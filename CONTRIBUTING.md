# Contributing to SNS Media Downloader

🌐 English | [日本語](#日本語)

Thanks for the interest. This is a one-person project, so reading this first will save us both
some time.

Looking for how to *use* the extension rather than change it? That's the [README](README.md),
and there's a filename-template cookbook in [TIPS.md](TIPS.md).

## Licensing of contributions

**Unless you say otherwise, anything you submit for inclusion here — as defined under Apache-2.0 —
gets dual licensed as Apache-2.0 OR MIT, no extra terms attached.**

Opening a PR means you're confirming you have the right to submit that code under those terms.
No CLA to sign.

Every new source file needs an SPDX header on line one:

| File type | Header |
| :--- | :--- |
| `.js` | `// SPDX-License-Identifier: Apache-2.0 OR MIT` |
| `.css` | `/* SPDX-License-Identifier: Apache-2.0 OR MIT */` |
| `.html` | `<!-- SPDX-License-Identifier: Apache-2.0 OR MIT -->` |

JSON files (`manifest.json`, `_locales/*/messages.json`) don't need one — a comment would break them.

## Ground rules

These aren't preferences, they're hard constraints. A PR that breaks one of these can't be merged
as-is.

* **No dependencies, no build step.** The repo *is* the extension — clone it and load it unpacked,
  that's it. No npm, no bundler, no transpiler.
* **No developer-owned server, ever.** No analytics, no telemetry, no error reporting, no
  "anonymous usage statistics". [PRIVACY.md](PRIVACY.md) promises this and the promise is the point.
* **Network requests only to the endpoints already documented** — `public.api.bsky.app`,
  `plc.directory`, and the author's PDS, all of them triggered by an explicit save. Anything new
  needs an issue first, and needs to be added to PRIVACY.md in the same PR.
* **No new permissions** beyond `downloads`, `storage` and `alarms` without discussing it in an issue first.
  Widening `host_permissions` counts.
* **Manifest V3, latest Chrome and latest Firefox only.** No compatibility code for older versions
  or other browsers — use current APIs directly (`chrome.*`, not `browser ?? chrome`). The Chrome
  floor (`minimum_chrome_version`, now 126 because of `URL.parse`) tracks the newest API the code
  uses: raise it when you start using something newer. Firefox's `strict_min_version` stays at 140
  because of `data_collection_permissions`.
* **Assume the background script can be stopped at any moment.** Keep anything that must survive in
  `storage.session`, drive work from events and alarms, and never keep a message response waiting
  for a download to finish — Chrome stops a service worker whose single event runs past five
  minutes, and Firefox stops an event page 30 seconds after the last incoming event.
* **Never widen what gets downloaded.** URLs handed to `chrome.downloads` must be `https://` on X's
  media hosts or Bluesky's `getBlob`, and must come from the post the user clicked. The X message
  receiver and the download handler validate this independently — keep both.
* **Post media only.** Quote posts, link cards, avatars, external GIF embeds and the lightbox stay
  untouched.

## Code style

The comments in this project are unusually thorough, in Japanese, and aimed at someone who is
still learning JavaScript — they explain what `??` does, why `res.clone()` is necessary, what a
capture-phase listener is. That's deliberate, not an accident of one file. Match it. A PR whose
code is fine but whose comments are terse will get comments asked for in review.

Otherwise: plain modern JavaScript, no framework, no clever abstractions for their own sake,
JSDoc on exported functions.

## Before writing code

Open an issue first for anything beyond a typo or an obvious bug fix — especially new settings,
new placeholders, new sites, or anything touching permissions. Agreeing on the shape of something
before it's written beats rejecting a finished PR.

Selector fixes are the exception: if X or Bluesky changed their DOM and a selector needs updating,
just send it.

## Development setup

Nothing to install.

* **Chromium:** `chrome://extensions` → Developer mode → **Load unpacked** → pick the repo folder.
  Hit **Reload** after every edit.
* **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick
  `manifest.json`.

Three consoles matter, and they're different consoles:

| What you're debugging | Where to look |
| :--- | :--- |
| Adapters, `shared/core.js`, toasts, the counter | The **page's** console on x.com / bsky.app |
| `sites/x/interceptor.js` | Also the page's console — but it runs in the MAIN world and shares globals with X itself |
| `background.js`, the saved-media record | The service worker's console, from the extensions page — `chrome.storage.session.get()` shows the record |

The service worker stops when idle and restarts on the next message, so its cache empties on its
own. That's expected, not a bug.

### Which manifest is which

`manifest-chrome.json` is the source of truth; `manifest.json` is a copy of it, and is what
browsers actually load. Edit the former and copy it over the latter — **never the other way
round.** After a Firefox test session `manifest.json` holds the *Firefox* content, so it can't be
trusted as the original. `git checkout -- manifest.json` puts it back.

## Adding a site

Write one adapter exposing `site` / `postRoot` / `mediaContainers()` / `readPost()` / `getMedia()` /
`actionBar()`, and call `SMDCore.start()` with it. Then:

* add the content-script entry (and any `host_permissions`) to `manifest.json`,
* add the site to the `SITE` map in `shared/template.js` so `{site}` renders as something short,
* add an accent-colour block keyed on `[data-smd-site="…"]` in `content.css`.

`shared/core.js` shouldn't need to change. If it does, that's worth discussing — it means the
adapter contract is missing something, and the fix probably belongs in the contract rather than
in a special case.

`getMedia()` may fill in fields on the `post` object it's given; the Bluesky adapter uses this to
backfill text and timestamp from the API. Don't overwrite good values with empty ones.

## Adding a placeholder

A placeholder is not one change, it's five. See the table below. The value must be a string, and
it must be safe to interpolate into a filename — `valueOf()` strips forbidden characters, but a
value that is *always* empty just produces confusing conditional blocks.

## Adding or fixing a translation

Start from `_locales/en/messages.json`. Translate only the `message` values, leave the keys and
any `$1` placeholders alone. All nine locales need to carry the same key set.

Placeholder names themselves (`{user}`, `{ext}` …) are **not** translated. They're syntax.

## Things that have to change together

Some facts live in more than one file. Change only one and the project starts contradicting itself.

| If you change… | Also update… |
| :--- | :--- |
| A template placeholder | `shared/template.js` (`buildVars()`) · `popup.js` (`TOKENS`) · `_locales/*/messages.json`, all nine · the placeholder tables in `README.md` / `README.ja.md` · `TIPS.md` |
| A setting, or its default | `shared/template.js` (`DEFAULTS`) · the row markup in `popup.html` · `popup.js` (`FIELDS`) · `_locales/*/messages.json`, all nine · the settings tables in `README.md` / `README.ja.md` |
| A UI label or a toast | `_locales/*/messages.json`, all nine — the English file is the source of truth for the key set |
| A site adapter's selectors | Nothing else, but say in the PR which page states you tested (timeline, thread, permalink, quote post) |
| Adding a site | `manifest.json` · `SITE` in `shared/template.js` · `content.css` accent block · README (en/ja) · `.github/ISSUE_TEMPLATE/bug_report.yml` (the site dropdown) |
| Anything in the manifest | `manifest-chrome.json` · `manifest.json` (copy it over) · `manifest-firefox.json` — the three differ in exactly three keys, and nothing else should ever diverge |
| What gets stored, which permissions are used, or which hosts are contacted | `PRIVACY.md` — the body **and** the "Last updated" date, in the same commit · the privacy sections of both READMEs |
| The selectors an adapter's `mediaContainers()`, `postId()` or `actionBar()` rely on | That adapter's `watch` selector too — only changes matching it make the buttons look again, so a missing entry means buttons that don't appear or don't update |
| What `getMedia()` returns | Keep it in the same order as `mediaContainers()`, with `null` for unknown items — item buttons, the saved-media record and `{n}` all rely on the position |
| The messages between the background and the tabs (`download`, `smdState`, `smdUpdate`, `smdBatch`) | `background.js` (`HANDLERS`, `broadcast()`) · `shared/core.js` (`save()` and the `onMessage` listener in `start()`) — both ends validate what they receive, keep it that way |
| The saved-media record's shape, or when it's cleared | `background.js` · `shared/core.js` · `PRIVACY.md` §1.2 and §5 (en/ja) · the saved-state sections of both READMEs |

## Pull requests

* One logical change per PR.
* Add an entry under `## [未リリース]` in `CHANGELOG.md`, using the existing headings
  (`追加` / `変更` / `非推奨` / `削除` / `修正` / `セキュリティ`). English is fine for the entries.
* Say which browsers and which sites you actually tested on, and in which page states.
  "Chrome, X timeline and thread only" is a fine answer — just say so.
* For anything touching filenames, say what template you tested with.

## Security

Don't open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md) for the private
reporting process.

---

<a name="日本語"></a>

# 日本語

興味を持ってもらえて嬉しいです。個人でひとりで回している小さなプロジェクトなので、
お互い時間を無駄にしないためにも、まずこれを読んでおいてください。

拡張機能を「改造する」ではなく「使う」ための情報をお探しなら、[README](README.ja.md) と、
ファイル名テンプレートの実践集である [TIPS.md](TIPS.md) のほうです。

## 貢献のライセンス

**あなたが明示的に別段の指定をしない限り、本作品への取り込みを目的として意図的に提出された
いかなる貢献（Contribution）も、Apache-2.0 ライセンスでの定義に従い、追加の条項や条件なしに
Apache-2.0 OR MIT のデュアルライセンスが適用されるものとします。**

プルリクエストを送った時点で、そのコードを上記の条件で提出する権利を持っていることを
表明したとみなします。CLA への署名は不要です。

新しいソースファイルには、1 行目に SPDX 識別子を入れてください。

| 種類 | 記載する行 |
| :--- | :--- |
| `.js` | `// SPDX-License-Identifier: Apache-2.0 OR MIT` |
| `.css` | `/* SPDX-License-Identifier: Apache-2.0 OR MIT */` |
| `.html` | `<!-- SPDX-License-Identifier: Apache-2.0 OR MIT -->` |

JSON ファイル（`manifest.json`、`_locales/*/messages.json`）は対象外です。
コメントを入れると JSON として壊れるので。

## 守ってほしい前提

これは好みの話じゃなく制約です。ここに引っかかるプルリクエストは、そのままではマージできません。

* **依存もビルド工程もなし。** リポジトリがそのまま拡張機能です。clone したものをそのまま
  「パッケージ化されていない拡張機能を読み込む」で使えます。npm・バンドラ・トランスパイラは入れません。
* **開発者のサーバーは作りません。** 解析、テレメトリ、エラー収集、「匿名の利用統計」、どれも入れません。
  [PRIVACY.md](PRIVACY.md) でそう約束しており、その約束自体がこの拡張機能の価値です。
* **通信先は文書化済みのものだけ。** `public.api.bsky.app`、`plc.directory`、投稿者の PDS の 3 つで、
  いずれもユーザーが保存ボタンを押したときにだけ発生します。追加が必要なら先に Issue を立て、
  同じプルリクエストで PRIVACY.md も更新してください。
* **`downloads`・`storage`・`alarms` 以外の権限は追加しません。** `host_permissions` を広げるのも同じ扱いです。
  必要になったら、まず Issue で相談してください。
* **Manifest V3、最新の Chrome と最新の Firefox のみ。** 古いバージョンや他のブラウザ向けの
  互換処理は書きません。API はそのまま使います（`browser ?? chrome` ではなく `chrome.*`）。
  Chrome の下限（`minimum_chrome_version`。今は `URL.parse` のため 126）は、コードが使う
  最も新しい API に合わせます。より新しいものを使い始めたら引き上げてください。
  Firefox の `strict_min_version` は `data_collection_permissions` のため 140 のままにします。
* **バックグラウンドはいつ止められてもおかしくない前提で書きます。** 残す必要のある状態は
  `storage.session` に置き、処理はイベントとアラームで進め、ダウンロードの完了までメッセージの返事を
  待たせないでください。Chrome は 1 つのイベントの処理が 5 分を超えた Service Worker を止め、
  Firefox は最後にイベントが届いてから 30 秒でイベントページを止めます。
* **ダウンロードする対象を広げないこと。** `chrome.downloads` へ渡す URL は、X のメディア配信ホストか
  Bluesky の `getBlob` の `https://` で、かつユーザーがクリックした投稿由来のものに限ります。メッセージ受信時とダウンロード直前の
  2 か所で独立に検証しています。両方とも残してください。
* **投稿メディアのみが対象。** 引用投稿・リンクカード・アイコン画像・外部 GIF 埋め込み・
  ライトボックスには触りません。

## コードの書き方

このプロジェクトのコメントは、日本語で、かなり丁寧で、JavaScript をまだ学んでいる人に向けて
書かれています。`??` が何をするか、なぜ `res.clone()` が必要か、キャプチャフェーズとは何か。
これは 1 ファイルの偶然ではなく、全体の方針です。合わせてください。
コードは問題ないがコメントが素っ気ない、という場合はレビューで追記をお願いすることになります。

それ以外は、素の現代的な JavaScript、フレームワークなし、抽象化のための抽象化もなし、
公開する関数には JSDoc を付ける、という方針です。

## コードを書く前に

誤字修正や明らかなバグ修正以外は、先に Issue を立ててください。特に設定項目の追加、
変数の追加、対応サイトの追加、権限に関わる変更は要相談です。書く前に方向性をすり合わせたほうが、
出来上がったプルリクエストを却下するよりずっと楽なので。

セレクタの修正だけは例外です。X や Bluesky の DOM が変わって動かなくなった場合は、
そのまま送ってもらって構いません。

## 開発環境

インストールするものはありません。

* **Chromium 系:** `chrome://extensions` → デベロッパーモード →
  **パッケージ化されていない拡張機能を読み込む** → リポジトリのフォルダを選択。
  編集のたびに **更新（リロード）** を押してください。
* **Firefox:** `about:debugging#/runtime/this-firefox` → **一時的なアドオンを読み込む…** →
  `manifest.json` を選択

コンソールは 3 つあり、それぞれ別物です。

| デバッグ対象 | 見る場所 |
| :--- | :--- |
| アダプタ、`shared/core.js`、トースト、カウンター | x.com / bsky.app の**ページ側**コンソール |
| `sites/x/interceptor.js` | 同じくページ側。ただし MAIN world で動き、X 本体とグローバルを共有します |
| `background.js`、保存済みの記録 | 拡張機能ページから開くサービスワーカーのコンソール。記録は `chrome.storage.session.get()` で見られます |

サービスワーカーはアイドル状態で停止し、次のメッセージで再起動します。
そのときキャッシュが空になるのは正常な挙動で、不具合ではありません。

### どのマニフェストが正か

正は `manifest-chrome.json` です。`manifest.json` はそのコピーで、ブラウザが実際に読むのは
こちらです。編集は前者に対して行い、保存したら後者へコピーしてください。**逆はやらないこと。**
Firefox で動作確認したあとの `manifest.json` には *Firefox 用の内容* が入っているため、
原本として信用できません。戻すときは `git checkout -- manifest.json` です。

## サイトを追加する

`site` / `postRoot` / `mediaContainers()` / `readPost()` / `getMedia()` / `actionBar()` を持つ
アダプタを 1 つ書き、`SMDCore.start()` に渡してください。あわせて次の 3 つを行います。

いいね連動保存に対応させる場合は、任意キー `likeButton` も足してください。
「まだいいねしていない」状態のボタンだけに一致するセレクタである必要があります
（X の `like` / `unlike`、Bluesky の `likeBtn` / `unlikeBtn` のように、
状態で別のセレクタになっているのが普通です）。省略した場合、
そのサイトではいいね連動保存だけが無効になり、他の動作には影響しません。

* `manifest.json` にコンテンツスクリプトの項目（必要なら `host_permissions` も）を追加する
* `shared/template.js` の `SITE` 表に追記し、`{site}` が短い文字列になるようにする
* `content.css` に `[data-smd-site="…"]` を鍵とするアクセント色のブロックを足す

`shared/core.js` は触らずに済むはずです。触る必要が出た場合は相談してください。
それはアダプタの契約に足りないものがある、という意味であり、
個別対応ではなく契約側を直すべき可能性が高いためです。

`getMedia()` は受け取った `post` オブジェクトに情報を書き足して構いません。
Bluesky のアダプタは、これを使って本文と投稿日時を API の結果で補っています。
ただし空の値で良い値を上書きしないよう注意してください。

## 変数（プレースホルダ）を追加する

変数の追加は 1 か所の変更ではなく 5 か所の変更です。下の表を見てください。
値は文字列でなければならず、ファイル名に埋め込んで安全である必要があります
（`valueOf()` が禁止文字を除去しますが、**常に空になる**変数は条件ブロックを混乱させるだけです）。

## 翻訳の追加・修正

起点は `_locales/en/messages.json` です。`message` の値だけ訳して、キーと `$1` プレースホルダは
そのままにしてください。9 言語すべて、キーの集合を揃える必要があります。

変数名そのもの（`{user}`、`{ext}` など）は**翻訳しません**。あれは構文です。

## まとめて直すべき箇所

同じ事実が複数のファイルにまたがって書かれている箇所があります。
片方だけ直すと、プロジェクトの中で話が食い違ってしまいます。

| 変更する対象 | 一緒に更新するもの |
| :--- | :--- |
| テンプレート変数 | `shared/template.js` の `buildVars()` ・ `popup.js` の `TOKENS` ・ `_locales/*/messages.json` 9 言語 ・ README 英日の変数表 ・ `TIPS.md` |
| 設定項目、その既定値 | `shared/template.js` の `DEFAULTS` ・ `popup.html` の行の記述 ・ `popup.js` の `FIELDS` ・ `_locales/*/messages.json` 9 言語 ・ README 英日の設定表 ・ `PRIVACY.md` §1.1 の保存内容の表（英日）|
| UI の文言、トーストの文言 | `_locales/*/messages.json` 9 言語（キーの集合は英語版が基準） |
| アダプタのセレクタ | 他は不要ですが、どのページ状態で確認したかをプルリクエストに書いてください（タイムライン・スレッド・パーマリンク・引用投稿） |
| サイトの追加 | `manifest.json` ・ `shared/template.js` の `SITE` ・ `content.css` のアクセント色 ・ README 英日 ・ `.github/ISSUE_TEMPLATE/bug_report.yml` のサイト選択肢 |
| マニフェストの内容 | `manifest-chrome.json` ・ `manifest.json`（コピーする） ・ `manifest-firefox.json` — 3 つの差分は 3 キーだけで、それ以外が食い違ってはいけません |
| 保存内容、使用する権限、通信先 | `PRIVACY.md` の本文**および**「最終更新」日を、同じコミットで ・ README 英日のプライバシー節 |
| アダプタの `mediaContainers()`・`postId()`・`actionBar()` が頼るセレクタ | そのアダプタの `watch` も合わせて直す — これに当てはまる変化でしかボタンを見直さないので、漏れがあるとボタンが出ない・更新されない原因になります |
| `getMedia()` の戻り値 | `mediaContainers()` と同じ並びを保ち、分からないものは `null` にする — 個別ボタン・保存済みの記録・`{n}` がすべて位置に依存しています |
| バックグラウンドとタブの間のメッセージ（`download`・`smdState`・`smdUpdate`・`smdBatch`） | `background.js` の `HANDLERS` と `broadcast()` ・ `shared/core.js` の `save()` と `start()` 内の `onMessage` リスナー — 受け取った値はどちらの側でも検証しています。その形を崩さないでください |
| 保存済みの記録の形式、消えるタイミング | `background.js` ・ `shared/core.js` ・ `PRIVACY.md` §1.2 と §5（英日） ・ README 英日の保存済みの表示の節 |

## プルリクエスト

* 1 つのプルリクエストにつき、意味のある変更は 1 つに。
* `CHANGELOG.md` の `## [未リリース]` 配下に、既存の見出し
  （`追加` / `変更` / `非推奨` / `削除` / `修正` / `セキュリティ`）を使って追記してください。
  本文は英語でも構いません。
* どのブラウザ・どのサイト・どのページ状態で実際に動かして確認したかを書いてください。
  「Chrome の X で、タイムラインとスレッドだけ」でも問題ありません、そう書いてあれば十分です。
* ファイル名まわりの変更では、どのテンプレートで確認したかも書いてください。

## セキュリティ

脆弱性は公開 Issue で報告しないでください。非公開の報告手順は [SECURITY.md](SECURITY.md) にあります。
