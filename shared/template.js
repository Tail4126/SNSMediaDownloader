// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * shared/template.js
 * ==================================================================
 * 「設定」と「ファイル名テンプレート」を担当するモジュール（globalThis.SMD）。
 * バックグラウンド（background.js）と設定画面（popup.js）の両方から使われます。
 * 同じものを使うので、設定画面のプレビューに出るファイル名と、実際に保存されるファイル名が一致します。
 *
 *   SMD.loadSettings()      保存された設定を読み、不正な値を既定値へ直して返す
 *   SMD.CONFLICT_ACTIONS    このブラウザで使える「同名ファイルがあるときの動作」
 *   SMD.IS_FIREFOX          Firefox で動いているか
 *   SMD.buildPath()         "{user}-{id}.{ext}" のようなテンプレートを保存先の相対パスへ変換
 *   SMD.tokensIn() / SMD.dropEscaped()  設定画面の入力チェック用
 *
 * ページに読み込まれる content script からは使いません（ファイル名はバックグラウンドが組み立てます）。
 * ==================================================================
 */

globalThis.SMD = (() => {
    "use strict";

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

    /** Firefox か。拡張機能の URL が moz-extension: で始まるかどうかで見分けます */
    const IS_FIREFOX = chrome.runtime.getURL("").startsWith("moz-extension:");

    /**
     * このブラウザの downloads API が受け付ける conflictAction の値。
     * Firefox は "prompt"（保存先を尋ねる）を実装しておらず、指定すると保存がすべて失敗するため外します
     * （設定画面はこの一覧に無い選択肢を隠し、loadSettings は既定値へ直します）。
     */
    const CONFLICT_ACTIONS = IS_FIREFOX ? ["uniquify", "overwrite"] : ["uniquify", "overwrite", "prompt"];

    /**
     * 保存された設定を読み、型や値がおかしい項目を既定値へ直して返す。
     * conflictAction に知らない値が入っていると downloads API が例外を投げ、
     * すべての保存が失敗してしまうため、使う前に必ずここを通します。
     * 読めなかったときは既定値を使います。
     *
     * @returns {Promise<typeof DEFAULTS>}
     */
    const loadSettings = async () => {
        const s = await chrome.storage.sync.get(DEFAULTS).catch(() => DEFAULTS);

        return {
            file: typeof s.file === "string" ? s.file : DEFAULTS.file,
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
     *
     * 作るときに文字の区切り方のデータを読み込むので、少し時間がかかります。区切る必要があるのは
     * 長い名前を切り詰めるときだけなので、読み込み時には作らず、初めて使うときに作ります（graphemes() 参照）。
     * バックグラウンドが起こされるたび・設定画面を開くたびに、使わない準備をせずに済みます。
     * @type {Intl.Segmenter|undefined}
     */
    let segmenter;

    /**
     * 文字列を、見た目上の 1 文字ずつに区切る。
     * 返ってくるのは「先頭から順に 1 文字ずつ取り出せるもの」で、途中でやめれば残りは調べません。
     *
     * @param {string} text
     * @returns {Intl.Segments}
     */
    const graphemes = (text) => (segmenter ??= new Intl.Segmenter()).segment(text);

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
        for (const { segment } of graphemes(text)) {
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
        for (const { segment } of graphemes(text)) {
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

    /**
     * ファイル名に使えない文字。Chrome と Firefox のダウンロード API が、1 文字でも含むと
     * 保存そのものを拒否する（Chrome は "Invalid filename"、Firefox は "illegal characters"）文字です。
     *   - Windows の禁止文字 \ / : * ? " < > |
     *   - 制御文字（\p{Cc}。C0・DEL に加えて U+0080〜U+009F も）
     *   - 書式文字（\p{Cf}）。ゼロ幅接合子（U+200D）・ゼロ幅スペース・ソフトハイフン・左右の向きの制御・
     *     BOM・国旗などのタグ文字が当てはまります。ゼロ幅接合子は 👨‍💻 のような結合絵文字の中にあるので、
     *     取り除くと絵文字が分かれて表示されますが、残すと保存できません
     *   - 非文字（U+FFFE など）と、対になっていないサロゲート
     * 空白（改行・タブ・ノーブレークスペースなど）は、ここではなく normalize() で半角スペースにします。
     */
    const FORBIDDEN = /[\\/:*?"<>|\p{Cc}\p{Cf}\p{Cs}\p{Noncharacter_Code_Point}]/gu;

    /**
     * ファイル名にできない名前（拡張子が付いていても不可）。先頭に "_" を付けて避けます。
     * Windows の予約名（CON・NUL・COM1 など。CLOCK$ も Chrome が拒否します）と、
     * Chrome が拒否するエクスプローラーの設定ファイル名（desktop.ini・Thumbs.db）です。
     */
    const RESERVED = /^(?:(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|clock\$)(?:\.|$)|(?:desktop\.ini|thumbs\.db)$)/i;

    /**
     * ブラウザが保存を拒否する拡張子（OS のショートカットや設定として扱われるもの）。
     * Chrome は .lnk / .local / .{…}（CLSID）を、Firefox は .lnk / .local / .url / .scf / .desktop を拒否します。
     * フォルダ名でも同じなので、どの階層でも、当てはまれば末尾に "_" を足して避けます。
     */
    const SHELL_EXT = /\.(?:lnk|local|url|scf|desktop|\{[^}]*\})$/i;

    /**
     * 空白をまとめてから、使えない文字を取り除く。
     * 改行やタブも制御文字なので、先に空白へ変えておかないと前後の単語がくっついてしまいます。
     * 取り除いた跡に空白が続くこともあるので、最後にもう一度まとめます。
     *
     * @param {string} text
     * @returns {string}
     */
    const normalize = (text) => text.replace(/\s+/g, " ").replace(FORBIDDEN, "").replace(/\s+/g, " ");

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
    const KIND = { photo: "img", video: "vid", animated_gif: "gif", audio: "aud" };
    const SITE = {
        x: "x", bluesky: "bsky", poipiku: "poipiku", privatter: "privatter", privatterplus: "privatterplus", skeb: "skeb",
        niconico: "niconico",
    };

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

            site: (Object.hasOwn(SITE, post.site) ? SITE[post.site] : post.site) ?? "",
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

            kind: Object.hasOwn(KIND, item.kind) ? KIND[item.kind] : "img",
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
        const raw = normalize(String(value ?? "")).trim();
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
     * @param {{beforeExt?: boolean}} [options] - beforeExt: 拡張子の前の本体か（末尾の「~」を残す）
     * @returns {string} 空文字なら、その階層は捨てる
     */
    const cleanSegment = (name, maxBytes, { beforeExt = false } = {}) => {
        // 前後の空白とドット（Windows で不可）と「~」を除きます。
        // 「~」は途中にあれば問題ありませんが、階層の先頭か末尾にあると Chrome が保存を拒否し、
        // 先頭にあると Firefox も「絶対パス」とみなして拒否します（"~Mika~/…" や、本文が「よろしく~」で終わる
        // フォルダ名など）。拡張子の前の本体（beforeExt）の末尾は階層の末尾ではないので、「~」を残します。
        const tidy = beforeExt
            ? (s) => s.replace(/^[\s.~]+|[\s.]+$/g, "")
            : (s) => s.replace(/^[\s.~]+|[\s.~]+$/g, "");

        return tidy(clipBytes(tidy(normalize(name)), maxBytes));
    };

    /**
     * 整えた 1 階層分の名前が、ファイル名にできない名前（予約名・拒否される拡張子）なら、少しだけ変えて避ける。
     * 拡張子を付けた後の名前で確かめる必要があるので（"desktop" + ".ini" など）、cleanSegment とは分けています。
     *
     * @param {string} name - cleanSegment で整えた名前（空なら空のまま返す）
     * @returns {string}
     */
    const avoidReserved = (name) => {
        let out = name;
        if (RESERVED.test(out)) out = `_${out}`;
        if (SHELL_EXT.test(out)) out = `${out}_`;
        return out;
    };

    /**
     * 設定とコンテキストから、ダウンロード API に渡す相対パスを作る。
     * どんな値が来ても、Chrome と Firefox の両方が受け付ける、ダウンロードフォルダの中の相対パスになります
     * （「/」で始まらず、空の階層も「.」「..」の階層も無く、使えない文字・名前を含まない）。
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
        const rawExt = dot > 0 ? normalize(name.slice(dot + 1)).replace(/^[\s~]+|[\s~]+$/g, "") : "";
        const ext = rawExt && utf8Length(rawExt) <= MAX_EXT_BYTES ? `.${rawExt}` : "";
        const stem = ext ? name.slice(0, dot) : name;

        const folders = parts.map((p) => avoidReserved(cleanSegment(p, MAX_SEGMENT_BYTES))).filter(Boolean);
        const file = cleanSegment(stem, MAX_SEGMENT_BYTES - utf8Length(ext), { beforeExt: ext !== "" }) || "download";

        // Firefox は、ファイル名の最後の「.」より後ろ（拡張子とみなす部分）に空白があると、保存を拒否します
        // （"{id}.{text}" や "{id}.{ext} ({n})" のようなテンプレート）。その部分の空白は "_" にします。
        let leaf = file + ext;
        const last = leaf.lastIndexOf(".");
        if (last >= 0 && /\s/.test(leaf.slice(last + 1))) {
            leaf = `${leaf.slice(0, last + 1)}${leaf.slice(last + 1).replace(/\s/g, "_")}`;
        }

        return [...folders, avoidReserved(leaf)].join("/");
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
        IS_FIREFOX,
        VARIABLE_NAMES: Object.keys(buildVars({})),
        loadSettings, buildPath, tokensIn, dropEscaped,
    };
})();
