// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * shared/core.js
 * ==================================================================
 * サイトに依存しない共通処理（globalThis.SMDCore）。
 *
 * X 用・Bluesky 用のスクリプトは「アダプタ」を 1 つ作って SMDCore.start() に渡すだけです。
 * ボタンの描画、保存の流れ、エラー通知（トースト）、いいね連動保存、
 * ダウンロード数カウンター、保存済みボタンの表示は、すべてこのファイルが引き受けます。
 *
 * 【保存の流れ】
 *   1. ボタン（またはいいね）が押される
 *   2. アダプタから投稿情報とメディア一覧をもらい、ファイル名を組み立てる
 *   3. background.js へ「この一覧を保存して」と頼む。background はすぐに受け付けだけ返す
 *   4. 進み具合は smdUpdate（カウンターと、保存できた 1 件）で全タブへ届く
 *   5. 頼んだ分がすべて終わると smdBatch が届き、ボタンの「保存中」を解いて、失敗があれば知らせる
 *
 * 【速さのための工夫】
 * X も Bluesky も DOM が絶えず変わるので、ボタンの差し込みは次の 3 点で軽くしています。
 *   - 変化があった投稿だけを、次の描画フレームでまとめて見直す（画面全体は走査しない）
 *   - 見直しは「読む段階」と「書く段階」に分ける。要素の大きさを読むとブラウザは
 *     レイアウトを計算し直すため、読みと書きを交互にすると投稿の数だけ計算が走ってしまう
 *   - 付けたボタンは WeakMap で覚えておき、DOM を探し直さない
 *     （WeakMap は要素が消えれば一緒に消えるので、メモリも溜まらない）
 *   - ボタンに関係しない変化（動画の再生時間の表示など）は、見直しの対象にしない
 *   - クリックの受け取りは document の 1 か所にまとめ、ボタンごとにリスナーを付けない
 *   - アイコンは 1 度だけ作って複製する（毎回 HTML として解析しない）
 * ==================================================================
 */

globalThis.SMDCore = (() => {
    "use strict";

    /**
     * @typedef {object} PostInfo 投稿 1 件の情報
     * @property {"x"|"bluesky"|"poipiku"} site - サイト
     * @property {string} screenName - ユーザー名 / ハンドル
     * @property {string} postId - 投稿 ID
     * @property {string} name - 表示名
     * @property {string} text - 本文
     * @property {string|null} time - 投稿日時（ISO 8601）
     */

    /**
     * @typedef {object} MediaItem メディア 1 件の情報
     * @property {"photo"|"video"|"animated_gif"} kind - 種類
     * @property {string} url - ダウンロード元（https のみ）
     * @property {string} ext - 拡張子
     * @property {string} [id] - 元ファイルの ID（Bluesky の CID など）
     * @property {string} [res] - 解像度
     */

    /**
     * @typedef {object} SiteAdapter サイトごとの差分を吸収するオブジェクト
     * @property {"x"|"bluesky"|"poipiku"} site - サイト。保存済みの記録のキーと、CSS のアクセント色の切り替えに使う
     * @property {string} postRoot - 投稿 1 件のコンテナを選ぶ CSS セレクタ
     * @property {(root: Element) => Element[]} mediaContainers - メディアを包む要素（画面の並び順）
     * @property {(root: Element) => string|null} postId
     *   投稿 ID だけを素早く読む。ボタンの描き分けのたびに呼ぶので、軽く作ること
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
     */

    // 下向き矢印（保存）とチェックマーク（保存済み）のアイコン。
    // fill="currentColor" なので、CSS の color で色が変わります。
    const ICON =
        '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" ' +
        'd="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 ' +
        '1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1zM5 18a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/></svg>';
    const CHECK =
        '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" ' +
        'd="M9.5 12.09 6.7 9.3a1 1 0 0 0-1.4 1.4l3.5 3.5a1 1 0 0 0 1.4 0l8.5-8.5a1 1 0 0 0-1.4-1.4z' +
        'M5 18a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/></svg>';

    /**
     * アイコンの元（1 度だけ作る）。ボタンを描き直すたびに SVG を HTML として解析するのは重いので、
     * 元を複製して使います。
     * @type {{icon?: Node, check?: Node}}
     */
    const iconSources = {};

    /**
     * アイコンの複製を返す。
     *
     * @param {boolean} done - 保存済みならチェックマーク、そうでなければ矢印
     * @returns {Node}
     */
    const iconOf = (done) => {
        const name = done ? "check" : "icon";
        if (!iconSources[name]) {
            const template = document.createElement("template");
            template.innerHTML = done ? CHECK : ICON; // 自前の固定文字列なので、HTML として解釈しても安全
            iconSources[name] = template.content.firstChild;
        }
        return iconSources[name].cloneNode(true);
    };

    /** この拡張機能が作るボタンを選ぶセレクタ */
    const BUTTONS = ".smd-button, .smd-item-button";

    /** この拡張機能が作る要素のクラス。DOM の変化のうち、自分で起こしたものを見分けるのに使います */
    const OWN_CLASSES = ["smd-button", "smd-item-button", "smd-counter", "smd-toast"];

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
     * 自前の要素をページに追加する。
     * document_start で動くため <body> がまだ無いこともあり、その場合は <html> の直下に置きます
     * （どちらも position: fixed なので、見た目は変わりません）。
     *
     * @param {HTMLElement} el
     * @returns {HTMLElement} 追加した要素
     */
    const mount = (el) => (document.body ?? document.documentElement).appendChild(el);

    /**
     * この拡張機能が作った要素か。
     *
     * @param {Node} node
     * @returns {boolean}
     */
    const isOwn = (node) => node.nodeType === 1 && OWN_CLASSES.some((name) => node.classList.contains(name));

    // ================================================================
    // トースト（エラー通知）
    // ================================================================

    /** トーストを消すタイマーの ID */
    let toastTimer;

    /**
     * 画面下にエラーメッセージを 3 秒だけ表示する。
     * 成功は左下のカウンターで分かるので、トーストはエラーのときだけ出します。
     *
     * @param {string} message
     * @returns {void}
     */
    const toast = (message) => {
        const el = document.querySelector(".smd-toast") ?? mount(document.createElement("div"));

        el.className = "smd-toast smd-toast-show";
        el.textContent = message; // textContent なので HTML として解釈されません

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove("smd-toast-show"), 3000);
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
     * 形式は background.js と共通です。
     *
     * @type {Map<string, number>}
     */
    const ledger = new Map();

    /** 総数を上位に詰めるための桁（2^32） */
    const PACK = 2 ** 32;

    /**
     * 記録の値からメディア総数を取り出す。
     *
     * @param {number} value
     * @returns {number}
     */
    const totalOf = (value) => Math.floor(value / PACK);

    /**
     * 記録の値から保存済みの番号のビットを取り出す（下位 32 ビット）。
     *
     * @param {number} value
     * @returns {number}
     */
    const maskOf = (value) => value >>> 0;

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
     * 下から total 個のビットだけを取り出すための数（total 以上の番号は無視するため）。
     *
     * @param {number} total
     * @returns {number}
     */
    const lowBits = (total) => (total >= 32 ? 0xffffffff : 2 ** total - 1);

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
        const mask = (maskOf(ledger.get(key) ?? 0) | (1 << index)) >>> 0;
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
        const total = totalOf(value) || count;
        const mask = (maskOf(value) & lowBits(total)) >>> 0;

        return { mask, total, saved: countBits(mask) };
    };

    // ================================================================
    // ダウンロード数カウンター（画面左下）
    // ================================================================

    /**
     * カウンターの要素と、数字を書き換える場所。初めて表示するときに作ります。
     * @type {{el: HTMLElement, nums: Record<string, HTMLElement>, failed: HTMLElement}|null}
     */
    let counter = null;

    /** 待ちが 0 になった後、表示を消すためのタイマー ID */
    let counterTimer;

    /**
     * カウンターの要素を作る。
     * 文言は翻訳ファイルから取り、textContent で入れるので HTML として解釈されません。
     * 数字を書き換える要素は覚えておき、更新のたびに探し直さないようにします。
     *
     * @returns {NonNullable<typeof counter>}
     */
    const createCounter = () => {
        const el = document.createElement("div");
        el.className = "smd-counter";

        const nums = {};
        const items = {};

        // 「DL待ち」「DL完了」「DL失敗」の 3 つを、ラベルと数字の組で並べます。
        for (const [name, label] of [["pending", "counterPending"], ["done", "counterDone"], ["failed", "counterFailed"]]) {
            const item = el.appendChild(document.createElement("span"));
            item.className = `smd-counter-item smd-counter-${name}`;

            const text = item.appendChild(document.createElement("span"));
            text.className = "smd-counter-label";
            text.textContent = SMD.t(label);

            nums[name] = item.appendChild(document.createElement("span"));
            nums[name].className = "smd-counter-num";
            items[name] = item;
        }

        mount(el);
        return { el, nums, failed: items.failed };
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

        if (!counter) {
            counter = createCounter();

            // レイアウトを一度確定させてからクラスを付けます。
            // 作成と同時に付けると、下からふわっと出る transition が効かないためです。
            void counter.el.offsetWidth;
        }

        counter.nums.pending.textContent = String(pending);
        counter.nums.done.textContent = String(done);
        counter.nums.failed.textContent = String(failed);
        counter.failed.hidden = failed === 0; // 失敗は 1 件以上のときだけ並べます

        counter.el.classList.add("smd-counter-show");
        if (pending <= 0) counterTimer = setTimeout(() => counter.el.classList.remove("smd-counter-show"), wait);
    };

    // ================================================================
    // 保存
    // ================================================================

    /**
     * 結果待ちのバッチ（ボタン 1 回分の保存）。
     * キーはバッチ ID、値は background から結果（smdBatch）が届いたときに呼ぶ関数です。
     * @type {Map<string, (result: {done: number, failed: number}) => void>}
     */
    const waiting = new Map();

    /**
     * 投稿情報から記録のキーを作る。
     *
     * @param {PostInfo} post
     * @returns {string} 例: "x:1234567890"
     */
    const keyOf = (post) => `${post.site}:${post.postId}`;

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
        const nothing = (key) => { if (!quiet) toast(SMD.t(key)); };

        // 1. 投稿情報（ユーザー名・投稿 ID・本文など）を読む
        const post = adapter.readPost(root);
        if (!post) return nothing("toastNoPost");

        // 2. メディア一覧と設定を、同時に取りに行く
        const [all, settings] = await Promise.all([
            adapter.getMedia(root, post).catch(() => []).then((list) => list ?? []),
            SMD.loadSettings(),
        ]);
        const now = new Date(); // 同じ投稿のファイルで {dl_datetime} がずれないよう、1 回だけ取ります

        // 3. 保存するものを選び、ファイル名を組み立てる。
        //    番号（index）は保存済みの記録に使うので、メディアと組にして持ち回ります。
        const items = [];
        all.forEach((media, index) => {
            if (!media || (only !== null && index !== only) || hasBit(skip, index)) return;
            items.push({
                url: media.url,
                filename: SMD.buildPath(settings, { post, item: { ...media, index: index + 1, total: all.length }, now }),
                index,
            });
        });

        if (items.length === 0) return nothing("toastNoMedia");

        // 4. background へ頼む。結果の受け取り口は、頼む前に用意しておきます
        //    （結果が返事より先に届いても取りこぼさないように）。
        const batch = crypto.randomUUID();
        const finished = new Promise((resolve) => waiting.set(batch, resolve));

        const reply = await request({
            type: "download",
            batch,
            items,
            post: keyOf(post),
            total: all.length,
            saveAs: settings.alwaysSaveAs,
            conflictAction: settings.conflictAction,
        });

        if (!reply) {
            waiting.delete(batch);
            return toast(SMD.t("toastCommError"));
        }

        // 5. 1 件も受け付けられなかったときは、結果を待たずにここで終わります。
        let result = { done: 0, failed: reply.rejected };
        if (reply.accepted > 0) result = await finished;
        else waiting.delete(batch);

        // 6. 失敗があったときだけ知らせます（成功の件数はカウンターで分かります）。
        const { done, failed } = result;
        if (failed) toast(done ? SMD.t("toastPartial", done, failed) : SMD.t("toastFailed", failed));
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
            const base = index < 0 ? SMD.t("btnMainTitle") : SMD.t("btnItemTitle", index + 1);
            title = done ? SMD.t("titleSaved", base) : base;
            titles.set(key, title);
        }
        return title;
    };

    /**
     * ダウンロードボタンを作る。アイコン・枚数バッジ・ツールチップは look() が付けます。
     * クリックは start() が document でまとめて受け取るので、ここではリスナーを付けません
     * （ボタンが何百個あっても、リスナーは 1 つで済みます）。
     *
     * @param {number|null} only - null ならメインボタン、数値ならその番号の個別ボタン
     * @returns {HTMLButtonElement}
     */
    const button = (only) => {
        const el = document.createElement("button");

        // type="button" を明示しないと、フォーム内に置かれたとき送信ボタン扱いになります。
        el.type = "button";
        el.className = only === null ? "smd-button" : "smd-item-button";

        // 個別ボタンには番号を覚えさせます（どれを保存するか、描き分け、番号が合っているかの確認に使います）。
        if (only !== null) el.dataset.smdIndex = String(only);

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
     * ボタンの見た目（アイコン・バッジ・ツールチップ・保存済みクラス）を整える。
     * 前回と同じ見た目なら DOM に触りません。書き換えると、ブラウザの描き直しと
     * MutationObserver の反応が起きるため、変わったときだけ書きます。
     *
     * @param {HTMLButtonElement} el
     * @param {boolean} done - 保存済みか
     * @param {string} badge - 枚数バッジの文字（空なら出さない）
     * @param {number} index - 個別ボタンの番号。メインボタンは -1
     * @returns {void}
     */
    const look = (el, done, badge, index) => {
        const sign = `${done ? 1 : 0}|${badge}`;
        if (el.dataset.smdLook === sign) return;

        el.dataset.smdLook = sign;
        el.classList.toggle("smd-done", done);
        el.title = titleOf(index, done);

        if (badge) {
            const count = document.createElement("span");
            count.className = "smd-count";
            count.textContent = badge;
            el.replaceChildren(iconOf(done), count);
        } else {
            el.replaceChildren(iconOf(done));
        }
    };

    /**
     * @typedef {object} Plan 投稿 1 件ぶんの「やること」（読む段階で作り、書く段階で実行する）
     * @property {Element} root - 投稿のコンテナ
     * @property {string|null} key - 記録のキー
     * @property {number} count - 画面上のメディア数
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

        const plan = { root, key: null, count: media.length, remove: existing, keep: [], bar: null, add: [], missing: false };
        if (media.length === 0) return plan; // メディアが無ければ、ボタンはすべて取り除く

        // メインボタン: 覚えているものが今もこの投稿にあれば、そのまま使います。
        const main = mainButtons.get(root);
        if (main?.isConnected && mine(main)) plan.keep.push(main);
        else plan.bar = adapter.actionBar(root);

        // 個別ボタン（メディアが 2 件以上のときだけ）: 覚えているものが今も同じ番号なら、そのまま使います。
        // 新しく付けるものだけ置き場所を探すので、大きさの読み取り（レイアウト計算）は最初の 1 回で済みます。
        if (media.length >= 2) {
            media.forEach((el, index) => {
                const btn = itemButtons.get(el);
                if (btn?.isConnected && mine(btn) && btn.dataset.smdIndex === String(index)) {
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
    const apply = ({ root, key, count, remove, keep, bar, add }) => {
        for (const el of remove) el.remove();
        if (count === 0) return;

        const buttons = [...keep];

        if (bar) {
            const el = button(null);
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
            if (el.classList.contains("smd-button")) {
                // 一部だけ保存済みなら「2/4」、それ以外は総数（1 件なら出さない）。
                const partial = saved > 0 && saved < total;
                const badge = total > 1 ? (partial ? `${saved}/${total}` : String(total)) : "";
                look(el, total > 0 && saved >= total, badge, -1);
            } else {
                const index = Number(el.dataset.smdIndex);
                look(el, hasBit(mask, index), "", index);
            }
        }
    };

    // ================================================================
    // いいね連動保存
    // ================================================================

    /**
     * いいねのクリックを見張り、設定がオンなら保存も行う。
     * 見るだけで、preventDefault も stopPropagation も呼びません（いいね自体には手を触れない）。
     *
     * @param {SiteAdapter} adapter
     * @returns {void}
     */
    const watchLikes = (adapter) => {
        if (!adapter.likeButton) return;

        // 設定は起動時に読み、変更されたら追いかけます。
        let enabled = false;
        SMD.loadSettings().then((s) => { enabled = s.likeDownload; });
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "sync" && changes.likeDownload) enabled = changes.likeDownload.newValue === true;
        });

        /**
         * いいねで保存を始めて、まだ終わっていない投稿のキー。
         * 終わる前に「取り消し → もう一度いいね」と操作されても、二重に始めないためのものです。
         * 終わったら（失敗しても）外すので、失敗した投稿はいいねを付け直せば、もう一度試せます。
         * 保存できた分は、保存済みの記録で見分けます。
         */
        const started = new Set();

        document.addEventListener("click", (e) => {
            // ページ上のすべてのクリックが通るので、いちばん軽い判定から順に行います。
            if (!enabled || !(e.target instanceof Element)) return;

            // 「いいねを取り消す」ボタンは別のセレクタなので、いいねを付けたときだけ一致します。
            const root = e.target.closest(adapter.likeButton)?.closest(adapter.postRoot);
            if (!root) return;

            // メディアの無い投稿は静かに見送ります。
            const count = adapter.mediaContainers(root).length;
            const id = count > 0 ? adapter.postId(root) : null;
            if (!id) return;

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
        // <html data-smd-site="x"> のような目印を付け、CSS でサイトごとのアクセント色を切り替えます。
        document.documentElement.dataset.smdSite = adapter.site;

        // ボタンのクリックを document でまとめて受け取ります。
        // キャプチャフェーズ（第 3 引数 true）の document は、ページ側のどの要素よりも先に受け取れるので、
        // SNS 側の処理（投稿を開く、画像を拡大する等）が動く前に止められます。
        // mousedown も止めるのは、押した瞬間に反応する処理があるためです。
        document.addEventListener("mousedown", (e) => {
            if (e.target instanceof Element && e.target.closest(BUTTONS)) e.stopPropagation();
        }, true);

        document.addEventListener("click", (e) => {
            const el = e.target instanceof Element ? e.target.closest(BUTTONS) : null;
            if (!el) return;

            e.preventDefault();
            e.stopImmediatePropagation();

            // 保存中は受け付けません。CSS の pointer-events: none はマウスにしか効かず、
            // キーボード（Enter / Space）での連打は止められないため、ここでも確かめます。
            const root = el.closest(adapter.postRoot);
            if (!root || el.classList.contains("smd-busy")) return;

            const only = el.classList.contains("smd-item-button") ? Number(el.dataset.smdIndex) : null;

            el.classList.add("smd-busy");
            save(adapter, root, only)
                .catch(() => toast(SMD.t("toastCommError")))
                .finally(() => el.classList.remove("smd-busy"));
        }, true);

        watchLikes(adapter);

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
                const tried = retries.get(plan.root) ?? 0;
                if (plan.missing && tried < RETRY_LIMIT) {
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

        /** ページ内の全投稿に印を付ける（起動時と、記録をまとめて受け取ったとき） */
        const markAll = () => {
            for (const root of document.querySelectorAll(adapter.postRoot)) mark(root);
        };

        /**
         * 追加・削除された要素のうち、ボタンに関係するもの（adapter.watch に当てはまる要素か、
         * それを含む要素）があるか。自前の要素と、文字だけの変化は関係ありません。
         * adapter.watch が無ければ、自前の要素以外は何でも関係ありとみなします。
         *
         * @param {NodeList} nodes
         * @returns {boolean}
         */
        const touches = (nodes) => {
            for (const node of nodes) {
                if (node.nodeType !== 1 || isOwn(node)) continue;
                if (!adapter.watch || node.matches(adapter.watch) || node.querySelector(adapter.watch)) return true;
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

                const saved = message.saved;
                if (typeof saved?.key === "string") {
                    remember(saved.key, saved.index, saved.total);

                    // その投稿を表示しているところだけ描き直します。
                    for (const root of document.querySelectorAll(adapter.postRoot)) {
                        if (rootKeys.get(root) === saved.key) mark(root);
                    }
                }
            }

            if (message?.type === "smdBatch") {
                waiting.get(message.batch)?.({ done: Number(message.done) || 0, failed: Number(message.failed) || 0 });
                waiting.delete(message.batch);
            }

            return false; // 返事はしません
        });

        // 開いた時点のカウンターと記録をもらいます。
        // 再読み込みしたり別のタブを開いたりしても、保存中の数と保存済みの見た目が引き継がれます。
        request({ type: "smdState" }).then((state) => {
            for (const [key, value] of Object.entries(state?.history ?? {})) {
                if (Number.isSafeInteger(value)) ledger.set(key, value);
            }
            showCounts(state?.counts);
            markAll();
        }).catch(() => {});

        // DOM の変化から、見直しが必要な投稿だけを拾います。
        //   - 投稿を含む要素が追加された → 中の投稿すべて
        //   - 投稿の中で、ボタンに関係する要素が増減した → その投稿
        //     （メディア・投稿へのリンク・操作バーなど。動画の再生時間の表示のような変化は見送ります）
        //   - 投稿の中の画像の src・動画の poster・リンクの href が変わった → その投稿
        //     （メディアとして数えられるようになる、または要素の使い回しで別の投稿を表示し始めたため）
        // 自分でボタンを付けたり描き直したりした変化も、見直しの対象にしません（無駄な繰り返しを防ぐ）。
        new MutationObserver((records) => {
            for (const record of records) {
                const target = record.target;
                if (target.nodeType !== 1 || isOwn(target)) continue;

                if (record.type === "childList") {
                    // 投稿そのものが追加された場合
                    for (const node of record.addedNodes) {
                        if (node.nodeType !== 1 || !node.firstElementChild || isOwn(node)) continue;
                        if (node.matches(adapter.postRoot)) mark(node);
                        else for (const root of node.querySelectorAll(adapter.postRoot)) mark(root);
                    }

                    // 投稿の中の変化。関係のある要素が増減したときだけ拾います。
                    // （メディアの中身の変化、たとえば動画プレイヤーの再生時間の表示は拾いません。
                    //   置き場所の大きさが後から決まる場合は、flush のやり直しで拾います）
                    const root = target.closest(adapter.postRoot);
                    if (!root || dirty.has(root)) continue;
                    if (touches(record.addedNodes) || touches(record.removedNodes)) mark(root);
                } else {
                    // 属性（src / poster / href）の変化
                    const root = target.closest(adapter.postRoot);
                    if (root) mark(root);
                }
            }
        }).observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src", "poster", "href"],
        });

        markAll();
        return { refresh: markAll };
    };

    return { start, request };
})();
