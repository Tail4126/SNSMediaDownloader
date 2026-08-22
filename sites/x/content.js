// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * sites/x/content.js
 * ==================================================================
 * X（Twitter）用のアダプタ。
 *
 * interceptor.js が集めたメディア URL を受け取って保持し、
 * 「どれが投稿か」「どれがメディアか」といった X 特有の判断を行って、
 * 最後に SMDCore.start() へアダプタを渡します。
 * ==================================================================
 */

(() => {
    "use strict";

    /** メディアを包む要素を選ぶセレクタ。X は data-testid 属性で役割を示しています */
    const MEDIA =
        'div[data-testid="tweetPhoto"], div[data-testid="videoPlayer"], div[data-testid="videoComponent"]';

    /** 投稿者のプロフィールリンク。:not([href*="/status/"]) で投稿へのリンクを除外しています */
    const PROFILE = 'div[data-testid="User-Name"] a:not([href*="/status/"])';

    /** サムネイル URL から動画 ID を取り出す正規表現 */
    const VIDEO_ID = /\/(?:ext_tw_video_thumb|amplify_video_thumb)\/(\d+)\//;

    /**
     * interceptor.js から届いたメディア情報の保管庫。
     * キーは投稿 ID、または "v" + 動画 ID です。
     * @type {Map<string, object[]>}
     */
    const cache = new Map();

    // interceptor.js（MAIN world）からの postMessage を受け取ります。
    addEventListener("message", (e) => {
        // 別のサイトや広告 iframe から送られてきた偽メッセージを弾くための検証です。
        // e.source !== window は「自分自身のウィンドウから送られたか」の確認。
        if (e.source !== window || e.data?.channel !== "smd-cache") return;

        for (const [id, list] of Object.entries(e.data.entries ?? {})) {
            // 受け取ったデータの形も必ず確認します。
            // 特に url が https で始まることの確認は、後で不正な URL を開かないために重要です。
            const ok = Array.isArray(list) && list.length > 0
                && list.every((m) => typeof m?.url === "string" && m.url.startsWith("https://"));

            if (ok) cache.set(id, list);
        }

        // 長時間タイムラインを見続けても際限なく増えないよう、古いものから捨てます。
        while (cache.size > 2000) cache.delete(cache.keys().next().value);
    });

    /**
     * この要素が「引用ツイート（内側の投稿）」に属しているかを判定する。
     * 引用元のメディアまで一緒にダウンロードしてしまわないための除外判定です。
     *
     * @param {Element} el - 判定したい要素
     * @param {Element} root - 外側の投稿コンテナ
     * @returns {boolean} 引用部分の中にあれば true
     */
    const isQuoted = (el, root) => {
        // X の引用ツイートは div[role="link"] で囲まれています。
        const quote = el.closest('div[role="link"]');
        return Boolean(quote && root.contains(quote));
    };

    /**
     * 投稿内から要素を探し、引用部分のものを除いて返す。
     *
     * @param {string} selector - CSS セレクタ
     * @param {Element} root - 投稿コンテナ
     * @returns {Element[]} 見つかった要素の配列
     */
    const own = (selector, root) => [...root.querySelectorAll(selector)].filter((el) => !isQuoted(el, root));

    /**
     * この投稿のメディアコンテナ一覧を返す（アダプタの mediaContainers）。
     *
     * @param {Element} root - 投稿コンテナ
     * @returns {Element[]} メディアを包む要素の配列
     */
    const mediaContainers = (root) => {
        // data-testid が "card." で始まるものはリンクカードのプレビュー画像なので除外します。
        const found = own(MEDIA, root).filter((el) => !el.closest('[data-testid^="card."]'));

        // 入れ子になっている場合（動画プレイヤーの中にサムネイルがある等）、
        // 外側だけを残して重複カウントを防ぎます。
        return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
    };

    /**
     * 投稿情報を読み取る（アダプタの readPost）。
     *
     * @param {Element} root - 投稿コンテナ
     * @returns {import("../../shared/core.js").PostInfo|null} 読み取れなければ null
     */
    const readPost = (root) => {
        // :has(time) は「中に <time> を含む要素」を選ぶセレクタ。
        // 投稿日時のリンクこそが、その投稿自身へのリンクだからです。
        // 見つからない場合は最初の /status/ リンクで妥協します。
        const link = root.querySelector('a[href*="/status/"]:has(time)')
            ?? root.querySelector('a[href*="/status/"]');

        // リンクが無い場合（投稿詳細ページなど）は、今開いている URL を使います。
        const path = link ? new URL(link.href).pathname : location.pathname;

        // "/ユーザー名/status/投稿ID" の形から 2 つを取り出します。
        const match = /^\/([^/]+)\/status\/(\d+)/.exec(path);
        if (!match) return null;

        return {
            site: "x",

            // X には "/i/status/123..." という、ユーザー名の代わりに "i" が入る URL 形式があります。
            // その場合はプロフィールリンクから本当のユーザー名を拾い直します。
            screenName: match[1] === "i"
                ? new URL(root.querySelector(PROFILE)?.href ?? location.origin).pathname.slice(1) || "i"
                : match[1],

            postId: match[2],
            name: root.querySelector(`${PROFILE} span`)?.textContent.trim() ?? "",
            text: own('div[data-testid="tweetText"]', root)[0]?.textContent ?? "",

            // <time datetime="2026-08-19T14:25:30.000Z"> の datetime 属性が正確な投稿日時です。
            time: own("time", root)[0]?.getAttribute("datetime") ?? null,
        };
    };

    /**
     * DOM から直接メディア URL を拾うフォールバック処理。
     * interceptor.js がレスポンスを取り逃した場合に使われます。
     *
     * @param {Element} root - 投稿コンテナ
     * @returns {object[]} メディア情報の配列
     */
    const scrapeDom = (root) =>
        mediaContainers(root).map((container) => {
            const video = container.querySelector("video");

            // まずサムネイル URL 内の動画 ID でキャッシュを引いてみます。
            const cached = cache.get(`v${VIDEO_ID.exec(video?.poster ?? "")?.[1]}`)?.[0];
            if (cached) return cached;

            // blob: でない直リンクが入っていれば、そのまま使えます。
            if (video?.src && !video.src.startsWith("blob:")) {
                return { kind: "video", url: video.src, ext: "mp4" };
            }

            // GIF は URL の規則性が高く、サムネイル名から実体の URL を組み立てられます。
            const gif = /tweet_video_thumb\/([^./?]+)/.exec(video?.poster ?? "")?.[1];
            if (gif) {
                return { kind: "animated_gif", url: `https://video.twimg.com/tweet_video/${gif}.mp4`, ext: "mp4" };
            }

            // 静止画は表示用に縮小された URL なので、name=orig を付けて原寸に戻します。
            const src = container.querySelector('img[src*="/media/"]')?.src ?? "";
            const m = /^(https?:\/\/pbs\.twimg\.com\/media\/[^./?]+)(?:\.(\w+))?/.exec(src);
            if (!m) return null;

            const ext = (m[2] ?? /[?&]format=(\w+)/.exec(src)?.[1] ?? "jpg").toLowerCase();
            return { kind: "photo", url: `${m[1]}?format=${ext}&name=orig`, ext };
        }).filter(Boolean); // null になったものを取り除く

    // ここでアダプタを組み立てて共通処理へ渡します。以降の制御は core.js 側です。
    SMDCore.start({
        site: "x",

        // X ではタイムラインの投稿 1 件が <article> 要素になっています。
        postRoot: "article",

        mediaContainers,
        readPost,

        /**
         * メディア一覧を返す。まず横取りキャッシュを見て、無ければ DOM から拾います。
         *
         * @param {Element} root - 投稿コンテナ
         * @param {object} post - readPost の結果
         * @returns {Promise<object[]>} メディア情報の配列
         */
        getMedia: async (root, post) => cache.get(post.postId) ?? scrapeDom(root),

        /**
         * 返信・リポスト・いいねが並ぶ操作バーを探す。
         * :has(...) で「返信かいいねのボタンを含む group」に絞り込んでいます。
         */
        actionBar: (root) => root.querySelector(
            'div[role="group"]:has([data-testid="reply"], [data-testid="like"], [data-testid="unlike"])'
        ),
    });
})();
