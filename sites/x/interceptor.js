// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * sites/x/interceptor.js
 * ==================================================================
 * X（Twitter）の API レスポンスを横取りして、動画・画像の本当の URL を集めるスクリプト。
 *
 * なぜ必要か:
 *   X の動画プレイヤーは <video src="blob:https://x.com/..."> という形になっており、
 *   この blob: URL はページ内部だけで有効な一時的な参照です。ダウンロードには使えません。
 *   そこで、X 自身がサーバーから受け取っている JSON を覗いて、
 *   本物の .mp4 の URL を先に拾っておく、という作戦を取ります。
 *
 * 実行環境について:
 *   manifest.json でこのファイルだけ "world": "MAIN" が指定されています。
 *   通常の content script はページとは別の隔離された世界で動くため、
 *   ページ側の window.fetch を書き換えることができません。
 *   MAIN world ならページと同じ世界で動くので、書き換えが可能になります。
 *   その代わり拡張機能 API は使えないので、結果は postMessage で content.js へ渡します。
 * ==================================================================
 */

(() => {
    "use strict";

    /**
     * この URL は監視対象（X の API）か判定する。
     *
     * @param {string|URL|Request} url - リクエスト先
     * @returns {boolean} /graphql/ か /i/api/ を含んでいれば true
     */
    const isTarget = (url) => /\/(?:graphql|i\/api)\//.test(String(url));

    /**
     * X の JSON に含まれるメディア 1 件分の情報を、この拡張機能で使う形へ変換する。
     *
     * @param {object} m - X の media エントリ
     * @returns {{kind: string, url: string, ext: string}|null} 変換結果。対象外なら null
     */
    const toMedia = (m) => {
        // --- 静止画の場合 ---
        if (m?.type === "photo") {
            // URL から「拡張子より前の部分」を取り出します。
            const base = /^(https?:\/\/pbs\.twimg\.com\/media\/[^./?]+)(?:\.(\w+))?/.exec(m.media_url_https ?? "");
            if (!base) return null;

            // 拡張子は URL の末尾か ?format= のどちらかに入っています。両方無ければ jpg と仮定。
            const ext = (base[2] ?? /[?&]format=(\w+)/.exec(m.media_url_https)?.[1] ?? "jpg").toLowerCase();

            // name=orig を付けると、リサイズされていないオリジナル画像が取得できます。
            return { kind: "photo", url: `${base[1]}?format=${ext}&name=orig`, ext };
        }

        // --- 動画・GIF 以外はここで終了 ---
        if (m?.type !== "video" && m?.type !== "animated_gif") return null;

        // 動画は複数の画質（variants）が用意されているので、その中から最高画質を選びます。
        const best = (m.video_info?.variants ?? [])
            .filter((v) => v?.content_type === "video/mp4" && typeof v.url === "string") // m3u8 などを除外
            .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]; // ビットレートの降順に並べて先頭

        return best ? { kind: m.type, url: best.url, ext: "mp4" } : null;
    };

    /**
     * JSON の中を再帰的に歩き回り、投稿 ID とメディア一覧の対応を集める。
     *
     * X のレスポンスは階層が深く、しかもバージョンによって構造が変わります。
     * そのため「決まった場所を見に行く」のではなく「全部見て、それらしいものを拾う」
     * という総当たりの方針にしてあります。
     *
     * @param {unknown} node - 現在調べているノード
     * @param {Record<string, object[]>} found - 見つかった結果を溜める入れ物
     * @param {Set<object>} seen - 訪問済みオブジェクト（循環参照で無限ループしないため）
     * @returns {Record<string, object[]>} found と同じオブジェクト
     */
    const harvest = (node, found, seen) => {
        // オブジェクト以外、または訪問済みなら打ち切り。
        if (!node || typeof node !== "object" || seen.has(node)) return found;
        seen.add(node);

        // 投稿 ID は新形式では rest_id、旧形式では id_str に入っています。
        const id = node.rest_id ?? node.id_str;

        // メディア情報も legacy というキーの下にある場合とない場合があります。
        const source = node.legacy ?? node;

        // extended_entities のほうが動画情報を含むので優先します。
        const media = (source.extended_entities ?? source.entities)?.media;

        if (typeof id === "string" && Array.isArray(media)) {
            const list = media.map(toMedia).filter(Boolean); // 変換できなかったものは捨てる

            if (list.length) found[id] = list;

            // 動画は、投稿 ID とは別に「サムネイル画像に含まれる動画 ID」でも引けるようにします。
            // content.js 側で、投稿 ID が分からない状況でも動画を特定できるようにするためです。
            const videoId = /\/(?:ext_tw_video|amplify_video)\/(\d+)\//.exec(list[0]?.url ?? "")?.[1];
            if (videoId) found[`v${videoId}`] = list;
        }

        // 子要素へ潜っていきます（配列もオブジェクトも Object.values で扱えます）。
        for (const child of Object.values(node)) harvest(child, found, seen);

        return found;
    };

    /**
     * レスポンス JSON を解析し、成果があれば content.js へ送る。
     *
     * @param {unknown} data - API のレスポンス JSON
     * @returns {void}
     */
    const scan = (data) => {
        const entries = harvest(data, {}, new Set());

        if (Object.keys(entries).length > 0) {
            // 第 2 引数（targetOrigin）に location.origin を指定することで、
            // 同一オリジンのスクリプトにしか届かないようにしています。
            postMessage({ channel: "smd-cache", entries }, location.origin);
        }
    };

    // ================================================================
    // ここから「モンキーパッチ」。既存の関数を自分の関数で包み直します。
    // ================================================================

    // 元の関数を必ず控えておきます。これを忘れると通信そのものが壊れます。
    const originalFetch = fetch;

    window.fetch = function (input, init) {
        // まず本来の fetch をそのまま実行します。
        const promise = originalFetch.call(this, input, init);

        if (isTarget(input?.url ?? input)) {
            // res.clone() が重要です。レスポンスの中身は 1 回しか読めないため、
            // 複製してから読まないと X 本体がデータを受け取れなくなってしまいます。
            promise.then((res) => res.ok && res.clone().json().then(scan)).catch(() => {});
        }

        // 呼び出し元には、元の Promise をそのまま返します（振る舞いを変えない）。
        return promise;
    };

    /**
     * 監視対象の XMLHttpRequest インスタンスを覚えておく集合。
     * WeakSet なので、XHR が不要になればガベージコレクションを妨げません。
     */
    const watched = new WeakSet();

    // XMLHttpRequest でも同じことをします。open で URL が分かり、send で送信されるので、
    // 「open のときに印を付けて、send のときに監視を仕掛ける」という 2 段構えです。
    const { open, send } = XMLHttpRequest.prototype;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        if (isTarget(url)) watched.add(this); // this = この XHR インスタンス
        return open.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        if (watched.has(this)) {
            this.addEventListener("load", () => {
                try {
                    // responseType が "json" なら response が既にオブジェクト、
                    // それ以外は文字列なので自分で解析します。
                    scan(this.responseType === "json" ? this.response : JSON.parse(this.responseText));
                } catch {
                    // JSON でないレスポンスも普通にあるので、失敗は無視して構いません。
                }
            });
        }
        return send.apply(this, args);
    };
})();
