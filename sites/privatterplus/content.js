// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * sites/privatterplus/content.js
 * ==================================================================
 * Privatter+（privatter.me）用のアダプタ。記事のページ（/page/{記事ID}）で動きます。
 * 1 ページに記事 1 件で、記事の中身は「本文の区切り線（hr#contents）を持つ列」にまとまっています。
 *
 * 本文の画像は、拡大表示用のリンク（data-lightbox）で包まれていて、画像もリンクも原寸画像
 * （https://media.privatter.me/img/{ユーザー番号}/original/{ファイル名}）を指しています。
 * 署名もログインも要らない URL なので、通信を追加せず、ページに書かれている URL をそのまま使います。
 *
 * パスワード付きなどの記事は、解除する前のページに本文（と区切り線）がありません。
 * 解除するとページが読み込み直され、画像の入ったページになるので、そこでボタンが付きます。
 * 解除の操作を代わりに行ったり、画面に無い画像を取得したりはしません。
 * ==================================================================
 */

(() => {
    "use strict";

    /** ボタンを付けるページのパス。[1] が記事 ID（例: "6975d5e22c2c3"）。ユーザーページなどの一覧では動かしません */
    const PAGE = /^\/page\/([0-9A-Za-z]+)\/?$/.exec(location.pathname);
    if (!PAGE) return;

    /** 記事 ID（記録のキーと {id} に使う） */
    const POST_ID = PAGE[1];

    /**
     * 記事 1 件のコンテナ。本文の区切り線（hr#contents）を直接持つ列です。
     * 解除前のページには区切り線が無いので、何も見つかりません。
     */
    const POST_ROOT = "div:has(> hr#contents)";

    /** 原寸画像の URL。[1] がユーザー番号、[2] がファイル名（例: "8066673996975d547a798f.png"） */
    const IMAGE_URL = /^https:\/\/media\.privatter\.me\/img\/(\d+)\/original\/([\w.-]+)$/;

    /**
     * URL から原寸画像の URL（クエリなどを除いたもの）を取り出す。投稿の画像でなければ null。
     * アイコン（…/icon/…）や広告の画像は当てはまりません。
     *
     * @param {string|null|undefined} value - href / src の値（相対 URL でもよい）
     * @returns {{url: string, file: string}|null}
     */
    const imageOf = (value) => {
        if (!value) return null;
        const parsed = URL.parse(value, location.href);
        if (!parsed) return null;
        const url = `${parsed.origin}${parsed.pathname}`;
        const m = IMAGE_URL.exec(url);
        return m ? { url, file: m[2] } : null;
    };

    /**
     * 記事の画像（画面の並び順）。同じ画像が 2 回出ている場合は最初の 1 つだけ。
     * 包んでいるリンクの href を優先し、無ければ画像の src を見ます。
     * 置き場所（el）は画像を包むリンクです（<img> の中にはボタンを置けないため）。
     *
     * @param {Element} root
     * @returns {{el: Element, url: string, file: string}[]}
     */
    const images = (root) => {
        const seen = new Set();
        const list = [];
        for (const img of root.querySelectorAll("img")) {
            const link = img.closest("a");
            const found = imageOf(link?.getAttribute("href")) ?? imageOf(img.getAttribute("src"));
            if (!found || seen.has(found.url)) continue;
            seen.add(found.url);
            list.push({ el: link && root.contains(link) ? link : img.parentElement ?? img, ...found });
        }
        return list;
    };

    /**
     * 文字を取り出す。改行は <br> で書かれているので、改行文字に戻してから文字だけを取り出します。
     *
     * @param {Element|null|undefined} el
     * @returns {string}
     */
    const textOf = (el) => {
        if (!el) return "";
        const copy = el.cloneNode(true);
        for (const br of copy.querySelectorAll("br")) br.replaceWith("\n");
        return copy.textContent?.trim() ?? "";
    };

    /**
     * 投稿日時。ページには "2026-01-25 17:35:46" の形で、日本時間で書かれています。
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
     * 記事の情報をすべて読む（アダプタの readPost）。保存するときだけ呼ばれます。
     *
     *   - ユーザー名（{user}）は投稿者へのリンク（/user/{ユーザー名}）から、表示名（{name}）はその文字から取ります
     *   - 本文（{text}）は記事のタイトルです（本文は長すぎてファイル名に向かないため）。
     *     タイトルが無ければ、タイトルの下の説明文を使います
     *
     * @param {Element} root
     * @returns {object|null}
     */
    const readPost = (root) => {
        const link = root.querySelector('a[href^="/user/"]');
        const user = /^\/user\/([^/?#]+)/.exec(link?.getAttribute("href") ?? "")?.[1];
        if (!user) return null;

        return {
            site: "privatterplus",
            screenName: decodeURIComponent(user),
            postId: POST_ID,
            name: textOf(link),
            text: textOf(root.querySelector(":scope > h2")) || textOf(root.querySelector(":scope > .honbun")),
            time: readTime(root),
        };
    };

    /**
     * メディア一覧（アダプタの getMedia）。並びは画面（DOM）と同じです。
     *
     * @param {Element} root
     * @returns {Promise<object[]>}
     */
    const getMedia = async (root) => images(root).map(({ url, file }) => {
        const dot = file.lastIndexOf(".");
        const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "jpg";

        return {
            kind: "photo",
            url,
            ext: ext === "jpeg" ? "jpg" : ext,
            id: dot > 0 ? file.slice(0, dot) : file,
            res: "",
        };
    });

    SMDCore.start({
        site: "privatterplus",
        postRoot: POST_ROOT,
        mediaContainers: (root) => images(root).map(({ el }) => el),
        postId: () => POST_ID,
        readPost,
        getMedia,

        /**
         * 本文の下の「リアクション」「コメント」のタブが並ぶ行（ul#myTab）の、タブの右横に置きます。
         * 上部の共有ボタンの行は、設定によって無い記事があるため使いません。
         * タブの行が無い記事では、共有ボタンの行、それも無ければ投稿日時の欄の末尾に置きます。
         */
        actionBar: (root) => root.querySelector("#myTab")
            ?? root.querySelector(":scope > div:has(> .web-share-btn)")
            ?? root.querySelector(".fa-clock")?.closest(".text-end") ?? null,

        /**
         * リアクションを選ぶ一覧のアイコン。押すたびにリアクションが 1 つ送られます。
         * すでに送られたリアクションの一覧（#reaction_show）と、いま送ったリアクション
         * （#reaction_icons_added。押すと取り消し）にも同じクラスがあるので、選ぶ一覧の中だけに絞ります。
         */
        likeButton: "#reaction_icons .add-reaction",

        /** ボタンに関係する要素（画像・タブの行・共有ボタン） */
        watch: "img, #myTab, .web-share-btn",
    });
})();
