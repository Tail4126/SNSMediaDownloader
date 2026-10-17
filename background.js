// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * background.js
 * ==================================================================
 * バックグラウンドスクリプト。
 * Chrome では Service Worker、Firefox ではイベントページとして動きます。
 * manifest.json の background には service_worker と scripts の両方を書いてあります。
 * Chrome は service_worker を、Firefox は scripts を使い、もう片方は無視します。
 * ブラウザ専用の manifest-chrome.json と manifest-firefox.json には、それぞれ自分が使うほうだけを書いてあります。
 *
 * ページ上の content script にはできない仕事を、ここで引き受けます。
 *   - 保存先のファイル名の組み立て（設定のテンプレートから。shared/template.js を使います）
 *   - chrome.downloads によるファイル保存（1 件ずつ順番に。失敗時の再試行と後片付けを含む）
 *   - ダウンロード数カウンター（全タブ合算）と保存済みの記録
 *   - Bluesky の API へのアクセス（CORS の制約を受けない）と結果のキャッシュ
 *   - ニコニコ静画の原寸画像の URL の取得
 *
 * 【いつ止められても続きから動けるように】
 * バックグラウンドは、しばらく暇だとブラウザに止められます。
 *   - Chrome : 30 秒間なにも起きないと停止。1 つのイベントの処理が 5 分を超えても停止。
 *   - Firefox: 30 秒間イベントが届かないと停止（API を呼んでいるだけでは延長されない）。
 * そのため「保存が終わるまで関数の中で待ち続ける」作りにはできません。代わりに、
 *   1. 保存待ちの列・保存中の 1 件・カウンター・保存済みの記録を、変わるたびに storage.session へ書き出す
 *   2. 完了は downloads.onChanged イベントで受け取る（止まっていてもイベントで起こされる）
 *   3. 受信が止まったままのダウンロードは、alarms で 30 秒ごとに見回る
 * という作りにしています。どこで止められても、次に起こされたときに storage から
 * 状態を読み直し、続きから処理します。
 *
 * 【速さのための工夫】
 *   - storage の読み込みは起こされたときの 1 回だけ。書き込みは、続けて起きた変化を少し待って 1 回にまとめ、
 *     書き終わるのを待たずに次へ進む。ただし「保存を始める」ことだけは、ダウンロードを頼む前に書き出す
 *     （それ以外の変化は、書き出す前に止められても、起こされたときの見回りで同じ状態に戻せます）
 *   - タブへの知らせは、カウンターと「保存できた 1 件」を 1 通のメッセージ（smdUpdate）にまとめる
 *   - 保存済みの記録は、投稿 1 件を 1 個の数値に詰めて持つ（コピーも転送も軽い）。
 *     タブを開いたときに渡すのは、そのタブのサイトの分だけ
 *   - Bluesky の API 応答は、使う項目だけに絞ってからキャッシュする（メモリも転送量も小さい）
 * ==================================================================
 */

// ファイル名の組み立てに使う shared/template.js（globalThis.SMD）を読み込みます。
// Firefox は manifest の scripts に並べた順に読み込むので、ここに来た時点で読み込み済みです。
// Chrome の Service Worker は 1 ファイルしか指定できないので、ここで importScripts() を使って読み込みます
// （importScripts は Service Worker の中にしかない関数で、Firefox のイベントページでは呼びません）。
if (!globalThis.SMD) importScripts("shared/template.js");

// ==================================================================
// 定数
// ==================================================================

/** PDS（投稿者のデータが置かれているサーバー）が特定できないときの既定値 */
const PDS = "https://bsky.social";

/** Bluesky の投稿情報の取得に使う公開 API（AppView） */
const APPVIEW = "https://public.api.bsky.app/xrpc";

/** X のメディアを配信しているホスト。X 由来の URL はこれ以外を保存しません */
const X_MEDIA_HOSTS = new Set(["pbs.twimg.com", "video.twimg.com"]);

/** Bluesky のメディアを取得するエンドポイントのパス（ホストは投稿者ごとの PDS） */
const BSKY_BLOB_PATH = "/xrpc/com.atproto.sync.getBlob";

/** ポイピクの画像を配信しているホスト */
const POIPIKU_MEDIA_HOST = "cdn.poipiku.com";

/** Privatter の画像を配信しているホストと、原寸画像のパスの頭 */
const PRIVATTER_MEDIA_HOST = "d2pqhom6oey9wx.cloudfront.net";
const PRIVATTER_MEDIA_PATH = "/img_original/";

/** Privatter+ の原寸画像の URL の形（ホストと /img/{ユーザー番号}/original/） */
const PRIVATTER_PLUS_MEDIA_HOST = "media.privatter.me";
const PRIVATTER_PLUS_MEDIA_PATH = /^\/img\/\d+\/original\//;

/**
 * Skeb の作品のメディアの URL の形。どちらも署名付きなので、ページに書かれた URL をそのまま保存します。
 *   - 画像 … si.imgix.net の /{英数字}/uploads/origins/{ファイルの ID}（作品ページに表示される画像）
 *   - 動画・音声 … fcdn.skeb.jp の /uploads/outputs/{ファイルの ID}
 * 同じホストにある依頼の添付画像（/requests/…）や、アイコン・サイトの部品（/assets/…）は当てはまりません。
 */
const SKEB_IMAGE_HOST = "si.imgix.net";
const SKEB_IMAGE_PATH = /^\/[0-9a-f]+\/uploads\/origins\/[\w-]+$/;
const SKEB_FILE_HOST = "fcdn.skeb.jp";
const SKEB_FILE_PATH = /^\/uploads\/outputs\/[\w-]+$/;

/**
 * ニコニコ静画のイラストの原寸画像の URL の形（lohas.nicoseiga.jp の /priv/{署名}/{期限}/{イラスト番号}）。
 * 署名と期限が URL に入っているので、Cookie を送らなくても取得できます。
 */
const SEIGA_IMAGE_HOST = "lohas.nicoseiga.jp";
const SEIGA_IMAGE_PATH = /^\/priv\/[0-9a-f]+\/\d+\/\d+$/;

/**
 * ニコニコ漫画のページの画像の URL の形（deliver.cdn.nicomanga.jp の /thumb/{署名付きの URL を符号化した文字列}.webp）。
 * 同じホストの /thumb/mg_thumb/… や /material/… （作品のアイコンやバナー）は当てはまりません。
 */
const MANGA_IMAGE_HOST = "deliver.cdn.nicomanga.jp";
const MANGA_IMAGE_PATH = /^\/thumb\/[\w-]+\.webp$/;

/** ニコニコ静画のイラストの「原寸大で見る」のリンク先。ログインしていれば原寸画像のページへ転送されます */
const SEIGA_SOURCE = "https://seiga.nicovideo.jp/image/source/";

/** 原寸画像の MIME タイプから拡張子へ。ここに無いものは jpg とします */
const SEIGA_EXT = { "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/jpeg": "jpg" };

/** 失敗したときの再試行の待ち時間（ミリ秒）。要素の数が再試行の回数です（初回は含まない） */
const RETRY_WAIT = [300, 800, 1500];

/**
 * 受信量が増えないまま、これだけ経ったら諦める（ミリ秒）。
 * 合計時間ではなく「止まっている時間」で判断するので、遅い回線での大きな動画も最後まで待てます。
 */
const STALL_LIMIT = 3 * 60 * 1000;

/**
 * downloads.download() の返事を待っている途中でバックグラウンドが止められたとき、
 * 「始まらなかった」と判断するまでの猶予（ミリ秒）。それまでは、始まったダウンロードが無いか探し続けます。
 * 保存ダイアログを出すときは、利用者が保存先を選ぶまで始まらないので長めにします。
 */
const START_GRACE = 60 * 1000;
const SAVE_AS_GRACE = 10 * 60 * 1000;

/**
 * 何度やり直しても結果が変わらない中断理由。これらは再試行しません。
 * START_FAILED は、downloads.download() がその場で拒否した場合（ファイル名が不正など）に
 * この拡張機能が付ける名前です。
 */
const FATAL = new Set([
    "USER_CANCELED", "USER_SHUTDOWN", "START_FAILED",
    "SERVER_BAD_CONTENT", "SERVER_UNAUTHORIZED", "SERVER_FORBIDDEN",
    "SERVER_CERT_PROBLEM", "SERVER_CROSS_ORIGIN_REDIRECT", "NETWORK_INVALID_REQUEST",
    "FILE_ACCESS_DENIED", "FILE_NO_SPACE", "FILE_NAME_TOO_LONG", "FILE_TOO_LARGE",
    "FILE_BLOCKED", "FILE_SECURITY_CHECK_FAILED", "FILE_VIRUS_INFECTED", "FILE_SAME_AS_SOURCE",
]);

/** 1 回の依頼（ボタン 1 回分）で受け付けるファイル数の上限と、URL の長さの上限 */
const MAX_ITEMS = 500;
const MAX_URL_LENGTH = 8192;

/**
 * content script から届いた文字列のうち、ファイル名の組み立てに使う長さの上限。
 * ファイル名の 1 階層は 150 バイトまでで、値は先頭から使うので、これより後ろが使われることはありません。
 */
const MAX_TEXT_LENGTH = 10000;

/**
 * 状態の変化を知らせる先のタブ。manifest の content_scripts に書いた範囲をそのまま使います
 * （ここに書き写すと、サイトを足したときに直し忘れるため）。同じ範囲が 2 回出てくる X は 1 つにまとめます。
 */
const TAB_URLS = [...new Set(chrome.runtime.getManifest().content_scripts.flatMap((script) => script.matches))];

/** 待ちが 0 になってから、カウンターを表示し続ける時間（ミリ秒） */
const LINGER = 5000;

/** 保存済みの記録に覚えておく投稿の上限。超えたら古いものから捨てます */
const HISTORY_LIMIT = 3000;

/**
 * 1 投稿のメディア数として受け付ける上限。保存済みの番号を 32 ビットの数値で持つため 32 までです
 * （X も Bluesky も、実際は 1 投稿 4 件まで）。
 * これを超える投稿（ポイピクでは起こり得ます）も保存はできますが、保存済みとしては記録しません。
 */
const MAX_MEDIA = 32;

/** 保存済みの記録の値で、メディア総数を上位に詰めるための桁（2^32）。値の形は shared/core.js と共通です */
const PACK = 2 ** 32;

/**
 * 保存済みの記録の保存先キー（storage.session）。通常ウィンドウとシークレットウィンドウで分けます。
 * 拡張機能はどちらのウィンドウでも同じバックグラウンドを使うため、
 * 分けておかないとシークレットで保存した記録が通常ウィンドウに漏れてしまいます。
 */
const HISTORY_KEY = { n: "history", i: "historyIncognito" };

/** 保存待ちの列・保存中の 1 件・カウンターをまとめた「状態」の保存先キー（storage.session） */
const STATE_KEY = "queue";

/**
 * 状態が変わってから storage.session へ書き出すまでの待ち時間（ミリ秒）。
 * この間に続けて起きた変化（受け付け → 保存の開始、完了 → 次の保存の開始など）は、1 回の書き込みにまとめます。
 */
const WRITE_DELAY = 200;

/** 保存中のダウンロードを見回るアラームの名前 */
const WATCH_ALARM = "smd-watch";

/** ボタン 1 回分の保存（バッチ）の ID として受け付ける形。content script が crypto.randomUUID() で作ります */
const BATCH_ID = /^[\w-]{1,64}$/;

/** Bluesky のメディアの MIME タイプから拡張子へ。ここに無いものは jpg（画像）/ mp4（動画）とします */
const BSKY_EXT = {
    "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif",
    "video/webm": "webm", "video/quicktime": "mov",
};

// ==================================================================
// Bluesky の API
// ==================================================================

/**
 * 取得結果のキャッシュ。値に Promise を入れているので、同時に同じ問い合わせが来ても通信は 1 回です。
 * バックグラウンドが止まると消えますが、取り直せばよいだけなので問題ありません。
 * @type {Map<string, Promise<unknown>>}
 */
const cache = new Map();

/**
 * キャッシュ付きで非同期処理を実行する。失敗した結果は残さず、次回は取り直します。
 *
 * @param {string} key - キャッシュのキー
 * @param {() => Promise<unknown>} load - 実際の取得処理
 * @returns {Promise<unknown>} 取得結果。失敗時は null
 */
const once = (key, load) => {
    if (!cache.has(key)) {
        const promise = load().catch(() => {
            // 失敗した結果はキャッシュから消します。ただし、上限超えで一度追い出された後に
            // 同じキーで取り直している最中なら、その新しいほうは消さないよう、同じものか確かめます。
            if (cache.get(key) === promise) cache.delete(key);
            return null;
        });
        cache.set(key, promise);

        // 上限 300 件。Map は挿入順を保つので、先頭が一番古いキーです。
        if (cache.size > 300) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
};

/**
 * URL を GET して JSON として返す。10 秒で打ち切ります。
 *
 * @param {string} url
 * @returns {Promise<any>}
 */
const json = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
};

/**
 * content script から届く AT Protocol の識別子として受け付ける形。URL に組み込む前に、形を確かめます
 * （ページの DOM から読んだ値なので、"did:web:example.com%2F..." のような、別の URL を作る値も届き得るため）。
 *   did:plc … did:plc: に続く英小文字と数字（今の形式は 24 文字の base32）
 *   did:web … did:web: に続くホスト名。AT Protocol はホスト名だけの did:web にしか対応していません
 *             （パス付きやポート付き、IP アドレスは使われないので受け付けません）
 *   ハンドル … ドメイン名の形（example.bsky.social）
 *   rkey    … 投稿 ID（レコードキー）
 */
const PLC_DID = /^did:plc:[a-z0-9]{1,64}$/;
const WEB_DID = /^did:web:((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)$/;
const HANDLE = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const RKEY = /^[a-zA-Z0-9._:~-]{1,512}$/;

/**
 * 受け付ける形の DID か。
 *
 * @param {unknown} did
 * @returns {did is string}
 */
const isDid = (did) => typeof did === "string" && (PLC_DID.test(did) || WEB_DID.test(did));

/**
 * DID から、その人の PDS の URL を調べる。
 *   did:plc:…           → https://plc.directory/{DID}
 *   did:web:example.com → https://example.com/.well-known/did.json
 *
 * did:web の DID ドキュメントは投稿者自身のドメインにあり、host_permissions の外です。権限の外でも
 * リクエスト自体は送れてしまう（応答が CORS で読めないだけで、相手のサーバーには届く）ので、
 * そのドメインへの権限があるときだけ問い合わせます。無ければ問い合わせず、既定の PDS を使います
 * （PRIVACY.md・README に書いているとおり、既定の権限では did:web は解決しません）。
 *
 * @param {string} did - isDid() で確かめた DID
 * @returns {Promise<string|null>} https の URL。調べられなければ null
 */
const pdsOf = (did) => once(`pds:${did}`, async () => {
    const web = WEB_DID.exec(did);
    if (web && !(await chrome.permissions.contains({ origins: [`https://${web[1]}/*`] }).catch(() => false))) return null;

    const doc = await json(web
        ? `https://${web[1]}/.well-known/did.json`
        : `https://plc.directory/${encodeURIComponent(did)}`);

    // DID ドキュメントの service 一覧から、PDS を表す項目を探します。
    const services = Array.isArray(doc?.service) ? doc.service : [];
    const service = services.find(
        (s) => s?.type === "AtprotoPersonalDataServer" || String(s?.id ?? "").endsWith("#atproto_pds"));

    // https の URL で、ユーザー名・クエリ・フラグメントを含まないものだけを使います
    // （content script はこの後ろに /xrpc/… を足して、ダウンロード元の URL を作るため）。
    const endpoint = URL.parse(String(service?.serviceEndpoint ?? ""));
    if (!endpoint || endpoint.protocol !== "https:" || endpoint.username || endpoint.password
        || endpoint.search || endpoint.hash) return null;
    return `${endpoint.origin}${endpoint.pathname.replace(/\/+$/, "")}`;
});

/**
 * ハンドル（example.bsky.social）を DID へ変換する。すでに DID ならそのまま返す。
 *
 * @param {string} actor - ハンドルまたは DID
 * @returns {Promise<string|null>} 受け付ける形の DID。調べられなければ null
 */
const didOf = async (actor) => {
    if (actor.startsWith("did:")) return isDid(actor) ? actor : null;
    if (!HANDLE.test(actor)) return null;

    const data = await once(`did:${actor.toLowerCase()}`, () =>
        json(`${APPVIEW}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(actor)}`));
    return isDid(data?.did) ? data.did : null;
};

/**
 * blob 参照から CID を取り出す（新しい形式は ref.$link、初期の投稿に残っている形式は cid）。
 *
 * @param {object} blob
 * @returns {string}
 */
const cidOf = (blob) => String(blob?.ref?.$link ?? blob?.cid ?? "");

/**
 * API の投稿データを、この拡張機能が使う項目だけに絞る。
 * 投稿データは数 KB あり、そのままキャッシュ・転送すると無駄が大きいためです。
 *
 * @param {object} post - app.bsky.feed.getPosts の結果 1 件
 * @returns {{did: string, handle: string, name: string, text: string, time: string|null,
 *            media: {kind: string, cid: string, ext: string, res: string}[]}}
 */
const summarize = (post) => {
    const record = post.record ?? {};

    // 引用つきの投稿では、メディアは embed.media の下に入れ子になります。
    const embed = record.embed?.media ?? record.embed ?? {};
    const blobs = embed.images ?? embed.items
        ?? (embed.video ? [{ image: embed.video, aspectRatio: embed.aspectRatio, video: true }] : []);

    return {
        did: String(post.author?.did ?? ""),
        handle: String(post.author?.handle ?? ""),
        name: String(post.author?.displayName ?? ""),
        text: String(record.text ?? ""),

        // 投稿日時はサーバーが受け取った時刻（indexedAt）だけを使います。
        // record.createdAt は投稿者の端末の自己申告で、ずれや書き換えがあり得るためです。
        time: typeof post.indexedAt === "string" ? post.indexedAt : null,

        media: (Array.isArray(blobs) ? blobs : []).filter((b) => cidOf(b?.image)).map((b) => ({
            kind: b.video ? "video" : "photo",
            cid: cidOf(b.image),
            ext: Object.hasOwn(BSKY_EXT, b.image.mimeType) ? BSKY_EXT[b.image.mimeType] : b.video ? "mp4" : "jpg",
            res: b.aspectRatio?.width ? `${b.aspectRatio.width}x${b.aspectRatio.height}` : "",
        })),
    };
};

/**
 * DID と rkey（投稿 ID）から投稿を取得し、使う項目だけに絞って返す。
 *
 * @param {string} did
 * @param {string} rkey
 * @returns {Promise<ReturnType<typeof summarize>|null>}
 */
const postOf = (did, rkey) => once(`post:${did}/${rkey}`, async () => {
    const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
    const data = await json(`${APPVIEW}/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`);
    const post = data?.posts?.[0];
    return post ? summarize(post) : null;
});

// ==================================================================
// 受け取った値の検証
// ==================================================================

/**
 * 保存してよいメディアの URL か確かめる。
 *
 * X の URL は、ページ内のスクリプトが偽のメッセージで差し込める経路があるため、
 * X のメディア配信ホストだけに絞ります。Bluesky は投稿者の PDS（任意の https ホスト）から
 * 取得するので、ホストではなく getBlob のパスで判断します。ポイピクは画像の配信ホストだけに絞ります。
 * Privatter と Privatter+ は、配信ホストに原寸画像以外のファイル（アイコンなど）もあるので、原寸画像のパスでも絞ります。
 * Skeb・ニコニコ静画・ニコニコ漫画も同じく、作品の画像のパスで絞ります。
 * URL.parse は、解析できなければ例外ではなく null を返すので、1 回の解析で済みます。
 *
 * @param {unknown} url
 * @returns {boolean}
 */
const isMediaUrl = (url) => {
    const parsed = typeof url === "string" ? URL.parse(url) : null;
    return parsed !== null && parsed.protocol === "https:"
        && (X_MEDIA_HOSTS.has(parsed.hostname) || parsed.pathname === BSKY_BLOB_PATH
            || parsed.hostname === POIPIKU_MEDIA_HOST
            || (parsed.hostname === PRIVATTER_MEDIA_HOST && parsed.pathname.startsWith(PRIVATTER_MEDIA_PATH))
            || (parsed.hostname === PRIVATTER_PLUS_MEDIA_HOST && PRIVATTER_PLUS_MEDIA_PATH.test(parsed.pathname))
            || (parsed.hostname === SKEB_IMAGE_HOST && SKEB_IMAGE_PATH.test(parsed.pathname))
            || (parsed.hostname === SKEB_FILE_HOST && SKEB_FILE_PATH.test(parsed.pathname))
            || (parsed.hostname === SEIGA_IMAGE_HOST && SEIGA_IMAGE_PATH.test(parsed.pathname))
            || (parsed.hostname === MANGA_IMAGE_HOST && MANGA_IMAGE_PATH.test(parsed.pathname)));
};

/**
 * content script から届いた値を、ファイル名の組み立てに使ってよい形にする。
 * 文字列ならそのまま（長すぎれば先頭だけ）使い、それ以外は「無い」ものとして undefined にします。
 * 文字列の中身（使えない文字など）は、SMD.buildPath がファイル名にするときに整えます。
 *
 * @param {unknown} value
 * @returns {string|undefined}
 */
const stringOf = (value) => (typeof value === "string" ? value.slice(0, MAX_TEXT_LENGTH) : undefined);

/**
 * content script から届いた投稿情報（core.js の PostInfo）を、使う項目だけの新しいオブジェクトにする。
 *
 * @param {unknown} post
 * @returns {{site?: string, screenName?: string, postId?: string, recordId?: string, name?: string,
 *            text?: string, time: string|null}}
 */
const postInfo = (post) => ({
    site: stringOf(post?.site),
    screenName: stringOf(post?.screenName),
    postId: stringOf(post?.postId),
    recordId: stringOf(post?.recordId),
    name: stringOf(post?.name),
    text: stringOf(post?.text),
    time: stringOf(post?.time) ?? null,
});

// ==================================================================
// 状態（保存待ちの列・保存中の 1 件・カウンター）と保存済みの記録
// ==================================================================

/**
 * @typedef {object} Job 保存 1 件分の仕事
 * @property {string} batch - ボタン 1 回分の保存（バッチ）の ID
 * @property {"n"|"i"} ctx - 通常ウィンドウ（n）かシークレットウィンドウ（i）か
 * @property {string} url - ダウンロード元
 * @property {string} filename - 保存先の相対パス
 * @property {string|null} key - 保存済みの記録のキー（"サイト:投稿ID"）。記録しないなら null
 * @property {number} index - 投稿内の番号（0 始まり）
 * @property {number} total - 投稿内のメディア総数
 * @property {string} conflictAction - 同名ファイルがあるときの動作
 * @property {boolean} saveAs - 保存ダイアログを表示するか
 * @property {number} attempt - 何回目の試行か（0 始まり）
 * @property {number} [notBefore] - この時刻（ミリ秒）までは始めない（再試行の待ち時間）
 * @property {number|null} [downloadId] - 保存中の 1 件だけが持つダウンロード ID
 * @property {number} [received] - 最後に確認した受信バイト数
 * @property {number} [since] - 受信バイト数が最後に増えた時刻（ミリ秒）
 */

/**
 * カウンターの初期値。
 * hideAt は「この時刻（ミリ秒）に表示を消す」予定で、0 なら予定なし（表示中か、何もしていない）。
 *
 * @returns {{pending: number, done: number, failed: number, hideAt: number}}
 */
const freshCounts = () => ({ pending: 0, done: 0, failed: 0, hideAt: 0 });

/**
 * 状態の初期値。
 *   jobs    … 保存待ちの列（先頭から順に保存）
 *   active  … 保存中の 1 件（無ければ null）
 *   batches … ボタン 1 回分ごとの集計。全件終わったら依頼元のタブへ結果を知らせます
 *   counts  … 画面左下のカウンター（通常 / シークレット別、全タブ合算）
 *
 * @returns {{jobs: Job[], active: Job|null, batches: Record<string, object>, counts: Record<string, object>}}
 */
const blankState = () => ({
    jobs: [],
    active: null,
    batches: {},
    counts: { n: freshCounts(), i: freshCounts() },
});

/**
 * 状態と保存済みの記録。起こされた直後の 1 回だけ storage.session からまとめて読み、
 * 以降は同じオブジェクトを使い回します（止められて起こし直されたときは、ここで前回の続きを読み戻します）。
 * storage.session は拡張機能を更新・再読み込みすると空になるので、読み戻すのは必ずこのファイルが書いたものです。
 *
 * 保存済みの記録は { "x:1234567890": 値 } の形で、値は「総数 × 2^32 + 保存済みの番号のビット」です。
 * ビットは「n 番目（0 始まり）を保存済みなら、下から n ビット目が 1」という数です。
 *
 * @type {Promise<{state: ReturnType<typeof blankState>, history: {n: Record<string, number>, i: Record<string, number>}}>|null}
 */
let ready = null;

/**
 * 読み終えた状態と保存済みの記録（ready が解決したときの値と同じもの）。
 * 書き出しを await せずに行うために、Promise を通さず直接使えるようにしておきます。
 * @type {Awaited<NonNullable<typeof ready>>|null}
 */
let loaded = null;

/** @returns {NonNullable<typeof ready>} */
const load = () => {
    ready ??= chrome.storage.session.get([STATE_KEY, HISTORY_KEY.n, HISTORY_KEY.i])
        .catch(() => ({}))
        .then((stored) => {
            loaded = {
                state: stored[STATE_KEY] ?? blankState(),
                history: { n: stored[HISTORY_KEY.n] ?? {}, i: stored[HISTORY_KEY.i] ?? {} },
            };
            return loaded;
        });
    return ready;
};

/** 書き出しを予約したタイマーの ID（0 なら予約なし） */
let writeTimer = 0;

/** 次の書き出しで、状態と一緒に書き出す保存済みの記録（"n" / "i"） */
const historyToWrite = new Set();

/**
 * 状態（と、変わったときは保存済みの記録）を storage.session へ書き出す予約をする。
 * 状態を変えたら必ず呼びます（load() で読んだものを変えたときだけなので、読み終えた後です）。
 * WRITE_DELAY の間に何度呼ばれても書き込みは 1 回で、書くのはその時点の（いちばん新しい）内容です。
 *
 * @param {"n"|"i"} [historyCtx] - 保存済みの記録も書き出すなら、どちらの記録か
 * @returns {void}
 */
const persist = (historyCtx) => {
    if (historyCtx) historyToWrite.add(historyCtx);
    writeTimer ||= setTimeout(write, WRITE_DELAY);
};

/**
 * 予約を待たずに、今の状態を書き出す（予約されていた記録の書き出しも一緒に行い、予約は取り消します）。
 * 書き終わるのは待ちませんが、拡張機能の API への依頼は呼んだ順に届くので、
 * この後に頼んだ処理（downloads.download() など）より先に書き込まれます。
 *
 * @returns {void}
 */
const write = () => {
    clearTimeout(writeTimer);
    writeTimer = 0;

    const data = { [STATE_KEY]: loaded.state };
    for (const ctx of historyToWrite) data[HISTORY_KEY[ctx]] = loaded.history[ctx];
    historyToWrite.clear();

    chrome.storage.session.set(data).catch(() => {});
};

/**
 * 保存済みの記録に 1 件書き足す（メモリ上だけ。書き出しは persist で行います）。
 *
 * @param {Record<string, number>} all - 通常 / シークレットどちらかの記録
 * @param {string} key - "サイト:投稿ID"
 * @param {number} index - 投稿内の番号（0 始まり）
 * @param {number} total - 投稿内のメディア総数
 * @returns {void}
 */
const record = (all, key, index, total) => {
    const known = key in all;
    const mask = ((known ? all[key] >>> 0 : 0) | (1 << index)) >>> 0;

    // 入れ直して末尾（一番新しい位置）へ移します。オブジェクトの文字列キーは入れた順に並ぶので、
    // 先頭が一番古いものになります。
    delete all[key];
    all[key] = total * PACK + mask;

    // 新しく増えたときだけ、上限を超えていないか数えます。超えたら先頭（一番古いもの）から捨てます。
    if (!known && Object.keys(all).length > HISTORY_LIMIT) {
        for (const old in all) {
            delete all[old];
            break;
        }
    }
};

/**
 * 送り主のタブが通常ウィンドウ（"n"）かシークレットウィンドウ（"i"）か。
 *
 * @param {chrome.runtime.MessageSender} [sender]
 * @returns {"n"|"i"}
 */
const ctxOf = (sender) => (sender?.tab?.incognito ? "i" : "n");

/**
 * カウンター（と、あれば保存できた 1 件）を、同じ種類のウィンドウで開いている対応サイトのタブすべてへ、
 * 1 通のメッセージで知らせる。
 *
 * @param {ReturnType<typeof blankState>} state
 * @param {"n"|"i"} ctx
 * @param {{key: string, index: number, total: number}} [saved] - 保存できた 1 件
 * @returns {Promise<void>}
 */
const notify = async (state, ctx, saved) => {
    const message = { type: "smdUpdate", counts: state.counts[ctx], saved };
    const tabs = await chrome.tabs.query({ url: TAB_URLS }).catch(() => []);

    for (const tab of tabs) {
        if (typeof tab.id !== "number" || (tab.incognito ? "i" : "n") !== ctx) continue;
        chrome.tabs.sendMessage(tab.id, message).catch(() => {}); // content script の無いタブは無視
    }
};

/**
 * カウンターを増減させる（メモリ上だけ。知らせるのは notify、書き出すのは persist）。
 *
 * 前回の表示がすでに消えている（待ち 0 で hideAt を過ぎた）なら、先に 0 から数え直します。
 * まだ表示中なら数を引き継ぎます。待ちが 0 になったら、LINGER 後に消す予定（hideAt）を立てます。
 * 実際に消すのは各タブが hideAt を見て行うので、ここではタイマーを使いません
 * （バックグラウンドが止められても、消え方は変わりません）。
 *
 * @param {ReturnType<typeof blankState>} state
 * @param {"n"|"i"} ctx
 * @param {{pending?: number, done?: number, failed?: number}} change - 増減させる量
 * @returns {void}
 */
const tally = (state, ctx, { pending = 0, done = 0, failed = 0 }) => {
    const c = state.counts[ctx];

    if (c.pending === 0 && c.hideAt <= Date.now()) Object.assign(c, freshCounts());

    c.pending = Math.max(0, c.pending + pending);
    c.done += done;
    c.failed += failed;
    c.hideAt = c.pending > 0 ? 0 : Date.now() + LINGER;
};

/**
 * バッチ（ボタン 1 回分）の集計に 1 件の結果を足し、全件終わったら依頼元のタブへ知らせる。
 * タブ側はこの知らせで、ボタンの「保存中」表示を解き、失敗があればトーストを出します。
 *
 * @param {ReturnType<typeof blankState>} state
 * @param {Job} job
 * @param {"done"|"failed"|"canceled"} outcome - 結果（canceled はどちらにも数えない）
 * @returns {void}
 */
const report = (state, job, outcome) => {
    const batch = state.batches[job.batch];
    if (!batch) return;

    batch.left -= 1;
    if (outcome !== "canceled") batch[outcome] += 1;
    if (batch.left > 0) return;

    delete state.batches[job.batch];
    if (typeof batch.tab === "number") {
        chrome.tabs.sendMessage(batch.tab, { type: "smdBatch", batch: job.batch, done: batch.done, failed: batch.failed })
            .catch(() => {}); // タブがもう閉じられていれば無視
    }
};

// ==================================================================
// 保存の順番待ち
// ==================================================================

/**
 * このバックグラウンドが今まさに downloads.download() の返事を待っているか。
 * 保存ダイアログが開いている間などは、ダウンロード ID がまだ決まっていません。
 * これはメモリ上だけの印なので、止められて起こし直されると false に戻ります。
 * それを利用して、「ID が無いのに誰も待っていない」＝開始の途中で止められた、と見分けます。
 */
let starting = false;

/**
 * 保存中の 1 件が無ければ、列の先頭を保存し始める。
 * 何度呼んでも安全です（保存中なら何もしません）。
 *
 * @returns {Promise<void>}
 */
const pump = async () => {
    const { state } = await load();
    if (state.active) return;

    const next = state.jobs[0];
    if (!next) {
        // 何も残っていなければ見回りも止めます。
        chrome.alarms.clear(WATCH_ALARM).catch(() => {});
        return;
    }

    // 再試行の待ち時間がまだ残っていれば、その分だけ後回しにします。
    const wait = (next.notBefore ?? 0) - Date.now();
    if (wait > 0) {
        setTimeout(pump, wait);
        return;
    }

    // ここから次の await までは、ほかの処理が割り込みません。
    // そのため「保存中の 1 件を決める」処理が二重に走ることはありません。
    state.jobs.shift();
    const job = { ...next, downloadId: null, received: -1, since: Date.now() };
    state.active = job;
    starting = true;

    // 「この 1 件を保存し始めた」ことは、ダウンロードを頼む前に書き出します（予約を待たずに）。
    // 書き出す前に止められると、起こし直されたときに同じファイルをもう一度保存してしまうためです。
    write();

    // 30 秒ごとの見回りを始めます（同じ名前で作り直すと、前のアラームは置き換わります）。
    // Chrome は Promise を返し、Firefox は何も返しませんが、この指定で失敗することはないので、結果は待ちません。
    chrome.alarms.create(WATCH_ALARM, { periodInMinutes: 0.5 });

    try {
        const { url, filename, conflictAction, saveAs } = job;
        const options = { url, filename, conflictAction, saveAs };

        // Firefox では、拡張機能が始めたダウンロードは、指定しないと通常のダウンロード履歴に残ります。
        // プライベートウィンドウで押されたものは、プライベートのダウンロードとして始めます
        // （Chrome にはこの指定が無く、渡すとエラーになるので Firefox だけです）。
        if (SMD.IS_FIREFOX && job.ctx === "i") options.incognito = true;

        job.downloadId = await chrome.downloads.download(options);
    } catch (error) {
        // その場で拒否された場合です。保存ダイアログのキャンセルと、それ以外（ファイル名が不正など）を分けます。
        starting = false;
        finish(job, /cancel/i.test(String(error?.message)) ? "USER_CANCELED" : "START_FAILED");
        return;
    }
    starting = false;
    persist();

    // ごく小さいファイルは、ここに来た時点で終わっていることがあるので、すぐに一度確かめます。
    watch();
};

/**
 * 保存中の 1 件の結果を処理して、次へ進む。
 *
 * @param {Job} job - 結果が出た仕事
 * @param {string} error - 空文字なら成功。それ以外は中断理由
 * @returns {Promise<void>}
 */
const finish = async (job, error) => {
    const { state, history } = await load();

    // イベントと見回りの両方から同じ結果が届くことがあります。先に処理したほうだけを通します。
    if (state.active !== job) return;
    state.active = null;

    // 失敗したダウンロードは履歴から消し、壊れたファイルを残しません。
    // 受信が止まっただけ（TIMEOUT）のものは、ユーザーが一時停止した可能性があるので残します。
    if (error && error !== "TIMEOUT" && typeof job.downloadId === "number") {
        await chrome.downloads.erase({ id: job.downloadId }).catch(() => {});
    }

    const retry = error && error !== "TIMEOUT" && !FATAL.has(error) && job.attempt < RETRY_WAIT.length;

    if (retry) {
        // やり直し: 少し待ってから、列の先頭で同じ仕事をもう一度行います。
        // 保存中の 1 件だけが使う項目（downloadId など）は、次に始めるときに pump() が付け直します。
        state.jobs.unshift({ ...job, attempt: job.attempt + 1, notBefore: Date.now() + RETRY_WAIT[job.attempt] });
        persist();
        pump();
        return;
    }

    // 保存ダイアログをユーザーが閉じた場合などは、失敗には数えません。
    const outcome = !error ? "done" : error === "USER_CANCELED" ? "canceled" : "failed";

    // 保存できたら記録に残し、カウンターと一緒に 1 通で知らせます。
    const saved = outcome === "done" && job.key ? { key: job.key, index: job.index, total: job.total } : undefined;
    if (saved) record(history[job.ctx], saved.key, saved.index, saved.total);

    tally(state, job.ctx, {
        pending: -1,
        done: outcome === "done" ? 1 : 0,
        failed: outcome === "failed" ? 1 : 0,
    });
    report(state, job, outcome);
    notify(state, job.ctx, saved);

    persist(saved ? job.ctx : undefined);
    pump();
};

/**
 * 開始の途中で止められた仕事の、始まっていたダウンロードを探す。
 * 同じ URL で、その仕事を始めた時刻より後に始まったもののうち、いちばん新しいものです。
 *
 * @param {Job} job
 * @returns {Promise<number|null>} ダウンロード ID。見つからなければ null
 */
const adopt = async (job) => {
    const items = await chrome.downloads.search({
        url: job.url,
        startedAfter: new Date(job.since - 1000).toISOString(),
    }).catch(() => []);

    let best = null;
    for (const item of items) {
        if (typeof item?.id !== "number") continue;
        if (!best || Date.parse(item.startTime) > Date.parse(best.startTime)) best = item;
    }
    return best ? best.id : null;
};

/**
 * 保存中の 1 件の様子を確かめる。
 * downloads.onChanged を取りこぼした場合や、受信が止まったままの場合に備えた見回りです。
 *
 * @returns {Promise<void>}
 */
const watch = async () => {
    const { state } = await load();
    const job = state.active;
    if (!job) return pump();

    if (job.downloadId === null) {
        // 開始の返事を待っている最中（保存ダイアログが開いているなど）なら、そのまま待ちます。
        if (starting) return;

        // 誰も待っていないのに ID が無いのは、開始の途中でバックグラウンドが止められた場合です。
        // ダウンロード自体は始まっていることがあるので（保存ダイアログで保存先を選んだ後など）、
        // すぐにやり直すと同じファイルが二重に保存されたり、ダイアログが二重に出たりします。
        // そこで、始まったダウンロードを探して引き継ぎ、猶予を過ぎても見つからなければやり直します。
        const found = await adopt(job);
        if (state.active !== job) return; // 探している間に、ほかの処理で片付いた
        if (found === null) {
            if (Date.now() - job.since > (job.saveAs ? SAVE_AS_GRACE : START_GRACE)) await finish(job, "LOST");
            return;
        }
        job.downloadId = found;
        persist();
    }

    const [item] = await chrome.downloads.search({ id: job.downloadId }).catch(() => []);

    if (!item) return finish(job, "NOT_FOUND");
    if (item.state === "complete") return finish(job, "");
    if (item.state === "interrupted") return finish(job, item.error ?? "INTERRUPTED");

    // 受信量が増えていれば、止まっている時間を数え直します。
    if (item.bytesReceived !== job.received) {
        job.received = item.bytesReceived;
        job.since = Date.now();
        return persist();
    }

    if (Date.now() - job.since > STALL_LIMIT) return finish(job, "TIMEOUT");
};

// ==================================================================
// ブラウザからのイベント
// （Service Worker では、リスナーは必ずファイルの一番外側で登録します。
//   そうしないと、止められた後にイベントで起こされたとき、受け取れません）
// ==================================================================

/** ダウンロードの状態が変わった（完了・中断）ときの知らせ */
chrome.downloads.onChanged.addListener(async (delta) => {
    // 状態の変化を含まない知らせ（ファイル名が決まった等）は、読み込みもせずに見送ります。
    const now = delta.state?.current;
    if (now !== "complete" && now !== "interrupted") return;

    const { state } = await load();
    const job = state.active;
    if (!job) return;

    // 開始の途中で止められた仕事（ID がまだ無い）のダウンロードかもしれないので、見回りで引き継ぎます。
    // そうしないと、次の見回り（最大 30 秒後）まで、次の保存へ進めません。
    if (job.downloadId === null) {
        if (!starting) watch();
        return;
    }
    if (job.downloadId !== delta.id) return;

    finish(job, now === "complete" ? "" : delta.error?.current ?? "INTERRUPTED");
});

/** 30 秒ごとの見回り */
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WATCH_ALARM) watch();
});

/**
 * シークレットウィンドウがすべて閉じられたら、シークレット側の記録・保存待ち・カウンターを消す。
 * storage.session はブラウザ全体を閉じるまで残るため、ここで明示的に消します。
 * 保存中の 1 件がシークレットのものなら、ブラウザがそのダウンロードを中断するので、
 * その知らせ（downloads.onChanged）で片付きます。
 */
chrome.windows.onRemoved.addListener(async () => {
    const windows = await chrome.windows.getAll().catch(() => null);
    if (!windows || windows.some((w) => w.incognito)) return;

    const { state, history } = await load();

    // シークレット側に何も残っていなければ、消すものも書き出すものもありません。
    // このイベントは通常ウィンドウを閉じたときにも届き、ほとんどの場合はここで終わります。
    const counts = state.counts.i;
    const used = Object.keys(history.i).length > 0
        || state.jobs.some((job) => job.ctx === "i")
        || Object.values(state.batches).some((batch) => batch.ctx === "i")
        || counts.pending + counts.done + counts.failed + counts.hideAt > 0;
    if (!used) return;

    history.i = {};
    state.jobs = state.jobs.filter((job) => job.ctx !== "i");
    for (const [id, batch] of Object.entries(state.batches)) {
        if (batch.ctx === "i") delete state.batches[id];
    }
    state.counts.i = freshCounts();

    persist("i");
});

// ==================================================================
// content script からのメッセージ
// ==================================================================

/** メッセージの種類ごとの処理 */
const HANDLERS = {
    /**
     * ファイルの保存を引き受ける。保存先のファイル名は、ここで設定のテンプレートから組み立てます。
     *
     * 保存が終わるのを待たずに、受け付けた件数だけをすぐに返します。
     * 返事を待たせたままにすると、Chrome は「1 つのイベントの処理が 5 分を超えた」として
     * バックグラウンドを止めてしまうことがあるためです。進み具合と結果は、
     * smdUpdate（カウンターと保存できた 1 件）と smdBatch（バッチの結果）で別に知らせます。
     *
     * 受け取った値は信用せず、ここで必ず検証します。検証で弾いた項目は、カウンターとバッチの結果の
     * 両方で「失敗」に数えます（どちらか一方だけに出ると、数が食い違って見えるため）。
     *
     * @param {object} message
     * @param {string} message.batch - バッチ ID
     * @param {object} message.post - 投稿情報（core.js の PostInfo）
     * @param {object[]} message.items - 保存するメディア（core.js の MediaItem に、投稿内の番号 index を足したもの）
     * @param {number} message.total - 投稿内のメディア総数
     * @param {chrome.runtime.MessageSender} sender
     * @returns {Promise<{accepted: number, rejected: number}|null>} バッチ ID が不正なら null
     */
    download: async ({ batch, post, items, total }, sender) => {
        if (typeof batch !== "string" || !BATCH_ID.test(batch)) return null;

        const ctx = ctxOf(sender);
        const list = Array.isArray(items) ? items : [];
        const info = postInfo(post);
        const count = Number.isSafeInteger(total) && total > 0 ? total : 0;

        // 保存済みの記録のキー（"サイト:投稿ID"。recordId があればそちら）。
        // メディアが MAX_MEDIA 件を超える投稿や、長すぎるキー（200 文字超）は記録しません（保存はします）。
        const id = info.recordId ?? info.postId;
        const key = info.site && id && info.site.length + id.length < 200 && count <= MAX_MEDIA
            ? `${info.site}:${id}` : null;

        const settings = await SMD.loadSettings();
        const now = new Date(); // 同じ投稿のファイルで {dl_datetime} がずれないよう、1 回だけ取ります

        // 1 回の依頼で受け付ける数には上限を設けます（超えた分は「失敗」に数えます）。
        // ページ側のスクリプトに偽のメディア一覧を差し込まれても、際限なく保存が始まらないようにするためです。
        const jobs = [];
        for (const item of list.slice(0, MAX_ITEMS)) {
            // 番号が総数の範囲に無いもの、保存してよい URL でないものは受け付けません。
            if (!Number.isInteger(item?.index) || item.index < 0 || item.index >= count) continue;
            if (typeof item.url !== "string" || item.url.length > MAX_URL_LENGTH || !isMediaUrl(item.url)) continue;

            // ファイル名に使うメディアの情報。{n} は 1 始まりなので、番号に 1 を足します。
            const media = {
                url: item.url,
                kind: stringOf(item.kind),
                ext: stringOf(item.ext),
                id: stringOf(item.id),
                res: stringOf(item.res),
                index: item.index + 1,
                total: count,
            };
            jobs.push({
                batch, ctx,
                url: item.url,
                filename: SMD.buildPath(settings, { post: info, item: media, now }),
                key,
                index: item.index,
                total: count,
                conflictAction: settings.conflictAction,
                saveAs: settings.alwaysSaveAs,
                attempt: 0,
            });
        }
        const rejected = list.length - jobs.length;

        const { state } = await load();
        state.jobs.push(...jobs);
        if (jobs.length > 0) {
            state.batches[batch] = { tab: sender.tab?.id, ctx, left: jobs.length, done: 0, failed: rejected };
        }
        if (list.length > 0) {
            tally(state, ctx, { pending: jobs.length, failed: rejected });
            notify(state, ctx);
        }

        persist();
        pump();

        return { accepted: jobs.length, rejected };
    },

    /**
     * タブを開いたときに、現在のカウンターと、そのタブのサイトの保存済みの記録を返す。
     * 記録はほかのサイトの分も合わせて最大 3000 件あるので、使う分だけに絞って渡します。
     *
     * @param {{site?: unknown}} message - site は "x" などのサイト名
     * @param {chrome.runtime.MessageSender} sender
     * @returns {Promise<{counts: object, history: Record<string, number>}>}
     */
    smdState: async ({ site }, sender) => {
        const ctx = ctxOf(sender);
        const { state, history } = await load();

        const own = {};
        if (typeof site === "string" && site) {
            const prefix = `${site}:`;
            const all = history[ctx];
            for (const key in all) {
                if (key.startsWith(prefix)) own[key] = all[key];
            }
        }
        return { counts: state.counts[ctx], history: own };
    },

    /**
     * Bluesky の投稿情報（使う項目だけに絞ったもの）と、投稿者の PDS の URL を返す。
     *
     * @param {{actor?: string, rkey?: string}} message - actor はハンドルまたは DID
     * @returns {Promise<{post: ReturnType<typeof summarize>|null, pds: string}>}
     */
    bskyPost: async ({ actor, rkey }) => {
        const did = typeof actor === "string" && actor ? await didOf(actor) : null;
        if (!did) return { post: null, pds: PDS };

        const [post, pds] = await Promise.all([
            typeof rkey === "string" && RKEY.test(rkey) ? postOf(did, rkey) : null,
            pdsOf(did),
        ]);
        return { post, pds: pds ?? PDS };
    },

    /**
     * ニコニコ静画のイラストの、原寸画像の URL と拡張子を調べる。
     *
     * 原寸画像の URL には、その都度作られる署名が入っていて、イラストのページには書かれていません。
     * ページの「原寸大で見る」のリンク（/image/source/{番号}）を開くと、ログインしていれば
     * 原寸画像のページ（lohas.nicoseiga.jp/o/{署名}/{期限}/{番号}）へ転送され、その中の画像が
     * lohas.nicoseiga.jp/priv/{同じ署名}/{同じ期限}/{番号} です。ここでは、利用者がリンクを開いたときと同じ
     * リクエストを送り（ニコニコのログイン状態の Cookie はブラウザが付けます）、その画像の URL を拾います。
     * content script から送らないのは、転送先が別のホストで、ページからは応答を読めない（CORS）ためです。
     *
     * 拡張子は URL からは分からないので、画像の種類だけを HEAD で尋ねます（画像の中身は受け取りません）。
     *
     * @param {{id?: unknown}} message - id はイラスト番号（im の後ろの数字）
     * @returns {Promise<{url: string, ext: string}|null>} 調べられなければ null（ログインしていないときなど）
     */
    seigaSource: async ({ id }) => {
        if (typeof id !== "string" || !/^\d{1,12}$/.test(id)) return null;

        const res = await fetch(`${SEIGA_SOURCE}${id}`, {
            credentials: "include",
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return null;

        // 1. ページの中の画像（/priv/…）。2. 無ければ、転送先の URL（/o/…）の /o/ を /priv/ に替えたもの。
        const html = await res.text();
        const inPage = new RegExp(`https://lohas\\.nicoseiga\\.jp/priv/[0-9a-f]+/\\d+/${id}(?=["'\\s<>])`).exec(html)?.[0];
        const fromUrl = URL.parse(res.url);
        const guessed = fromUrl?.hostname === SEIGA_IMAGE_HOST && fromUrl.pathname.startsWith("/o/")
            ? `https://${SEIGA_IMAGE_HOST}/priv/${fromUrl.pathname.slice(3)}` : null;

        const url = inPage ?? guessed;
        if (!url || !isMediaUrl(url) || !url.endsWith(`/${id}`)) return null;

        // 拡張子。尋ねられなかったときは jpg とします（中身が違っても、多くのアプリは開けます）。
        let ext = "jpg";
        try {
            const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10000) });
            const type = head.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
            if (Object.hasOwn(SEIGA_EXT, type)) ext = SEIGA_EXT[type];
        } catch {
            // そのまま jpg とします。
        }
        return { url, ext };
    },
};

/**
 * content script からのメッセージの入り口。
 * 非同期で返事をするため、同期的に true を返して返事の経路を開けたままにします。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = message?.type;

    // Object.hasOwn で確かめるのは、"toString" のような継承されたキーで
    // 関係のない関数が呼ばれてしまうのを防ぐためです。
    if (typeof type !== "string" || !Object.hasOwn(HANDLERS, type)) return false;

    HANDLERS[type](message, sender).then(sendResponse, () => sendResponse(null));
    return true;
});
