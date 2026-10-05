// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * sites/poipiku/content.js
 * ==================================================================
 * ポイピク用のアダプタ。投稿詳細ページ（/{ユーザーID}/{投稿ID}.html）だけで動きます。
 *
 * 画面のサムネイル（…/{ファイル名}_640.jpg）は縮小版で、原寸画像は CloudFront の署名付き URL
 * （…/{ファイル名}?Expires=…&Signature=…）でしか取得できません。署名付き URL は、ページ自身が
 * 画像を拡大表示するときに使う /f/ShowIllustDetailF.jsp が返すので、保存するときに 1 回だけ
 * 同じリクエストを送って受け取ります。
 *
 * パスワード・フォロワー限定・ワンクッションなどの投稿は、画面で閲覧できている（解除済みの）
 * 画像だけを保存します。解除の操作を代わりに行ったり、画面に無い画像を取得したりはしません。
 * ==================================================================
 */

(() => {
    "use strict";

    /** 投稿詳細ページのパス。[1] がユーザー ID、[2] が投稿 ID */
    const PAGE_PATH = /^\/(\d+)\/(\d+)\.html$/;

    // 一覧やタイムラインでは動かしません（ボタンは投稿詳細ページだけ）。
    const page = PAGE_PATH.exec(location.pathname);
    if (!page) return;

    /** 投稿 1 件のコンテナ */
    const POST_ROOT = '.IllustItem[id^="IllustItem_"]';

    /** サムネイル画像。ロック中・警告の代わりに出る画像（/img/…）も同じクラスなので、URL で見分けます */
    const THUMB = "img.IllustItemThumbImg";

    /** 画像の配信元 */
    const CDN = "https://cdn.poipiku.com";

    /** 投稿者がアップロードした画像のパス（/{ユーザーID}/{投稿ID}_…）。[1] がファイル名 */
    const FILE_PATH = /^\/\d+\/(\d+_[^/]+)$/;

    /** サムネイルのファイル名の末尾（"_640.jpg" など）。取り除くと原寸画像のファイル名になります */
    const THUMB_SUFFIX = /_\d+\.jpg$/;

    /** 応答の中の、配信元の URL */
    const CDN_URL = /https:\/\/cdn\.poipiku\.com\/[^"'\s<>\\]+/g;

    /**
     * Firefox では content.fetch がページ側の fetch で、Cookie もページと同じように扱われます。
     * Chrome の拡張機能の fetch は、同じオリジンへのリクエストならそのまま Cookie を送ります。
     */
    const pageFetch = globalThis.content?.fetch ? (...args) => globalThis.content.fetch(...args) : fetch;

    /**
     * 画像の URL から、原寸画像のパスを取り出す。投稿者の画像でなければ null。
     *
     * @param {string} url
     * @returns {string|null} 例: "/000820044/009771685_7ayEpiF51.png"
     */
    const filePath = (url) => {
        if (!url.startsWith(`${CDN}/`)) return null;
        const path = url.slice(CDN.length).split(/[?#]/)[0].replace(THUMB_SUFFIX, "");
        return FILE_PATH.test(path) ? path : null;
    };

    /**
     * この投稿の、画面に表示されている画像（サムネイル）。同じ画像が 2 回出ている場合は最初の 1 つだけ。
     *
     * @param {Element} root
     * @returns {{el: HTMLImageElement, path: string}[]}
     */
    const thumbs = (root) => {
        const seen = new Set();
        const list = [];
        for (const el of root.querySelectorAll(THUMB)) {
            const path = filePath(el.src);
            if (!path || seen.has(path)) continue;
            seen.add(path);
            list.push({ el, path });
        }
        return list;
    };

    /**
     * 投稿 ID を読む。
     *
     * @param {Element} root
     * @returns {string|null}
     */
    const postId = (root) => /^IllustItem_(\d+)$/.exec(root.id)?.[1] ?? null;

    /**
     * 投稿者のユーザー ID を読む。名前のリンク（/{ユーザーID}/）が無ければページの URL から取ります。
     *
     * @param {Element} root
     * @returns {string}
     */
    const userId = (root) => {
        const href = root.querySelector(".IllustItemUserName a")?.getAttribute("href") ?? "";
        return /^\/(\d+)\//.exec(href)?.[1] ?? page[1];
    };

    /**
     * 本文。改行は <br> で書かれているので、改行文字に戻してから文字だけを取り出します。
     *
     * @param {Element} root
     * @returns {string}
     */
    const readText = (root) => {
        const desc = root.querySelector(".IllustItemDesc");
        if (!desc) return "";
        const copy = desc.cloneNode(true);
        for (const br of copy.querySelectorAll("br")) br.replaceWith("\n");
        return copy.textContent ?? "";
    };

    /**
     * 投稿情報をすべて読む（アダプタの readPost）。保存するときだけ呼ばれます。
     *
     * @param {Element} root
     * @returns {object|null}
     */
    const readPost = (root) => {
        const id = postId(root);
        if (!id) return null;

        return {
            site: "poipiku",
            screenName: userId(root),
            postId: id,
            name: root.querySelector(".IllustItemUserName")?.textContent.trim() ?? "",
            text: readText(root),
            time: null, // 投稿日時はページに無いので、{date} などは空になります
        };
    };

    /**
     * 署名付き URL を、ページと同じ方法で受け取る。失敗したら空の Map。
     *
     * @param {string} uid - ユーザー ID
     * @param {string} cid - 投稿 ID
     * @returns {Promise<Map<string, string>>} 原寸画像のパス → 署名付き URL
     */
    const signedUrls = async (uid, cid) => {
        // AD=-1 は「投稿のすべての画像」。PAS=yes は、解除済みの投稿でページ自身が送る値です
        // （パスワードそのものではなく、解除済みかどうかはサーバー側が Cookie で判断します）。
        const body = new URLSearchParams({ ID: uid, TD: cid, AD: "-1", PAS: "yes" });
        const urls = new Map();

        try {
            const res = await pageFetch(`${location.origin}/f/ShowIllustDetailF.jsp`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "X-Requested-With": "XMLHttpRequest" },
                body,
            });
            if (!res.ok) return urls;

            // 応答は HTML か、HTML を含む JSON です。どちらでも URL を拾えるよう、エスケープを戻してから探します。
            const text = (await res.text())
                .replace(/\\\//g, "/")
                .replace(/\\u0026/gi, "&")
                .replace(/&amp;/g, "&");

            for (const [url] of text.matchAll(CDN_URL)) {
                const path = filePath(url);
                // 署名の付いたものだけを使います（付いていない URL では原寸画像を取得できません）。
                if (path && url.includes("Signature=") && !urls.has(path)) urls.set(path, url);
            }
        } catch {
            // 通信できなかったときは空のまま返します（保存するものが無い、と通知されます）。
        }
        return urls;
    };

    /**
     * メディア一覧（アダプタの getMedia）。並びは画面（DOM）のサムネイルと同じです。
     * 画面に無い画像は、たとえ応答に含まれていても保存しません（閲覧できている分だけを保存するため）。
     *
     * @param {Element} root
     * @param {object} post - readPost の結果
     * @returns {Promise<(object|null)[]>}
     */
    const getMedia = async (root, post) => {
        const shown = thumbs(root);
        if (shown.length === 0) return [];

        const urls = await signedUrls(post.screenName, post.postId);

        return shown.map(({ path }) => {
            const url = urls.get(path);
            if (!url) return null;

            const name = path.slice(path.lastIndexOf("/") + 1);
            const dot = name.lastIndexOf(".");
            const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "jpg";

            return {
                kind: "photo",
                url,
                ext: ext === "jpeg" ? "jpg" : ext,
                id: dot > 0 ? name.slice(0, dot) : name,
                res: "",
            };
        });
    };

    SMDCore.start({
        site: "poipiku",
        postRoot: POST_ROOT,
        mediaContainers: (root) => thumbs(root).map(({ el }) => el.parentElement ?? el), // <img> の中には置けないので親（リンク）へ
        postId,
        readPost,
        getMedia,

        /** 共有・ブックマークのボタンが並ぶ場所 */
        actionBar: (root) => root.querySelector(".IllustItemCommand .IllustItemCommandSub"),

        /** 絵文字リアクションのボタン。押すたびにリアクションが 1 つ送られます */
        likeButton: ".ResEmojiBtn",

        /**
         * ボタンに関係する要素（サムネイル・解除後に画像が入る枠・操作バー）。
         * 解除すると画像が追加されるので、そのときにボタンを見直します。
         */
        watch: `${THUMB}, .IllustItemThubExpand, .IllustItemCommandSub`,
    });
})();
