// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * popup.js
 * ==================================================================
 * ツールバーアイコンをクリックしたときに開く設定画面のスクリプト。
 * （manifest.json の options_ui でも同じ popup.html を使っています）
 *
 * やっていること:
 *   - 画面の文言を現在の言語へ差し替える
 *   - ファイル名テンプレートの入力と、その結果のライブプレビュー
 *   - 変数ボタンのクリックでカーソル位置に変数を挿入
 *   - 入力を少し待ってから chrome.storage.sync へ自動保存
 * ==================================================================
 */

(() => {
    "use strict";

    const api = globalThis.browser ?? globalThis.chrome;

    // shared/template.js（SMD）は popup.html で先に読み込まれているので、そのまま使えます。
    const t = SMD.t;

    /**
     * document.getElementById の短縮版。
     *
     * @param {string} id - 要素の id
     * @returns {HTMLElement} 見つかった要素
     */
    const $ = (id) => document.getElementById(id);

    /**
     * 文字列を HTML に埋め込んでも安全な形へ変換する（XSS 対策）。
     * < > & " を数値文字参照（&#60; など）へ置き換えます。
     *
     * @param {unknown} s - 変換したい値
     * @returns {string} エスケープ済みの文字列
     */
    const esc = (s) => String(s).replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

    /**
     * 設定項目の id と、その値を読み書きするプロパティ名の対応表。
     * チェックボックスだけは value ではなく checked を使う点に注意。
     */
    const FIELDS = { file: "value", conflictAction: "value", alwaysSaveAs: "checked" };

    /**
     * 画面上の入力内容を、保存できるオブジェクトの形にまとめる。
     *
     * @returns {{file: string, conflictAction: string, alwaysSaveAs: boolean}}
     */
    const readForm = () => Object.fromEntries(Object.entries(FIELDS).map(([id, prop]) => [id, $(id)[prop]]));

    /**
     * 設定オブジェクトの内容を画面へ反映する（readForm の逆）。
     *
     * @param {object} settings - 反映したい設定
     * @returns {void}
     */
    const writeForm = (settings) => {
        for (const [id, prop] of Object.entries(FIELDS)) $(id)[prop] = settings[id];
        update(); // 表示を作り直す
    };

    /**
     * 「変数一覧」に並べるボタンの定義。
     * [グループ名, [[変数, 説明], ...]] という入れ子構造になっています。
     */
    const TOKENS = [
        [t("grpPost"), [
            ["{site}", t("phSite")], ["{user}", t("phUser")], ["{name}", t("phName")],
            ["{id}", t("phId")], ["{text:30}", t("phText")],
        ]],
        [t("grpDate"), [
            // 日時系は説明よりも実例のほうが分かりやすいので、そのまま例を書いています。
            ["{datetime}", "20260819_142530"], ["{date}", "20260819"], ["{time}", "142530"],
            ["{yyyy}", t("phYear")], ["{mm}", t("phMonth")], ["{dd}", t("phDay")],
            ["{hh}", t("phHour")], ["{mi}", t("phMin")], ["{ss}", t("phSec")],
            ["{dl_date}", t("phDlDate")], ["{dl_datetime}", t("phDlDatetime")],
        ]],
        [t("grpMedia"), [
            ["{n}", t("phN")], ["{nn}", t("phNn")], ["{n?}", t("phNq")], ["{total}", t("phTotal")],
            ["{kind}", "img / vid / gif"], ["{ext}", t("phExt")],
            ["{media_id}", t("phMediaId")], ["{res}", t("phRes")],
        ]],
        [t("grpSyntax"), [
            // 変数ではなく記法の説明。半角スペースは挿入時に取り除かれます（後述）。
            ["/", t("phSlash")], ["[ ]", t("phBracket")], ["\\[ \\]", t("phEscape")], [":20", t("phLimit")],
        ]],
    ];

    /**
     * プレビュー用のダミー URL を作る（実在しないサンプルです）。
     *
     * @param {string} cid - サンプルの CID
     * @returns {string} getBlob 形式の URL
     */
    const blob = (cid) => `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aexample&cid=${cid}`;

    /**
     * プレビューに表示する 4 パターンのサンプルデータ。
     * X / Bluesky × 画像 / 動画 の組み合わせで、
     * 「複数枚のとき」「1 枚のとき」の違いも確認できるようにしてあります。
     */
    const SAMPLES = [
        [`X · ${t("sampleImage24")}`, {
            post: { site: "x", screenName: "example_user", name: t("sampleUserName"),
                postId: "1234567890123456789", text: `${t("sampleText")} https://example.com`,
                time: "2026-08-19T14:25:30+09:00" },
            item: { url: "https://pbs.twimg.com/media/GxAbCdEfGhIjKlM?format=jpg&name=orig",
                kind: "photo", ext: "jpg", index: 2, total: 4 },
        }],
        [`X · ${t("sampleVideo")}`, {
            post: { site: "x", screenName: "video_poster", name: t("sampleVideoName"),
                postId: "1122334455667788990", text: t("sampleVideoText"),
                time: "2026-08-18T22:40:10+09:00" },
            item: { url: "https://video.twimg.com/ext_tw_video/1122334455/pu/vid/avc1/1280x720/abcdEFGH.mp4",
                kind: "video", ext: "mp4", index: 1, total: 1 },
        }],
        [`Bluesky · ${t("sampleImage11")}`, {
            post: { site: "bluesky", screenName: "example.bsky.social", name: t("sampleUserName"),
                postId: "3lbxk2yqf7c2s", text: t("sampleText"), time: "2026-08-19T09:05:00+09:00" },
            item: { url: blob("bafkreiabcdefghijklmn"), kind: "photo", ext: "png",
                id: "bafkreiabcdefghijklmn", res: "1600x1200", index: 1, total: 1 },
        }],
        [`Bluesky · ${t("sampleVideo")}`, {
            post: { site: "bluesky", screenName: "video.bsky.social", name: t("sampleVideoName"),
                postId: "3lbz9m4tq2k2h", text: t("sampleVideoText"), time: "2026-08-18T22:40:10+09:00" },
            item: { url: blob("bafkreixyz0123456789"), kind: "video", ext: "mp4",
                id: "bafkreixyz0123456789", res: "1920x1080", index: 1, total: 1 },
        }],
    ];

    /**
     * プレビューと警告メッセージを最新の入力内容で作り直す。
     *
     * @returns {void}
     */
    const update = () => {
        const settings = readForm();
        const now = new Date();

        // --- プレビュー ---
        // ユーザー入力を含む値は必ず esc() を通してから innerHTML に渡します。
        $("preview").innerHTML = SAMPLES.map(([label, ctx]) =>
            `<div><b>${esc(label)}</b><code>${esc(SMD.buildPath(settings, { ...ctx, now }))}</code></div>`
        ).join("");

        // --- 警告 1: 存在しない変数が書かれていないか ---
        // new Set(...) で重複を取り除いてから、既知の変数名リストと突き合わせます。
        const unknown = [...new Set(SMD.tokensIn(settings.file))]
            .filter((name) => !SMD.VARIABLE_NAMES.includes(name));

        const warnings = [];

        // --- 警告 2: [ と ] の数が揃っているか ---
        // 文字として書かれた \[ \] は数えたくないので、先に取り除いておきます。
        const bare = SMD.dropEscaped(settings.file);

        // match は見つからないと null を返すので、?? [] で空配列にしてから length を数えます。
        if ((bare.match(/\[/g) ?? []).length !== (bare.match(/\]/g) ?? []).length) {
            warnings.push(t("warnBracket"));
        }

        if (unknown.length > 0) warnings.push(t("warnUnknown", unknown.map((n) => `{${n}}`).join(" ")));

        // --- 警告 3: 拡張子が抜けていないか ---
        if (!settings.file.includes("{ext}")) warnings.push(t("warnNoExt"));

        $("warning").textContent = warnings.join(" / ");
    };

    /** 自動保存を遅らせるためのタイマー ID */
    let saveTimer;

    /**
     * 表示を更新し、少し間を置いてから設定を保存する。
     *
     * 1 文字打つたびに保存すると storage.sync の書き込み回数制限に
     * 引っかかるおそれがあるため、デバウンス（一定時間まとめる）しています。
     *
     * @returns {void}
     */
    const persist = () => {
        update();

        // 入力が続いている間はタイマーが作り直され、実際の保存は行われません。
        clearTimeout(saveTimer);

        saveTimer = setTimeout(async () => {
            await api.storage.sync.set(readForm());

            // 「保存しました」の表示を 1.2 秒だけ出します。
            $("status").classList.add("show");
            setTimeout(() => $("status").classList.remove("show"), 1200);
        }, 400);
    };

    // ================================================================
    // ここから初期化処理（このファイルが読み込まれた直後に 1 回だけ実行）
    // ================================================================

    // <html lang="ja"> のように設定すると、フォントや折り返しの扱いが適切になります。
    document.documentElement.lang = api.i18n.getUILanguage();

    // popup.html 側に data-i18n="キー名" と書いておいた要素へ、翻訳文を流し込みます。
    for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);

    // manifest.json の version をそのまま表示します（更新時に書き換える手間が省けます）。
    $("version").textContent = `v${api.runtime.getManifest().version}`;

    // 変数一覧のボタンを組み立てます。
    $("placeholders").innerHTML = TOKENS.map(([group, tokens]) =>
        `<div class="ph-group"><h3>${esc(group)}</h3>` + tokens.map(([token, description]) =>
            `<button type="button" class="token" data-token="${esc(token)}">` +
            `<code>${esc(token)}</code><span>${esc(description)}</span></button>`
        ).join("") + "</div>"
    ).join("");

    // ボタン 1 個ずつにイベントを付けるのではなく、親要素で一括して受け取ります
    // （イベント委譲と呼ばれる手法。要素が多いときに効率的です）。
    $("placeholders").addEventListener("click", (e) => {
        // closest でクリックされた場所から一番近い .token を探します。
        // <code> や <span> をクリックしても正しくボタンを特定できます。
        const token = e.target.closest(".token")?.dataset.token;
        if (!token) return;

        const input = $("file");

        // 表示用に "[ ]" と空けてある半角スペースは、挿入時には不要なので削除します。
        // setRangeText は選択範囲を置き換えるメソッドで、
        // 第 4 引数の "end" は「挿入した文字の直後へカーソルを移動」の意味です。
        input.setRangeText(token.replace(/ /g, ""), input.selectionStart, input.selectionEnd, "end");

        input.focus(); // 続けて入力できるよう、フォーカスを入力欄へ戻します
        persist();
    });

    // 「既定値に戻す」ボタン。
    $("reset").addEventListener("click", () => {
        writeForm(SMD.DEFAULTS);
        persist();
    });

    // すべての設定項目の変更を監視します。
    // input イベントは change と違い、1 文字入力するたびに発生します。
    for (const id of Object.keys(FIELDS)) $(id).addEventListener("input", persist);

    // 保存済みの設定を読み込んで画面に反映します。
    // get に DEFAULTS を渡すと、未保存の項目は自動的に既定値で埋まります。
    // さらにスプレッドでも重ねているのは、項目が増えたときの取りこぼし防止です。
    api.storage.sync.get(SMD.DEFAULTS).then((stored) => writeForm({ ...SMD.DEFAULTS, ...stored }));
})();
