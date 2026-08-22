// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * shared/template.js
 * ==================================================================
 * 「ファイル名テンプレート」と「多言語メッセージ」を担当するモジュール。
 *
 * このファイルは globalThis.SMD というグローバル変数に関数をまとめて公開し、
 * content script（各 SNS のページ上で動く側）と popup.js（設定画面）の
 * 両方から使われます。
 *
 * 主な役割は 3 つ:
 *   1. 翻訳文字列の取得 .......... SMD.t()
 *   2. "{user}-{id}.{ext}" のようなテンプレートを実際のファイルパスへ変換
 *                                  SMD.buildPath()
 *   3. 設定画面の入力チェック用ヘルパー
 *                                  SMD.tokensIn() / SMD.dropEscaped()
 * ==================================================================
 */

// (() => { ... })() は「即時実行関数（IIFE）」と呼ばれる書き方です。
// 定義した瞬間に実行され、中で宣言した変数は外から見えません。
// そのため他のスクリプトと変数名がぶつからず、
// 最後に return したオブジェクトだけが globalThis.SMD に入ります。
globalThis.SMD = (() => {
    "use strict"; // うっかりミスをエラーとして教えてくれる厳格モード

    // 拡張機能 API の入り口。Firefox では browser、Chrome / Edge では chrome という
    // 名前で提供されるため、?? 演算子（左が null / undefined なら右を使う）で吸収します。
    const api = globalThis.browser ?? globalThis.chrome;

    /**
     * _locales フォルダ内の messages.json から翻訳済みの文字列を取り出す。
     *
     * @param {string} key - messages.json のキー（例: "toastDone"）
     * @param {...unknown} subs - メッセージ内の $1, $2 ... に差し込む値
     * @returns {string} 翻訳された文字列。見つからなければ key をそのまま返す
     */
    const t = (key, ...subs) => api.i18n.getMessage(key, subs.map(String)) || key;

    /**
     * テンプレート内の変数（プレースホルダ）を探す正規表現。
     *   {user}    → キャプチャ1 = "user"、キャプチャ2 = undefined
     *   {n?}      → キャプチャ1 = "n?"  （? も名前の一部として扱う）
     *   {text:30} → キャプチャ1 = "text"、キャプチャ2 = "30"（文字数上限）
     * 末尾の g フラグは「1 個目で止まらず全部探す」という意味です。
     */
    const TOKEN = /\{(\w+\??)(?::(\d+))?\}/g;

    // Windows などでファイル名に使えない文字。見つけたら削除します。
    // 末尾の \u0000-\u001f\u007f は改行やタブなどの制御文字です。
    const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

    // ユーザーが「角かっこを文字としてそのまま出したい」ときに書く \[ と \] を探す正規表現。
    const ESCAPE = /\\([[\]])/g;

    // 上の \[ \] を、いったん普通は文章に出てこない特殊文字へ置き換えるための対応表。
    // こうしておけば「条件ブロック [ ... ] の処理」に巻き込まれずに済みます。
    const MARK = { "[": "\u0001", "]": "\u0002" };

    // 置き換えた特殊文字を探す正規表現と、元の文字へ戻す対応表（MARK の逆）。
    const UNMARK = /[\u0001\u0002]/g;
    const CHAR = { "\u0001": "[", "\u0002": "]" };

    // メディア種別を、ファイル名向けの短い表記へ変換する対応表。
    const KIND = { photo: "img", video: "vid", animated_gif: "gif" };

    // サイト名をファイル名向けの短い表記へ変換する対応表。
    const SITE = { x: "x", bluesky: "bsky" };

    // 投稿日時が取得できなかったときに使う「全部空文字」の日時変数一式。
    const NO_DATE = { yyyy: "", mm: "", dd: "", hh: "", mi: "", ss: "", date: "", time: "", datetime: "" };

    /**
     * 設定の初期値。popup.js の「既定値に戻す」ボタンや、
     * 保存された設定が無いときの穴埋めにも使われます。
     * @type {{ file: string, conflictAction: string, alwaysSaveAs: boolean }}
     */
    const DEFAULTS = {
        file: "{site}/{user}-{id}-{datetime}-{kind}{n}.{ext}",
        conflictAction: "uniquify", // 同名ファイルがあるときは連番を付けて保存
        alwaysSaveAs: false,        // 毎回「名前を付けて保存」ダイアログを出すか
    };

    /**
     * 日時文字列を分解して、テンプレート用の変数一式（年・月・日など）を作る。
     * 時刻はすべて閲覧している端末のローカルタイムに変換されます。
     *
     * @param {string|number|Date|null|undefined} value - ISO 8601 文字列など Date が解釈できる値
     * @returns {{yyyy:string, mm:string, dd:string, hh:string, mi:string, ss:string,
     *            date:string, time:string, datetime:string}}
     *          解析できなかった場合は NO_DATE（全部空文字）を返す
     */
    const dateVars = (value) => {
        const d = value ? new Date(value) : null;

        // new Date("でたらめな文字列") はエラーにならず「Invalid Date」になります。
        // その場合 getTime() が NaN になるので、それで判定しています。
        if (!d || Number.isNaN(d.getTime())) return NO_DATE;

        // 1 桁の数字を "01" のように 2 桁へそろえる小さなヘルパー。
        const pad = (n) => String(n).padStart(2, "0");

        // getMonth() は 0 始まり（0 = 1月）なので +1 が必要です。
        const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; // 例: "20260819"
        const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; // 例: "142530"

        // まとめて作った文字列を slice で切り分け、各変数に配ります。
        return {
            yyyy: date.slice(0, 4), mm: date.slice(4, 6), dd: date.slice(6),
            hh: time.slice(0, 2), mi: time.slice(2, 4), ss: time.slice(4),
            date, time, datetime: `${date}_${time}`,
        };
    };

    /**
     * メディア URL の形から、ファイル ID と解像度を推測する（主に X 用）。
     * API から正式な値が取れなかったときの保険として使います。
     *
     * @param {string} [url=""] - 画像 / 動画の URL
     * @returns {{ id: string, res: string }} 推測結果。分からなければ空文字
     */
    const fromUrl = (url = "") => {
        // 画像: https://pbs.twimg.com/media/XXXXXXX?format=jpg... の XXXXXXX 部分
        const photo = /\/media\/([^./?]+)/.exec(url);

        // 動画: .../vid/avc1/1280x720/YYYYYY.mp4 の「1280x720」と「YYYYYY」部分
        // (?:avc1\/)? の (?: ) は「グループにするがキャプチャはしない」書き方です。
        const video = /\/vid\/(?:avc1\/)?(\d+x\d+)\/([^./?]+)/.exec(url);

        // exec は一致しないと null を返すので、?. で安全に添字アクセスしています。
        return { id: photo?.[1] ?? video?.[2] ?? "", res: photo ? "orig" : video?.[1] ?? "" };
    };

    /**
     * 投稿情報とメディア情報から、テンプレートで使える変数の一覧表を組み立てる。
     *
     * @param {object} ctx - 変換のもとになる情報
     * @param {object} [ctx.post={}] - 投稿情報（site / screenName / postId / name / text / time）
     * @param {object} [ctx.item={}] - メディア 1 件の情報（url / kind / ext / id / res / index / total）
     * @param {Date}   [ctx.now=new Date()] - ダウンロードを実行した日時
     * @returns {Record<string, string>} 変数名 → 値 の対応表
     */
    const buildVars = ({ post = {}, item = {}, now = new Date() }) => {
        const dl = dateVars(now);          // ダウンロード日時
        const guess = fromUrl(item.url);   // URL から推測した ID / 解像度
        const index = item.index ?? 1;     // このメディアが何番目か（1 始まり）
        const total = item.total ?? 1;     // 投稿内のメディア総数

        return {
            // 先にスプレッドしておくことで、投稿日時の yyyy / mm / dd ... が展開されます。
            ...dateVars(post.time),

            site: SITE[post.site] ?? post.site ?? "",
            user: post.screenName ?? "",
            name: post.name ?? "",
            id: post.postId ?? "",

            // 本文中の URL はファイル名に入れても意味がないので取り除きます。
            text: (post.text ?? "").replace(/https?:\/\/\S+/g, ""),

            dl_date: dl.date,
            dl_datetime: dl.datetime,

            n: String(index),                          // 1, 2, 3 ...
            nn: String(index).padStart(2, "0"),        // 01, 02 ...
            "n?": total > 1 ? String(index) : "",      // 複数枚のときだけ番号を付ける
            total: String(total),

            kind: KIND[item.kind] ?? "img",
            ext: item.ext ?? "bin",
            media_id: item.id || guess.id,  // ?? ではなく || なので、空文字のときも推測値を使う
            res: item.res || guess.res,
        };
    };

    /**
     * 変数 1 個の値を取り出し、ファイル名として安全な形に整える。
     *
     * @param {Record<string, string>} vars - buildVars() が作った変数表
     * @param {string} key - 変数名（例: "user"）
     * @param {string|number} [limit] - 先頭から何文字までに切り詰めるか
     * @returns {string} 使用禁止文字を除き、空白を整理した文字列
     */
    const valueOf = (vars, key, limit) => {
        const raw = String(vars[key] ?? "")
            .replace(FORBIDDEN, "")   // ファイル名に使えない文字を削除
            .replace(/\s+/g, " ")     // 連続する空白・改行を半角スペース 1 個へ
            .trim();                  // 前後の空白を除去

        // Array.from() で分割すると絵文字などのサロゲートペアが壊れません。
        // （raw.slice(0, 20) だと絵文字が半分に切れて文字化けすることがあります）
        return limit ? Array.from(raw).slice(0, Number(limit)).join("").trim() : raw;
    };

    /**
     * テンプレート文字列を実際の文字列へ変換する（このファイルの心臓部）。
     *
     * 処理は 4 段階:
     *   1. \[ \] を一時的な特殊文字へ退避（条件ブロック判定に巻き込まれないように）
     *   2. [ ... ] の条件ブロックを評価し、中に空の変数があればブロックごと削除
     *   3. 残った {変数} を実際の値へ置き換え
     *   4. 1 で退避した特殊文字を [ ] へ戻す
     *
     * @param {string} template - "{user}-{id}[.{res}].{ext}" のようなテンプレート
     * @param {object} ctx - buildVars() に渡す情報（post / item / now）
     * @returns {string} 変換後の文字列（この時点ではまだ「/」区切りのパス候補）
     */
    const render = (template, ctx) => {
        const vars = buildVars(ctx);

        return String(template ?? "")
            // 1. ユーザーが書いた \[ \] を \u0001 \u0002 へ退避
            .replace(ESCAPE, (_, ch) => MARK[ch])

            // 2. [ ... ] の中を調べる。[^[\]]* は「[ も ] も含まない文字列」＝入れ子なしの最内ブロック。
            //    中の変数が 1 つでも空なら "" にしてブロックごと消し、そうでなければ中身だけ残します。
            .replace(/\[([^[\]]*)\]/g, (_, inner) =>
                [...inner.matchAll(TOKEN)].some(([, key, limit]) => !valueOf(vars, key, limit)) ? "" : inner
            )

            // 3. 残った {変数} を値へ置換
            .replace(TOKEN, (_, key, limit) => valueOf(vars, key, limit))

            // 4. 退避しておいた特殊文字を [ ] に戻す
            .replace(UNMARK, (ch) => CHAR[ch]);
    };

    /**
     * 設定とコンテキストから、ダウンロード API に渡す最終的な相対パスを作る。
     * 「/」がサブフォルダの区切りになります。
     *
     * @param {{ file: string }} settings - 設定オブジェクト（file がテンプレート本体）
     * @param {object} ctx - buildVars() に渡す情報（post / item / now）
     * @returns {string} 例: "x/example_user-123-20260819_142530-img1.jpg"
     */
    const buildPath = (settings, ctx) => {
        const segments = render(settings.file, ctx)
            .split("/")                                     // フォルダ階層に分解
            .map((s) => s.replace(/^[\s.]+|[\s.]+$/g, "").trim()) // 各階層の前後の空白とドットを除去
            .filter(Boolean);                               // 空になった階層は捨てる

        // すべて空になってしまった場合の保険。
        if (segments.length === 0) return "download";

        // 末尾がファイル名、残りがフォルダ名です（pop は配列から末尾を取り出す）。
        const filename = segments.pop();

        // 拡張子を分けるために最後のドット位置を探します。
        // dot > 0 としているのは ".gitignore" のような先頭ドットを拡張子扱いしないためです。
        const dot = filename.lastIndexOf(".");

        // 拡張子を除いた本体部分。長すぎるパスは OS 側で失敗するので 100 文字で打ち切ります。
        const stem = (dot > 0 ? filename.slice(0, dot) : filename).slice(0, 100).trim();

        return [...segments, stem + (dot > 0 ? filename.slice(dot) : "")].join("/");
    };

    /**
     * テンプレート内で使われている変数名を、書かれた順にすべて拾い出す。
     * 設定画面で「知らない変数が書かれていないか」を調べるのに使います。
     *
     * @param {string} text - テンプレート文字列
     * @returns {string[]} 変数名の配列（例: ["user", "id", "ext"]）
     */
    const tokensIn = (text) => [...String(text).matchAll(TOKEN)].map(([, key]) => key);

    /**
     * エスケープされた \[ \] を取り除く。
     * 設定画面で「[ ] の数が揃っているか」を数えるとき、
     * 文字として書かれた角かっこを数えないようにするための下準備です。
     *
     * @param {string} text - テンプレート文字列
     * @returns {string} \[ と \] を取り除いた文字列
     */
    const dropEscaped = (text) => String(text).replace(ESCAPE, "");

    // ここで return したものが globalThis.SMD になります。
    // VARIABLE_NAMES は「空のコンテキストで変数表を作り、そのキー一覧を取る」という小技で、
    // 変数を追加したときに一覧を書き直す手間がなくなります。
    return { DEFAULTS, VARIABLE_NAMES: Object.keys(buildVars({})), buildPath, tokensIn, dropEscaped, t };
})();
