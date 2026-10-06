// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * shared/template.js
 * ==================================================================
 * 「設定」「ファイル名テンプレート」「多言語メッセージ」を担当するモジュール（globalThis.SMD）。
 * content script と設定画面（popup.js）の両方から使われます。
 *
 *   SMD.t()             翻訳文字列の取得
 *   SMD.loadSettings()  保存された設定を読み、不正な値を既定値へ直して返す
 *   SMD.CONFLICT_ACTIONS  このブラウザで使える「同名ファイルがあるときの動作」
 *   SMD.buildPath()     "{user}-{id}.{ext}" のようなテンプレートを保存先の相対パスへ変換
 *   SMD.tokensIn() / SMD.dropEscaped()  設定画面の入力チェック用
 * ==================================================================
 */

globalThis.SMD = (() => {
    "use strict";

    /**
     * _locales/<言語>/messages.json から翻訳済みの文字列を取り出す。
     *
     * @param {string} key - メッセージのキー
     * @param {...unknown} subs - $1, $2 ... に差し込む値
     * @returns {string} 見つからなければ key をそのまま返す
     */
    const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

    // ================================================================
    // 設定
    // ================================================================

    /** 設定の既定値。設定画面の「既定値に戻す」でも使います */
    const DEFAULTS = {
        file: "{site}/{user}-{id}[-{datetime}]-{kind}{n}.{ext}",
        conflictAction: "uniquify", // 同名ファイルがあるときは連番を付けて保存
        alwaysSaveAs: false,        // 毎回「名前を付けて保存」ダイアログを出すか
        likeDownload: false,        // 「いいね」と同時に保存するか（押した覚えのない保存は驚きが大きいので既定はオフ）
    };

    /** 1.3.0 までの既定のファイル名。保存されていれば、今の既定値に読み替えます */
    const LEGACY_DEFAULT_FILE = "{site}/{user}-{id}-{datetime}-{kind}{n}.{ext}";

    /**
     * このブラウザの downloads API が受け付ける conflictAction の値。
     * Firefox は "prompt"（保存先を尋ねる）を実装しておらず、指定すると保存がすべて失敗するため外します。
     * 拡張機能の URL が moz-extension: で始まるかどうかで Firefox を見分けます
     * （設定画面はこの一覧に無い選択肢を隠し、loadSettings は既定値へ直します）。
     */
    const CONFLICT_ACTIONS = chrome.runtime.getURL("").startsWith("moz-extension:")
        ? ["uniquify", "overwrite"]
        : ["uniquify", "overwrite", "prompt"];

    /**
     * 保存された設定を読み、型や値がおかしい項目を既定値へ直して返す。
     * conflictAction に知らない値が入っていると downloads API が例外を投げ、
     * すべての保存が失敗してしまうため、使う前に必ずここを通します。
     *
     * @returns {Promise<typeof DEFAULTS>}
     */
    const loadSettings = async () => {
        const s = await chrome.storage.sync.get(DEFAULTS).catch(() => DEFAULTS);

        // 以前の既定値がそのまま保存されている場合は、今の既定値に読み替えます
        // （投稿日時の無いポイピクで「--」が残らないよう、{datetime} を条件ブロックで囲んだもの）。
        const file = s.file === LEGACY_DEFAULT_FILE ? DEFAULTS.file : s.file;

        return {
            file: typeof file === "string" ? file : DEFAULTS.file,
            conflictAction: CONFLICT_ACTIONS.includes(s.conflictAction) ? s.conflictAction : DEFAULTS.conflictAction,
            alwaysSaveAs: s.alwaysSaveAs === true,
            likeDownload: s.likeDownload === true,
        };
    };

    // ================================================================
    // 文字列の下ごしらえ
    // ================================================================

    /**
     * 見た目上の 1 文字（絵文字の結合も含む）単位で文字列を区切るための道具。
     * 絵文字や「👨‍👩‍👧」のような結合文字を途中で切らないために使います。
     */
    const segmenter = new Intl.Segmenter();

    /**
     * UTF-8 にしたときのバイト数を数える。
     * TextEncoder でバイト列を作ると、そのたびにメモリを確保するので、文字コードから直接数えます。
     *   U+0000〜U+007F → 1 バイト、U+0080〜U+07FF → 2 バイト、
     *   サロゲートペア（絵文字など）→ 4 バイト、それ以外 → 3 バイト
     *
     * @param {string} text
     * @returns {number}
     */
    const utf8Length = (text) => {
        let size = 0;

        for (let i = 0; i < text.length; i += 1) {
            const code = text.charCodeAt(i);

            if (code < 0x80) size += 1;
            else if (code < 0x800) size += 2;
            else if (code >= 0xd800 && code < 0xdc00 && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
                size += 4; // 上位と下位のサロゲートで 1 文字
                i += 1;
            } else size += 3;
        }
        return size;
    };

    /**
     * 先頭から見た目上 n 文字だけを取り出す。
     * 文字列全体を区切ってから切り出すのではなく、n 文字に達した時点で止めます。
     *
     * @param {string} text
     * @param {number} n
     * @returns {string}
     */
    const firstGraphemes = (text, n) => {
        // 1 文字は必ず 1 単位（UTF-16）以上なので、長さが n 以下なら区切るまでもありません。
        if (text.length <= n) return text;

        let out = "";
        let count = 0;
        for (const { segment } of segmenter.segment(text)) {
            if (count === n) break;
            out += segment;
            count += 1;
        }
        return out;
    };

    /**
     * UTF-8 で maxBytes バイトに収まるよう、1 文字単位で後ろを切り捨てる。
     *
     * @param {string} text
     * @param {number} maxBytes
     * @returns {string}
     */
    const clipBytes = (text, maxBytes) => {
        // ほとんどの名前は上限に収まるので、そのときは区切る処理ごと飛ばします。
        if (utf8Length(text) <= maxBytes) return text;

        let out = "";
        let size = 0;
        for (const { segment } of segmenter.segment(text)) {
            size += utf8Length(segment);
            if (size > maxBytes) break;
            out += segment;
        }
        return out;
    };

    // ================================================================
    // ファイル名テンプレート
    // ================================================================

    /**
     * テンプレート内の変数を探す正規表現。
     *   {user} → "user" / {n?} → "n?" / {text:30} → "text" と "30"（文字数上限）
     */
    const TOKEN = /\{(\w+\??)(?::(\d+))?\}/g;

    /** ファイル名に使えない文字（Windows の禁止文字と制御文字） */
    const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

    /** Windows で予約されていてファイル名にできない名前（拡張子が付いていても不可） */
    const RESERVED = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i;

    /**
     * 1 階層（フォルダ名またはファイル名）の上限バイト数（UTF-8）。
     * 多くのファイルシステムの上限は 255 バイトですが、ブラウザが保存中に付ける
     * ".crdownload" などの一時的な接尾辞や、連番の " (1)" の分を残しておきます。
     */
    const MAX_SEGMENT_BYTES = 150;

    /** 拡張子として扱う最大バイト数。これより長い「.」以降は拡張子とみなしません */
    const MAX_EXT_BYTES = 16;

    // ユーザーが「角かっこを文字として出したい」ときに書く \[ \] を、
    // 条件ブロックの処理に巻き込まれないよう一時的な特殊文字へ退避します。
    const ESCAPE = /\\([[\]])/g;
    const MARK = { "[": "\u0001", "]": "\u0002" };
    const UNMARK = /[\u0001\u0002]/g;
    const CHAR = { "\u0001": "[", "\u0002": "]" };

    /** メディア種別・サイト名をファイル名向けの短い表記へ */
    const KIND = { photo: "img", video: "vid", animated_gif: "gif" };
    const SITE = { x: "x", bluesky: "bsky", poipiku: "poipiku" };

    /** 日時が取れなかったときの「全部空文字」の日時変数 */
    const NO_DATE = { yyyy: "", mm: "", dd: "", hh: "", mi: "", ss: "", date: "", time: "", datetime: "" };

    /**
     * 日時を分解してテンプレート用の変数一式を作る（端末のローカルタイム）。
     *
     * @param {string|number|Date|null|undefined} value
     * @returns {Record<string, string>} 解析できなければ NO_DATE
     */
    const dateVars = (value) => {
        const d = value ? new Date(value) : null;
        if (!d || Number.isNaN(d.getTime())) return NO_DATE;

        const pad = (n) => String(n).padStart(2, "0");
        const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
        const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

        return {
            yyyy: date.slice(0, 4), mm: date.slice(4, 6), dd: date.slice(6),
            hh: time.slice(0, 2), mi: time.slice(2, 4), ss: time.slice(4),
            date, time, datetime: `${date}_${time}`,
        };
    };

    /**
     * メディア URL の形からファイル ID と解像度を推測する（主に X 用）。
     *
     * @param {string} [url=""]
     * @returns {{ id: string, res: string }}
     */
    const fromUrl = (url = "") => {
        const photo = /\/media\/([^./?]+)/.exec(url);                       // pbs.twimg.com/media/XXXX
        const video = /\/vid\/(?:avc1\/)?(\d+x\d+)\/([^./?]+)/.exec(url);   // .../vid/avc1/1280x720/YYYY.mp4
        return { id: photo?.[1] ?? video?.[2] ?? "", res: photo ? "orig" : video?.[1] ?? "" };
    };

    /**
     * 投稿情報とメディア情報から、テンプレートで使える変数の一覧を作る。
     *
     * @param {{post?: object, item?: object, now?: Date}} ctx
     * @returns {Record<string, string>}
     */
    const buildVars = ({ post = {}, item = {}, now = new Date() }) => {
        const dl = dateVars(now);
        const guess = fromUrl(item.url);
        const index = item.index ?? 1;
        const total = item.total ?? 1;

        return {
            ...dateVars(post.time),

            site: SITE[post.site] ?? post.site ?? "",
            user: post.screenName ?? "",
            name: post.name ?? "",
            id: post.postId ?? "",
            text: (post.text ?? "").replace(/https?:\/\/\S+/g, ""), // 本文中の URL はファイル名に不要

            dl_date: dl.date,
            dl_datetime: dl.datetime,

            n: String(index),
            nn: String(index).padStart(2, "0"),
            "n?": total > 1 ? String(index) : "", // 複数枚のときだけ番号を付ける
            total: String(total),

            kind: KIND[item.kind] ?? "img",
            ext: item.ext ?? "bin",
            media_id: item.id || guess.id,
            res: item.res || guess.res,
        };
    };

    /**
     * 変数 1 個の値を取り出し、ファイル名に使える形へ整える。
     * 値の中の「/」も消すため、表示名にスラッシュがあっても勝手にフォルダは作られません。
     *
     * @param {Record<string, string>} vars
     * @param {string} key - 変数名
     * @param {string} [limit] - 先頭から何文字までにするか
     * @returns {string}
     */
    const valueOf = (vars, key, limit) => {
        // Object.hasOwn で確かめるのは、{toString} や {constructor} のような名前で
        // Object が元から持っている関数を拾い、その中身がファイル名に入ってしまうのを防ぐためです。
        const value = Object.hasOwn(vars, key) ? vars[key] : "";
        const raw = String(value ?? "").replace(FORBIDDEN, "").replace(/\s+/g, " ").trim();
        return limit ? firstGraphemes(raw, Number(limit)).trim() : raw;
    };

    /**
     * テンプレートを文字列へ展開する。
     *   1. \[ \] を特殊文字へ退避
     *   2. [ ... ] の条件ブロック: 中の変数が 1 つでも空ならブロックごと削除
     *   3. 残った {変数} を値へ置換
     *   4. 退避した特殊文字を [ ] へ戻す
     *
     * @param {string} template
     * @param {object} ctx - buildVars() に渡す情報
     * @returns {string} 「/」区切りのパス候補（まだ整形前）
     */
    const render = (template, ctx) => {
        const vars = buildVars(ctx);

        return String(template ?? "")
            .replace(ESCAPE, (_, ch) => MARK[ch])
            .replace(/\[([^[\]]*)\]/g, (_, inner) =>
                [...inner.matchAll(TOKEN)].some(([, key, limit]) => !valueOf(vars, key, limit)) ? "" : inner)
            .replace(TOKEN, (_, key, limit) => valueOf(vars, key, limit))
            .replace(UNMARK, (ch) => CHAR[ch]);
    };

    /**
     * 1 階層分の名前を、どの OS でも保存できる形へ整える。
     * テンプレートに直接書かれた「:」「?」などの禁止文字もここで取り除きます。
     *
     * @param {string} name
     * @param {number} maxBytes - この階層に使える最大バイト数
     * @returns {string} 空文字なら、その階層は捨てる
     */
    const cleanSegment = (name, maxBytes) => {
        const tidy = (s) => s.replace(/^[\s.]+|[\s.]+$/g, ""); // 前後の空白とドット（Windows で不可）を除く

        let out = tidy(clipBytes(tidy(name.replace(FORBIDDEN, "").replace(/\s+/g, " ")), maxBytes));
        if (RESERVED.test(out)) out = `_${out}`;
        return out;
    };

    /**
     * 設定とコンテキストから、ダウンロード API に渡す相対パスを作る。
     *
     * @param {{ file: string }} settings
     * @param {object} ctx - buildVars() に渡す情報（post / item / now）
     * @returns {string} 例: "x/example_user-123-20260819_142530-img1.jpg"
     */
    const buildPath = (settings, ctx) => {
        // テンプレートが空欄（空白だけ）だと、すべてのファイルが拡張子の無い「download」に
        // なってしまうので、既定のテンプレートを使います。
        const template = String(settings.file ?? "").trim() ? settings.file : DEFAULTS.file;
        const parts = render(template, ctx).split("/");
        const name = parts.pop();

        // 拡張子は別扱いにして、本体を切り詰めても拡張子が消えないようにします。
        // dot > 0 なので ".gitignore" のような先頭ドットは拡張子とみなしません。
        const dot = name.lastIndexOf(".");
        const rawExt = dot > 0 ? name.slice(dot + 1).replace(FORBIDDEN, "").trim() : "";
        const ext = rawExt && utf8Length(rawExt) <= MAX_EXT_BYTES ? `.${rawExt}` : "";
        const stem = ext ? name.slice(0, dot) : name;

        const folders = parts.map((p) => cleanSegment(p, MAX_SEGMENT_BYTES)).filter(Boolean);
        const file = cleanSegment(stem, MAX_SEGMENT_BYTES - utf8Length(ext)) || "download";

        return [...folders, file + ext].join("/");
    };

    /**
     * テンプレート内の変数名を順にすべて拾う（設定画面の「不明な変数」の警告用）。
     *
     * @param {string} text
     * @returns {string[]}
     */
    const tokensIn = (text) => [...String(text).matchAll(TOKEN)].map(([, key]) => key);

    /**
     * エスケープされた \[ \] を取り除く（設定画面で [ ] の数を数える前の下準備）。
     *
     * @param {string} text
     * @returns {string}
     */
    const dropEscaped = (text) => String(text).replace(ESCAPE, "");

    return {
        DEFAULTS,
        CONFLICT_ACTIONS,
        VARIABLE_NAMES: Object.keys(buildVars({})),
        loadSettings, buildPath, tokensIn, dropEscaped, t,
    };
})();
