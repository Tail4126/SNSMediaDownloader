// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * shared/core.js
 * ==================================================================
 * サイトに依存しない共通処理をまとめたモジュール（globalThis.SMDCore）。
 *
 * X 用・Bluesky 用のスクリプトは「アダプタ」と呼ばれる 6 個のキーを持つ
 * オブジェクトを 1 つ作って SMDCore.start() に渡すだけで済みます。
 * ボタンの描画、クリック処理、ファイル名の組み立て、通知の表示などは
 * すべてこのファイルが引き受けます。
 * ==================================================================
 */

globalThis.SMDCore = (() => {
    "use strict";

    const api = globalThis.browser ?? globalThis.chrome;

    /**
     * @typedef {object} PostInfo 投稿 1 件の情報
     * @property {"x"|"bluesky"} site サイト種別
     * @property {string} screenName ユーザー名 / ハンドル
     * @property {string} postId 投稿 ID
     * @property {string} name 表示名
     * @property {string} text 本文
     * @property {string|null} time 投稿日時（ISO 8601 文字列）
     */

    /**
     * @typedef {object} MediaItem メディア 1 件の情報
     * @property {"photo"|"video"|"animated_gif"} kind 種別
     * @property {string} url ダウンロード元 URL（https のみ）
     * @property {string} ext 拡張子
     * @property {string} [id] 元ファイルの ID（Bluesky の CID など）
     * @property {string} [res] 解像度（"1280x720" など）
     */

    /**
     * @typedef {object} SiteAdapter サイトごとの差分を吸収するオブジェクト
     * @property {"x"|"bluesky"} site CSS のアクセント色の切り替えに使う
     * @property {string} postRoot 投稿 1 件のコンテナを選ぶ CSS セレクタ
     * @property {(root: Element) => Element[]} mediaContainers メディアを包む要素の配列を返す
     * @property {(root: Element) => PostInfo|null} readPost 投稿情報を読み取る
     * @property {(root: Element, post: PostInfo) => Promise<MediaItem[]>} getMedia メディア一覧を返す
     * @property {(root: Element) => Element|null} actionBar メインボタンを置く要素を返す
     */

    // ボタンに表示する下向き矢印アイコン（SVG）。
    // fill="currentColor" にしておくと、CSS の color をそのまま色として使ってくれます。
    const ICON =
        '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" ' +
        'd="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 ' +
        '1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1zM5 18a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/></svg>';

    /**
     * background.js（バックグラウンドスクリプト）へメッセージを送り、返事を待つ。
     * ページ上のスクリプトは downloads API や外部 API を直接使えないため、
     * 実処理はすべて background 側にお願いする形になっています。
     *
     * @param {object} message - { type: "download" | "bskyPost", ... } 形式のメッセージ
     * @returns {Promise<unknown>} background 側の返答
     */
    const request = (message) => api.runtime.sendMessage(message);

    // 表示中のトーストを自動で閉じるためのタイマー ID を覚えておく変数。
    let toastTimer;

    /**
     * 画面の隅に短いメッセージ（トースト）を表示する。
     *
     * @param {string} message - 表示する文言
     * @param {boolean} [isError=false] - true ならエラー用の配色にする
     * @returns {void}
     */
    const toast = (message, isError = false) => {
        // すでに作ってあるトーストがあれば使い回し、無ければ新しく div を作って body に追加します。
        // appendChild は「追加した要素そのもの」を返すので、この 1 行で作成と取得が同時にできます。
        const el = document.querySelector(".smd-toast")
            ?? document.body.appendChild(document.createElement("div"));

        el.className = `smd-toast smd-toast-show${isError ? " smd-toast-error" : ""}`;
        el.textContent = message; // innerHTML ではなく textContent を使うのが安全（HTML として解釈されない）

        // 連続でトーストが出たときに、前のタイマーで早く消えてしまわないよう作り直します。
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove("smd-toast-show"), 3000);
    };

    /**
     * 実際の保存処理。ボタンが押されたときに呼ばれます。
     *
     * @param {SiteAdapter} adapter - サイトごとのアダプタ
     * @param {Element} root - 投稿 1 件のコンテナ要素
     * @param {number|null} only - null なら全件、数値ならその番号（0 始まり）だけ保存
     * @returns {Promise<void>}
     */
    const save = async (adapter, root, only) => {
        // 1. 投稿情報（ユーザー名・投稿 ID など）を読む
        const post = adapter.readPost(root);
        if (!post) return toast(SMD.t("toastNoPost"), true);

        // 2. メディア一覧を取得。通信を伴うことがあるので失敗したら空配列にします。
        const all = (await adapter.getMedia(root, post).catch(() => [])) ?? [];

        // 3. 全件保存か、指定された 1 件だけ保存かを決める。
        //    slice(only, only + 1) は「only 番目の要素だけを含む配列」を作る書き方です。
        const picked = only === null ? all : all.slice(only, only + 1);
        if (picked.length === 0) return toast(SMD.t("toastNoMedia"), true);

        // 4. 保存された設定を読む。未保存の項目は DEFAULTS で埋めます。
        const settings = { ...SMD.DEFAULTS, ...await api.storage.sync.get(SMD.DEFAULTS).catch(() => ({})) };

        // 同じ投稿内のファイルで「ダウンロード日時」がずれないよう、ここで 1 回だけ現在時刻を取ります。
        const now = new Date();

        // 5. 各メディアについて、URL と組み立て済みのファイル名のペアを作る。
        const items = picked.map((media, i) => ({
            url: media.url,
            filename: SMD.buildPath(settings, {
                post,
                // only が指定されているときは元の通し番号を、全件保存のときは i を使います。
                item: { ...media, index: (only ?? i) + 1, total: all.length },
                now,
            }),
        }));

        // 6. background へダウンロードを依頼する。
        const result = await request({
            type: "download",
            items,
            saveAs: settings.alwaysSaveAs,
            conflictAction: settings.conflictAction,
        });

        // background が落ちている場合などは null が返ります。
        if (!result) return toast(SMD.t("toastCommError"), true);

        // 7. 結果を通知。1 件でも失敗があれば「成功 n / 失敗 m」形式にします。
        const { done, failed } = result;
        toast(failed ? SMD.t("toastPartial", done, failed) : SMD.t("toastDone", done), Boolean(failed));
    };

    /**
     * ダウンロードボタンの DOM 要素を作る。
     *
     * @param {SiteAdapter} adapter - サイトごとのアダプタ
     * @param {Element} root - 投稿 1 件のコンテナ要素
     * @param {number|null} only - null ならメインボタン、数値ならサムネイル個別ボタン
     * @param {string} title - マウスを乗せたときに出るツールチップ文言
     * @param {string} [extra=""] - アイコンの後ろに足す追加 HTML（枚数バッジなど）
     * @returns {HTMLButtonElement} 完成したボタン要素
     */
    const button = (adapter, root, only, title, extra = "") => {
        const el = document.createElement("button");

        // type="button" を明示しないと、フォーム内に置かれたとき送信ボタン扱いになります。
        el.type = "button";
        el.className = only === null ? "smd-button" : "smd-item-button";
        el.title = title;
        el.innerHTML = ICON + extra; // 中身は自前の固定文字列なので innerHTML でも安全

        // --- ここからイベント関連。SNS 側の処理に邪魔されないための工夫です ---

        // 第 3 引数の true は「キャプチャフェーズ」で受け取る指定。
        // イベントは「外側 → 内側」（キャプチャ）→「内側 → 外側」（バブリング）の順に流れるので、
        // キャプチャで先回りすれば SNS 側のハンドラより先に処理を止められます。
        el.addEventListener("mousedown", (e) => e.stopPropagation(), true);

        el.addEventListener("click", (e) => {
            e.preventDefault();           // リンクのページ遷移などの既定動作を止める
            e.stopImmediatePropagation(); // 同じ要素の他のハンドラも含めて完全に止める

            el.classList.add("smd-busy"); // 処理中の見た目（CSS 側で定義）

            save(adapter, root, only)
                .catch(() => toast(SMD.t("toastCommError"), true))
                .finally(() => el.classList.remove("smd-busy")); // 成功・失敗どちらでも解除
        }, true);

        return el;
    };

    /**
     * サムネイル個別ボタンを重ねて置くのにちょうど良い要素（アンカー）を探す。
     *
     * メディア要素そのものは <img> なので子要素を持てず、ボタンを内側に置けません。
     * そこで親をたどり、「表示サイズを持っていて、かつ他のメディアを巻き込んでいない」
     * 最初の要素を探します。巻き込んでいる要素に置くと、2 枚目のボタンが
     * 1 枚目の上に重なってしまうためです。
     *
     * @param {Element} el - 対象のメディア要素
     * @param {Element} root - 投稿のコンテナ（ここまで遡ったら打ち切り）
     * @param {Element[]} all - 同じ投稿内のメディア要素すべて
     * @returns {Element|null} 見つかった要素。適切な場所が無ければ null
     */
    const anchorOf = (el, root, all) => {
        for (let node = el; node && node !== root; node = node.parentElement) {
            // 他のメディアまで含んでしまう要素に到達したら、そこから上は使えません。
            if (all.some((other) => other !== el && node.contains(other))) return null;

            // offsetWidth / offsetHeight が 0 の要素は画面上に大きさが無く、
            // ボタンを重ねても見えないのでスキップします。
            if (node.offsetWidth && node.offsetHeight) return node;
        }
        return null;
    };

    /**
     * 投稿 1 件にボタンを差し込む。すでに差し込み済みなら何もしません。
     *
     * @param {SiteAdapter} adapter - サイトごとのアダプタ
     * @param {Element} root - 投稿 1 件のコンテナ要素
     * @returns {void}
     */
    const inject = (adapter, root) => {
        const media = adapter.mediaContainers(root);
        if (media.length === 0) return; // メディアが無い投稿には何もしない

        // --- メインボタン（アクションバーに 1 個） ---
        const bar = adapter.actionBar(root);
        if (bar && !bar.querySelector(".smd-button")) { // 二重追加の防止
            // メディアが 2 件以上なら枚数バッジを添えます。
            const count = media.length > 1 ? `<span class="smd-count">${media.length}</span>` : "";
            bar.append(button(adapter, root, null, SMD.t("btnMainTitle"), count));
        }

        // --- 個別ボタン（メディアが 2 件以上のときだけ） ---
        if (media.length < 2) return;

        media.forEach((el, i) => {
            const anchor = anchorOf(el, root, media);

            // :scope は「この要素自身」を指す指定。直下に既にボタンがあればスキップします。
            if (!anchor || anchor.querySelector(":scope > .smd-item-button")) return;

            // 絶対配置でボタンを右上に置くには、親側が position: static 以外である必要があります。
            if (getComputedStyle(anchor).position === "static") anchor.style.position = "relative";

            anchor.append(button(adapter, root, i, SMD.t("btnItemTitle", i + 1)));
        });
    };

    /**
     * 拡張機能の動作を開始する。各サイトのスクリプトはこの関数を 1 回呼ぶだけです。
     *
     * @param {SiteAdapter} adapter - サイトごとのアダプタ
     * @returns {void}
     */
    const start = (adapter) => {
        // <html data-smd-site="x"> のような属性を付けると、
        // CSS 側でサイトごとのアクセント色を切り替えられます。
        document.documentElement.dataset.smdSite = adapter.site;

        /** ページ内の全投稿を走査してボタンを差し込む */
        const scan = () => {
            for (const root of document.querySelectorAll(adapter.postRoot)) inject(adapter, root);
        };

        // X も Bluesky も、スクロールすると新しい投稿が次々に DOM へ追加されます。
        // MutationObserver でその変化を監視し、変化のたびに scan を呼びます。
        let timer;
        new MutationObserver(() => {
            // ただし DOM の変化は 1 秒に何十回も起こるので、そのたびに走査すると重くなります。
            // 「最後の変化から 200ms 静かになったら 1 回だけ実行」というデバウンス処理を入れています。
            clearTimeout(timer);
            timer = setTimeout(scan, 200);
        }).observe(document.documentElement, { childList: true, subtree: true });

        scan(); // 初回（すでに表示されている投稿）の分
    };

    return { start, request };
})();
