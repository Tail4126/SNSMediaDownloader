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

    /**
     * メディアを包む要素。X は data-testid 属性で役割を示しています。
     *
     * 「div[…], div[…], div[…]」と 3 つ並べても同じ要素に当てはまりますが、:is() でまとめておくと、
     * ブラウザは「div か」を 1 回確かめるだけで済みます。投稿の表示が変わるたびに使うセレクタなので、
     * こうした小さな差が積み重なります。
     */
    const MEDIA =
        'div:is([data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"])';

    /** 投稿者のプロフィールリンク（投稿へのリンクは除く） */
    const PROFILE = 'div[data-testid="User-Name"] a:not([href*="/status/"])';

    /** 操作バーの中にあるボタン（返信・いいね・いいね取り消し） */
    const ACTIONS = '[data-testid="reply"], [data-testid="like"], [data-testid="unlike"]';

    /**
     * メディアの持ち主を決める境目。メディア要素から親をたどって、最初に当たるものが
     *   - 投稿のコンテナ（article）なら、その投稿自身のメディア
     *   - 引用の枠（div[role="link"]）なら、引用された投稿のメディア
     *   - リンクカード（data-testid が "card." で始まる要素）なら、リンク先のプレビュー
     * です。
     */
    const MEDIA_SCOPE = 'article, div[role="link"], [data-testid^="card."]';

    /**
     * 投稿へのリンクのパスを分解する。
     * "/ユーザー名/status/123" のほか、"/i/web/status/123" の形にも対応します。
     */
    const STATUS_PATH = /^\/([^/]+)\/(?:web\/)?status\/(\d+)/;

    /**
     * 画像の拡大表示（"/ユーザー名/status/123/photo/1" などで開く、黒い背景の画面）。
     * 拡大された画像と、その下の返信・いいねの並び（操作バー）は、投稿の <article> の外にあり、
     * この要素が両方を囲んでいます。そこで、この要素も投稿 1 件のコンテナとして扱います。
     * 右側の会話欄の <article> もこの中にありますが、そちらは今までどおりふつうの投稿として扱います
     * （postRoot に当てはまる要素のうち、いちばん近いものが持ち主になるため）。
     */
    const VIEWER = 'div[role="dialog"][aria-modal="true"]';

    /** 投稿 1 件のコンテナ。タイムラインの投稿（article）と、画像の拡大表示です */
    const POST_ROOT = `article, ${VIEWER}`;

    /** 拡大表示で、画像や動画を包む要素（スワイプで閉じられる範囲） */
    const VIEWER_MEDIA = '[data-testid="swipe-to-dismiss"]';

    /** 拡大表示の URL。[1] がユーザー名、[2] が投稿 ID、[3] が何件目か（1 始まり） */
    const VIEWER_PATH = /^\/([^/]+)\/status\/(\d+)\/(?:photo|video)\/(\d+)/;

    /** X の投稿 ID（Snowflake）に詰められた時刻の起点（2010-11-04T01:42:54.657Z） */
    const EPOCH = 1288834974657n;

    /** 動画のサムネイル URL からメディア ID を取り出す */
    const VIDEO_ID = /\/(?:ext_tw_video_thumb|amplify_video_thumb)\/(\d+)\//;

    /**
     * 受け入れるメディアの条件。ページ側のスクリプトが偽のデータを送ってきても弾けるよう絞ります。
     * URL は X のメディア配信ホスト（pbs.twimg.com / video.twimg.com）の https だけです。ホスト名のすぐ後ろに「/」が
     * 来ることまで確かめるので、"https://pbs.twimg.com.example/" や "https://pbs.twimg.com@example/" のような
     * 別のホストを指す URL は当てはまりません（保存する前に、バックグラウンドでも URL を解析して確かめ直します）。
     */
    const MEDIA_URL = /^https:\/\/(?:pbs|video)\.twimg\.com\//;
    const KINDS = new Set(["photo", "video", "animated_gif"]);
    const EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif", "mp4"]);

    /** キャッシュに覚えておく件数の上限。超えたら古いものから捨てます */
    const CACHE_LIMIT = 2000;

    /**
     * 1 通の知らせで受け付ける件数と、1 投稿のメディア数の上限（X は 1 投稿 4 件まで）。
     * ページ側のスクリプトが巨大な偽の知らせを送ってきても、処理が重くならず、
     * 1 回のボタンで際限なく保存が始まることもないようにします。
     */
    const ENTRY_LIMIT = 1000;
    const LIST_LIMIT = 32;

    /** キャッシュのキーの形（投稿 ID、または "v" + 動画のメディア ID） */
    const CACHE_KEY = /^v?\d{1,25}$/;

    /**
     * メディア 1 件の情報が安全に使える形か確かめる。
     * X の API の応答 1 つで何百件も届くので、URL は解析せず、文字列の頭だけで確かめます（MEDIA_URL 参照）。
     *
     * @param {unknown} m
     * @returns {boolean}
     */
    const isValidMedia = (m) =>
        KINDS.has(m?.kind) && EXTS.has(m.ext) && typeof m.url === "string" && MEDIA_URL.test(m.url);

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

        const entries = e.data.entries;
        if (entries === null || typeof entries !== "object") return;

        let seen = 0;
        for (const id in entries) {
            if ((seen += 1) > ENTRY_LIMIT) break;

            const list = entries[id];
            if (!CACHE_KEY.test(id) || !Array.isArray(list) || list.length === 0 || list.length > LIST_LIMIT) continue;
            if (!list.some(Boolean) || !list.every((m) => m === null || isValidMedia(m))) continue;

            // 使う項目だけを写し取ります（ページ側が足した余計な項目は持ち込みません）。
            cache.delete(id); // 入れ直して新しい位置へ（Map は挿入順を保つので、先頭が一番古い）
            cache.set(id, list.map((m) => m && { kind: m.kind, url: m.url, ext: m.ext }));
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
     * 投稿内の要素を探し、引用部分のものを除いた最初の 1 つを返す。
     *
     * 最初に見つかるものは、ほぼ必ず投稿自身のものです（引用は本文の後ろにあるため）。
     * そこで、まず querySelector で 1 つだけ探します。querySelector は見つけた時点で探すのをやめるので、
     * 投稿の中を最後まで調べる querySelectorAll よりずっと軽く済みます。
     * それが引用の中のものだったときだけ、全部を順に調べます。
     *
     * @param {string} selector
     * @param {Element} root
     * @returns {Element|null}
     */
    const firstOwn = (selector, root) => {
        const first = root.querySelector(selector);
        if (first === null || !isQuoted(first)) return first;

        for (const el of root.querySelectorAll(selector)) {
            if (!isQuoted(el)) return el;
        }
        return null;
    };

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
     * 投稿のコンテナが、画像の拡大表示か。
     * postRoot に当てはまるのは <article> と拡大表示（<div>）だけなので、要素名を見るだけで分かります。
     *
     * @param {Element} root
     * @returns {boolean}
     */
    const isViewer = (root) => root.tagName === "DIV";

    /**
     * 拡大表示している投稿のパスを分解する。
     * ふだんは今開いている URL から読みます。URL が拡大表示の形でない（URL が変わる前に描かれたなど）ときは、
     * 操作バーの「表示数」のリンク（"/ユーザー名/status/123/analytics"）から読みます。
     *
     * @param {Element} root - 拡大表示
     * @returns {RegExpExecArray|null} [1] がユーザー名、[2] が投稿 ID
     */
    const viewerMatch = (root) => {
        const here = VIEWER_PATH.exec(location.pathname);
        if (here) return here;

        for (const a of root.querySelectorAll('a[href*="/status/"]')) {
            if (a.closest("article") === null) return STATUS_PATH.exec(a.pathname);
        }
        return null;
    };

    /**
     * 拡大表示の中の、画像・動画を包む要素（右側の会話欄の中のものは除く）。
     *
     * @param {Element} root - 拡大表示
     * @returns {Element[]}
     */
    const viewerContainers = (root) => [...root.querySelectorAll(VIEWER_MEDIA)].filter((el) => el.closest("article") === null);

    /**
     * 画面にある、指定した投稿の <article>（後ろのタイムラインや、拡大表示の右側の会話欄）。
     * 投稿へのリンクで見分けます。保存するときなど、たまにしか呼ばれません。
     *
     * @param {string} id - 投稿 ID
     * @returns {Element[]}
     */
    const articlesOf = (id) =>
        [...document.querySelectorAll("article")].filter((a) => STATUS_PATH.exec(statusLink(a)?.pathname ?? "")?.[2] === id);

    /**
     * 投稿 ID から投稿日時を求める。X の投稿 ID は、上位のビットに投稿した時刻（ミリ秒）が入っています。
     * 拡大表示しか無く、投稿日時の表示が見つからないときの代わりです。
     *
     * @param {string} id
     * @returns {string|null} ISO 8601
     */
    const timeOf = (id) => {
        try {
            return new Date(Number((BigInt(id) >> 22n) + EPOCH)).toISOString();
        } catch {
            return null;
        }
    };

    /**
     * この投稿のメディアコンテナ（アダプタの mediaContainers）。
     *
     * 拡大表示では、表示中の 1 件を包む要素だけを返します。拡大表示は 1 件ずつ切り替えて見せるので、
     * 画面にある要素の並びが、投稿の中の番号と一致するとは限らないためです。
     * 個別ボタンは付けず、メインボタン（全件の保存）といいね連動保存だけを動かします。
     * 総数は mediaCount で別に伝えます。
     *
     * @param {Element} root
     * @returns {Element[]}
     */
    const mediaContainers = (root) => {
        if (isViewer(root)) {
            // ほかのダイアログ（投稿の作成など）は、最初の querySelector で見送られます。
            // プロフィール画像の拡大表示（"/ユーザー名/photo"）は、投稿の URL ではないので対象外です。
            const media = root.querySelector(VIEWER_MEDIA);
            if (media === null || !viewerMatch(root)) return [];
            return media.closest("article") === null ? [media] : viewerContainers(root).slice(0, 1);
        }
        // この投稿自身のメディアだけを残します（引用とリンクカードの中のものは除く）。
        // 親をたどるのは 1 件につき 1 回だけです。最初に当たった境目がこの投稿のコンテナなら、
        // 途中に引用の枠もリンクカードも無かった、と分かります。
        const found = [];
        for (const el of root.querySelectorAll(MEDIA)) {
            if (el.closest(MEDIA_SCOPE) === root) found.push(el);
        }

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
    const readPost = (root) => (isViewer(root) ? readViewer(root) : readArticle(root));

    /**
     * 拡大表示している投稿の情報を読む。
     * 拡大表示には表示名や本文が無いので、同じ投稿の <article>（右側の会話欄か、後ろのタイムライン）から読みます。
     * どこにも無いとき（右側の会話欄を閉じていて、後ろの画面にも出ていないなど）は、URL から分かることだけで作ります。
     *
     * @param {Element} root - 拡大表示
     * @returns {object|null}
     */
    const readViewer = (root) => {
        const match = viewerMatch(root);
        if (!match) return null;

        const id = match[2];
        for (const article of articlesOf(id)) {
            const post = readArticle(article);
            if (post?.postId === id) return post;
        }

        return { site: "x", screenName: match[1], postId: id, name: "", text: "", time: timeOf(id) };
    };

    /**
     * タイムラインの投稿（<article>）の情報を読む。
     *
     * @param {Element} root
     * @returns {object|null}
     */
    const readArticle = (root) => {
        const match = matchStatus(root);
        if (!match) return null;

        // "/i/status/123" や "/i/web/status/123" ではユーザー名の代わりに "i" が入るので、
        // プロフィールリンクから拾い直します。引用部分のプロフィールを拾わないよう firstOwn() で探します。
        const profile = firstOwn(PROFILE, root);
        const screenName = match[1] === "i" && profile ? profile.pathname.slice(1) : match[1];

        return {
            site: "x",
            screenName,
            postId: match[2],
            name: profile?.querySelector("span")?.textContent.trim() ?? "",
            text: firstOwn('div[data-testid="tweetText"]', root)?.textContent ?? "",
            time: firstOwn("time", root)?.getAttribute("datetime") ?? null,
        };
    };

    /**
     * DOM からメディア URL を拾う（interceptor.js が通信を取り逃した場合の代わり）。
     * mediaContainers と同じ並びで返し、分からないものは null にします。
     *
     * @param {Element} root - タイムラインの投稿（<article>）
     * @returns {(object|null)[]}
     */
    const scrapeDom = (root) => mediaContainers(root).map(scrapeOne);

    /**
     * 拡大表示している投稿のメディア URL を、DOM から拾う（interceptor.js が通信を取り逃した場合の代わり）。
     *
     * 同じ投稿が後ろのタイムラインにも出ていれば、そちらには全件が正しい並びで揃っているので、そちらを使います。
     * 無ければ拡大表示の中から拾います。1 件しか出ていなければ、URL の番号（"/photo/2" の 2）の位置に置きます
     * （手前の番号は分からないので null。保存されるのは分かった分だけです）。
     *
     * @param {Element} root - 拡大表示
     * @param {string} id - 投稿 ID
     * @returns {(object|null)[]}
     */
    const scrapeViewer = (root, id) => {
        for (const article of articlesOf(id)) {
            const list = scrapeDom(article);
            if (list.some(Boolean)) return list;
        }

        const list = viewerContainers(root).map(scrapeOne);
        const n = Number(VIEWER_PATH.exec(location.pathname)?.[3] ?? 1);
        if (list.length !== 1 || !(n > 1 && n <= 32)) return list;
        return Array.from({ length: n }, (_, i) => (i === n - 1 ? list[0] : null));
    };

    /**
     * メディア 1 件の URL を、それを包む要素から拾う。
     *
     * @param {Element} container
     * @returns {object|null}
     */
    const scrapeOne = (container) => {
        const video = container.querySelector("video");
        const poster = video?.poster ?? "";

        // 動画: サムネイル URL の中のメディア ID でキャッシュを引きます。
        const videoId = VIDEO_ID.exec(poster)?.[1];
        const cached = videoId ? cache.get(`v${videoId}`)?.[0] : null;
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
    };

    /**
     * 投稿 ID だけを素早く読む（アダプタの postId）。
     *
     * @param {Element} root
     * @returns {string|null}
     */
    const postId = (root) => (isViewer(root) ? viewerMatch(root) : matchStatus(root))?.[2] ?? null;

    SMDCore.start({
        site: "x",
        postRoot: POST_ROOT, // タイムラインの投稿 1 件が <article> です。画像の拡大表示も 1 件として扱います
        mediaContainers,
        readPost,

        /** 投稿 ID だけを素早く読む（ボタンの描き分けのたびに呼ばれる） */
        postId,

        /**
         * 拡大表示では表示中の 1 件しか数えられないので、通信から拾った件数を総数として伝えます。
         * これで、枚数バッジと「全件保存済みか」の判断が、タイムラインと同じになります。
         *
         * @param {Element} root
         * @returns {number}
         */
        mediaCount: (root) => (isViewer(root) ? cache.get(postId(root))?.length ?? 0 : 0),

        /**
         * 押された「いいね」が、どの投稿のものか。
         * 拡大表示の右側の会話欄に出ている、拡大表示中の投稿そのもののいいねは、拡大表示のものとして扱います。
         * 会話欄の投稿にはメディアが表示されないため、そのままでは「メディアの無い投稿」として見送られてしまうからです。
         * いいねが押されたときにしか呼ばれません。
         *
         * @param {Element} like
         * @returns {Element|null}
         */
        likeRoot: (like) => {
            const root = like.closest(POST_ROOT);
            if (root === null || isViewer(root)) return root;

            const viewer = root.closest(VIEWER);
            if (viewer === null || mediaContainers(root).length > 0) return root;

            const id = postId(viewer);
            return id !== null && STATUS_PATH.exec(statusLink(root)?.pathname ?? "")?.[2] === id ? viewer : root;
        },

        /**
         * メディア一覧。通信から拾った情報を優先し、足りない番号は DOM から補います。
         *
         * @param {Element} root
         * @param {object} post
         * @returns {Promise<(object|null)[]>}
         */
        getMedia: async (root, post) => {
            const cached = cache.get(post.postId) ?? [];
            const dom = isViewer(root) ? scrapeViewer(root, post.postId) : scrapeDom(root);
            return Array.from({ length: Math.max(cached.length, dom.length) }, (_, i) => cached[i] ?? dom[i] ?? null);
        },

        /**
         * 返信・リポスト・いいねが並ぶ操作バー（引用部分のものは除く）。
         * :has() で操作バーそのものを探すより、中のボタンから親をたどるほうが軽く済みます。
         */
        actionBar: (root) => {
            if (!isViewer(root)) return firstOwn(ACTIONS, root)?.closest('div[role="group"]') ?? null;

            // 拡大表示の操作バーは、画像の下にあります（右側の会話欄の投稿のものは除く）。
            for (const el of root.querySelectorAll(ACTIONS)) {
                if (el.closest("article") === null) return el.closest('div[role="group"]');
            }
            return null;
        },

        /** "like" は未いいね、"unlike" はいいね済みのボタン。前者だけを見るので、付けたときだけ保存します */
        likeButton: '[data-testid="like"]',

        /**
         * ボタンに関係する要素（メディア・投稿へのリンク・操作バーのボタン）。
         * 投稿の中でこれらが増減したときだけ、ボタンを見直します。
         * 動画の再生時間の表示のような変化では見直さないので、再生中も軽く済みます。
         * 拡大表示の画像を包む要素は、拡大表示が開いた後から入ってくることがあるので、これも見ます。
         */
        watch: `${MEDIA}, ${VIEWER_MEDIA}, a[href*="/status/"], ${ACTIONS}`,
    });
})();
