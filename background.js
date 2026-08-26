// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * background.js
 * ==================================================================
 * バックグラウンドスクリプト（Manifest V3 では Service Worker）。
 *
 * ページ上の content script からは使えない機能を、ここで代行します:
 *   - chrome.downloads によるファイル保存（失敗時の再試行と後片付けを含む）
 *   - 外部 API へのアクセス（CORS の制約を受けない）
 *   - 結果のキャッシュ（同じ投稿を何度も開いても API を叩き直さない）
 *
 * Service Worker は使われないと自動で停止し、メッセージが来ると再起動します。
 * そのため下のキャッシュはページを開きっぱなしでも消えることがありますが、
 * 消えても再取得できるので問題ありません。
 * ==================================================================
 */

const api = globalThis.browser ?? globalThis.chrome;

/** PDS（ユーザーのデータが実際に置かれているサーバー）が特定できないときの既定値 */
const PDS = "https://bsky.social";

/** 投稿情報の取得に使う公開 API（AppView）のベース URL */
const APPVIEW = "https://public.api.bsky.app/xrpc";

/** ダウンロードに失敗したときに再試行する回数（初回の 1 回は含みません） */
const MAX_RETRY = 3;

/**
 * 再試行の前に待つ時間（ミリ秒）。1 回目・2 回目・3 回目の順に延ばします。
 * 一時的な混雑が原因のときは、少し間を置いたほうが成功しやすいためです。
 */
const RETRY_WAIT = [300, 800, 1500];

/** ダウンロードの進み具合を確認する間隔（ミリ秒） */
const POLL_INTERVAL = 500;

/** 1 件のダウンロードを待つ上限（ミリ秒）。大きな動画でも足りるよう長めにしてあります */
const POLL_LIMIT = 10 * 60 * 1000;

/**
 * 何度やり直しても結果が変わらない中断理由の一覧。
 * これらが返ってきた場合は再試行せず、その場で失敗として打ち切ります。
 * 文字列はブラウザの downloads API が返す InterruptReason です。
 */
const FATAL = new Set([
    "USER_CANCELED",             // 保存ダイアログでキャンセルされた
    "USER_SHUTDOWN",             // ブラウザが終了した
    "SERVER_BAD_CONTENT",        // 404。その URL にファイルが無い
    "SERVER_UNAUTHORIZED",       // 401
    "SERVER_FORBIDDEN",          // 403
    "FILE_ACCESS_DENIED",        // 保存先に書き込めない
    "FILE_NO_SPACE",             // 空き容量が足りない
    "FILE_NAME_TOO_LONG",        // ファイル名が長すぎる
    "FILE_TOO_LARGE",
    "FILE_BLOCKED",              // ブラウザや別の拡張機能の方針で止められた
    "FILE_SECURITY_CHECK_FAILED",
    "FILE_VIRUS_INFECTED",
]);

/**
 * 指定したミリ秒だけ待つ。
 * setTimeout を Promise で包むと、await で「ここで待つ」と素直に書けるようになります。
 *
 * @param {number} ms - 待つ時間（ミリ秒）
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 取得結果を覚えておく簡易キャッシュ。
 * 値には「結果」ではなく「Promise」を入れているのがポイントで、
 * 同じキーへの問い合わせが同時に来ても通信は 1 回で済みます。
 * @type {Map<string, Promise<unknown>>}
 */
const store = new Map();

/**
 * キャッシュ付きで非同期処理を実行する。同じキーなら 2 回目以降は通信しない。
 *
 * @param {string} key - キャッシュのキー（例: "pds:did:plc:xxxx"）
 * @param {() => Promise<unknown>} load - 実際に取得を行う関数
 * @returns {Promise<unknown>} 取得結果（失敗時は null）
 */
const once = (key, load) => {
    if (!store.has(key)) {
        // 失敗した Promise を残すと「一度失敗したら永久に失敗」になってしまうため、
        // catch でキャッシュから削除し、次回は再挑戦できるようにしています。
        // (store.delete(key), null) はカンマ演算子で「削除してから null を返す」書き方です。
        store.set(key, load().catch(() => (store.delete(key), null)));
    }

    // 際限なく増えないよう上限 300 件。Map は挿入順を保つので、
    // keys().next().value は「一番古く追加されたキー」になります。
    if (store.size > 300) store.delete(store.keys().next().value);

    return store.get(key);
};

/**
 * URL へ GET リクエストを送り、JSON として解析する。
 *
 * @param {string} url - 取得先の URL
 * @returns {Promise<any>} 解析済みの JSON
 * @throws {Error} HTTP ステータスが 200 番台でない場合
 */
const json = async (url) => {
    // AbortSignal.timeout(10000) は「10 秒で自動的に中断する」信号。
    // 応答が返らないサーバーで永久に待たされるのを防ぎます。
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

    // fetch は 404 や 500 でも例外を投げないので、自分で確認する必要があります。
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    return response.json();
};

/**
 * did:web 形式の DID から、DID ドキュメントの URL を組み立てる。
 *   did:web:example.com          → https://example.com/.well-known/did.json
 *   did:web:example.com:user:bob → https://example.com/user/bob/did.json
 *
 * @param {string} did - "did:web:" で始まる DID
 * @returns {string} did.json の URL
 */
const didWebUrl = (did) => {
    // "did:web:" を取り除き、残りをコロンで分解します。
    // 分割代入の ...path は「2 個目以降をまとめて配列にする」書き方です。
    const [host, ...path] = did.slice("did:web:".length).split(":");

    // パス部分が無い場合の既定値は .well-known（仕様で決まっています）。
    const dir = path.length > 0 ? path.map(decodeURIComponent).join("/") : ".well-known";

    return `https://${decodeURIComponent(host)}/${dir}/did.json`;
};

/**
 * DID から、その人のデータが置かれている PDS の URL を解決する。
 *
 * @param {string} did - "did:plc:..." または "did:web:..."
 * @returns {Promise<string>} PDS の URL。解決できなければ既定の bsky.social
 */
const pdsOf = (did) => once(`pds:${did}`, async () => {
    // did:web は自分のサーバーから、did:plc は plc.directory から DID ドキュメントを取ります。
    const doc = await json(did.startsWith("did:web:")
        ? didWebUrl(did)
        : `https://plc.directory/${encodeURIComponent(did)}`);

    // service 配列の中から PDS のエントリを探します。
    // 仕様上 type か id のどちらかで判別できるため、両方を条件にしています。
    const service = (doc.service ?? []).find(
        (s) => s.type === "AtprotoPersonalDataServer" || String(s.id ?? "").endsWith("#atproto_pds")
    );

    // 末尾のスラッシュを削って URL を組み立てやすくします。
    const endpoint = String(service?.serviceEndpoint ?? "").replace(/\/+$/, "");

    // https 以外（http や空文字）が返ってきた場合は安全のため既定値へ。
    return endpoint.startsWith("https://") ? endpoint : PDS;
});

/**
 * ハンドル（example.bsky.social）を DID へ変換する。すでに DID ならそのまま返す。
 *
 * @param {string} actor - ハンドルまたは DID
 * @returns {Promise<string|null>} DID。解決できなければ null
 */
const didOf = async (actor) => {
    if (actor.startsWith("did:")) return actor;

    const data = await once(`did:${actor}`, () =>
        json(`${APPVIEW}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(actor)}`));

    return data?.did ?? null;
};

/**
 * DID と rkey（投稿 ID）から投稿データを取得する。
 *
 * @param {string} did - 投稿者の DID
 * @param {string} rkey - 投稿 ID（URL の末尾部分）
 * @returns {Promise<object|null>} 投稿オブジェクト。見つからなければ null
 */
const postOf = (did, rkey) => once(`post:${did}/${rkey}`, async () => {
    // AT Protocol では投稿を at:// で始まる URI で表します。
    const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
    const data = await json(`${APPVIEW}/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`);
    return data?.posts?.[0] ?? null;
});

/**
 * ダウンロード 1 件が終わるまで待ち、成功したかどうかを返す。
 *
 * downloads.download() は「開始できた」時点で解決してしまうため、その戻り値だけでは
 * 404 や通信断に気づけません（成功と区別が付きません）。そこで downloads.search() で
 * 状態を繰り返し確認し、"in_progress" でなくなるまで待ちます。
 *
 * 副次的な効果として、この定期的な API 呼び出しがサービスワーカーのアイドル判定を
 * リセットするため、長いダウンロードの最中にバックグラウンドが止まるのも防げます。
 *
 * @param {number} id - downloads.download() が返したダウンロード ID
 * @returns {Promise<{ok: boolean, error: string}>} ok が true なら保存完了
 */
const finished = async (id) => {
    for (let waited = 0; waited < POLL_LIMIT; waited += POLL_INTERVAL) {
        // search は id を指定すると、その 1 件だけが入った配列を返します。
        // [item] は分割代入で「配列の 0 番目を取り出す」書き方です。
        const [item] = await api.downloads.search({ id }).catch(() => []);

        // 見つからない場合（履歴から消された等）は追跡できないので失敗扱いにします。
        if (!item) return { ok: false, error: "NOT_FOUND" };

        if (item.state === "complete") return { ok: true, error: "" };
        if (item.state === "interrupted") return { ok: false, error: item.error ?? "INTERRUPTED" };

        // まだ転送中なので、少し待ってからもう一度確認します。
        // 待つ前に 1 回目の確認を済ませているので、小さい画像なら待ち時間ゼロで終わります。
        await sleep(POLL_INTERVAL);
    }

    // 上限まで待っても終わらなかった場合（一時停止されたときなど）。
    return { ok: false, error: "TIMEOUT" };
};

/**
 * ファイルを 1 件保存する。失敗した場合は MAX_RETRY 回まで再試行し、
 * それでも駄目なら諦めて false を返す。
 *
 * 最終的に失敗した項目は downloads.erase() で履歴から取り除きます。
 * 中断されたダウンロードの書きかけファイルはブラウザ自身が破棄するため、
 * これで「壊れたファイルだけが残る」状態を防げます。
 *
 * @param {{url: string, filename: string}} item - 保存する 1 件
 * @param {{conflictAction: string, saveAs: boolean}} options - ダウンロード API へ渡す設定
 * @returns {Promise<boolean>} 最終的に保存できたら true
 */
const saveOne = async (item, options) => {
    // attempt は 0 始まり。0 が初回で、1〜MAX_RETRY が再試行にあたります。
    for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
        let id;

        try {
            id = await api.downloads.download({ ...item, ...options });
        } catch {
            // ここで例外になるのは、保存ダイアログをキャンセルした場合など、
            // ダウンロードを開始すらできなかったときです。やり直す意味がないので打ち切ります。
            return false;
        }

        const { ok, error } = await finished(id);
        if (ok) return true;

        // まだ終わっていないだけ（一時停止など）の場合は、こちらから手出しをしません。
        // 進行中のものを erase すると、追跡できないダウンロードが残ってしまうためです。
        if (error === "TIMEOUT") return false;

        // 失敗した項目は「失敗」として履歴に残るので、消しておきます。
        // catch を付けているのは、消せなくても本筋には影響しないためです。
        await api.downloads.erase({ id }).catch(() => {});

        // 何度試しても同じ結果になる種類の失敗は、ここで打ち切ります。
        if (FATAL.has(error)) return false;

        // 最後の試行だったなら、もう待つ必要はありません。
        if (attempt < MAX_RETRY) await sleep(RETRY_WAIT[attempt] ?? 1500);
    }

    return false;
};

/**
 * content script から送られてくるメッセージの種類ごとの処理をまとめた表。
 * message.type がそのままキーになります。
 */
const HANDLERS = {
    /**
     * ファイルをダウンロードする。
     * 1 件ずつ順に保存し、失敗したものは最大 MAX_RETRY 回まで再試行します。
     *
     * @param {object} message
     * @param {{url: string, filename: string}[]} [message.items=[]] - 保存するファイルの一覧
     * @param {string} message.conflictAction - 同名ファイルがあるときの動作
     * @param {boolean} message.saveAs - 保存ダイアログを表示するか
     * @returns {Promise<{done: number, failed: number}>} 成功数と失敗数
     */
    download: async ({ items = [], conflictAction, saveAs }) => {
        let done = 0;

        for (const { url, filename } of items) {
            // 受け取った値をそのまま信用せず、必ず検証します。
            // https 以外（javascript: や file: など）を弾くのが目的です。
            if (typeof url !== "string" || !url.startsWith("https://") || !filename) continue;

            // await を付けて 1 件ずつ順番に保存します（同時実行すると失敗しやすいため）。
            // 再試行と後片付けは saveOne の中で面倒を見ます。
            // 1 件失敗しても残りは続行し、失敗数は最後に items.length との差分で計算します。
            if (await saveOne({ url, filename }, { conflictAction, saveAs })) done += 1;
        }

        return { done, failed: items.length - done };
    },

    /**
     * Bluesky の投稿情報と PDS の URL をまとめて返す。
     *
     * @param {object} message
     * @param {string} [message.actor] - ハンドルまたは DID
     * @param {string} [message.rkey] - 投稿 ID
     * @returns {Promise<{post: object|null, pds: string}>}
     */
    bskyPost: async ({ actor, rkey }) => {
        const did = actor ? await didOf(actor) : null;

        // DID が分からなければ投稿も引けないので、既定の PDS だけ返します。
        if (!did) return { post: null, pds: PDS };

        return { post: rkey ? await postOf(did, rkey) : null, pds: (await pdsOf(did)) ?? PDS };
    },
};

/**
 * content script からのメッセージを受け取る入り口。
 *
 * 重要な注意点として、非同期で返事をする場合はリスナーが同期的に true を
 * 返さなければなりません。false や undefined を返すとメッセージ経路が
 * すぐ閉じられ、sendResponse を呼んでも相手に届かなくなります。
 */
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = HANDLERS[message?.type];

    // 知らない種類のメッセージは他のリスナーに任せます。
    if (!handler) return false;

    // then の第 2 引数はエラー時のコールバック。失敗したら null を返して
    // 呼び出し側が「通信エラー」として扱えるようにします。
    handler(message).then(sendResponse, () => sendResponse(null));

    return true; // 「あとで sendResponse を呼ぶので経路を開けたままにして」の合図
});
