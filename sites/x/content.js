// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * sites/x/content.js
 * ==================================================================
 * X（Twitter）用のアダプタ。
 *
 * interceptor.js が集めたメディア URL を受け取って保持し、
 * 「どれが投稿か」「どれがメディアか」といった X 特有の判断をして、
 * SMDCore.start() へアダプタを渡します。
 *
 * postId() と mediaContainers() は、投稿の表示が変わるたびに呼ばれるので軽く作ってあります。
 * 本文や表示名まで読む readPost() は、保存するときだけ呼ばれます。
 * ==================================================================
 */

(() => {
    "use strict";

    /** メディアを包む要素。X は data-testid 属性で役割を示しています */
    const MEDIA =
        'div[data-testid="tweetPhoto"], div[data-testid="videoPlayer"], div[data-testid="videoComponent"]';

    /** 投稿者のプロフィールリンク（投稿へのリンクは除く） */
    const PROFILE = 'div[data-testid="User-Name"] a:not([href*="/status/"])';

    /** 操作バーの中にあるボタン（返信・いいね・いいね取り消し） */
    const ACTIONS = '[data-testid="reply"], [data-testid="like"], [data-testid="unlike"]';

    /**
     * 投稿へのリンクのパスを分解する。
     * "/ユーザー名/status/123" のほか、"/i/web/status/123" の形にも対応します。
     */
    const STATUS_PATH = /^\/([^/]+)\/(?:web\/)?status\/(\d+)/;

    /** 動画のサムネイル URL からメディア ID を取り出す */
    const VIDEO_ID = /\/(?:ext_tw_video_thumb|amplify_video_thumb)\/(\d+)\//;

    /** 受け入れるメディアの条件。ページ側のスクリプトが偽のデータを送ってきても弾けるよう絞ります */
    const HOSTS = new Set(["pbs.twimg.com", "video.twimg.com"]);
    const KINDS = new Set(["photo", "video", "animated_gif"]);
    const EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif", "mp4"]);

    /** キャッシュに覚えておく件数の上限。超えたら古いものから捨てます */
    const CACHE_LIMIT = 2000;

    /**
     * メディア 1 件の情報が安全に使える形か確かめる。
     * URL.parse は、解析できなければ例外ではなく null を返すので、1 回の解析で済みます。
     *
     * @param {unknown} m
     * @returns {boolean}
     */
    const isValidMedia = (m) => {
        if (!KINDS.has(m?.kind) || !EXTS.has(m.ext) || typeof m.url !== "string") return false;

        const url = URL.parse(m.url);
        return url !== null && url.protocol === "https:" && HOSTS.has(url.hostname);
    };

    /**
     * interceptor.js から届いたメディア情報。キーは投稿 ID、または "v" + 動画のメディア ID。
     * 値は画面上の並びと同じ順の配列で、URL が分からなかったものは null です。
     * @type {Map<string, (object|null)[]>}
     */
    const cache = new Map();

    // interceptor.js（MAIN world）からの postMessage を受け取ります。
    // 同じウィンドウのページ側スクリプトも同じ形で送れてしまうため、中身は必ず検証します。
    addEventListener("message", (e) => {
        if (e.source !== window || e.data?.channel !== "smd-cache") return;

        for (const [id, list] of Object.entries(e.data.entries ?? {})) {
            if (Array.isArray(list) && list.some(Boolean) && list.every((m) => m === null || isValidMedia(m))) {
                cache.delete(id); // 入れ直して新しい位置へ（Map は挿入順を保つので、先頭が一番古い）
                cache.set(id, list);
            }
        }

        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    });

    /**
     * 要素が引用ツイート（内側の投稿）に属しているか。X の引用は div[role="link"] で囲まれています。
     * 投稿のコンテナ（article）と引用の枠のうち、近いほうを 1 回の closest で探し、
     * 引用の枠のほうが近ければ引用の中です。
     *
     * @param {Element} el
     * @returns {boolean}
     */
    const isQuoted = (el) => el.closest('div[role="link"], article')?.tagName === "DIV";

    /**
     * 投稿内の要素を探し、引用部分のものを除いて返す。
     *
     * @param {string} selector
     * @param {Element} root
     * @returns {Element[]}
     */
    const own = (selector, root) => [...root.querySelectorAll(selector)].filter((el) => !isQuoted(el));

    /**
     * 投稿自身へのリンクを探す。投稿日時（<time>）を含むリンクがそれです。
     * 最初に見つかる <time> 入りのリンクは、ほぼ必ず投稿自身のものなので（引用は本文の後ろにあるため）、
     * まずそれを確かめ、違ったときだけ全部のリンクを調べます。
     *
     * @param {Element} root
     * @returns {HTMLAnchorElement|null}
     */
    const statusLink = (root) => {
        const time = root.querySelector('a[href*="/status/"] time');
        if (time && !isQuoted(time)) return time.closest("a");

        const links = own('a[href*="/status/"]', root);
        return links.find((a) => a.querySelector("time")) ?? links[0] ?? null;
    };

    /**
     * 投稿のパスを分解する。リンクが無い場合（投稿詳細ページなど）は、今開いている URL を使います。
     *
     * @param {Element} root
     * @returns {RegExpExecArray|null} [1] がユーザー名（または "i"）、[2] が投稿 ID
     */
    const matchStatus = (root) => STATUS_PATH.exec(statusLink(root)?.pathname ?? location.pathname);

    /**
     * この投稿のメディアコンテナ（アダプタの mediaContainers）。
     *
     * @param {Element} root
     * @returns {Element[]}
     */
    const mediaContainers = (root) => {
        // "card." で始まるものはリンクカードのプレビューなので除外します。
        const found = own(MEDIA, root).filter((el) => !el.closest('[data-testid^="card."]'));

        // 入れ子（動画プレイヤーの中のサムネイル等）は外側だけを残します。
        // ほとんどの投稿は 1 件なので、そのときは比べる必要がありません。
        if (found.length < 2) return found;
        return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
    };

    /**
     * 投稿情報をすべて読む（アダプタの readPost）。保存するときだけ呼ばれます。
     *
     * @param {Element} root
     * @returns {object|null}
     */
    const readPost = (root) => {
        const match = matchStatus(root);
        if (!match) return null;

        // "/i/status/123" や "/i/web/status/123" ではユーザー名の代わりに "i" が入るので、
        // プロフィールリンクから拾い直します。引用部分のプロフィールを拾わないよう own() で探します。
        const profile = own(PROFILE, root)[0];
        const screenName = match[1] === "i" && profile ? profile.pathname.slice(1) : match[1];

        return {
            site: "x",
            screenName,
            postId: match[2],
            name: profile?.querySelector("span")?.textContent.trim() ?? "",
            text: own('div[data-testid="tweetText"]', root)[0]?.textContent ?? "",
            time: own("time", root)[0]?.getAttribute("datetime") ?? null,
        };
    };

    /**
     * DOM からメディア URL を拾う（interceptor.js が通信を取り逃した場合の代わり）。
     * mediaContainers と同じ並びで返し、分からないものは null にします。
     *
     * @param {Element} root
     * @returns {(object|null)[]}
     */
    const scrapeDom = (root) => mediaContainers(root).map((container) => {
        const video = container.querySelector("video");
        const poster = video?.poster ?? "";

        // 動画: サムネイル URL の中のメディア ID でキャッシュを引きます。
        const cached = cache.get(`v${VIDEO_ID.exec(poster)?.[1]}`)?.[0];
        if (cached) return cached;

        // GIF はサムネイル名から実体の URL を組み立てられます。
        // GIF の <video src> には mp4 の URL がそのまま入っているため、下の「直接の mp4」より先に調べます
        // （後にすると、GIF が動画として扱われ、ファイル名の {kind} が gif ではなく vid になってしまいます）。
        const gif = /tweet_video_thumb\/([^./?]+)/.exec(poster)?.[1];
        if (gif) return { kind: "animated_gif", url: `https://video.twimg.com/tweet_video/${gif}.mp4`, ext: "mp4" };

        // 直接の mp4 URL が入っていれば、そのまま使えます（普段の動画は blob: なので使えません）。
        const direct = { kind: "video", url: video?.src ?? "", ext: "mp4" };
        if (/\.mp4(?:\?|$)/.test(direct.url) && isValidMedia(direct)) return direct;

        // 静止画は表示用に縮小された URL なので、name=orig で原寸に戻します。
        const src = container.querySelector('img[src*="/media/"]')?.src ?? "";
        const m = /^(https:\/\/pbs\.twimg\.com\/media\/[^./?]+)(?:\.(\w+))?/.exec(src);
        if (!m) return null;

        const ext = (m[2] ?? /[?&]format=(\w+)/.exec(src)?.[1] ?? "jpg").toLowerCase();
        const photo = { kind: "photo", url: `${m[1]}?format=${ext}&name=orig`, ext };
        return isValidMedia(photo) ? photo : null;
    });

    SMDCore.start({
        site: "x",
        postRoot: "article", // タイムラインの投稿 1 件が <article> です
        mediaContainers,
        readPost,

        /** 投稿 ID だけを素早く読む（ボタンの描き分けのたびに呼ばれる） */
        postId: (root) => matchStatus(root)?.[2] ?? null,

        /**
         * メディア一覧。通信から拾った情報を優先し、足りない番号は DOM から補います。
         *
         * @param {Element} root
         * @param {object} post
         * @returns {Promise<(object|null)[]>}
         */
        getMedia: async (root, post) => {
            const cached = cache.get(post.postId) ?? [];
            const dom = scrapeDom(root);
            return Array.from({ length: Math.max(cached.length, dom.length) }, (_, i) => cached[i] ?? dom[i] ?? null);
        },

        /**
         * 返信・リポスト・いいねが並ぶ操作バー（引用部分のものは除く）。
         * :has() で操作バーそのものを探すより、中のボタンから親をたどるほうが軽く済みます。
         */
        actionBar: (root) => own(ACTIONS, root)[0]?.closest('div[role="group"]') ?? null,

        /** "like" は未いいね、"unlike" はいいね済みのボタン。前者だけを見るので、付けたときだけ保存します */
        likeButton: '[data-testid="like"]',

        /**
         * ボタンに関係する要素（メディア・投稿へのリンク・操作バーのボタン）。
         * 投稿の中でこれらが増減したときだけ、ボタンを見直します。
         * 動画の再生時間の表示のような変化では見直さないので、再生中も軽く済みます。
         */
        watch: `${MEDIA}, a[href*="/status/"], ${ACTIONS}`,
    });
})();
