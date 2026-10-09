// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * sites/privatter/content.js
 * ==================================================================
 * Privatter 用のアダプタ。画像の投稿（/i/{投稿ID}）と、本文に画像を埋め込んだ文章の投稿（/p/{投稿ID}）の
 * ページで動きます。どちらも 1 ページに投稿 1 件で、投稿の中身は左の列（#left）にまとまっています。
 *
 * 画面の画像は縮小版（…/img_resize/{ファイル名}）で、それを包むリンク（rel="lightbox"）の先に
 * 原寸画像（…/img_original/{ファイル名}）があります。原寸画像は署名もログインも要らない URL なので、
 * 通信を追加せず、ページに書かれている URL をそのまま使います。
 *
 * パスワード・ログイン限定などの投稿は、解除する前のページに投稿の中身（#left）がありません。
 * 解除するとページが読み込み直され、画像の入ったページになるので、そこでボタンが付きます。
 * 解除の操作を代わりに行ったり、画面に無い画像を取得したりはしません。
 * ==================================================================
 */

(() => {
    "use strict";

    /**
     * ボタンを付けるページのパス。[1] が投稿の種類（i = 画像、p = 文章）、[2] が番号です。
     * ユーザーページ（/u/…）などの一覧では動かしません。
     */
    const PAGE = /^\/([ip])\/(\d+)\/?$/.exec(location.pathname);
    if (!PAGE) return;

    /**
     * 投稿 ID（記録のキーと {id} に使う）。画像の投稿と文章の投稿は番号が別々に振られていて、
     * 同じ番号が両方にあり得るので、種類の頭文字を付けて区別します（例: "i7962168"、"p12082367"）。
     */
    const POST_ID = `${PAGE[1]}${PAGE[2]}`;

    /** 投稿 1 件のコンテナ（ページの左の列）。解除前のページにはありません */
    const POST_ROOT = "#left";

    /** 原寸画像の置き場所。縮小版は同じファイル名で img_resize に置かれています */
    const ORIGINAL = "https://d2pqhom6oey9wx.cloudfront.net/img_original/";

    /** 画像の URL。[1] がファイル名（例: "20758042846ac9137a5788c.jpg"） */
    const IMAGE_URL = /^https:\/\/d2pqhom6oey9wx\.cloudfront\.net\/img_(?:original|resize)\/([\w.-]+)$/;

    /**
     * URL から画像のファイル名を取り出す。投稿の画像でなければ null。
     *
     * @param {string|null|undefined} value - href / src / data-original の値（相対 URL でもよい）
     * @returns {string|null}
     */
    const fileOf = (value) => {
        if (!value) return null;
        const url = URL.parse(value, location.href);
        if (!url) return null;
        return IMAGE_URL.exec(`${url.origin}${url.pathname}`)?.[1] ?? null;
    };

    /**
     * 投稿の画像（画面の並び順）。同じ画像が 2 回出ている場合は最初の 1 つだけ。
     *
     * 画像は遅れて読み込まれ（lazy）、読み込む前の src は空の GIF で、本当の URL は data-original にあります。
     * そのため、包んでいるリンクの href → data-original → src の順に見ます。
     * 置き場所（el）は画像を包むリンクです（<img> の中にはボタンを置けないため）。
     *
     * @param {Element} root
     * @returns {{el: Element, file: string}[]}
     */
    const images = (root) => {
        const seen = new Set();
        const list = [];
        for (const img of root.querySelectorAll("img")) {
            const link = img.closest("a");
            const file = fileOf(link?.getAttribute("href")) ?? fileOf(img.getAttribute("data-original"))
                ?? fileOf(img.getAttribute("src"));
            if (!file || seen.has(file)) continue;
            seen.add(file);
            list.push({ el: link && root.contains(link) ? link : img.parentElement ?? img, file });
        }
        return list;
    };

    /**
     * 文字を取り出す。改行は <br> で書かれているので、改行文字に戻してから文字だけを取り出します。
     *
     * @param {Element|null} el
     * @returns {string}
     */
    const textOf = (el) => {
        if (!el) return "";
        const copy = el.cloneNode(true);
        for (const br of copy.querySelectorAll("br")) br.replaceWith("\n");
        return copy.textContent?.trim() ?? "";
    };

    /**
     * 投稿者のプロフィール欄へのリンク（/u/{ユーザー名}）。
     * 右の列のプロフィール欄を優先し、無ければ左の列の「Posted by」（スマホ表示用）を使います。
     *
     * @param {Element} root
     * @returns {HTMLAnchorElement|null}
     */
    const profileLink = (root) =>
        document.querySelector('#right a.panel-title[href^="/u/"]') ?? root.querySelector('a.panel-title[href^="/u/"]');

    /**
     * 投稿日時。ページには "2026-10-10 01:16:59" の形で、日本時間で書かれています。
     *
     * @param {Element} root
     * @returns {string|null} ISO 8601（+09:00 付き）。見つからなければ null
     */
    const readTime = (root) => {
        const text = root.querySelector(".fa-clock")?.parentElement?.textContent ?? "";
        const m = /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(text);
        return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00` : null;
    };

    /**
     * 投稿情報をすべて読む（アダプタの readPost）。保存するときだけ呼ばれます。
     *
     *   - 本文（{text}）は、文章の投稿ならタイトル、画像の投稿なら画像に添えられた文章です
     *     （文章の投稿の本文は長すぎてファイル名に向かないため）
     *   - 表示名（{name}）は、右の列のプロフィール欄にある名前です
     *
     * @param {Element} root
     * @returns {object|null}
     */
    const readPost = (root) => {
        const link = profileLink(root);
        const user = /^\/u\/([^/?#]+)/.exec(link?.getAttribute("href") ?? "")?.[1];
        if (!user) return null;

        const name = link.closest(".panel")?.querySelector(":scope > .panel-body > b");
        const title = root.querySelector(":scope > h3");
        const caption = root.querySelector(":scope > .panel > .panel-body");

        return {
            site: "privatter",
            screenName: decodeURIComponent(user),
            postId: POST_ID,
            name: textOf(name),
            text: textOf(title) || textOf(caption),
            time: readTime(root),
        };
    };

    /**
     * メディア一覧（アダプタの getMedia）。並びは画面（DOM）と同じです。
     *
     * @param {Element} root
     * @returns {Promise<object[]>}
     */
    const getMedia = async (root) => images(root).map(({ file }) => {
        const dot = file.lastIndexOf(".");
        const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "jpg";

        return {
            kind: "photo",
            url: ORIGINAL + file,
            ext: ext === "jpeg" ? "jpg" : ext,
            id: dot > 0 ? file.slice(0, dot) : file,
            res: "",
        };
    });

    SMDCore.start({
        site: "privatter",
        postRoot: POST_ROOT,
        mediaContainers: (root) => images(root).map(({ el }) => el),
        postId: () => POST_ID,
        readPost,
        getMedia,

        /**
         * お気に入り・いいね・Share が並ぶ行。Share の項目の中に置きます（無ければ行の末尾）。
         * ここが無いページ（作りの違うページ）では、投稿日時の欄の末尾に置きます。
         */
        actionBar: (root) => {
            const bar = root.querySelector(":scope > ul.list-inline");
            return bar?.querySelector(":scope > li:has(.web-share-btn)") ?? bar
                ?? root.querySelector(":scope > .panel > .panel-heading");
        },

        /**
         * いいねのアイコン（「♡いいね」を押すと開く一覧の、ハートや顔のアイコン）。
         * 押すたびにいいねが 1 つ送られます。一覧を開くだけの「♡いいね」は含みません。
         */
        likeButton: "button.addnice",

        /** ボタンに関係する要素（画像・操作の行） */
        watch: "img, ul.list-inline",
    });
})();
