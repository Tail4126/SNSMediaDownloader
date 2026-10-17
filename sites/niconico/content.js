// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * sites/niconico/content.js
 * ==================================================================
 * ニコニコ静画のイラスト（seiga.nicovideo.jp/seiga/im{番号}）と、ニコニコ漫画のエピソード
 * （manga.nicovideo.jp/watch/mg{番号}）用のアダプタ。どちらも 1 ページに作品 1 件で、作品の中身は
 * article#detail にまとまっています。ホストで見分けて、それぞれの読み方をします。
 *
 * 【イラスト】
 * ページに出ている画像（lohas.nicoseiga.jp/thumb/{番号}i）は縮小版です。原寸画像の URL には
 * その都度作られる署名が入っていて、ページには書かれていません。ページの「原寸大で見る」のリンク
 * （/image/source/{番号}）を開くと、ログインしていれば原寸画像のページへ転送されるので、
 * 保存するときに background.js に同じリンクを開いてもらい、原寸画像の URL を受け取ります（seigaSource）。
 * 転送先が別のホストで、ページからは応答を読めないため、content script からは送りません。
 *
 * 【漫画】
 * 各ページの画像（deliver.cdn.nicomanga.jp/thumb/{…}.webp）は署名付きで、ページに書かれている
 * URL をそのまま保存します（表示されている大きさ・形式のまま）。通信は追加しません。
 * 画像を遅れて読み込むため、まだ読み込まれていない画像は data-original に URL があります。
 * ==================================================================
 */

(() => {
    "use strict";

    /** イラストのページのパス。[1] がイラスト番号 */
    const ILLUST_PATH = /^\/seiga\/im(\d+)\/?$/;

    /** 漫画のエピソードのページのパス。[1] がエピソード番号 */
    const MANGA_PATH = /^\/watch\/mg(\d+)\/?$/;

    const illust = location.hostname === "seiga.nicovideo.jp" ? ILLUST_PATH.exec(location.pathname) : null;
    const manga = location.hostname === "manga.nicovideo.jp" ? MANGA_PATH.exec(location.pathname) : null;

    // それ以外のページ（一覧・ユーザーページなど）では動かしません。
    if (!illust && !manga) return;

    /**
     * 作品 ID。種類の頭文字（イラストは im、漫画は mg）を付けたままにします。
     * 番号はイラストと漫画で別々に振られているので、頭文字が無いと重なることがあるためです。
     */
    const POST_ID = illust ? `im${illust[1]}` : `mg${manga[1]}`;

    /** 作品 1 件のコンテナ */
    const POST_ROOT = "article#detail";

    /** 漫画のページの画像の URL の形 */
    const MANGA_IMAGE_URL = /^https:\/\/deliver\.cdn\.nicomanga\.jp\/thumb\/[\w-]+\.webp$/;

    /** イラストの縮小版の URL の形（読み込み済みかどうかの確認に使う） */
    const ILLUST_THUMB_URL = /^https:\/\/lohas\.nicoseiga\.jp\/thumb\/\d+i(?:\?.*)?$/;

    /**
     * 「2022年04月15日 22:58」の形の日時を読む（秒は書かれていません）。ページには日本時間で書かれています。
     *
     * @param {Element|null} el
     * @returns {string|null} ISO 8601（+09:00 付き）。読めなければ null
     */
    const readTime = (el) => SMDCore.jstTime(/(\d{4})年(\d{2})月(\d{2})日\s*(\d{2}):(\d{2})/.exec(el?.textContent ?? ""));

    /**
     * 要素の文字を取り出す（前後の空白は除きます。途中の改行や連続する空白は、ファイル名にするときに詰められます）。
     */
    const { textOf } = SMDCore;

    // ================================================================
    // イラスト
    // ================================================================

    /**
     * イラストの画像を包むリンク（「原寸大で見る」）。画像が読み込まれていなければ null。
     *
     * @param {Element} root
     * @returns {Element|null}
     */
    const illustLink = (root) => {
        const link = root.querySelector(".illust_main .thum_large > a#illust_link");
        const src = link?.querySelector("img")?.getAttribute("src") ?? "";
        return link && ILLUST_THUMB_URL.test(src) ? link : null;
    };

    /**
     * イラストの情報を読む。
     *   - ユーザー名（{user}）は投稿者のユーザー ID（数字）、表示名（{name}）はニックネーム
     *   - 本文（{text}）はタイトル
     *
     * @param {Element} root
     * @returns {object|null}
     */
    const readIllust = (root) => {
        const header = root.querySelector("#ko_watchlist_header");
        const href = header?.querySelector('a[href^="/user/illust/"]')?.getAttribute("href") ?? "";
        const user = header?.dataset.id || /^\/user\/illust\/(\d+)/.exec(href)?.[1];
        if (!user) return null;

        return {
            site: "niconico",
            screenName: user,
            postId: POST_ID,
            name: textOf(header.querySelector(".user_name strong")),
            text: textOf(root.querySelector(".im_head_bar h1.title")),
            time: readTime(root.querySelector(".im_head_bar .other_info .created")),
        };
    };

    /**
     * イラストの原寸画像（1 件）。background.js に URL を調べてもらいます。
     *
     * @returns {Promise<(object|null)[]>}
     */
    const getIllust = async () => {
        // SMDCore.request は、background と話せないときも例外ではなく null を返します。
        const found = await SMDCore.request({ type: "seigaSource", id: illust[1] });
        if (!found?.url) return [null]; // ログインしていないときなど。「メディアURLを取得できません」と知らせます

        return [{ kind: "photo", url: found.url, ext: found.ext ?? "jpg", id: illust[1], res: "" }];
    };

    // ================================================================
    // 漫画
    // ================================================================

    /**
     * 漫画のページの画像（画面の並び順）。同じ画像が 2 回出ている場合は最初の 1 つだけ。
     * 置き場所（el）は、ページ 1 枚ぶんの枠（li.page）です。
     *
     * @param {Element} root
     * @returns {{el: Element, img: HTMLImageElement, url: string, id: string}[]}
     */
    const mangaPages = (root) => {
        const seen = new Set();
        const list = [];
        for (const img of root.querySelectorAll("#page_contents > li.page img[data-image-id]")) {
            // 遅れて読み込む画像は、読み込むまで data-original に本当の URL があります。
            const url = [img.getAttribute("data-original"), img.getAttribute("src")]
                .find((value) => value && MANGA_IMAGE_URL.test(value));
            const id = img.getAttribute("data-image-id") ?? "";
            if (!url || seen.has(id)) continue;
            seen.add(id);
            list.push({ el: img.closest("li.page") ?? img.parentElement ?? img, img, url, id });
        }
        return list;
    };

    /**
     * 漫画のエピソードの情報を読む。
     *   - ユーザー名（{user}）は作者のユーザー ID（数字）、表示名（{name}）は作者名
     *   - 本文（{text}）は「作品名 話のタイトル」
     *
     * @param {Element} root
     * @returns {object|null}
     */
    const readManga = (root) => {
        const author = root.querySelector(".manga_info .user_name a[href*='user_id=']");
        const user = URL.parse(author?.getAttribute("href") ?? "", location.href)?.searchParams.get("user_id");
        if (!user || !/^\d+$/.test(user)) return null;

        const head = root.querySelector("#full_watch_head_bar");
        const title = [textOf(head?.querySelector(".title .manga_title")), textOf(head?.querySelector(".title .episode_title"))]
            .filter(Boolean).join(" ");

        return {
            site: "niconico",
            screenName: user,
            postId: POST_ID,
            name: textOf(author.querySelector(".author_name") ?? author),
            text: title,
            time: readTime(head?.querySelector(".other_info .created") ?? null),
        };
    };

    /**
     * 漫画のページの画像の一覧。並びは mediaContainers と同じです。
     *
     * @param {Element} root
     * @returns {Promise<object[]>}
     */
    const getManga = async (root) => mangaPages(root).map(({ img, url, id }) => ({
        kind: "photo",
        url,
        ext: "webp",
        id,
        // 読み込み済みなら、実際の画像の大きさ（読み込む前は 0 なので空にします）
        res: img.naturalWidth ? `${img.naturalWidth}x${img.naturalHeight}` : "",
    }));

    // ================================================================
    // 開始
    // ================================================================

    SMDCore.start({
        site: "niconico",
        postRoot: POST_ROOT,
        mediaContainers: illust
            ? (root) => { const link = illustLink(root); return link ? [link] : []; }
            : (root) => mangaPages(root).map(({ el }) => el),
        postId: () => POST_ID,
        readPost: illust ? readIllust : readManga,
        getMedia: illust ? getIllust : getManga,

        /**
         * 作品の上の欄の、投稿日時（「2022年04月15日 22:58」）の右横に置きます。
         * イラストも漫画も、日時・閲覧数などの並び（ul.other_info）の先頭が日時の欄です。
         */
        actionBar: (root) => root.querySelector(illust ? ".im_head_bar .other_info > li.date" : "#full_watch_head_bar .other_info > li.date"),

        /**
         * いいね連動保存は、イラストの「クリップ先」に追加するボタンに連動します。
         * このボタンは押しても見た目が変わらず、押すたびにクリップに追加されます（取り消しのボタンはありません）。
         * 保存済みのイラストは、もう一度押しても保存し直しません。
         * クリップ先がまだ 1 つも無いときは、同じボタンが「クリップを作成」になるので、
         * クリップ先の一覧（#clip_group_list）の直下に項目があるときだけ連動します
         * （「新規作成」の項目は section の中にあるので、直下には数えません）。
         * 漫画の「お気に入り」は作品（シリーズ）全体の登録で、このエピソードのものではないので連動しません。
         */
        likeButton: illust ? "#ko_clip:has(#clip_group_list > li) button.add_clip_button" : undefined,

        /** ボタンに関係する要素（画像と、日時の欄） */
        watch: illust ? "img, #illust_link, li.date" : "img, li.page, li.date",
    });
})();
