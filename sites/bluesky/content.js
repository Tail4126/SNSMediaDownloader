// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * sites/bluesky/content.js
 * ==================================================================
 * Bluesky 用のアダプタ。
 *
 * Bluesky では通信の横取りが不要です。表示中の画像 URL に
 * DID（アカウントの永続 ID）と CID（ファイルの内容から決まる ID）が
 * そのまま入っているため、DOM を読むだけで実体の URL を組み立てられます。
 *
 * ただし DOM からは本文・投稿日時・正確な拡張子・解像度が取れないので、
 * 保存時に 1 回だけ API を呼んで情報を補います。
 * API が失敗しても DOM 由来の情報だけでダウンロードは成立します。
 *
 * なお投稿日時は indexedAt のみを採用し、createdAt は使いません（readRecord を参照）。
 * ==================================================================
 */

(() => {
    "use strict";

    /** PDS が特定できないときの既定値 */
    const PDS = "https://bsky.social";

    /** 投稿 1 件のコンテナ。フィード内とスレッド表示で testid が異なります */
    const POST_ROOT = '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]';

    /** メディア要素。動画はサムネイル（poster 属性）に情報が入っています */
    const MEDIA = 'img[src*="//cdn.bsky.app/img/feed_"], video[poster*="//video.bsky.app/watch/"]';

    /** "/profile/ハンドル/post/投稿ID" を分解する正規表現 */
    const POST_PATH = /^\/profile\/([^/]+)\/post\/([^/?#]+)/;

    /**
     * MIME タイプから拡張子への対応表。
     * ここに無いものは jpg（画像）/ mp4（動画）として扱います。
     */
    const EXT = { "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif",
        "video/webm": "webm", "video/quicktime": "mov" };

    /**
     * この要素が引用投稿（内側の投稿）に属しているかを判定する。
     *
     * @param {Element} el - 判定したい要素
     * @param {Element} root - 外側の投稿コンテナ
     * @returns {boolean} 引用部分の中にあれば true
     */
    const isQuoted = (el, root) => {
        const quote = el.closest('div[role="link"], div[aria-label^="Post by"]');

        // quote !== root の確認が必要なのは、root 自身がこの条件に一致することがあるためです。
        // 自分自身を「引用」と誤判定すると、全メディアが除外されてしまいます。
        return Boolean(quote && quote !== root && root.contains(quote));
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
     * この投稿が持つメディア要素（img / video そのもの）を返す。
     *
     * @param {Element} root - 投稿コンテナ
     * @returns {Element[]} メディア要素の配列
     */
    const mediaElements = (root) =>
        // 外部リンクのプレビュー画像（<a href="http..."> の中の img）は対象外にします。
        own(MEDIA, root).filter((el) => !el.closest('a[href^="http"]'));

    /**
     * 投稿情報を読み取る（アダプタの readPost）。
     *
     * @param {Element} root - 投稿コンテナ
     * @returns {import("../../shared/core.js").PostInfo|null} 読み取れなければ null
     */
    const readPost = (root) => {
        // data-testid="feedItem-by-example.bsky.social" の "-by-" 以降が投稿者です。
        const owner = /-by-(.+)$/.exec(root.dataset.testid ?? "")?.[1] ?? "";

        /**
         * 見つけたリンクが「この投稿の投稿者本人のもの」か確認する。
         * owner が取れない場合や DID 形式の場合は照合できないので、無条件で通します。
         *
         * @param {RegExpExecArray} m - POST_PATH の実行結果
         * @returns {boolean}
         */
        const isOwner = (m) => !owner || owner.startsWith("did:") || decodeURIComponent(m[1]) === owner;

        // 投稿内にある /post/ リンクをすべて集めて分解します。
        const links = own('a[href*="/post/"]', root)
            .map((a) => POST_PATH.exec(new URL(a.href, location.origin).pathname))
            .filter(Boolean); // 形式が合わないものは捨てる

        // 投稿詳細ページでは投稿自身へのリンクが無いことがあるため、現在の URL も候補にします。
        const here = POST_PATH.exec(location.pathname);

        // 優先順位: 投稿者本人のリンク → 最初のリンク → 現在の URL
        const match = links.find(isOwner) ?? links[0] ?? (here && isOwner(here) ? here : null);
        if (!match) return null;

        return {
            site: "bluesky",
            screenName: decodeURIComponent(match[1]),
            postId: match[2],

            // 表示名と投稿日時は DOM から確実に取れないため、あとで API の結果で埋めます。
            name: "",
            text: own('[data-testid="postText"]', root)[0]?.textContent ?? "",
            time: null,
        };
    };

    /**
     * DOM のメディア要素から DID と CID を取り出す。
     * API が使えなくても、この情報だけでダウンロード URL を組み立てられます。
     *
     * @param {Element} root - 投稿コンテナ
     * @returns {{kind: string, did: string, cid: string, ext: string}[]}
     */
    const fromDom = (root) =>
        mediaElements(root).map((el) => {
            const isVideo = el.tagName === "VIDEO";

            // 動画:   .../watch/{did}/{cid}/...
            // 静止画: .../plain/{did}/{cid}@jpeg
            const m = isVideo
                ? /\/watch\/([^/]+)\/([^/]+)\//.exec(el.poster ?? "")
                : /\/plain\/([^/]+)\/([^/@?]+)/.exec(el.src ?? "");

            // m が null のときは && によって全体が null になり、次の filter で除去されます。
            return m && {
                kind: isVideo ? "video" : "photo",
                did: decodeURIComponent(m[1]),
                cid: decodeURIComponent(m[2]),
                ext: isVideo ? "mp4" : "jpg", // DOM だけでは本当の形式が分からないので暫定値
            };
        }).filter(Boolean);

    /**
     * API のレスポンスに含まれる blob オブジェクトから CID を取り出す。
     * データ形式に新旧 2 種類があるため、両方に対応しています。
     *
     * @param {object} blob - blob 参照オブジェクト
     * @returns {string} CID。取れなければ空文字
     */
    const cidOf = (blob) => blob?.ref?.["$link"] ?? blob?.cid ?? "";

    /**
     * API から取得した投稿オブジェクトを解析し、メディア一覧と補足情報に分ける。
     *
     * @param {object} post - app.bsky.feed.getPosts の結果 1 件分
     * @returns {{media: object[], meta: {screenName: string, name: string, text: string, time: string|null}}}
     */
    const readRecord = (post) => {
        const record = post?.record ?? {};
        const did = post?.author?.did;

        // 引用投稿つきの場合、メディアは embed.media の下に入れ子になります。
        const embed = record.embed?.media ?? record.embed ?? {};

        // 画像は images、動画は video というように形式が違うので、配列の形に揃えます。
        const blobs = embed.images ?? embed.items
            ?? (embed.video ? [{ image: embed.video, aspectRatio: embed.aspectRatio, video: true }] : []);

        return {
            media: blobs.filter((b) => cidOf(b.image)).map((b) => ({
                kind: b.video ? "video" : "photo",
                did,
                cid: cidOf(b.image),
                ext: EXT[b.image.mimeType] ?? (b.video ? "mp4" : "jpg"),
                res: b.aspectRatio?.width ? `${b.aspectRatio.width}x${b.aspectRatio.height}` : "",
            })),
            meta: {
                screenName: post?.author?.handle ?? "",
                name: post?.author?.displayName ?? "",
                text: record.text ?? "",

                // 投稿日時は indexedAt（サーバーが投稿を受け取った時刻）だけを使います。
                // record.createdAt は投稿者の端末が自己申告した時刻で、時計のずれや
                // 意図的な書き換えがあり得るため、値として信用しません。
                // indexedAt が取れない場合は null のままにし、日時系の変数を空にします。
                // 誤った日時でファイル名を作るより、空にしたほうが害が小さいためです。
                time: post?.indexedAt ?? null,
            },
        };
    };

    /**
     * メディア一覧を返す（アダプタの getMedia）。
     * DOM の情報を土台にしつつ、API が成功すればより正確な情報で置き換えます。
     *
     * @param {Element} root - 投稿コンテナ
     * @param {object} post - readPost の結果。ここに情報を書き足します
     * @returns {Promise<object[]>} ダウンロード可能なメディア情報の配列
     */
    const getMedia = async (root, post) => {
        const dom = fromDom(root);

        // DOM から DID が取れていればそれを使い、取れなければハンドルを渡します
        // （background 側でハンドル → DID の解決が 1 回挟まります）。
        const reply = await SMDCore.request({
            type: "bskyPost", actor: dom[0]?.did ?? post.screenName, rkey: post.postId,
        }).catch(() => null);

        const record = reply?.post ? readRecord(reply.post) : null;

        // API が成功したときだけ、投稿情報に本文・表示名・日時を補います。
        // 空の値で上書きしないよう if (value) で確認しています。
        if (record?.media.length) {
            for (const [key, value] of Object.entries(record.meta)) if (value) post[key] = value;
        }

        const host = reply?.pds ?? PDS;

        // API の結果を優先し、無ければ DOM 由来の情報でダウンロード URL を組み立てます。
        // getBlob は「その人の PDS」から生データを直接取得するエンドポイントです。
        return (record?.media.length ? record.media : dom).map((m) => ({
            kind: m.kind,
            ext: m.ext,
            id: m.cid,
            res: m.res ?? "",
            url: `${host}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(m.did)}&cid=${encodeURIComponent(m.cid)}`,
        }));
    };

    /**
     * 返信・リポスト・いいねが並ぶ操作バーを探す（アダプタの actionBar）。
     *
     * @param {Element} root - 投稿コンテナ
     * @returns {Element|null} ボタンを置く要素。見つからなければ null
     */
    const actionBar = (root) => {
        // ブックマークボタンがあれば、その親が操作バーです（最も確実な手がかり）。
        const bookmark = root.querySelector('[data-testid="postBookmarkBtn"]');
        if (bookmark?.parentElement) return bookmark.parentElement;

        // 無い場合は「返信ボタンから親をたどり、いいねボタンも含む最初の要素」を探します。
        // 両方を含む要素なら、それが操作バー全体だと判断できます。
        const like = root.querySelector('[data-testid="likeBtn"], [data-testid="unlikeBtn"]');
        for (let n = root.querySelector('[data-testid="replyBtn"]'); n && n !== root; n = n.parentElement) {
            if (like && n.contains(like)) return n;
        }

        return null;
    };

    // アダプタを組み立てて共通処理へ渡します。
    SMDCore.start({
        site: "bluesky",
        postRoot: POST_ROOT,

        // ボタンは <img> の中には置けないので、その親要素を返します。
        mediaContainers: (root) => mediaElements(root).map((el) => el.parentElement ?? el),

        readPost,
        getMedia,
        actionBar,
    });
})();
