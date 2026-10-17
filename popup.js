// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * popup.js
 * ==================================================================
 * ツールバーアイコンから開く設定画面（オプションページも同じ popup.html）。
 *
 *   - 画面の文言を現在の言語へ差し替える
 *   - ファイル名テンプレートのライブプレビューと入力チェック
 *   - 変数ボタンでカーソル位置に変数を挿入
 *   - 設定の自動保存（「保存」ボタンはありません）
 *
 * popup.html で shared/template.js（SMD）を先に読み込んでいるので、
 * 既定値・ファイル名の組み立ては、保存するときのバックグラウンドと同じものを使えます。
 * プレビューに出るファイル名が、実際に保存されるファイル名と一致するのはこのためです。
 * ==================================================================
 */

(() => {
    "use strict";

    /**
     * _locales/<言語>/messages.json から翻訳済みの文字列を取り出す。
     *
     * @param {string} key - メッセージのキー
     * @param {...unknown} subs - $1, $2 ... に差し込む値
     * @returns {string} 見つからなければ key をそのまま返す
     */
    const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

    /**
     * document.getElementById の短縮版。
     *
     * @param {string} id - 要素の id
     * @returns {HTMLElement}
     */
    const $ = (id) => document.getElementById(id);

    /**
     * 何度も使う要素。入力のたびに探し直さないよう、ここで 1 度だけ取り出しておきます
     * （このスクリプトは defer 付きで読み込まれるので、この時点で要素はすべて出来上がっています）。
     */
    const fileInput = $("file");
    const preview = $("preview");
    const warning = $("warning");
    const status = $("status");
    const placeholders = $("placeholders");

    /**
     * 設定項目の id と、値を読み書きするプロパティの対応表。
     * チェックボックスだけは value ではなく checked を使います。
     * ここに 1 行足すだけで、読み込み・保存・リセットのすべてに反映されます。
     */
    const FIELDS = { file: "value", conflictAction: "value", alwaysSaveAs: "checked", likeDownload: "checked" };

    /**
     * 画面の入力内容を、保存できるオブジェクトにまとめる。
     *
     * @returns {typeof SMD.DEFAULTS}
     */
    const readForm = () => Object.fromEntries(Object.entries(FIELDS).map(([id, prop]) => [id, $(id)[prop]]));

    /**
     * 設定を画面へ反映する（readForm の逆）。反映したらプレビューも作り直します。
     *
     * @param {typeof SMD.DEFAULTS} settings
     * @returns {void}
     */
    const writeForm = (settings) => {
        for (const [id, prop] of Object.entries(FIELDS)) $(id)[prop] = settings[id];
        update();
    };

    /**
     * 「変数一覧」に並べるボタンの定義。[グループ名, [[変数, 説明], ...]] という入れ子です。
     * 日時の変数は、説明より実例のほうが分かりやすいので、例をそのまま書いています。
     */
    const TOKENS = [
        [t("grpPost"), [
            ["{site}", t("phSite")], ["{user}", t("phUser")], ["{name}", t("phName")],
            ["{id}", t("phId")], ["{text:30}", t("phText")],
        ]],
        [t("grpDate"), [
            ["{datetime}", "20260819_142530"], ["{date}", "20260819"], ["{time}", "142530"],
            ["{yyyy}", t("phYear")], ["{mm}", t("phMonth")], ["{dd}", t("phDay")],
            ["{hh}", t("phHour")], ["{mi}", t("phMin")], ["{ss}", t("phSec")],
            ["{dl_date}", t("phDlDate")], ["{dl_datetime}", t("phDlDatetime")],
        ]],
        [t("grpMedia"), [
            ["{n}", t("phN")], ["{nn}", t("phNn")], ["{n?}", t("phNq")], ["{total}", t("phTotal")],
            ["{kind}", "img / vid / gif / aud"], ["{ext}", t("phExt")],
            ["{media_id}", t("phMediaId")], ["{res}", t("phRes")],
        ]],
        [t("grpSyntax"), [
            // 記法の説明。表示用の半角スペースは挿入時に取り除きます。
            ["/", t("phSlash")], ["[ ]", t("phBracket")], ["\\[ \\]", t("phEscape")], [":20", t("phLimit")],
        ]],
    ];

    /**
     * プレビュー用のダミー URL（実在しません）。
     *
     * @param {string} cid - サンプルの CID
     * @returns {string}
     */
    const blob = (cid) => `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aexample&cid=${cid}`;

    /**
     * プレビューに出す 9 パターンのサンプル（X / Bluesky × 画像 / 動画、ポイピク・Privatter・Privatter+・Skeb・ニコニコ静画の画像）。
     * 「複数枚のとき」と「1 枚のとき」の違い（{n?} など）も確かめられるようにしてあります。
     * ポイピクは投稿日時が取れないので、日時の変数が空になる様子も確かめられます。
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
        [`${t("sitePoipiku")} · ${t("sampleImage24")}`, {
            post: { site: "poipiku", screenName: "1234567", name: t("sampleUserName"),
                postId: "12345678", text: t("sampleText"), time: null },
            item: { url: "https://cdn.poipiku.com/001234567/012345678_012345679_AbCdEfGhI.png",
                kind: "photo", ext: "png", id: "012345678_012345679_AbCdEfGhI", res: "", index: 2, total: 4 },
        }],
        [`${t("sitePrivatter")} · ${t("sampleImage11")}`, {
            post: { site: "privatter", screenName: "example_user", name: t("sampleUserName"),
                postId: "i1234567", text: t("sampleText"), time: "2026-08-19T14:25:30+09:00" },
            item: { url: "https://d2pqhom6oey9wx.cloudfront.net/img_original/12345678906abcdef012345.jpg",
                kind: "photo", ext: "jpg", id: "12345678906abcdef012345", res: "", index: 1, total: 1 },
        }],
        [`${t("sitePrivatterPlus")} · ${t("sampleImage24")}`, {
            post: { site: "privatterplus", screenName: "example_user", name: t("sampleUserName"),
                postId: "6975d5e22c2c3", text: t("sampleText"), time: "2026-08-19T14:25:30+09:00" },
            item: { url: "https://media.privatter.me/img/123456/original/12345678906abcdef01234.png",
                kind: "photo", ext: "png", id: "12345678906abcdef01234", res: "", index: 2, total: 4 },
        }],
        [`Skeb · ${t("sampleImage24")}`, {
            post: { site: "skeb", screenName: "example_user", name: t("sampleUserName"),
                postId: "12", recordId: "example_user/12", text: t("sampleText"), time: null },
            item: { url: "https://si.imgix.net/0a1b2c3d/uploads/origins/01234567-89ab-cdef-0123-456789abcdef?fm=webp&w=800",
                kind: "photo", ext: "webp", id: "01234567-89ab-cdef-0123-456789abcdef", res: "800x1000", index: 2, total: 4 },
        }],
        [`${t("siteNiconico")} · ${t("sampleImage11")}`, {
            post: { site: "niconico", screenName: "1234567", name: t("sampleUserName"),
                postId: "im12345678", text: t("sampleText"), time: "2026-08-19T14:25:30+09:00" },
            item: { url: "https://lohas.nicoseiga.jp/priv/0123456789abcdef0123456789abcdef01234567/1790000000/12345678",
                kind: "photo", ext: "jpg", id: "12345678", res: "", index: 1, total: 1 },
        }],
    ];

    /**
     * プレビューと警告を、今の入力内容で作り直す。
     *
     * @returns {void}
     */
    const update = () => {
        const settings = readForm();
        const now = new Date();

        // ユーザーの入力を含む値なので、HTML として解釈させず、textContent で入れます。
        preview.replaceChildren(...SAMPLES.map(([label, ctx]) => {
            const row = document.createElement("div");
            row.appendChild(document.createElement("b")).textContent = label;
            row.appendChild(document.createElement("code")).textContent = SMD.buildPath(settings, { ...ctx, now });
            return row;
        }));

        const warnings = [];

        // [ と ] の数が合っているか（文字として書いた \[ \] は数えない）
        const bare = SMD.dropEscaped(settings.file);
        if ((bare.match(/\[/g) ?? []).length !== (bare.match(/\]/g) ?? []).length) warnings.push(t("warnBracket"));

        // テンプレートに書かれた変数名（同じ変数を 2 回書いても 1 つに数えます）
        const tokens = new Set(SMD.tokensIn(settings.file));

        // 知らない変数が無いか
        const unknown = [...tokens].filter((n) => !SMD.VARIABLE_NAMES.includes(n));
        if (unknown.length > 0) warnings.push(t("warnUnknown", unknown.map((n) => `{${n}}`).join(" ")));

        // 拡張子が抜けていないか（{ext:4} のような文字数制限つきの書き方も、{ext} として数えます）
        if (!tokens.has("ext")) warnings.push(t("warnNoExt"));

        warning.textContent = warnings.join(" / ");
    };

    // ================================================================
    // 保存
    // ================================================================

    let saveTimer = 0;
    let statusTimer = 0;
    let retryTimer = 0;

    /**
     * 保存の結果を表示する。成功は短く出して消し、失敗は保存できるまで出したままにします。
     *
     * @param {boolean} ok
     * @returns {void}
     */
    const showStatus = (ok) => {
        status.textContent = t(ok ? "statusSaved" : "statusSaveFailed");
        status.classList.toggle("error", !ok);
        status.classList.add("show");
        clearTimeout(statusTimer);
        if (ok) statusTimer = setTimeout(() => status.classList.remove("show"), 1200);
    };

    /**
     * すぐに保存し、結果を表示する。
     *
     * storage.sync には 1 分あたり・1 時間あたりの書き込み回数の上限があり、スイッチを続けて切り替えたときなどに
     * 超えると保存に失敗します。失敗を黙って見送ると、画面と保存された設定が食い違ったままになるので、
     * 知らせたうえで、少し待ってから（その時点の画面の内容で）やり直します。
     *
     * @returns {Promise<void>}
     */
    const save = async () => {
        clearTimeout(saveTimer);
        saveTimer = 0;
        clearTimeout(retryTimer);
        retryTimer = 0;

        try {
            await chrome.storage.sync.set(readForm());
            showStatus(true);
        } catch {
            showStatus(false);
            retryTimer = setTimeout(save, 5000);
        }
    };

    /**
     * 少し待ってから保存する（ファイル名の入力用）。
     * 1 文字ごとに保存すると storage.sync の書き込み回数の上限に触れるおそれがあるためです。
     *
     * @returns {void}
     */
    const saveSoon = () => {
        update();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 400);
    };

    // ================================================================
    // 初期化（このファイルが読み込まれた直後に 1 回だけ実行）
    // ================================================================

    // <html lang="ja"> のように表示言語を設定すると、フォントや改行位置が適切になります。
    // popup.html の data-i18n="キー" の要素には、翻訳文を流し込みます。
    // バージョン表示は manifest.json の値をそのまま使うので、書き換え忘れがありません。
    document.documentElement.lang = chrome.i18n.getUILanguage();

    // このブラウザで使えない「同名ファイルがあるときの動作」は、選択肢から外します
    // （Firefox は「保存先を尋ねる」に対応していないため）。
    for (const option of [...$("conflictAction").options]) {
        if (!SMD.CONFLICT_ACTIONS.includes(option.value)) option.remove();
    }
    for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
    $("version").textContent = `v${chrome.runtime.getManifest().version}`;

    // 変数一覧のボタンを組み立てます（文言は textContent で入れるので、HTML として解釈されません）。
    for (const [group, tokens] of TOKENS) {
        const box = placeholders.appendChild(document.createElement("div"));
        box.className = "ph-group";
        box.appendChild(document.createElement("h3")).textContent = group;

        for (const [token, description] of tokens) {
            const button = box.appendChild(document.createElement("button"));
            button.type = "button";
            button.className = "token";
            button.dataset.token = token;
            button.appendChild(document.createElement("code")).textContent = token;
            button.appendChild(document.createElement("span")).textContent = description;
        }
    }

    // 変数ボタン: カーソル位置（選択範囲）に変数を挿入します。
    // ボタン 1 個ずつではなく親要素でまとめて受け取り（イベント委譲）、closest で押されたボタンを探します。
    // 表示用に "[ ]" と空けてある半角スペースは、挿入するときに取り除きます。
    placeholders.addEventListener("click", (e) => {
        const token = e.target.closest(".token")?.dataset.token;
        if (!token) return;

        fileInput.setRangeText(token.replaceAll(" ", ""), fileInput.selectionStart, fileInput.selectionEnd, "end");
        fileInput.focus();
        saveSoon();
    });

    // 「既定値に戻す」ボタン
    $("reset").addEventListener("click", () => {
        writeForm(SMD.DEFAULTS);
        save();
    });

    // ファイル名は入力が止まってから保存し、欄を離れたときはすぐ保存します。
    // スイッチと選択肢は、押した瞬間に保存します。
    fileInput.addEventListener("input", saveSoon);
    fileInput.addEventListener("change", save);
    for (const id of ["conflictAction", "alwaysSaveAs", "likeDownload"]) $(id).addEventListener("change", save);

    // ポップアップは外をクリックしただけで閉じるので、保存待ち（やり直し待ちを含む）があれば閉じる前に保存します。
    addEventListener("pagehide", () => { if (saveTimer || retryTimer) save(); });

    // 保存済みの設定を読み込んで画面に反映します（不正な値は既定値へ直したうえで）。
    SMD.loadSettings().then(writeForm);
})();
