// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * shared/core.js
 * ==================================================================
 * サイトに依存しない共通処理（globalThis.SMDCore）。
 *
 * 各サイト用のスクリプトは「アダプタ」を 1 つ作って SMDCore.start() に渡すだけです。
 * ボタンの描画、保存の依頼、エラー通知（トースト）、いいね連動保存、
 * ダウンロード数カウンター、保存済みボタンの表示は、すべてこのファイルが引き受けます。
 * どのアダプタでも同じになる小さな処理（URL の一部のデコード、<br> を改行に戻して文字を読む、
 * 日本時間の日時の変換、画像のファイル名からメディアの情報を作る）も、ここに置いて共有します。
 *
 * 【保存の流れ】
 *   1. ボタン（またはいいね）が押される
 *   2. アダプタから投稿情報とメディア一覧をもらう
 *   3. background.js へ「この投稿の、このメディアを保存して」と頼む。保存先のファイル名は、
 *      background が設定のテンプレートから組み立てる。background はすぐに受け付けだけ返す
 *   4. 進み具合は smdUpdate（カウンターと、保存できた 1 件）で全タブへ届く
 *   5. 頼んだ分がすべて終わると smdBatch が届き、ボタンの「保存中」を解いて、失敗があれば知らせる
 *
 * ファイル名を組み立てる shared/template.js は、このファイルからは使いません。ページを開くたびに
 * 読み込むスクリプトを減らすためと、保存先を決める処理をすべて background の 1 か所にまとめるためです。
 *
 * 【速さのための工夫】
 * X も Bluesky も DOM が絶えず変わるので、ボタンの差し込みは次のようにして軽くしています。
 *   - 変化があった投稿だけを、次の描画フレームでまとめて見直す（画面全体は走査しない）
 *   - 見直しは「読む段階」と「書く段階」に分ける。要素の大きさを読むとブラウザは
 *     レイアウトを計算し直すため、読みと書きを交互にすると投稿の数だけ計算が走ってしまう
 *   - 付けたボタンと、その番号・見た目は WeakMap で覚えておき、DOM を探し直さず、属性にも書かない
 *     （WeakMap は要素が消えれば一緒に消えるので、メモリも溜まらない）
 *   - ボタンに関係しない変化（動画の再生時間の表示など）は、見直しの対象にしない
 *   - DOM の変化を受け取る処理は、ページのあらゆる変化で呼ばれるので、できるだけ少ない手数で見送る
 *   - クリックの受け取りは document の 1 か所にまとめ、ボタンごとにリスナーを付けない
 *   - アイコンは content.css が描く（ボタンの中に SVG などの要素を作らないので、ボタン 1 個が要素 1 個で済む）
 * ==================================================================
 */

globalThis.SMDCore = (() => {
    "use strict";

    /**
     * @typedef {object} PostInfo 投稿 1 件の情報
     * @property {"x"|"bluesky"|"poipiku"|"privatter"|"privatterplus"|"skeb"|"niconico"} site - サイト
     * @property {string} screenName - ユーザー名 / ハンドル
     * @property {string} postId - 投稿 ID（ファイル名の {id} に使う）
     * @property {string} [recordId] - 保存済みの記録に使う ID。省略すると postId を使う。
     *   投稿 ID がサイト全体では重ならないとは限らないとき（Skeb の作品番号はクリエイターごとの連番）に、
     *   重ならない ID を別に渡すためのものです。アダプタの postId() が返す値と同じにすること
     * @property {string} name - 表示名
     * @property {string} text - 本文
     * @property {string|null} time - 投稿日時（ISO 8601）
     */

    /**
     * @typedef {object} MediaItem メディア 1 件の情報
     * @property {"photo"|"video"|"animated_gif"|"audio"} kind - 種類
     * @property {string} url - ダウンロード元（https のみ）
     * @property {string} ext - 拡張子
     * @property {string} [id] - 元ファイルの ID（Bluesky の CID など）
     * @property {string} [res] - 解像度
     */

    /**
     * @typedef {object} SiteAdapter サイトごとの差分を吸収するオブジェクト
     * @property {"x"|"bluesky"|"poipiku"|"privatter"|"privatterplus"|"skeb"|"niconico"} site - サイト。保存済みの記録のキーと、CSS のアクセント色の切り替えに使う
     * @property {string} postRoot - 投稿 1 件のコンテナを選ぶ CSS セレクタ
     * @property {(root: Element) => Element[]} mediaContainers - メディアを包む要素（画面の並び順）
     * @property {(root: Element) => string|null} postId
     *   投稿 ID（readPost が recordId を返すなら、その値）だけを素早く読む。ボタンの描き分けのたびに呼ぶので、軽く作ること
     * @property {(root: Element) => PostInfo|null} readPost
     *   投稿情報をすべて読む（本文など重いものも含む）。保存するときだけ呼ばれる
     * @property {(root: Element, post: PostInfo) => Promise<(MediaItem|null)[]>} getMedia
     *   メディア一覧。mediaContainers と同じ並びで返し、URL が分からないものは取り除かずに null にする。
     *   個別ボタン・保存済みの記録・ファイル名の {n} が、すべて位置（番号）で対応しているためです
     * @property {(root: Element) => Element|null} actionBar - メインボタンを置く要素
     * @property {string} [watch] - ボタンに関係する要素（メディア・投稿へのリンク・操作バーのボタンなど）の
     *   セレクタ。投稿の中の変化のうち、これに当てはまる要素が増減したものだけを見直します。
     *   省略すると、投稿の中のどんな変化でも見直します
     * @property {string} [likeButton] - 「いいね」ボタンのセレクタ（「いいねを取り消す」には一致しないこと）。
     *   省略すると、いいね連動保存だけが無効になる
     * @property {(root: Element) => boolean} [isLocked] - メディアはあるが、まだ表示されていない（パスワードや
     *   注意書きで隠れている）投稿か。true の投稿には、メディアが 0 件でもメインボタンを出し、押されたら
     *   先に解除するよう知らせます。省略すると、メディアが 0 件の投稿にはボタンを出しません
     * @property {(root: Element) => number} [mediaCount] - 画面に出ている数とは別に分かっている、メディアの総数。
     *   画像の拡大表示のように、一度に 1 件しか表示しないところで、枚数バッジと「全件保存済みか」の判断に使います
     *   （画面上の数より小さい値は無視します）。省略すると、画面上の数（mediaContainers の件数）を使います
     * @property {(like: Element) => Element|null} [likeRoot] - 押された「いいね」ボタンが、どの投稿のものか。
     *   ボタンのある投稿のコンテナとは別の要素（同じ投稿の拡大表示など）で保存したいときに使います。
     *   省略すると、ボタンを囲む postRoot を使います
     */

    // ================================================================
    // 翻訳文字列
    // ================================================================

    /**
     * 差し込む値の無いメッセージの覚え。
     * 拡張機能を更新・再読み込みすると、開いたままのページに残った content script からは
     * chrome.i18n が使えなくなり（Extension context invalidated の例外）、エラーを知らせる文言すら
     * 取り出せなくなります。一度取り出した文言はここに残しておき、そのときも使えるようにします。
     * @type {Map<string, string>}
     */
    const messages = new Map();

    /**
     * _locales/<言語>/messages.json から翻訳済みの文字列を取り出す。
     *
     * @param {string} key - メッセージのキー
     * @param {...unknown} subs - $1, $2 ... に差し込む値
     * @returns {string} 見つからなければ（取り出せなければ）key をそのまま返す
     */
    const t = (key, ...subs) => {
        if (subs.length === 0 && messages.has(key)) return messages.get(key);

        let text;
        try {
            text = chrome.i18n.getMessage(key, subs.map(String)) || key;
        } catch {
            return key;
        }
        if (subs.length === 0) messages.set(key, text);
        return text;
    };

    // ================================================================
    // アダプタが使う小さな道具
    // ================================================================

    /**
     * URL の一部を安全にデコードする。壊れた「%」があっても例外を投げず、元の文字列を返します
     * （例外になると、ボタンの描き分けが止まったり、保存のたびに見当違いの知らせが出たりするため）。
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
     * 要素の文字を取り出す。改行が <br> で書かれているページ向けに、<br> を改行文字に戻してから読みます
     * （そのまま textContent で読むと、改行の前後の単語がくっついてしまうため）。
     * ページの要素を書き換えないよう、複製してから置き換えます。保存するときにしか呼ばれません。
     *
     * @param {Element|null|undefined} el
     * @returns {string} 前後の空白を除いた文字。要素が無ければ空文字
     */
    const textOf = (el) => {
        if (!el) return "";
        const copy = el.cloneNode(true);
        for (const br of copy.querySelectorAll("br")) br.replaceWith("\n");
        return copy.textContent.trim();
    };

    /**
     * 日本時間で書かれた日時を、ISO 8601 の文字列（+09:00 付き）にする。
     *
     * @param {RegExpExecArray|null} m - 日時を読んだ正規表現の結果。[1]〜[6] が年・月・日・時・分・秒の数字
     *   （秒の無い表記なら [6] は無くてよい）
     * @returns {string|null} 読めていなければ null
     */
    const jstTime = (m) => (m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+09:00` : null);

    /**
     * 画像のファイル名から、メディア 1 件の情報を作る。
     * 拡張子はファイル名の最後の「.」より後ろ（無ければ jpg、jpeg は jpg にそろえます）、
     * ファイルの ID（{media_id}）は、ファイル名から拡張子を除いたものです。
     *
     * @param {string} url - ダウンロード元
     * @param {string} file - ファイル名（例: "20758042846ac9137a5788c.jpg"）
     * @returns {MediaItem}
     */
    const photoOf = (url, file) => {
        const dot = file.lastIndexOf(".");
        const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "jpg";
        return { kind: "photo", url, ext: ext === "jpeg" ? "jpg" : ext, id: dot > 0 ? file.slice(0, dot) : file, res: "" };
    };

    // ================================================================
    // ページに置く要素
    // ================================================================

    /** この拡張機能が作るボタンを選ぶセレクタ */
    const BUTTONS = ".smd-button, .smd-item-button";

    /**
     * この拡張機能（のこの起動）が作った要素（ボタン・カウンター・トースト）。
     * DOM の変化のうち、自分で起こしたものを見分けるのに使います。
     *
     * ページのあらゆる変化で調べるので、要素をセレクタと照らし合わせる（matches()）代わりに、
     * 作ったときにここへ入れておき、入っているかどうかだけを見ます。WeakSet なので、
     * 要素がページから消えれば一緒に消え、メモリも溜まりません。
     * @type {WeakSet<Element>}
     */
    const own = new WeakSet();

    /**
     * 自前の要素を作る。
     *
     * @param {string} tag
     * @param {string} className
     * @returns {HTMLElement}
     */
    const make = (tag, className) => {
        const el = document.createElement(tag);
        el.className = className;
        own.add(el);
        return el;
    };

    /**
     * 自前の要素をページに追加する。
     * document_start で動くため <body> がまだ無いこともあり、その場合は <html> の直下に置きます
     * （どちらも position: fixed なので、見た目は変わりません）。
     *
     * @param {HTMLElement} el
     * @returns {HTMLElement} 追加した要素
     */
    const mount = (el) => (document.body ?? document.documentElement).appendChild(el);

    // ================================================================
    // 拡張機能とのつながり
    // ================================================================

    /**
     * background.js へメッセージを送り、返事を待つ。
     * 拡張機能を更新・再読み込みした直後などは background と話せず例外になるので、
     * ここで受け止めて null を返します。呼び出し側は「null なら通信エラー」とだけ考えれば済みます。
     *
     * @param {object} message
     * @returns {Promise<any>} background の返事。話せなければ null
     */
    const request = async (message) => {
        try {
            return await chrome.runtime.sendMessage(message);
        } catch {
            return null;
        }
    };

    /**
     * この content script が、まだ拡張機能とつながっているか。
     *
     * 拡張機能を更新・再読み込み・無効化すると、開いたままのページに残った content script からは
     * 拡張機能の API が使えなくなり、chrome.runtime.id が無くなります。Chrome は新しい content script を
     * 開いたままのタブへ入れ直さないので、ページを再読み込みするまで、このスクリプトが残り続けます。
     *
     * @returns {boolean}
     */
    const alive = () => {
        try {
            return typeof chrome.runtime?.id === "string";
        } catch {
            return false;
        }
    };

    /**
     * 拡張機能とのつながりが切れたときに止める処理（DOM の見張りなど）。start() が登録します。
     * @type {Set<() => void>}
     */
    const stoppers = new Set();

    /**
     * 拡張機能とのつながりが切れていたら、DOM の見張りなどを止める。
     * 切れた後も見張り続けると、ページが変わるたびに、押しても動かないボタンを付け続けてしまいます。
     *
     * @returns {boolean} 切れていた（止めた）なら true
     */
    const retireIfOrphaned = () => {
        if (alive()) return false;
        for (const stop of stoppers) stop();
        stoppers.clear();
        return true;
    };

    /**
     * 利用者自身の操作によるクリックか。
     *
     * ページ側のスクリプトが button.click() などで送ったクリック（isTrusted が false）で保存が始まると、
     * ページの思うままにダウンロードを始められてしまいます（ブラウザの「複数ファイルの自動ダウンロード」の
     * 確認も通りません）。ただし、キーボードで操作するための拡張機能などは、利用者の操作を受けて
     * 同じ方法でクリックを送るので、直前に利用者の操作があったとき（userActivation）は受け付けます。
     *
     * @param {Event} e
     * @returns {boolean}
     */
    const byUser = (e) => e.isTrusted || navigator.userActivation.isActive;

    // ================================================================
    // トースト（エラー通知）
    // ================================================================

    /** トーストの要素（初めて出すときに作ります）と、消すタイマーの ID */
    let toastEl = null;
    let toastTimer = 0;

    /**
     * 画面下にエラーメッセージを 3 秒だけ表示する。
     * 成功は左下のカウンターで分かるので、トーストはエラーのときだけ出します。
     *
     * @param {string} message
     * @returns {void}
     */
    const toast = (message) => {
        toastEl ??= make("div", "smd-toast");

        // ページ側が <body> の中身を作り直すなどして外されていたら、付け直します。
        if (!toastEl.isConnected) mount(toastEl);

        toastEl.textContent = message; // textContent なので HTML として解釈されません
        toastEl.classList.add("smd-toast-show");

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove("smd-toast-show"), 3000);
    };

    // ================================================================
    // 保存済みの記録（background.js が持つものの写し）
    // ================================================================

    /**
     * 保存済みの記録の写し（ledger ＝ 台帳。window.history と紛らわしいのでこの名前）。
     * キーは "サイト:投稿ID"、値は「メディア総数」と「保存済みの番号」を 1 個に詰めた数値です。
     *
     *   値 = 総数 × 2^32 + 保存済みの番号のビット
     *
     * 保存済みの番号のビットは「n 番目（0 始まり）を保存済みなら、下から n ビット目が 1」という数です。
     * 例: 4 枚中 1 枚目と 3 枚目を保存済み → 4 × 2^32 + 0b101。
     * 投稿ごとにオブジェクトや Set を持つより、ずっと少ないメモリで済み、background との
     * やり取りも軽くなります（1 投稿のメディアは最大 32 件まで。X も Bluesky も実際は 4 件まで）。
     * 形式は background.js と共通です。持つのは、このタブのサイトの分だけです。
     *
     * @type {Map<string, number>}
     */
    const ledger = new Map();

    /** 総数を上位に詰めるための桁（2^32） */
    const PACK = 2 ** 32;

    /**
     * n 番目のビットが立っているか。
     *
     * @param {number} mask
     * @param {number} n - 0 始まり。記録できるのは 0〜31 だけなので、32 以上はいつも false
     *   （シフト量は 32 で割った余りになるため、そのまま調べると別の番号のビットを見てしまいます）
     * @returns {boolean}
     */
    const hasBit = (mask, n) => n >= 0 && n < 32 && ((mask >>> n) & 1) === 1;

    /**
     * 立っているビットの数を数える（保存済みの件数）。
     *
     * @param {number} mask
     * @returns {number}
     */
    const countBits = (mask) => {
        let count = 0;
        for (let m = mask >>> 0; m !== 0; m >>>= 1) count += m & 1;
        return count;
    };

    /**
     * 記録に 1 件書き足す。
     *
     * @param {string} key - "サイト:投稿ID"
     * @param {number} index - 投稿内の番号（0 始まり）
     * @param {number} total - 投稿内のメディア総数
     * @returns {void}
     */
    const remember = (key, index, total) => {
        if (!Number.isInteger(index) || index < 0 || index > 31 || !Number.isInteger(total)) return;
        // 値の下位 32 ビット（>>> 0 で取り出せます）が、保存済みの番号のビットです。
        const mask = (((ledger.get(key) ?? 0) >>> 0) | (1 << index)) >>> 0;
        ledger.set(key, total * PACK + mask);
    };

    /**
     * 投稿の保存状況を調べる。
     *
     * @param {string|null} key - "サイト:投稿ID"
     * @param {number} count - 画面上のメディア数（記録に総数が無いときの代わり）
     * @returns {{mask: number, total: number, saved: number}}
     *   mask は保存済みの番号のビット、total は総数、saved は保存済みの件数
     */
    const progressOf = (key, count) => {
        const value = (key && ledger.get(key)) || 0;

        // 総数は保存したときに数えた値を優先します。画面上の数は、読み込み途中だと少なく見えるためです。
        const total = Math.floor(value / PACK) || count;

        // 総数以上の番号のビットは無視します（下から total 個のビットだけを残す）。
        const mask = ((value >>> 0) & (total >= 32 ? 0xffffffff : 2 ** total - 1)) >>> 0;

        return { mask, total, saved: countBits(mask) };
    };

    // ================================================================
    // ダウンロード数カウンター（画面左下）
    // ================================================================

    /**
     * カウンターの要素と、数字の入った文字ノード。初めて表示するときに作ります。
     * @type {{el: HTMLElement, nums: Record<string, Text>, failed: HTMLElement}|null}
     */
    let counter = null;

    /** 待ちが 0 になった後、表示を消すためのタイマー ID */
    let counterTimer = 0;

    /**
     * カウンターの要素を作る。
     * 文言は翻訳ファイルから取り、textContent で入れるので HTML として解釈されません。
     * 数字は、文字ノードを 1 つずつ作って覚えておきます。更新のたびに探し直さずに済み、
     * 書き換えるのも文字ノードの中身だけになります（setNumber() 参照）。
     *
     * @returns {NonNullable<typeof counter>}
     */
    const createCounter = () => {
        const el = make("div", "smd-counter");
        const nums = {};
        let failed = null;

        // 「DL待ち」「DL完了」「DL失敗」の 3 つを、ラベルと数字の組で並べます。
        for (const [name, label] of [["pending", "counterPending"], ["done", "counterDone"], ["failed", "counterFailed"]]) {
            const item = el.appendChild(document.createElement("span"));
            item.className = `smd-counter-item smd-counter-${name}`;

            const text = item.appendChild(document.createElement("span"));
            text.className = "smd-counter-label";
            text.textContent = t(label);

            const num = item.appendChild(document.createElement("span"));
            num.className = "smd-counter-num";

            nums[name] = num.appendChild(document.createTextNode(""));
            if (name === "failed") failed = item; // 失敗の欄は、0 件のとき隠すので覚えておきます
        }

        mount(el);
        return { el, nums, failed };
    };

    /**
     * カウンターの数字を、変わったときだけ書き換える。
     *
     * 要素の textContent に代入すると、中の文字ノードが新しいものに取り替えられ、「子が増減した」という
     * DOM の変化として、この拡張機能自身の MutationObserver まで起こしてしまいます。
     * 文字ノードの中身（data）を書き換えるだけなら、ノードはそのままで、子の増減にもなりません。
     *
     * @param {Text} node - 数字の入った文字ノード
     * @param {number} value
     * @returns {void}
     */
    const setNumber = (node, value) => {
        const text = String(value);
        if (node.data !== text) node.data = text;
    };

    /**
     * background から届いたカウンターの値を表示する。
     *
     * 表示するのは「待ちが 1 件以上ある間」と「待ちが 0 になってから hideAt までの間」です。
     * hideAt は background が決めた時刻なので、どのタブでも同じ瞬間に消えます。
     *
     * @param {{pending?: number, done?: number, failed?: number, hideAt?: number}} [counts]
     * @returns {void}
     */
    const showCounts = ({ pending = 0, done = 0, failed = 0, hideAt = 0 } = {}) => {
        const wait = hideAt - Date.now();
        clearTimeout(counterTimer);

        if (pending <= 0 && wait <= 0) {
            counter?.el.classList.remove("smd-counter-show");
            return;
        }

        counter ??= createCounter();

        // ページ側が <body> の中身を作り直すなどして外されていたら、付け直します。
        if (!counter.el.isConnected) mount(counter.el);

        setNumber(counter.nums.pending, pending);
        setNumber(counter.nums.done, done);
        setNumber(counter.nums.failed, failed);
        counter.failed.hidden = failed === 0; // 失敗は 1 件以上のときだけ並べます

        // 作った直後にクラスを付けても、下からふわっと出る動きは付きます。
        // 「現れる前の見た目」を content.css の @starting-style で決めてあるためで、
        // 動きを付けるためだけにレイアウトを計算させる必要がありません。
        counter.el.classList.add("smd-counter-show");
        if (pending <= 0) counterTimer = setTimeout(() => counter.el.classList.remove("smd-counter-show"), wait);
    };

    // ================================================================
    // 保存
    // ================================================================

    /**
     * 結果待ちのバッチ（ボタン 1 回分の保存）。
     * キーはバッチ ID、値は background から結果（smdBatch）が届いたときに呼ぶ関数です。
     * 結果が分からなくなったとき（戻る・進むのキャッシュから戻ったとき）は null で呼びます。
     * @type {Map<string, (result: {done: number, failed: number}|null) => void>}
     */
    const waiting = new Map();

    /**
     * 投稿のメディアを保存する。ボタンか、いいねが押されたときに呼ばれます。
     * 保存がすべて終わるまで（background から結果が届くまで）待ってから解決します。
     *
     * @param {SiteAdapter} adapter
     * @param {Element} root - 投稿 1 件のコンテナ
     * @param {number|null} only - null なら全件、数値ならその番号（0 始まり）だけ
     * @param {object} [options]
     * @param {boolean} [options.quiet=false] - true なら「保存するものが無い」ときの通知を省く
     * @param {number} [options.skip=0] - 保存しない番号のビット（いいね連動で保存済みを飛ばすのに使う）
     * @returns {Promise<void>}
     */
    const save = async (adapter, root, only, { quiet = false, skip = 0 } = {}) => {
        /** 「保存するものが無い」系の通知。quiet なら黙って見送ります */
        const nothing = (key) => { if (!quiet) toast(t(key)); };

        // 1. 投稿情報（ユーザー名・投稿 ID・本文など）を読む
        const post = adapter.readPost(root);
        if (!post) return nothing("toastNoPost");

        // 2. メディア一覧をもらう（取得に失敗したときは、何も無かったものとして扱います）
        const all = (await adapter.getMedia(root, post).catch(() => null)) ?? [];

        // まだ解除されていない投稿なら、先に解除するよう知らせます。
        if (all.length === 0 && adapter.isLocked?.(root)) return nothing("toastLocked");

        // 3. 保存するものを選ぶ。番号（index）は保存済みの記録とファイル名の {n} に使うので、メディアと組にします。
        const items = [];
        all.forEach((media, index) => {
            if (media && (only === null || index === only) && !hasBit(skip, index)) items.push({ ...media, index });
        });
        if (items.length === 0) return nothing("toastNoMedia");

        // 4. background へ頼む。ファイル名は background が設定から組み立てます。
        //    結果の受け取り口は、頼む前に用意しておきます（結果が返事より先に届いても取りこぼさないように）。
        const batch = crypto.randomUUID();
        const finished = new Promise((resolve) => waiting.set(batch, resolve));

        const reply = await request({ type: "download", batch, post, items, total: all.length });

        if (!reply) {
            waiting.delete(batch);
            return toast(t("toastCommError"));
        }

        // 5. 1 件も受け付けられなかったときは、結果を待たずにここで終わります。
        let result = { done: 0, failed: Number(reply.rejected) || 0 };
        if (reply.accepted > 0) result = await finished;
        else waiting.delete(batch);

        // 結果が分からなくなった（ページが戻る・進むのキャッシュに入っている間に終わった）ときは、何も知らせません。
        if (!result) return;

        // 6. 失敗があったときだけ知らせます（成功の件数はカウンターで分かります）。
        const { done, failed } = result;
        if (failed) toast(done ? t("toastPartial", done, failed) : t("toastFailed", failed));
    };

    // ================================================================
    // ボタン
    // ================================================================

    /** メディア要素 → そのメディアに付けた個別ボタン（要素が消えれば、対応も自動で消えます） */
    const itemButtons = new WeakMap();

    /** 投稿のコンテナ → その投稿に付けたメインボタン */
    const mainButtons = new WeakMap();

    /** 投稿のコンテナ → 最後に描いたときの記録のキー（保存済みの知らせで、描き直す投稿を探すのに使う） */
    const rootKeys = new WeakMap();

    /**
     * @typedef {object} ButtonInfo ボタン 1 個について覚えておくこと
     * @property {number} index - 個別ボタンの番号（0 始まり）。メインボタンは -1
     * @property {boolean|null} done - 最後に描いたとき保存済みだったか。まだ描いていなければ null
     * @property {string} badge - 最後に描いた枚数バッジの文字（出していなければ空）
     */

    /**
     * ボタン → そのボタンについて覚えておくこと。
     *
     * 番号や見た目を data-* 属性に書いておく方法もありますが、属性の読み書きは遅く
     * （dataset は読むたびに属性名を組み立てて探します）、書けば、属性の変化を見張っている
     * ページ側の MutationObserver まで起こしてしまいます。
     * WeakMap なら JavaScript の中だけで済み、使うメモリも少なく、ボタンが消えれば一緒に消えます。
     * ここに無いボタンは、この拡張機能（のこの起動）が作ったものではありません。
     * @type {WeakMap<HTMLButtonElement, ButtonInfo>}
     */
    const buttonInfo = new WeakMap();

    /**
     * ツールチップの文言のメモ。翻訳の取り出しを毎回繰り返さないよう、1 度作ったら使い回します。
     * キーは「番号:保存済みか」で、メインボタンの番号は -1 です。
     * @type {Map<string, string>}
     */
    const titles = new Map();

    /**
     * ボタンのツールチップの文言を返す。
     *
     * @param {number} index - 個別ボタンの番号（0 始まり）。メインボタンは -1
     * @param {boolean} done - 保存済みか
     * @returns {string}
     */
    const titleOf = (index, done) => {
        const key = `${index}:${done}`;
        let title = titles.get(key);

        if (title === undefined) {
            const base = index < 0 ? t("btnMainTitle") : t("btnItemTitle", index + 1);
            title = done ? t("titleSaved", base) : base;
            titles.set(key, title);
        }
        return title;
    };

    /**
     * ダウンロードボタンを作る。枚数バッジ・ツールチップ・保存済みの印は look() が付けます。
     * アイコン（矢印・チェックマーク）は content.css が ::before に描くので、ボタンの中身は枚数バッジの文字だけです。
     * クリックは watchClicks() が document でまとめて受け取るので、ここではリスナーを付けません
     * （ボタンが何百個あっても、リスナーは 1 つで済みます）。
     *
     * @param {number} index - 個別ボタンの番号（0 始まり）。メインボタンは -1
     * @returns {HTMLButtonElement}
     */
    const button = (index) => {
        const el = make("button", index < 0 ? "smd-button" : "smd-item-button");

        // type="button" を明示しないと、フォーム内に置かれたとき送信ボタン扱いになります。
        el.type = "button";

        // 番号を覚えておきます（どれを保存するか、描き分け、番号が合っているかの確認に使います）。
        buttonInfo.set(el, { index, done: null, badge: "" });

        return el;
    };

    /**
     * 個別ボタンを重ねるのにちょうど良い要素を探す。
     * メディア要素から親をたどり、「大きさがあり、同じ投稿の他のメディアを含まない」最初の要素を返します。
     * （他のメディアまで含む要素に付けると、4 枚組のボタンが全部同じ角に重なってしまうため）
     *
     * 大きさ（offsetWidth）を読むとブラウザはレイアウトを計算するので、これは「読む段階」だけで呼びます。
     *
     * @param {Element} el - 対象のメディア要素
     * @param {Element} root - 投稿 1 件のコンテナ
     * @param {Element[]} all - 同じ投稿のメディア要素すべて
     * @returns {Element|null} 見つからなければ null（その 1 件は諦める）
     */
    const anchorOf = (el, root, all) => {
        for (let node = el; node && node !== root; node = node.parentElement) {
            if (all.some((other) => other !== el && node.contains(other))) return null;
            if (node.offsetWidth && node.offsetHeight) return node;
        }
        return null;
    };

    /**
     * ボタンの見た目（保存済みの印・ツールチップ・枚数バッジ）を整える。
     * 前回と同じ見た目なら DOM に触りません。書き換えると、ブラウザの描き直しと
     * MutationObserver の反応が起きるため、変わったところだけ書きます。
     * 保存済みかどうかは smd-done クラスで表し、アイコンの矢印とチェックマークも CSS がこれを見て描き分けます。
     *
     * @param {HTMLButtonElement} el
     * @param {ButtonInfo} info - このボタンについて覚えていること（描いた見た目をここに書き留めます）
     * @param {boolean} done - 保存済みか
     * @param {string} badge - 枚数バッジの文字（空なら出さない）
     * @returns {void}
     */
    const look = (el, info, done, badge) => {
        if (info.done !== done) {
            info.done = done;
            el.classList.toggle("smd-done", done);
            el.title = titleOf(info.index, done);
        }
        if (info.badge !== badge) {
            info.badge = badge;
            el.textContent = badge; // 文字だけなので textContent で入れます（HTML としては解釈されません）
        }
    };

    /**
     * @typedef {object} Plan 投稿 1 件ぶんの「やること」（読む段階で作り、書く段階で実行する）
     * @property {Element} root - 投稿のコンテナ
     * @property {string|null} key - 記録のキー
     * @property {number} count - 画面上のメディア数
     * @property {boolean} locked - メディアが 0 件だが、解除すれば見られる投稿か（メインボタンだけを出す）
     * @property {Element[]} remove - 取り除くボタン
     * @property {HTMLButtonElement[]} keep - そのまま使うボタン
     * @property {Element|null} bar - メインボタンを新しく置く場所（置かないなら null）
     * @property {{el: Element, index: number, anchor: Element, relative: boolean}[]} add - 新しく付ける個別ボタン
     * @property {boolean} missing - 置き場所が見つからず、個別ボタンを付けられなかったメディアがあるか
     */

    /**
     * 【読む段階】投稿 1 件を調べ、やることをまとめる。ここでは DOM を書き換えません。
     *
     * X は要素を別の投稿の表示へ使い回すことがあるため、前に付けたボタンが合わなくなる場合があります。
     *   - メディアが無くなった投稿のボタン
     *   - 個別ボタンが要らなくなった（1 件以下になった）投稿の個別ボタン
     *   - 番号がずれた個別ボタン（押すと別のメディアを保存しかねない）
     * こうしたボタンは remove に入れ、付け直します。
     *
     * @param {SiteAdapter} adapter
     * @param {Element} root
     * @returns {Plan}
     */
    const survey = (adapter, root) => {
        const media = adapter.mediaContainers(root);

        // この投稿のボタン（入れ子になった別の投稿のものは除く）
        const mine = (el) => el.closest(adapter.postRoot) === root;
        const existing = [...root.querySelectorAll(BUTTONS)].filter(mine);

        // メディアが 0 件でも、解除すれば見られる投稿にはメインボタンだけを出します（押すと解除を促す）。
        const locked = media.length === 0 && adapter.isLocked?.(root) === true;

        const plan = {
            root, key: null, count: media.length, locked, remove: existing, keep: [], bar: null, add: [], missing: false,
        };
        if (media.length === 0 && !locked) return plan; // メディアが無ければ、ボタンはすべて取り除く

        // 画面に出ていない分も含めた総数が分かるなら、そちらで描き分けます（拡大表示など）。
        if (adapter.mediaCount) plan.count = Math.max(media.length, adapter.mediaCount(root) || 0);

        // メインボタン: 覚えているものが今もこの投稿にあれば、そのまま使います。
        const main = mainButtons.get(root);
        if (main?.isConnected && mine(main)) plan.keep.push(main);
        else plan.bar = adapter.actionBar(root);

        // 個別ボタン（メディアが 2 件以上のときだけ）: 覚えているものが今も同じ番号なら、そのまま使います。
        // 新しく付けるものだけ置き場所を探すので、大きさの読み取り（レイアウト計算）は最初の 1 回で済みます。
        if (media.length >= 2) {
            media.forEach((el, index) => {
                const btn = itemButtons.get(el);
                if (btn?.isConnected && mine(btn) && buttonInfo.get(btn).index === index) {
                    plan.keep.push(btn);
                    return;
                }

                const anchor = anchorOf(el, root, media);
                if (!anchor) {
                    plan.missing = true; // まだ大きさが無い（読み込み中など）。少し後でやり直します
                    return;
                }

                // 絶対配置の基準にするため、static なら relative にします（書くのは次の段階）。
                plan.add.push({ el, index, anchor, relative: getComputedStyle(anchor).position === "static" });
            });
        }

        plan.remove = existing.filter((el) => !plan.keep.includes(el));

        const id = adapter.postId(root);
        plan.key = id ? `${adapter.site}:${id}` : null;
        return plan;
    };

    /**
     * 【書く段階】survey() がまとめたことを実行し、保存済みかどうかで見た目を描き分ける。
     *
     * @param {Plan} plan
     * @returns {void}
     */
    const apply = ({ root, key, count, locked, remove, keep, bar, add }) => {
        for (const el of remove) el.remove();
        if (count === 0 && !locked) return;

        const buttons = [...keep];

        if (bar) {
            const el = button(-1);
            bar.append(el);
            mainButtons.set(root, el);
            buttons.push(el);
        }

        for (const { el, index, anchor, relative } of add) {
            if (relative) anchor.style.position = "relative";
            const btn = button(index);
            anchor.append(btn);
            itemButtons.set(el, btn);
            buttons.push(btn);
        }

        rootKeys.set(root, key);

        // 保存済みかどうかで描き分けます。
        const { mask, total, saved } = progressOf(key, count);
        for (const el of buttons) {
            const info = buttonInfo.get(el);

            if (info.index < 0) {
                // メインボタン: 一部だけ保存済みなら「2/4」、それ以外は総数（1 件なら出さない）。
                const partial = saved > 0 && saved < total;
                const badge = total > 1 ? (partial ? `${saved}/${total}` : String(total)) : "";
                look(el, info, total > 0 && saved >= total, badge);
            } else {
                look(el, info, hasBit(mask, info.index), "");
            }
        }
    };

    // ================================================================
    // クリック（ボタンと、いいね連動保存）
    // ================================================================

    /**
     * イベントが、この拡張機能のボタンの上で起きたものなら、そのボタンを返す。
     *
     * @param {Event} e
     * @returns {Element|null}
     */
    const buttonOf = (e) => (e.target instanceof Element ? e.target.closest(BUTTONS) : null);

    /**
     * ボタンのクリックと、いいねのクリックを、document でまとめて受け取る。
     *
     * キャプチャフェーズ（第 3 引数 true）の document は、ページ側のどの要素よりも先に受け取れるので、
     * SNS 側の処理（投稿を開く、画像を拡大する等）が動く前に止められます。
     * mousedown も止めるのは、押した瞬間に反応する処理があるためです。
     * 個別ボタンは画像のリンクの中にあるので、中クリック（auxclick）も止めないと、ボタンを中クリックしただけで
     * リンク先（X なら画像の拡大表示）が新しいタブで開きます。Enter / Space も、ページ側のキーボード操作
     * （X なら Enter で投稿を開く）に届かないようにします（ボタンを押す動作そのものは止めません）。
     *
     * いいねのクリックは見るだけで、preventDefault も stopPropagation も呼びません（いいね自体には手を触れない）。
     *
     * @param {SiteAdapter} adapter
     * @returns {void}
     */
    const watchClicks = (adapter) => {
        document.addEventListener("mousedown", (e) => {
            if (buttonOf(e)) e.stopPropagation();
        }, true);

        document.addEventListener("auxclick", (e) => {
            if (!buttonOf(e)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, true);

        for (const type of ["keydown", "keyup"]) {
            document.addEventListener(type, (e) => {
                if ((e.key === "Enter" || e.key === " ") && buttonOf(e)) e.stopPropagation();
            }, true);
        }

        // いいね連動保存の設定。起動時に読み、変更されたら追いかけます（いいねのセレクタが無いサイトでは使いません）。
        // つながりが切れた後（retired）は、設定が変わっても有効にしません。
        let likes = false;
        let retired = false;
        if (adapter.likeButton) {
            chrome.storage.sync.get({ likeDownload: false })
                .then((s) => { likes = s.likeDownload === true && !retired; }, () => {});
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === "sync" && changes.likeDownload) likes = changes.likeDownload.newValue === true && !retired;
            });
            stoppers.add(() => {
                retired = true;
                likes = false;
            });
        }

        /**
         * いいねで保存を始めて、まだ終わっていない投稿のキー。
         * 終わる前に「取り消し → もう一度いいね」と操作されても、二重に始めないためのものです。
         * 終わったら（失敗しても）外すので、失敗した投稿はいいねを付け直せば、もう一度試せます。
         * 保存できた分は、保存済みの記録で見分けます。
         */
        const started = new Set();

        /**
         * いいねのクリックなら、その投稿のまだ保存していないメディアを保存する。
         *
         * @param {MouseEvent} e
         * @returns {void}
         */
        const onLike = (e) => {
            // 「いいねを取り消す」ボタンは別のセレクタなので、いいねを付けたときだけ一致します。
            const like = e.target instanceof Element ? e.target.closest(adapter.likeButton) : null;
            if (!like) return;

            // 拡張機能を更新・再読み込みした後のページでは、保存できないので静かに見送ります。
            if (retireIfOrphaned()) return;

            const root = adapter.likeRoot ? adapter.likeRoot(like) : like.closest(adapter.postRoot);
            if (!root) return;

            // メディアの無い投稿は静かに見送ります。
            const shown = adapter.mediaContainers(root).length;
            const id = shown > 0 ? adapter.postId(root) : null;
            if (!id) return;

            // 画面に出ていない分も含めた総数（拡大表示など）。保存済みかどうかは、この数で判断します。
            const count = adapter.mediaCount ? Math.max(shown, adapter.mediaCount(root) || 0) : shown;

            // 保存中か、全件保存済みなら何もしません（ボタンからなら何度でも保存できます）。
            const key = `${adapter.site}:${id}`;
            const { mask, total, saved } = progressOf(key, count);
            if (started.has(key) || saved >= total) return;

            started.add(key);

            // await しません。待つと、いいねの反映が保存の分だけ遅れて見えるためです。
            // 保存済みの番号は skip で飛ばし、残りだけを保存します。
            save(adapter, root, null, { quiet: true, skip: mask })
                .catch(() => {})
                .finally(() => started.delete(key));
        };

        document.addEventListener("click", (e) => {
            const el = buttonOf(e);
            if (!el) {
                // ページ上のすべてのクリックが通るので、設定がオフなら何もせずに見送ります。
                if (likes) onLike(e);
                return;
            }

            e.preventDefault();
            e.stopImmediatePropagation();

            // ページ側のスクリプトが送ったクリックでは保存しません（byUser() 参照）。
            if (!byUser(e)) return;

            // 拡張機能を更新・再読み込みした後のページでは、もう保存できません。再読み込みを促します。
            // 文言は起動時に一度取り出してあるので、拡張機能の API が使えなくなっていても出せます。
            if (retireIfOrphaned()) {
                toast(t("toastCommError"));
                return;
            }

            // 覚えの無いボタン（拡張機能を更新する前に作られて残ったものなど）は、番号が分からないので見送ります。
            // 保存中も受け付けません（保存中のボタンは押せる見た目のまま残し、ここで見送ります。
            // CSS の pointer-events: none で押せなくすると、クリックがボタンの下の画像のリンクや投稿へ
            // 素通りして、拡大表示や投稿のページが開いてしまうためです）。
            const root = el.closest(adapter.postRoot);
            const info = buttonInfo.get(el);
            if (!root || !info || el.classList.contains("smd-busy")) return;

            el.classList.add("smd-busy");
            save(adapter, root, info.index < 0 ? null : info.index)
                .catch(() => toast(t("toastCommError")))
                .finally(() => el.classList.remove("smd-busy"));
        }, true);
    };

    // ================================================================
    // 開始
    // ================================================================

    /**
     * 拡張機能の動作を開始する。各サイトのスクリプトはこれを 1 回呼ぶだけです。
     *
     * @param {SiteAdapter} adapter
     * @returns {{refresh: () => void}} refresh は、すべての投稿のボタンを見直す。
     *   投稿の外の変化でメディアの数が変わるサイト（ポイピクの拡大表示など）が呼びます
     */
    const start = (adapter) => {
        // DOM の変化のたびに使うセレクタは、先にアダプタから取り出しておきます。
        const { postRoot, watch } = adapter;

        /**
         * このサイトの記録のキーの頭（"x:" など）。
         * 保存できた 1 件の知らせ（smdUpdate）は全サイトのタブに届くので、このサイトのものを見分けるのに使います。
         */
        const prefix = `${adapter.site}:`;

        // <html data-smd-site="x"> のような目印を付け、CSS でサイトごとのアクセント色を切り替えます。
        document.documentElement.dataset.smdSite = adapter.site;

        // 拡張機能とのつながりが切れた後（更新・再読み込みの後）にも出せるよう、その知らせの文言を
        // 今のうちに取り出して覚えさせておきます（t() は一度取り出した文言を覚えています）。
        t("toastCommError");

        watchClicks(adapter);

        /** 次の描画フレームで見直す投稿 */
        const dirty = new Set();

        /** 予約済みの requestAnimationFrame の ID（0 なら予約なし） */
        let frame = 0;

        /**
         * 個別ボタンの置き場所がまだ見つからない投稿の、やり直した回数。
         * 画像の読み込み前は大きさが 0 のことがあり、そのときは少し後でもう一度試します。
         * 投稿の中に変化が無くても付け直せるようにするためのもので、回数に上限を設けています。
         */
        const retries = new WeakMap();

        /** やり直しの間隔（ミリ秒）と回数の上限 */
        const RETRY_DELAY = 500;
        const RETRY_LIMIT = 6;

        /**
         * 見直しを実行する。読む段階をすべて終えてから、書く段階に入ります。
         * 1 件で例外が起きても、残りの投稿は続けます（DOM の形が想定と違う投稿など）。
         *
         * @returns {void}
         */
        const flush = () => {
            frame = 0;

            // 拡張機能とのつながりが切れていたら、見張りを止めて何もしません。
            if (retireIfOrphaned()) {
                dirty.clear();
                return;
            }

            const plans = [];
            for (const root of dirty) {
                if (!root.isConnected) continue; // 待っている間に消えた投稿は飛ばす
                try {
                    plans.push(survey(adapter, root));
                } catch {
                    // この投稿だけ見送ります。
                }
            }
            dirty.clear();

            for (const plan of plans) {
                try {
                    apply(plan);
                } catch {
                    // この投稿だけ見送ります。
                }

                // 置き場所が見つからなかったメディアがあれば、少し後でその投稿だけやり直します。
                // 全部付けられたら回数を数え直します。数えたままにすると、X のように要素が別の投稿の表示へ
                // 使い回されたとき、その要素ではもう二度とやり直さなくなってしまうためです。
                if (!plan.missing) {
                    retries.delete(plan.root);
                    continue;
                }
                const tried = retries.get(plan.root) ?? 0;
                if (tried < RETRY_LIMIT) {
                    retries.set(plan.root, tried + 1);
                    setTimeout(() => mark(plan.root), RETRY_DELAY);
                }
            }
        };

        /**
         * 投稿を「見直す」印を付け、次の描画フレームでまとめて処理する。
         * requestAnimationFrame は画面を描く直前に呼ばれるので、ボタンは次の描画に間に合います。
         *
         * @param {Element} root
         * @returns {void}
         */
        const mark = (root) => {
            dirty.add(root);
            frame ||= requestAnimationFrame(flush);
        };

        /** ページ内の全投稿に印を付ける（起動時と、アダプタから refresh() が呼ばれたとき） */
        const markAll = () => {
            for (const root of document.querySelectorAll(postRoot)) mark(root);
        };

        /**
         * ページ内の投稿のうち、最後に描いたときの記録のキーが条件に合うものにだけ印を付ける。
         * 保存済みの見た目を描き直す必要があるのは、その記録に関わる投稿だけだからです。
         *
         * @param {(key: string|null|undefined) => boolean} wanted - キーを受け取り、見直すなら true を返す関数
         * @returns {void}
         */
        const markByKey = (wanted) => {
            for (const root of document.querySelectorAll(postRoot)) {
                if (wanted(rootKeys.get(root))) mark(root);
            }
        };

        /**
         * 追加された要素の中にある投稿（要素自身を含む）に、すべて印を付ける。
         * 中に投稿があるかを querySelector で先に確かめるのは、無いとき（ほとんどの場合）に
         * querySelectorAll の結果を入れる一覧を作らずに済むからです。
         *
         * @param {Element} node - 子を持つ要素（子の無い要素は、投稿でも投稿を含むものでもありません）
         * @returns {void}
         */
        const markRoots = (node) => {
            if (node.matches(postRoot)) mark(node);
            if (node.querySelector(postRoot) === null) return;

            const roots = node.querySelectorAll(postRoot);
            for (let i = 0; i < roots.length; i += 1) mark(roots[i]);
        };

        /**
         * 要素が、ボタンに関係するもの（adapter.watch に当てはまる要素か、それを含む要素）か。
         * adapter.watch が無ければ、どの要素も関係ありとみなします。
         * 子の無い要素は、中を探すまでもないので、要素自身だけを確かめます。
         *
         * @param {Element} el
         * @returns {boolean}
         */
        const matters = (el) =>
            !watch || el.matches(watch) || (el.childElementCount > 0 && el.querySelector(watch) !== null);

        /**
         * 削除された要素の中に、ボタンに関係するものがあるか。自前の要素と、文字だけの変化は関係ありません。
         *
         * NodeList は for...of ではなく添字でたどります。for...of は 1 回まわすごとに
         * 小さなオブジェクトを作るので、空や 1 件のことが多いこの一覧では、添字のほうが速く済みます。
         *
         * @param {NodeList} nodes
         * @returns {boolean}
         */
        const touches = (nodes) => {
            for (let i = 0; i < nodes.length; i += 1) {
                const node = nodes[i];
                if (node.nodeType === 1 && !own.has(node) && matters(node)) return true;
            }
            return false;
        };

        // background からの知らせ。runtime.onMessage に届くのは拡張機能自身からのものだけで、
        // ページ側のスクリプトからは送れません。
        //   smdUpdate … カウンターの値が変わった（全タブ合算）。saved があれば、メディアが 1 件保存された
        //   smdBatch  … このタブで頼んだ保存（ボタン 1 回分）が、すべて終わった
        chrome.runtime.onMessage.addListener((message) => {
            if (message?.type === "smdUpdate") {
                showCounts(message.counts);

                // 保存できた 1 件。知らせは対応サイトのどのタブにも届くので、
                // ほかのサイトのものは覚えず、投稿を探すこともしません。
                const saved = message.saved;
                if (typeof saved?.key === "string" && saved.key.startsWith(prefix)) {
                    remember(saved.key, saved.index, saved.total);

                    // その投稿を表示しているところだけ描き直します。
                    markByKey((key) => key === saved.key);
                }
            }

            if (message?.type === "smdBatch") {
                waiting.get(message.batch)?.({ done: Number(message.done) || 0, failed: Number(message.failed) || 0 });
                waiting.delete(message.batch);
            }

            return false; // 返事はしません
        });

        /**
         * background から、今のカウンターと、このサイトの記録をもらって反映する。
         * 開いたときと、戻る・進むのキャッシュ（bfcache）からページが戻ってきたときに呼びます。
         *
         * @returns {void}
         */
        const sync = () => {
            request({ type: "smdState", site: adapter.site }).then((state) => {
                // background はこのサイトの分だけを返しますが、受け取った値は念のため確かめてから写します。
                // for...in で直接たどるのは、Object.entries() だと記録の件数ぶんの配列を作ってしまうためです。
                const history = state?.history ?? {};
                for (const key in history) {
                    const value = history[key];
                    if (key.startsWith(prefix) && Number.isSafeInteger(value)) ledger.set(key, value);
                }
                showCounts(state?.counts ?? undefined);

                // 記録が届く前に描いた投稿のうち、記録のあるものだけを見直します
                // （記録が空なら、どの投稿の見た目も変わらないので何もしません）。
                if (ledger.size > 0) markByKey((key) => ledger.has(key));
            }).catch(() => {});
        };

        // 開いた時点のカウンターと記録をもらいます。
        // 再読み込みしたり別のタブを開いたりしても、保存中の数と保存済みの見た目が引き継がれます。
        sync();

        // 戻る・進むのキャッシュに入っている間は、background からの知らせが届きません。
        // その間に終わった保存の結果は二度と届かないので、待っているボタンの「保存中」を解き、
        // カウンターと記録を取り直します。
        addEventListener("pageshow", (e) => {
            if (!e.persisted) return;
            for (const resolve of waiting.values()) resolve(null);
            waiting.clear();
            sync();
        });

        // DOM の変化から、見直しが必要な投稿だけを拾います。
        //   - 投稿を含む要素が追加された → 中の投稿すべて
        //   - 投稿の中で、ボタンに関係する要素が増減した → その投稿
        //     （メディア・投稿へのリンク・操作バーなど。動画の再生時間の表示のような変化は見送ります）
        //   - 投稿の中の画像の src・動画の poster・リンクの href が変わった → その投稿
        //     （メディアとして数えられるようになる、または要素の使い回しで別の投稿を表示し始めたため）
        // 自分でボタンを付けたり描き直したりした変化も、見直しの対象にしません（無駄な繰り返しを防ぐ）。
        //
        // ここはページのあらゆる変化で呼ばれます。X ではスクロールするだけで毎秒何百件も届くので、
        // 関係のない変化は、できるだけ少ない手数で見送ります。
        const observer = new MutationObserver((records) => {
            // 同じ要素の中の変化は、続けて届くことがよくあります（1 つの要素に子を続けて足したときなど）。
            // そこで、直前の変化と同じ要素なら、どの投稿の中か（closest）を調べ直さずに使い回します。
            //   lastRoot … その要素を囲む投稿。投稿の外なら null、見送る変化（自前の要素の中など）なら false
            let lastTarget = null;
            let lastRoot = null;

            for (const record of records) {
                const target = record.target;
                if (target !== lastTarget) {
                    lastTarget = target;
                    lastRoot = target.nodeType !== 1 || own.has(target) ? false : target.closest(postRoot);
                }
                const root = lastRoot;
                if (root === false) continue;

                // 属性（src / poster / href）の変化。その投稿を見直します。
                if (record.type === "attributes") {
                    if (root !== null) mark(root);
                    continue;
                }

                // ここから下は、子の増減（childList）です。
                // その投稿に関係のある要素が増減したかどうかを、これから調べる必要があるか。
                // 投稿の外の変化と、もう見直すことが決まっている投稿の中の変化は、調べるまでもありません。
                // （メディアの中身の変化、たとえば動画プレイヤーの再生時間の表示は拾いません。
                //   置き場所の大きさが後から決まる場合は、flush のやり直しで拾います）
                let undecided = root !== null && !dirty.has(root);

                // 追加された要素を 1 回だけたどり、次の 2 つをまとめて調べます
                // （NodeList を添字でたどる理由は touches() と同じです）。
                const added = record.addedNodes;
                for (let i = 0; i < added.length; i += 1) {
                    const node = added[i];
                    if (node.nodeType !== 1 || own.has(node)) continue;

                    // 1. 投稿の中に、ボタンに関係する要素が追加された場合
                    if (undecided && matters(node)) {
                        mark(root);
                        undecided = false;
                    }

                    // 2. 投稿そのもの、または投稿を含む要素が追加された場合
                    if (node.childElementCount > 0) markRoots(node);
                }

                // 3. 投稿の中から、ボタンに関係する要素が削除された場合
                if (undecided && touches(record.removedNodes)) mark(root);
            }
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src", "poster", "href"],
        });

        // 拡張機能とのつながりが切れたら、DOM の見張りをやめます（retireIfOrphaned() 参照）。
        stoppers.add(() => {
            observer.disconnect();
            cancelAnimationFrame(frame);
            frame = 0;
            dirty.clear();
        });

        markAll();
        return { refresh: markAll };
    };

    return { start, request, decode, textOf, jstTime, photoOf };
})();
