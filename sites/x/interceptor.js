// SPDX-License-Identifier: Apache-2.0 OR MIT
/**
 * sites/x/interceptor.js
 * ==================================================================
 * X（Twitter）の API レスポンスを覗いて、動画・画像の本当の URL を集めるスクリプト。
 *
 * X の動画プレイヤーは <video src="blob:..."> という形で、この blob: URL はページの中でしか
 * 通用せず、ダウンロードには使えません。そこで X 自身が受け取っている JSON から
 * 本物の .mp4 の URL を先に拾っておきます。
 *
 * manifest.json でこのファイルだけ "world": "MAIN"（ページと同じ JavaScript の世界）で動きます。
 * ページの fetch / XMLHttpRequest を包めるのはこの世界だけです。代わりに拡張機能の API は
 * 使えないので、結果は postMessage で content.js へ渡します。
 *
 * 【X の動作を遅くしないための工夫】
 * X は API の応答を大量に受け取るので、ここでの処理はすべて X の画面表示の上乗せになります。
 *   - メディアを含まない応答は、JSON として解析する前に、文字列の検索だけで見送る
 *   - 解析と走査は、ブラウザの手が空いたとき（requestIdleCallback）に回す
 *   - JSON を走査するときに、余計な配列を作らない
 * ==================================================================
 */

(() => {
    "use strict";

    /**
     * メディアを含む応答にだけ現れる文字列。
     * X の media エントリは、写真・動画・GIF のどれでも media_url_https を持っています。
     * これを含まない応答は、JSON として解析するまでもなく対象外です。
     */
    const MEDIA_HINT = '"media_url_https"';

    /**
     * 監視対象（X の API）の URL か。
     *
     * @param {string} url
     * @returns {boolean}
     */
    const isTarget = (url) => /\/(?:graphql|i\/api)\//.test(url);

    /**
     * 処理を、ブラウザの手が空いたときに回す。
     * 遅くとも 1 秒以内には実行されます（ユーザーが保存ボタンを押すまでには間に合います）。
     * 例外は握りつぶします（JSON でない応答などは、単に対象外です）。
     *
     * @param {() => void} task
     * @returns {void}
     */
    const later = (task) => {
        requestIdleCallback(() => {
            try {
                task();
            } catch {
                // 対象外の応答です。
            }
        }, { timeout: 1000 });
    };

    /**
     * X の media エントリ 1 件を、この拡張機能で使う形へ変換する。
     *
     * @param {object} m
     * @returns {{kind: string, url: string, ext: string}|null} 対象外なら null
     */
    const toMedia = (m) => {
        if (m?.type === "photo") {
            const base = /^(https:\/\/pbs\.twimg\.com\/media\/[^./?]+)(?:\.(\w+))?/.exec(m.media_url_https ?? "");
            if (!base) return null;

            // 拡張子は URL の末尾か ?format= に入っています。name=orig で原寸を取得できます。
            const ext = (base[2] ?? /[?&]format=(\w+)/.exec(m.media_url_https)?.[1] ?? "jpg").toLowerCase();
            return { kind: "photo", url: `${base[1]}?format=${ext}&name=orig`, ext };
        }

        if (m?.type !== "video" && m?.type !== "animated_gif") return null;

        // 動画は複数の画質（variants）があるので、mp4 の中からビットレートが最も高いものを選びます。
        let best = null;
        for (const v of m.video_info?.variants ?? []) {
            if (v?.content_type !== "video/mp4" || typeof v.url !== "string") continue;
            if (!best || (v.bitrate ?? 0) > (best.bitrate ?? 0)) best = v;
        }

        return best ? { kind: m.type, url: best.url, ext: "mp4" } : null;
    };

    /**
     * JSON 全体を再帰的に調べ、投稿 ID とメディア一覧の対応を集める。
     * X のレスポンスは構造が深く変わりやすいので、決まった場所ではなく全体から拾います。
     *
     * 子を調べる前に「オブジェクトか」を確かめて、文字列や数値のために関数を呼ばないようにしています。
     * また Object.values() は呼ぶたびに配列を作るので、for...in で直接たどります。
     *
     * @param {object} node - オブジェクトまたは配列
     * @param {Record<string, (object|null)[]>} found - 結果を溜める入れ物
     * @returns {void}
     */
    const harvest = (node, found) => {
        if (Array.isArray(node)) {
            for (const child of node) {
                if (child !== null && typeof child === "object") harvest(child, found);
            }
            return;
        }

        // 投稿 ID は rest_id か id_str に、メディアは legacy の下にあることが多いです。
        const id = node.rest_id ?? node.id_str;
        const source = node.legacy ?? node;
        const raw = (source.extended_entities ?? source.entities)?.media; // extended_entities のほうが動画情報を含む

        if (typeof id === "string" && Array.isArray(raw)) {
            // 変換できなかったものも null のまま残し、画面上の並びと番号をそろえます。
            const list = raw.map(toMedia);
            if (list.some(Boolean)) found[id] = list;

            // 動画はメディア ID でも引けるようにします。サムネイル URL に同じ ID が入っているので、
            // 投稿 ID が分からない場面でも content.js が動画を特定できます。
            raw.forEach((m, i) => {
                if (list[i] && list[i].kind !== "photo" && typeof m.id_str === "string") found[`v${m.id_str}`] = [list[i]];
            });
        }

        for (const key in node) {
            const child = node[key];
            if (child !== null && typeof child === "object") harvest(child, found);
        }
    };

    /**
     * 解析済みの JSON を調べ、見つかったものを content.js へ送る。
     *
     * @param {unknown} data
     * @returns {void}
     */
    const scan = (data) => {
        if (data === null || typeof data !== "object") return;

        const found = {};
        harvest(data, found);
        for (const _ in found) {
            postMessage({ channel: "smd-cache", entries: found }, location.origin);
            return; // 1 件でもあれば送る（for...in は「空かどうか」を配列を作らずに確かめるため）
        }
    };

    /**
     * 応答の本文（文字列）を調べる。メディアを含まないものは、解析せずに見送ります。
     *
     * @param {string} text
     * @returns {void}
     */
    const scanText = (text) => {
        if (text.includes(MEDIA_HINT)) scan(JSON.parse(text));
    };

    // ================================================================
    // fetch と XMLHttpRequest を包み直す（元の動作は変えず、結果を覗くだけ）
    // ================================================================

    const originalFetch = window.fetch;

    window.fetch = function (...args) {
        const promise = originalFetch.apply(this, args);

        const [input] = args;
        if (isTarget(input instanceof Request ? input.url : String(input))) {
            // 本文は 1 回しか読めないので、clone() した複製のほうを文字列で読みます。
            // 解析するかどうかは、文字列を見てから決めます。
            promise
                .then((res) => res.ok && res.clone().text().then((text) => later(() => scanText(text))))
                .catch(() => {});
        }
        return promise;
    };

    const { open, send } = XMLHttpRequest.prototype;
    const watched = new WeakSet();

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        // 同じ XHR が別の URL で使い回されることもあるので、open のたびに印を付け直します。
        if (isTarget(String(url))) watched.add(this);
        else watched.delete(this);
        return open.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        if (watched.has(this)) {
            this.addEventListener("load", () => {
                try {
                    if (this.responseType === "json") {
                        // ブラウザが解析済みのオブジェクトです。X が後から手を加えることもあるので、
                        // 後回しにせず、この場で調べます（解析し直す必要が無いので軽く済みます）。
                        scan(this.response);
                    } else if (this.responseType === "" || this.responseType === "text") {
                        // 文字列は後から変わらないので、受け取っておいて手が空いたときに調べます。
                        const text = this.responseText;
                        later(() => scanText(text));
                    }
                } catch {
                    // 対象外の応答です。
                }
            }, { once: true }); // 同じ XHR が何度も send されても、リスナーが積み重ならないように
        }
        return send.apply(this, args);
    };
})();
