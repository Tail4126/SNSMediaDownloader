# Privacy Policy / プライバシーポリシー

**Last updated / 最終更新:** 2026-08-26

> **Note on Language / 言語に関する注記**
> このポリシーは英語で書いたものが正式版で、日本語訳は参考用です。両者の内容にズレがあった場合は英語版を優先します。
> This policy is written in English; the Japanese version is provided for convenience. If the two disagree, the English version wins.

---

## At a glance / 概要

| Question / 質問 | Answer / 回答 |
| :--- | :--- |
| Does it collect personal data? / 個人情報を収集しますか？ | **No / いいえ** |
| Is there a developer-owned server? / 開発者のサーバーはありますか？ | **No — none exists / ありません** |
| Does it make network requests? / 外部と通信しますか？ | Yes, but only when you press save, and only to Bluesky's public API and the author's PDS / はい。ただし保存ボタンを押したときだけ、Bluesky の公開 API と投稿者の PDS に対してのみ（§3） |
| Does it use analytics or telemetry? / 解析・テレメトリはありますか？ | **No / ありません** |
| Does it record what you view or save? / 閲覧・保存の履歴を記録しますか？ | **No / いいえ** |
| Where are settings stored? / 設定の保存先は？ | `storage.sync` — your browser profile / ブラウザのプロファイル内 |
| Are settings synced across devices? / 端末間で同期されますか？ | **Yes**, via your browser account / **されます**（ブラウザのアカウント経由） |
| Does it read the pages you visit? / 見ているページを読み取りますか？ | Only x.com / twitter.com / bsky.app, and only the parts described in §2 / x.com・twitter.com・bsky.app のみ、かつ §2 に書いた範囲だけ |
| Does it load remote code? / 外部コードを読み込みますか？ | **No / いいえ** |
| Can I delete everything? / 完全に削除できますか？ | Yes — uninstalling removes all data / はい。アンインストールで全て消えます |

---

## English Version (Official / 正本)

### Overview

This policy explains what data the **SNS Media Downloader** browser extension (the "Extension")
touches and how.

The Extension has no back end. There is no developer-owned server, no account, no API key, and no
component that receives anything from you. Everything it does happens on your device, and the only
code it runs is what's bundled inside the extension itself.

It is not, however, a zero-network extension, and it would be dishonest to describe it that way.
Downloading a file means fetching it, and on Bluesky the metadata that makes a good filename has
to be asked for. §3 sets out exactly which hosts are contacted, when, and why.

---

### 1. What gets stored, and what doesn't

#### 1.1 Saved to storage

Three settings, and nothing else:

| Item | Example | Why |
| :--- | :--- | :--- |
| Filename template | `{site}/{user}-{id}-{datetime}-{kind}{n}.{ext}` | So your files are named the way you asked |
| Conflict behaviour | `uniquify` / `overwrite` / `prompt` | Passed to the browser's download API |
| Always show the save dialog | `true` / `false` | Passed to the browser's download API |

These live in `chrome.storage.sync` / `browser.storage.sync`, which means **your browser syncs
them to your other devices** if you're signed in to it. That's a deliberate convenience — a
filename template you tuned on one machine is worth having on the next. It also means those three
values pass through your browser vendor's sync service (Google or Mozilla), under their privacy
policy, exactly as your bookmarks do.

Nothing else is stored. No history of what you downloaded, no list of posts, no accounts you
viewed, no URLs, no timestamps of your activity.

#### 1.2 Only ever in memory (never saved)

| Item | Why |
| :--- | :--- |
| Media URLs harvested from X's API responses | So a video's real URL is known when you press save |
| Bluesky post records and resolved PDS addresses | So the filename can include the post's text, date and resolution |
| The post's author, ID, text and timestamp | To fill in the filename template |

The X cache holds at most 2000 entries and is discarded oldest-first; it lives in the page and
disappears when you close or reload the tab. The Bluesky cache holds at most 300 entries and lives
in the service worker, which the browser stops whenever it's idle — so it often empties on its own
within a minute. Neither is ever written to disk or sent anywhere.

#### 1.3 The files you download

They go where your browser puts downloads, under the name your template produced. The Extension
hands the URL and the filename to the browser's download API, then follows that one download until
it settles, so a failed transfer can be retried and a transfer that fails for good can be cleared
away instead of leaving a broken file behind. It looks the download up **by the numeric id it was
just given**, and never lists, reads, or touches any other download. Beyond starting, following and
cleaning up the downloads you asked for, the `downloads` permission isn't used for anything — and
nothing about those downloads is stored or sent anywhere.

---

### 2. Permissions and site access

Two permissions:

| Permission | Why |
| :--- | :--- |
| **`downloads`** | To start the downloads you asked for, follow each one to completion, and retry or clear away the ones that fail. |
| **`storage`** | To save and load the three settings above. |

Content scripts run on these sites, and nowhere else:

```
https://x.com/*        https://twitter.com/*        https://bsky.app/*
```

On those pages the Extension looks at the post structure — the media elements, the action bar, the
author link, the post text and timestamp — in order to place a button and build a filename. It does
not touch form inputs, cookies, credentials, direct messages, or account settings, and it has no
interest in pages that aren't posts.

**One point deserves to be spelled out.** On X, `sites/x/interceptor.js` runs in the page's own
JavaScript world and wraps `fetch` and `XMLHttpRequest`, so it observes the *bodies* of responses
from `/graphql/` and `/i/api/` that the page requests. This is the only way to learn a video's real
URL, because the player is handed a `blob:` reference that means nothing outside the page.

What it does with those responses is narrow, and it is worth being precise: it walks the JSON,
keeps only `rest_id` / `id_str` values that sit next to a media array, converts those media entries
to URLs, and drops everything else on the floor. Post text, follower counts, timelines, anything
in a DM endpoint — none of it is read out, stored, or transmitted. The result never leaves the tab
except as a `postMessage` to this Extension's own content script, sent with `location.origin` as
the target so no other origin can receive it. Nothing is written to disk.

`host_permissions` covers `x.com`, `twitter.com`, `bsky.app`, `public.api.bsky.app` and
`plc.directory` — and nothing else. That narrowness is why a Bluesky account self-hosting under a
`did:web` identity can't be resolved: fetching its DID document would require read access to
arbitrary domains, and that trade isn't worth making by default.

---

### 3. Network requests

The Extension itself makes requests to exactly three kinds of host, all of them Bluesky
infrastructure, and all of them **only after you press a save button**:

| Host | When | What is sent | Why |
| :--- | :--- | :--- | :--- |
| `public.api.bsky.app` | Saving a Bluesky post | The post's AT-URI (its author DID and post ID), or a handle to resolve | To fetch the post's text, timestamp, MIME type and aspect ratio |
| `plc.directory` | First save for a given account | The author's DID | To find which server that account's files live on |
| The author's PDS (usually `bsky.social`) | Saving a Bluesky file | The author's DID and the file's CID | To fetch the file itself |

All three are public, unauthenticated endpoints. No credentials, no cookies of yours, no
identifier of any kind, and nothing about you is attached — the requests say only "which post is
this" and "give me this file", and would look identical coming from anyone.

The download of the file itself is performed by your browser's download manager against the media
host (`pbs.twimg.com`, `video.twimg.com`, or the PDS), exactly as if you had opened that URL.

**On X the Extension makes no requests of its own at all.** It only reads responses the page had
already received for its own reasons.

Beyond that:

* **No developer server** — there isn't one to contact.
* **No analytics, telemetry, crash reporting, or usage statistics** — of any kind, anonymous or not.
* **No remote code** — everything that runs ships inside the package. Nothing is downloaded or
  evaluated at runtime.
* **No identifiers, no fingerprinting, no tracking cookies, no ads.**

---

### 4. Third parties

There's nothing to share, sell, or hand over, because nothing is collected in the first place —
including in a business transfer scenario.

The Extension isn't acting as a data processor for X or Bluesky. Using those services is still
governed by their own privacy policies, as is your browser vendor's handling of synced settings
(§1.1).

---

### 5. Keeping and deleting data

Your three settings stay in your browser profile until you remove them. You can:

* hit **Restore defaults** in the settings screen, or
* uninstall the Extension, which removes its stored settings along with it.

If you had sync enabled, removing the extension on one signed-in device propagates in the normal
way your browser handles extension data.

Downloaded files are yours and are untouched by any of this — deleting the Extension doesn't
delete them.

Since no copy of anything exists anywhere else, there's no separate deletion request to make.

---

### 6. Children's privacy

Not directed at children, and no personal data is collected from anyone regardless of age.

---

### 7. Changes to this policy

This may get updated as the Extension changes. The "Last updated" date above will move accordingly,
and anything significant also gets a note in [CHANGELOG.md](CHANGELOG.md). The current version
always lives in `PRIVACY.md` in the source repo.

---

### 8. Contact

Questions, privacy concerns, bug reports — open a GitHub issue.

---
---

## 日本語版 (Japanese / 参考訳)

### 概要

このポリシーでは、ブラウザ拡張機能「**SNS Media Downloader**」（以下「本拡張機能」）が
どんなデータを扱うのか、扱わないのかを説明します。

本拡張機能にはバックエンドがありません。開発者のサーバーも、アカウントも、API キーも、
あなたから何かを受け取る仕組みも存在しません。動作はすべて端末内で完結し、
実行されるのは拡張機能に同梱されたコードだけです。

ただし「通信を一切行わない拡張機能」ではありませんし、そう説明するのは不誠実です。
ファイルをダウンロードすることは、そのファイルを取得することそのものですし、
Bluesky では、まともなファイル名を作るためのメタ情報を問い合わせる必要があります。
どのホストに、いつ、なぜ接続するのかは §3 に列挙します。

---

### 1. 保存するデータ・しないデータ

#### 1.1 ストレージに保存するもの

設定 3 つだけです。それ以外はありません。

| 内容 | 例 | 理由 |
| :--- | :--- | :--- |
| ファイル名テンプレート | `{site}/{user}-{id}-{datetime}-{kind}{n}.{ext}` | 指定どおりのファイル名で保存するため |
| 同名時の動作 | `uniquify` / `overwrite` / `prompt` | ブラウザのダウンロード API へ渡すため |
| 常に保存ダイアログを表示する | `true` / `false` | ブラウザのダウンロード API へ渡すため |

保存先は `chrome.storage.sync` / `browser.storage.sync` です。つまり、ブラウザにログインしていれば
**この 3 つは他の端末にも同期されます**。これは意図した利便性です。片方の端末で調整した
テンプレートを、もう片方でも使えたほうがよいからです。
同時にこれは、その 3 つの値がブックマークとまったく同じように、ブラウザベンダー
（Google または Mozilla）の同期サービスを経由し、そのプライバシーポリシーの下に置かれることも意味します。

これ以外は何も保存しません。ダウンロード履歴も、投稿の一覧も、閲覧したアカウントも、
URL も、操作した日時も保存しません。

#### 1.2 メモリ上だけで扱うもの（保存しない）

| 内容 | 理由 |
| :--- | :--- |
| X の API レスポンスから拾ったメディア URL | 保存ボタンを押した時点で動画の実 URL が分かっているようにするため |
| Bluesky の投稿レコードと解決済みの PDS アドレス | 本文・日時・解像度をファイル名に含められるようにするため |
| 投稿者・投稿 ID・本文・投稿日時 | ファイル名テンプレートを埋めるため |

X 側のキャッシュは上限 2000 件で古い順に破棄され、ページ内に存在するためタブを閉じるか
再読み込みすれば消えます。Bluesky 側のキャッシュは上限 300 件でサービスワーカー内にあり、
ブラウザはこれをアイドル状態で停止させるため、多くの場合 1 分以内に自然に空になります。
どちらもディスクへ書き出されることも、どこかへ送信されることもありません。

#### 1.3 ダウンロードしたファイル

ブラウザが通常ダウンロードを置く場所へ、テンプレートが生成した名前で保存されます。
本拡張機能は URL とファイル名をブラウザのダウンロード API へ渡したあと、その 1 件が
終わったかどうかだけを追跡します。失敗したときに再試行し、最終的に駄目だった項目を
履歴から取り除くためです（壊れたファイルを残さないための処理です）。
確認は**開始時に受け取ったダウンロード ID を指定して**行い、他のダウンロードを
一覧したり読み取ったりすることはありません。`downloads` 権限を、あなたが指示した
ダウンロードの開始・追跡・後片付け以外の目的で使うこともありません。
その内容はどこにも保存も送信もされません。

---

### 2. 権限とサイトアクセス

要求する権限は 2 つです。

| 権限 | 理由 |
| :--- | :--- |
| **`downloads`** | 指示されたダウンロードを開始し、完了まで追跡し、失敗したものを再試行・後片付けするため |
| **`storage`** | 上記 3 つの設定を保存・読み込みするため |

コンテンツスクリプトが動くのは以下のサイトだけです。

```
https://x.com/*        https://twitter.com/*        https://bsky.app/*
```

これらのページで本拡張機能が見るのは、投稿の構造（メディア要素、操作バー、投稿者リンク、
本文、投稿日時）だけです。ボタンを置き、ファイル名を組み立てるために必要な範囲に限られます。
フォーム入力、Cookie、認証情報、ダイレクトメッセージ、アカウント設定には触れませんし、
投稿ではないページには関心がありません。

**ひとつ、はっきり書いておくべき点があります。** X では `sites/x/interceptor.js` が
ページ自身の JavaScript の世界で動き、`fetch` と `XMLHttpRequest` を包みます。
つまり、ページが `/graphql/` や `/i/api/` へ行った通信の**レスポンス本文を観測します**。
動画の実 URL を知る方法がこれしかないためです（プレイヤーに渡されるのは `blob:` 参照であり、
ページの外では何の意味も持ちません）。

そこで何をしているかは限定的で、正確に書く価値があります。JSON を走査し、
メディア配列が隣にある `rest_id` / `id_str` だけを拾い、そのメディア項目を URL へ変換し、
それ以外はすべて捨てます。本文、フォロワー数、タイムライン、DM 系エンドポイントの内容、
いずれも読み出しませんし、保存も送信もしません。結果がタブの外へ出るのは、
本拡張機能自身のコンテンツスクリプトへの `postMessage` だけで、
宛先には `location.origin` を指定しているため他のオリジンには届きません。
ディスクには何も書きません。

`host_permissions` は `x.com` / `twitter.com` / `bsky.app` / `public.api.bsky.app` /
`plc.directory` のみで、それ以外はありません。`did:web` で自前運用している Bluesky アカウントを
解決できないのはこの狭さが理由です。DID ドキュメントの取得には任意ドメインへの読み取り権限が必要で、
既定でその取引をする価値は無いと判断しました。

---

### 3. 外部通信

本拡張機能自身が接続するのは、次の 3 種類のホストだけです。いずれも Bluesky の基盤であり、
いずれも**保存ボタンを押した後にのみ**発生します。

| 接続先 | タイミング | 送る内容 | 理由 |
| :--- | :--- | :--- | :--- |
| `public.api.bsky.app` | Bluesky の投稿を保存するとき | 投稿の AT-URI（投稿者 DID と投稿 ID）、または解決するハンドル | 本文・投稿日時・MIME タイプ・アスペクト比を取得するため |
| `plc.directory` | そのアカウントについて初回の保存時 | 投稿者の DID | そのアカウントのファイルがどのサーバーにあるかを調べるため |
| 投稿者の PDS（多くは `bsky.social`） | Bluesky のファイルを保存するとき | 投稿者の DID とファイルの CID | ファイル本体を取得するため |

3 つとも公開・認証不要のエンドポイントです。認証情報も、あなたの Cookie も、
いかなる識別子も、あなたに関する情報も一切付与しません。
リクエストが伝えるのは「この投稿はどれか」と「このファイルをください」だけで、
誰が送っても同じ内容になります。

ファイル本体のダウンロードは、ブラウザのダウンロードマネージャがメディアホスト
（`pbs.twimg.com`、`video.twimg.com`、または PDS）に対して行います。
その URL を自分で開いたときとまったく同じ動作です。

**X に対しては、本拡張機能からの通信は一切ありません。**
ページが自身の都合で既に受け取ったレスポンスを読んでいるだけです。

そのほか、

* **開発者のサーバーなし** — そもそも接続先が存在しません。
* **解析・テレメトリ・クラッシュレポート・利用統計なし** — 匿名かどうかを問わず、一切ありません。
* **外部コードなし** — 動くコードは全部パッケージ内にあります。
  実行時に何かをダウンロードしたり評価したりはしません。
* **識別子・フィンガープリンティング・トラッキング Cookie・広告なし。**

---

### 4. 第三者への提供

そもそも何も収集していないので、渡せるものがありません。事業譲渡があった場合も同じです。

また本拡張機能は X や Bluesky の処理者として動くものでもありません。
これらのサービスの利用にはそれぞれのプライバシーポリシーが適用されます。
同期される設定の扱いについては、お使いのブラウザベンダーのポリシーが適用されます（§1.1）。

---

### 5. データの保持と削除

設定 3 つは、消すまでブラウザのプロファイル内に残ります。消し方は 2 通りです。

* 設定画面の **「既定値に戻す」** で初期状態に戻す
* 拡張機能をアンインストールする（保存された設定ごと消えます）

同期を有効にしていた場合、ログイン済みの端末で削除すると、
ブラウザが拡張機能のデータを扱う通常の手順で反映されます。

ダウンロード済みのファイルはあなたのものであり、以上のどれにも影響されません。
拡張機能を削除してもファイルは消えません。

どこにも複製が無いので、開発者への削除依頼は不要です。

---

### 6. 子どものプライバシー

子ども向けの拡張機能ではなく、年齢に関わらず個人情報は集めていません。

---

### 7. ポリシーの改定

機能変更に応じて更新することがあります。その際は冒頭の「最終更新」日を更新し、
重要な変更は [CHANGELOG.md](CHANGELOG.md) にも記載します。
最新版は常にソースリポジトリの `PRIVACY.md` にあります。

---

### 8. お問い合わせ

質問、プライバシーに関する懸念、不具合報告は GitHub の Issue からどうぞ。
