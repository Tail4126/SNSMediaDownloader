// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * background.js
 * ==================================================================
 * バックグラウンドスクリプト（Manifest V3 では Service Worker）。
 *
 * ページ上の content script からは使えない機能を、ここで代行します:
 *   - chrome.downloads によるファイル保存
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
 * content script から送られてくるメッセージの種類ごとの処理をまとめた表。
 * message.type がそのままキーになります。
 */
const HANDLERS = {
    /**
     * ファイルをダウンロードする。
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

            try {
                // await を付けて 1 件ずつ順番に保存します（同時実行すると失敗しやすいため）。
                await api.downloads.download({ url, filename, conflictAction, saveAs });
                done += 1;
            } catch {
                // 1 件失敗しても残りは続行したいので、ここでは何もしません。
                // 失敗数は最後に items.length との差分で計算します。
            }
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
