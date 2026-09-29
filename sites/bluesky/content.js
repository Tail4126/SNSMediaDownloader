// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * sites/bluesky/content.js
 * ==================================================================
 * Bluesky 用のアダプタ。
 *
 * 表示中の画像 URL に DID（アカウントの永続 ID）と CID（ファイルの内容から決まる ID）が
 * そのまま入っているため、DOM を読むだけでダウンロード URL を組み立てられます。
 * 本文・投稿日時・正確な拡張子・解像度は DOM から取れないので、保存時に 1 回だけ
 * background.js 経由で API に問い合わせて補います（background が必要な項目だけに絞って返します）。
 * API が失敗しても、DOM 由来の情報だけでダウンロードは成立します。
 * ==================================================================
 */

(() => {
    "use strict";

    /** PDS が特定できないときの既定値 */
    const PDS = "https://bsky.social";

    /** 投稿 1 件のコンテナ。フィードとスレッド表示で testid が異なります */
    const POST_ROOT = '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]';

    /** 引用投稿の枠 */
    const QUOTE = 'div[role="link"], div[aria-label^="Post by"]';

    /** メディア要素。動画はサムネイル（poster 属性）に情報が入っています */
    const MEDIA = 'img[src*="//cdn.bsky.app/img/feed_"], video[poster*="//video.bsky.app/watch/"]';

    /** "/profile/ハンドル/post/投稿ID" を分解する */
    const POST_PATH = /^\/profile\/([^/]+)\/post\/([^/?#]+)/;

    /**
     * URL の一部を安全にデコードする。壊れた「%」があっても例外を投げず、元の文字列を返します。
     *
     * @param {string} s
     * @returns {string}
     */
    const decode = (s) => {
        try {
            return decodeURIComponent(s);
        } catch {
            return s;
        }
    };

    /**
     * 要素が引用投稿（内側の投稿）に属しているか。
     * 投稿のコンテナと引用の枠のうち、近いほうを 1 回の closest で探します。
     * 見つかったのが投稿のコンテナ（root）自身なら引用ではありません
     * （root 自身が引用の枠の条件に一致することもありますが、その場合も root が返るので同じ判定で済みます）。
     *
     * @param {Element} el
     * @param {Element} root
     * @returns {boolean}
     */
    const isQuoted = (el, root) => el.closest(`${QUOTE}, ${POST_ROOT}`) !== root;

    /**
     * 投稿内の要素を探し、引用部分のものを除いて返す。
     *
     * @param {string} selector
     * @param {Element} root
     * @returns {Element[]}
     */
    const own = (selector, root) => [...root.querySelectorAll(selector)].filter((el) => !isQuoted(el, root));

    /**
     * この投稿のメディア要素（img / video）。外部リンクのプレビュー画像は除きます。
     *
     * @param {Element} root
     * @returns {Element[]}
     */
    const mediaElements = (root) => own(MEDIA, root).filter((el) => !el.closest('a[href^="http"]'));

    /**
     * 投稿自身のパスを探して分解する。
     *
     * @param {Element} root
     * @returns {RegExpExecArray|null} [1] がハンドル（URL エンコードのまま）、[2] が投稿 ID
     */
    const matchPost = (root) => {
        // data-testid="feedItem-by-example.bsky.social" の "-by-" 以降が投稿者です。
        const owner = /-by-(.+)$/.exec(root.dataset.testid ?? "")?.[1] ?? "";

        /** 見つけたリンクが投稿者本人のものか（照合できないときは通す） */
        const isOwner = (m) => !owner || owner.startsWith("did:") || decode(m[1]) === owner;

        let first = null;
        for (const a of own('a[href*="/post/"]', root)) {
            const m = POST_PATH.exec(a.pathname);
            if (!m) continue;
            if (isOwner(m)) return m; // 本人のリンクが見つかった時点で終わり
            first ??= m;
        }
        if (first) return first;

        // 投稿詳細ページでは投稿自身へのリンクが無いことがあるので、今の URL も候補にします。
        const here = POST_PATH.exec(location.pathname);
        return here && isOwner(here) ? here : null;
    };

    /**
     * 投稿情報をすべて読む（アダプタの readPost）。保存するときだけ呼ばれます。
     *
     * @param {Element} root
     * @returns {object|null}
     */
    const readPost = (root) => {
        const match = matchPost(root);
        if (!match) return null;

        return {
            site: "bluesky",
            screenName: decode(match[1]),
            postId: match[2],
            name: "", // 表示名と日時は getMedia で API の結果から埋めます
            text: own('[data-testid="postText"]', root)[0]?.textContent ?? "",
            time: null,
        };
    };

    /**
     * DOM のメディア要素から DID と CID を取り出す。mediaElements と同じ並びで、読めないものは null。
     *
     * @param {Element} root
     * @returns {({kind: string, did: string, cid: string, ext: string}|null)[]}
     */
    const fromDom = (root) => mediaElements(root).map((el) => {
        const isVideo = el.tagName === "VIDEO";

        // 動画: .../watch/{did}/{cid}/...　静止画: .../plain/{did}/{cid}@jpeg
        const m = isVideo
            ? /\/watch\/([^/]+)\/([^/]+)\//.exec(el.poster)
            : /\/plain\/([^/]+)\/([^/@?]+)/.exec(el.src);

        return m && {
            kind: isVideo ? "video" : "photo",
            did: decode(m[1]),
            cid: decode(m[2]),
            ext: isVideo ? "mp4" : "jpg", // DOM からは本当の形式が分からないので暫定値
        };
    });

    /**
     * メディア一覧（アダプタの getMedia）。
     *
     * @param {Element} root
     * @param {object} post - readPost の結果。ここに API の情報を書き足します
     * @returns {Promise<(object|null)[]>}
     */
    const getMedia = async (root, post) => {
        const dom = fromDom(root);

        // background が API の結果を、必要な項目（投稿者・本文・日時・メディア）だけに絞って返します。
        // SMDCore.request は、background と話せないときも例外ではなく null を返します。
        const reply = await SMDCore.request({
            type: "bskyPost", actor: dom.find(Boolean)?.did ?? post.screenName, rkey: post.postId,
        });
        const info = reply?.post;

        // 表示名・本文・投稿日時は、取れた分だけ投稿情報へ書き足します。
        if (info) {
            if (info.handle) post.screenName = info.handle;
            if (info.name) post.name = info.name;
            if (info.text) post.text = info.text;
            if (info.time) post.time = info.time;
        }

        // 返す一覧の並びは、必ず画面（DOM）に合わせます。個別ボタンは画面の並びで付いているため、
        // API の並びや件数をそのまま使うと、ずれたときに別のメディアを保存してしまいます。
        // API の情報は CID（ファイルの内容から決まる ID）で突き合わせ、正確な拡張子と解像度を借ります。
        //   - API にあって画面に無いもの … 後ろに足します（「すべて保存」で取りこぼさないように）
        //   - 画面にあって API に無いもの … この投稿のもの（引用先など）ではないとみなし、null にします
        // API が失敗したときや、メディアが取れなかったときは、画面の情報だけを使います。
        const api = info?.media ?? [];
        const did = info?.did;
        let list = dom;

        if (api.length > 0) {
            const byCid = new Map(api.map((m) => [m.cid, m]));
            const shown = new Set();
            list = dom.map((d) => {
                const m = d && byCid.get(d.cid);
                if (!m) return null;
                shown.add(m.cid);
                return { ...m, did: did || d.did }; // DID が API に無ければ画面の値で補う
            });
            if (did) for (const m of api) if (!shown.has(m.cid)) list.push({ ...m, did });
        }

        // getBlob は投稿者の PDS から生データを直接取得するエンドポイントです。
        const host = reply?.pds ?? PDS;
        return list.map((m) => m && {
            kind: m.kind,
            ext: m.ext,
            id: m.cid,
            res: m.res ?? "",
            url: `${host}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(m.did)}&cid=${encodeURIComponent(m.cid)}`,
        });
    };

    /**
     * 返信・リポスト・いいねが並ぶ操作バー（アダプタの actionBar）。
     *
     * @param {Element} root
     * @returns {Element|null}
     */
    const actionBar = (root) => {
        // 引用部分のボタンを拾わないよう、どれも own() で探します。
        // ブックマークボタンがあれば、その親が操作バーです。
        const bookmark = own('[data-testid="postBookmarkBtn"]', root)[0];
        if (bookmark?.parentElement) return bookmark.parentElement;

        // 無ければ、返信ボタンから親をたどって、いいねボタンも含む最初の要素を探します。
        const like = own('[data-testid="likeBtn"], [data-testid="unlikeBtn"]', root)[0];
        for (let n = own('[data-testid="replyBtn"]', root)[0]; like && n && n !== root; n = n.parentElement) {
            if (n.contains(like)) return n;
        }
        return null;
    };

    SMDCore.start({
        site: "bluesky",
        postRoot: POST_ROOT,
        mediaContainers: (root) => mediaElements(root).map((el) => el.parentElement ?? el), // <img> の中には置けないので親へ

        /** 投稿 ID だけを素早く読む（ボタンの描き分けのたびに呼ばれる） */
        postId: (root) => matchPost(root)?.[2] ?? null,

        readPost,
        getMedia,
        actionBar,

        /** "likeBtn" は未いいね、"unlikeBtn" はいいね済みのボタン。前者だけを見ます */
        likeButton: '[data-testid="likeBtn"]',

        /**
         * ボタンに関係する要素（メディア・投稿へのリンク・操作バーのボタン）。
         * 投稿の中でこれらが増減したときだけ、ボタンを見直します。
         */
        watch: `${MEDIA}, a[href*="/post/"], [data-testid="postBookmarkBtn"], `
            + '[data-testid="likeBtn"], [data-testid="unlikeBtn"], [data-testid="replyBtn"]',
    });
})();
