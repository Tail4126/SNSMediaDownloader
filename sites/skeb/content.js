// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * sites/skeb/content.js
 * ==================================================================
 * Skeb（skeb.jp）用のアダプタ。作品の詳細ページ（/@{クリエイター}/works/{作品番号}）で動きます。
 * 1 ページに作品 1 件で、左の列（.image-column）に納品されたメディアが縦に並び、
 * 右の列にクリエイター・共有ボタン・依頼文が並びます。
 *
 * Skeb はページを読み込み直さずに画面を切り替える作り（SPA）なので、このファイルは skeb.jp の
 * どのページでも読み込まれ、作品のページを表示している間だけボタンを付けます。
 * そのため「どの作品か」は、読み込んだときではなく、ボタンを描くたびに調べ直します。
 *
 * 【保存するもの】
 * ページに表示されているメディアの URL を、そのまま保存します。通信は追加しません。
 *   - 画像 … si.imgix.net の画像（/uploads/origins/{ID}?…&s={署名}）
 *   - 動画・音声 … fcdn.skeb.jp のファイル（/uploads/outputs/{ID}?…&Signature=…）
 * どちらの URL にも署名が付いていて、クエリを 1 文字でも変えると取得できなくなります。
 * そのため、画像はページに表示されている大きさ・形式（多くは幅 800px の WebP）のままで、
 * 依頼者・クリエイター以外が見ているときは「SAMPLE」の透かしが入ったままです。
 * 透かしを外したり、画面に無い大きさや原本を取りに行ったりはしません。
 * 作品の情報を返す API もありますが、ページ自身の認証情報が要るため使いません。
 * ==================================================================
 */

(() => {
    "use strict";

    /** 作品の詳細ページのパス。[1] がクリエイターのユーザー名、[2] が作品番号 */
    const WORK_PATH = /^\/@([^/]+)\/works\/(\d+)\/?$/;

    /** 作品の URL（共有ボタンのリンクに入っているもの）。[1] がユーザー名、[2] が作品番号 */
    const WORK_URL = /^https:\/\/skeb\.jp\/@([^/?#]+)\/works\/(\d+)\/?$/;

    /**
     * 作品 1 件のコンテナ。メディアの列（.image-column）と情報の列（.column.is-5）を並べる段（.columns）です。
     * ページ下の「ほかの作品」の段（.columns.has-cards）は、メディアの列を持たないので当てはまりません。
     */
    const POST_ROOT = "main .columns:has(> .column.image-column)";

    /** メディアを 1 件ずつ包む箱（画像・動画・音声の別なく、1 件につき 1 個） */
    const MEDIA_BOX = ":scope > .column.image-column > .image > .container";

    /** 右の列（クリエイター・共有ボタン・依頼文）の、いちばん上の箱 */
    const INFO_BOX = ":scope > .column.is-5 > .is-box";

    /** 画像の URL の形。[1] がファイルの ID（UUID） */
    const IMAGE_URL = /^https:\/\/si\.imgix\.net\/[0-9a-f]+\/uploads\/origins\/([\w-]+)$/;

    /** 動画・音声の URL の形。[1] がファイルの ID（UUID） */
    const FILE_URL = /^https:\/\/fcdn\.skeb\.jp\/uploads\/outputs\/([\w-]+)$/;

    /**
     * 動画・音声の MIME タイプ（<source type>）から、種類と拡張子へ。
     * ここに無いものは、<video> の中の動画なら mp4、音声用の再生欄（.video--audio）なら mp3 とします。
     */
    const FILE_TYPES = {
        "video/mp4": ["video", "mp4"], "video/webm": ["video", "webm"], "video/quicktime": ["video", "mov"],
        "audio/mp3": ["audio", "mp3"], "audio/mpeg": ["audio", "mp3"], "audio/wav": ["audio", "wav"],
        "audio/x-wav": ["audio", "wav"], "audio/ogg": ["audio", "ogg"], "audio/aac": ["audio", "aac"],
        "audio/mp4": ["audio", "m4a"], "audio/flac": ["audio", "flac"],
    };

    /** imgix の fm（出力形式）から拡張子へ。fm が無い・ここに無いときは jpg とします */
    const IMAGE_EXT = { webp: "webp", jpg: "jpg", jpeg: "jpg", pjpg: "jpg", png: "png", gif: "gif", avif: "avif" };

    /**
     * URL の一部を安全にデコードする。壊れた「%」があっても例外を投げません
     * （アドレスバーに壊れた URL を打ち込まれても、ボタンの描き分けが止まらないように）。
     */
    const { decode } = SMDCore;

    /**
     * 作品のユーザー名と作品番号を読む。作品のページでなければ null。
     *
     * 画面の切り替えの途中では、アドレスバーの URL と画面の中身が一瞬ずれることがあります。
     * そこで、画面に出ている作品の共有ボタンのリンク（?url=https://skeb.jp/@…/works/…）を優先し、
     * 見つからなければアドレスバーの URL を使います。どちらの場合も、作品のページを開いていることが前提です。
     *
     * @param {Element} root
     * @returns {{creator: string, num: string}|null}
     */
    const workOf = (root) => {
        const here = WORK_PATH.exec(location.pathname);
        if (!here) return null;

        for (const a of root.querySelectorAll(".circle-button[href]")) {
            // URL.parse は、解析できなければ例外ではなく null を返します。?. で null のときは先へ進みません。
            const shared = URL.parse(a.getAttribute("href"))?.searchParams.get("url") ?? "";
            const m = WORK_URL.exec(shared);
            if (m) return { creator: decode(m[1]), num: m[2] };
        }
        return { creator: decode(here[1]), num: here[2] };
    };

    /**
     * 保存済みの記録に使う ID（アダプタの postId）。作品番号はクリエイターごとの連番で、
     * 番号だけでは別の人の作品と重なるため、「ユーザー名/作品番号」にします。
     *
     * @param {Element} root
     * @returns {string|null}
     */
    const recordIdOf = (root) => {
        const work = workOf(root);
        return work ? `${work.creator}/${work.num}` : null;
    };

    /**
     * メディア 1 件の箱から、保存するものを読む。作品のメディアでなければ null。
     *
     * @param {Element} box - MEDIA_BOX に当てはまる要素
     * @returns {{kind: string, url: string, ext: string, id: string, res: string}|null}
     */
    const mediaOf = (box) => {
        // 画像。src の値は署名ごとそのまま使います（クエリを変えると取得できなくなるため）。
        const img = box.querySelector(":scope > img");
        if (img) {
            const parsed = URL.parse(img.getAttribute("src") ?? "", location.href);
            const m = parsed ? IMAGE_URL.exec(`${parsed.origin}${parsed.pathname}`) : null;
            if (!m) return null;

            // naturalWidth は、画像を読み込み終えるまで 0 です。そのときは解像度を空にします。
            const res = img.naturalWidth ? `${img.naturalWidth}x${img.naturalHeight}` : "";
            const fm = parsed.searchParams.get("fm")?.toLowerCase() ?? "";
            return { kind: "photo", url: parsed.href, ext: Object.hasOwn(IMAGE_EXT, fm) ? IMAGE_EXT[fm] : "jpg", id: m[1], res };
        }

        // 動画・音声。どちらも再生欄（plyr）の中の <video> に <source> で入っています。
        const video = box.querySelector("video");
        const source = video?.querySelector("source[src]");
        if (!source) return null;

        const parsed = URL.parse(source.getAttribute("src"), location.href);
        const m = parsed ? FILE_URL.exec(`${parsed.origin}${parsed.pathname}`) : null;
        if (!m) return null;

        const audio = video.classList.contains("video--audio");
        const type = source.getAttribute("type")?.toLowerCase() ?? "";
        const [kind, ext] = Object.hasOwn(FILE_TYPES, type) ? FILE_TYPES[type] : audio ? ["audio", "mp3"] : ["video", "mp4"];

        // 動画の大きさは、再生の準備ができるまで分かりません（preload="none" なので、多くは空になります）。
        const res = kind === "video" && video.videoWidth ? `${video.videoWidth}x${video.videoHeight}` : "";
        return { kind, url: parsed.href, ext, id: m[1], res };
    };

    /**
     * 作品のメディア（画面の並び順）。作品のページでなければ空。
     * 同じファイルが 2 回出ている場合は最初の 1 つだけにします。
     *
     * @param {Element} root
     * @returns {{el: Element, media: object}[]}
     */
    const items = (root) => {
        if (!WORK_PATH.test(location.pathname)) return [];

        const seen = new Set();
        const list = [];
        for (const box of root.querySelectorAll(MEDIA_BOX)) {
            const media = mediaOf(box);
            if (!media || seen.has(media.id)) continue;
            seen.add(media.id);
            list.push({ el: box, media });
        }
        return list;
    };

    /**
     * 依頼文。翻訳と原文が両方あるときは、画面で先に出ているほう（翻訳）を使います。
     * 依頼文は、強調された単語ごとに <a> と <span> に分かれていますが、textContent でまとめて取り出せます。
     *
     * @param {Element} root
     * @returns {string}
     */
    const readText = (root) => root.querySelector(`${INFO_BOX} .pre-line`)?.textContent?.trim() ?? "";

    /**
     * 作品の情報をすべて読む（アダプタの readPost）。保存するときだけ呼ばれます。
     *
     *   - ユーザー名（{user}）と表示名（{name}）は、依頼者ではなくクリエイターのものです
     *   - 投稿 ID（{id}）は作品番号です（保存済みの記録には「ユーザー名/作品番号」を使います）
     *   - 本文（{text}）は依頼文です
     *   - 納品日時はページに無いので、{date} などは空になります
     *
     * @param {Element} root
     * @returns {object|null}
     */
    const readPost = (root) => {
        const work = workOf(root);
        if (!work) return null;

        // クリエイターの名前は、右の列のいちばん上（アイコン・名前・@ユーザー名が並ぶリンク）にあります。
        const link = root.querySelector(`${INFO_BOX} a.level-left[href^="/@"]`);

        return {
            site: "skeb",
            screenName: work.creator,
            postId: work.num,
            recordId: `${work.creator}/${work.num}`,
            name: link?.querySelector(".title")?.textContent?.trim() ?? "",
            text: readText(root),
            time: null,
        };
    };

    /**
     * メディア一覧（アダプタの getMedia）。並びは mediaContainers と同じです。
     *
     * @param {Element} root
     * @returns {Promise<object[]>}
     */
    const getMedia = async (root) => items(root).map(({ media }) => media);

    SMDCore.start({
        site: "skeb",
        postRoot: POST_ROOT,
        mediaContainers: (root) => items(root).map(({ el }) => el),
        postId: recordIdOf,
        readPost,
        getMedia,

        /**
         * 右の列のいちばん上、「シェア:」の X・Misskey.io・Bluesky のボタンの右横に置きます。
         * 共有ボタンの並びが無いときは、その外側（右寄せの欄）に置きます。
         */
        actionBar: (root) => root.querySelector(`${INFO_BOX} .level-right .buttons`)
            ?? root.querySelector(`${INFO_BOX} .level-right`) ?? null,

        // likeButton は書きません。Skeb の作品のページには「いいね」にあたるボタンが無いため、
        // いいね連動保存は Skeb では働きません（設定がオンでも、ボタンからの保存だけになります）。

        /**
         * ボタンに関係する要素（画像・動画・音声と、共有ボタンの並び）。
         * 動画の再生欄は再生中に絶えず書き換わりますが、これらの要素の増減でなければ見直しません。
         */
        watch: "img, video, source, .buttons",
    });
})();
