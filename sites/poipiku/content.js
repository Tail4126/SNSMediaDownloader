// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * sites/poipiku/content.js
 * ==================================================================
 * ポイピク用のアダプタ。投稿詳細ページ（/{ユーザーID}/{投稿ID}.html）と、こそフォロ・フォロータグの一覧
 * （/MyHomePcV.jsp・/MyHomeTagPcV.jsp）で動きます。どちらも投稿 1 件ごとに同じ形の枠（.IllustItem）が並びます。
 *
 * 画面のサムネイル（…/{ファイル名}_640.jpg）は縮小版で、原寸画像は CloudFront の署名付き URL
 * （…/{ファイル名}?Expires=…&Signature=…）でしか取得できません。署名付き URL は、ページ自身が
 * 画像を拡大表示するときに使う /f/ShowIllustDetailF.jsp が返すので、保存するときに 1 回だけ
 * 同じリクエストを送って受け取ります。
 *
 * パスワード・フォロワー限定・ワンクッションなどの投稿は、画面で閲覧できている（解除済みの）
 * 画像だけを保存します。解除の操作を代わりに行ったり、画面に無い画像を取得したりはしません。
 *
 * 画像 1 枚のワンクッション投稿は、解除してもサムネイルが警告画像のまま変わらず、原寸画像は
 * 投稿の外にある拡大表示（#DetailOverlay）にだけ出ます。そこで拡大表示に出た署名付き URL も
 * 覚えておき、その投稿の画像として扱います（警告画像のサムネイルにボタンを付けます）。
 * ==================================================================
 */

(() => {
    "use strict";

    /**
     * ボタンを付けるページのパス。
     *   - 投稿詳細ページ … /{ユーザーID}/{投稿ID}.html
     *   - こそフォロの一覧 … /MyHomePcV.jsp（?PG=1 などのページ送りも同じパス）
     *   - フォロータグの一覧 … /MyHomeTagPcV.jsp
     * お気に入り（/MyBookmarkListPcV.jsp）は作りが違う（.IllustThumb の格子）ので対象外です。
     */
    const PAGES = [/^\/\d+\/\d+\.html$/, /^\/MyHome(?:Tag)?PcV\.jsp$/];

    // それ以外のページ（新着・ユーザーページなど）では動かしません。
    if (!PAGES.some((re) => re.test(location.pathname))) return;

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

    /** ページ内に表示された署名付き画像（拡大表示など） */
    const SIGNED_IMG = `img[src^="${CDN}/"][src*="Signature="]`;

    /** 拡大表示の枠。投稿の外（ページの末尾）にあります */
    const OVERLAY = "#DetailOverlay";

    /**
     * ページ内に表示された署名付き URL。原寸画像のパス → { URL, どの投稿のものか }（表示された順）。
     * 拡大表示を閉じても保存できるよう、一度見えたものは覚えておきます。
     * @type {Map<string, {url: string, cid: string|null}>}
     */
    const shownSigned = new Map();

    /**
     * 最後にサムネイルを押して拡大表示を開いた投稿の ID。
     * ファイル名の先頭の数字は投稿 ID と一致しないこと（別の投稿の画像の使い回しなど）があるため、
     * 拡大表示に出た画像がどの投稿のものかは、開いた操作から判断します。
     * @type {string|null}
     */
    let openedCid = null;

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
     * 投稿 ID を読む。
     *
     * @param {Element} root
     * @returns {string|null}
     */
    const postId = (root) => /^IllustItem_(\d+)$/.exec(root.id)?.[1] ?? null;

    /**
     * 拡大表示に出た画像の持ち主（投稿 ID）を決める。
     *   1. サムネイルを押して開いたなら、その投稿
     *   2. ページに投稿が 1 件しかない（詳細ページ）なら、その投稿
     *   3. それ以外は、ファイル名の先頭の数字（多くの場合は投稿 ID と同じ）
     *
     * @param {string} path
     * @returns {string|null}
     */
    const ownerOf = (path) => {
        if (openedCid) return openedCid;
        const roots = document.querySelectorAll(POST_ROOT);
        if (roots.length === 1) return postId(roots[0]);
        const head = /^\/\d+\/(\d+)_/.exec(path)?.[1];
        return head ? String(Number(head)) : null;
    };

    /**
     * 原寸画像のパスが、ページ内で見えたその投稿の画像か。
     *
     * @param {string} path
     * @param {string|null} cid - 投稿 ID
     * @returns {boolean}
     */
    const belongsTo = (path, cid) => cid !== null && shownSigned.get(path)?.cid === cid;

    /**
     * ページ内に表示された署名付き画像を拾って覚える。
     *
     * @returns {boolean} 新しく覚えたものがあれば true
     */
    const collectShown = () => {
        let added = false;
        for (const img of document.querySelectorAll(SIGNED_IMG)) {
            const path = filePath(img.src);
            if (path && !shownSigned.has(path)) {
                shownSigned.set(path, { url: img.src, cid: ownerOf(path) });
                added = true;
            }
        }
        return added;
    };

    /**
     * この投稿の、画面に表示されている画像（サムネイル）。同じ画像が 2 回出ている場合は最初の 1 つだけ。
     *
     * 本物のサムネイルが 1 枚も無く、拡大表示でこの投稿の画像が見えていた場合（画像 1 枚の
     * ワンクッション投稿を解除したとき）は、警告画像のサムネイルをその画像の置き場所にします。
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
        if (list.length > 0) return list;

        const cid = postId(root);
        const placeholder = root.querySelector(THUMB);
        const path = [...shownSigned.keys()].find((p) => belongsTo(p, cid));
        return placeholder && path ? [{ el: placeholder, path }] : [];
    };

    /**
     * まだ解除されていない投稿か（アダプタの isLocked）。
     * サムネイルの枠はあるのに、本物の画像が 1 枚も見えていない投稿です（パスワード・フォロワー限定・
     * 年齢制限・注意書きの代わりの画像だけが出ている状態）。文章の投稿（.Text）は保存する画像が無いので除きます。
     *
     * @param {Element} root
     * @returns {boolean}
     */
    const isLocked = (root) =>
        !root.classList.contains("Text") && root.querySelector(THUMB) !== null && thumbs(root).length === 0;

    /**
     * 投稿者のユーザー ID を読む。一覧では投稿ごとに投稿者が違うので、ページの URL ではなく
     * 投稿の中から取ります。名前のリンク（/{ユーザーID}/）を優先し、無ければサムネイルの
     * onclick（showIllustDetail(ユーザーID, 投稿ID, …)）から取ります。
     *
     * @param {Element} root
     * @returns {string|null}
     */
    const userId = (root) => {
        const href = root.querySelector(".IllustItemUserName a")?.getAttribute("href") ?? "";
        const onclick = root.querySelector("a.IllustItemThumb")?.getAttribute("onclick") ?? "";
        return /^\/(\d+)\//.exec(href)?.[1] ?? /showIllustDetail\(\s*(\d+)/.exec(onclick)?.[1] ?? null;
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
        const uid = userId(root);
        if (!id || !uid) return null;

        return {
            site: "poipiku",
            screenName: uid,
            postId: id,
            name: root.querySelector(".IllustItemUserName")?.textContent.trim() ?? "",
            text: readText(root),
            time: null, // 投稿日時はページに無いので、{date} などは空になります
        };
    };

    /**
     * 投稿のパスワード欄に、利用者が入力した値。欄が無ければ空文字。
     *
     * @param {Element} root
     * @returns {string}
     */
    const passwordOf = (root) => root.querySelector("input.IllustItemExpandPass")?.value ?? "";

    /**
     * 署名付き URL を、ページと同じ方法で受け取る。失敗したら空の Map。
     *
     * @param {string} uid - ユーザー ID
     * @param {string} cid - 投稿 ID
     * @param {string} pass - パスワード欄に入っている値（無ければ空文字）
     * @returns {Promise<Map<string, string>>} 原寸画像のパス → 署名付き URL
     */
    const signedUrls = async (uid, cid, pass) => {
        // AD=-1 は「投稿のすべての画像」。PAS には、ページ自身と同じく投稿のパスワード欄の値を
        // そのまま送ります（パスワードの無い投稿では空）。値を推測したり補ったりはしません。
        // 空でない値を送ると、パスワードの無い投稿でも照合に失敗して画像が返ってきません。
        const body = new URLSearchParams({ ID: uid, TD: cid, AD: "-1", PAS: pass });
        const urls = new Map();

        try {
            const res = await pageFetch(`${location.origin}/f/ShowIllustDetailF.jsp`, {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "X-Requested-With": "XMLHttpRequest",
                },
                body,
            });
            if (!res.ok) return urls;

            // 応答は HTML か、HTML を含む JSON です。どちらでも URL を拾えるよう、エスケープを戻してから探します。
            // JSON の \uXXXX（Java の JSON ライブラリは "=" や "&" もこの形にします）と \/、
            // HTML の文字参照（&amp; や &#61; など）を元の文字に戻します。&amp; は二重に戻さないよう最後です。
            const text = (await res.text())
                .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
                .replace(/\\\//g, "/")
                .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
                .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
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
     * ただし拡大表示で見えていたこの投稿の画像は、サムネイルに無くても後ろに足します。
     *
     * @param {Element} root
     * @param {object} post - readPost の結果
     * @returns {Promise<(object|null)[]>}
     */
    const getMedia = async (root, post) => {
        collectShown();
        const shown = thumbs(root);
        if (shown.length === 0) return [];

        // ページ内で見えていた署名付き URL を優先し、足りないときだけ問い合わせます。
        const urls = new Map([...shownSigned].map(([path, { url }]) => [path, url]));
        if (shown.some(({ path }) => !urls.has(path))) {
            for (const [path, url] of await signedUrls(post.screenName, post.postId, passwordOf(root))) {
                if (!urls.has(path)) urls.set(path, url);
            }
        }

        const paths = shown.map(({ path }) => path);
        for (const path of shownSigned.keys()) {
            if (belongsTo(path, post.postId) && !paths.includes(path)) paths.push(path);
        }

        return paths.map((path) => {
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

    // サムネイルが押されたら、どの投稿の拡大表示かを覚えておきます（見るだけで、クリックには手を触れません）。
    document.addEventListener("click", (e) => {
        const root = e.target instanceof Element ? e.target.closest("a.IllustItemThumb")?.closest(POST_ROOT) : null;
        if (root) openedCid = postId(root);
    }, true);

    collectShown();

    const { refresh } = SMDCore.start({
        site: "poipiku",
        postRoot: POST_ROOT,
        mediaContainers: (root) => thumbs(root).map(({ el }) => el.parentElement ?? el), // <img> の中には置けないので親（リンク）へ
        postId,
        readPost,
        getMedia,

        isLocked,

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

    // 拡大表示は投稿の外にあり、SMDCore はそこの変化を見ていません。
    // 新しい署名付き画像が出たときだけ、ボタンを見直してもらいます。
    const overlay = document.querySelector(OVERLAY);
    if (overlay) {
        new MutationObserver(() => {
            if (collectShown()) refresh();
        }).observe(overlay, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    }
})();
