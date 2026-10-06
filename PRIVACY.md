# Privacy Policy / プライバシーポリシー

**Last updated / 最終更新:** 2026-10-05

> **Note on Language / 言語に関する注記**
> このポリシーは英語で書いたものが正式版で、日本語訳は参考用です。両者の内容にズレがあった場合は英語版を優先します。
> This policy is written in English; the Japanese version is provided for convenience. If the two disagree, the English version wins.

---

## At a glance / 概要

| Question / 質問 | Answer / 回答 |
| :--- | :--- |
| Does it collect personal data? / 個人情報を収集しますか？ | **No / いいえ** |
| Is there a developer-owned server? / 開発者のサーバーはありますか？ | **No — none exists / ありません** |
| Does it make network requests? / 外部と通信しますか？ | Yes, but only when a save is triggered — by the download button, or by a like if you enabled that — and only to Bluesky's public API and the author's PDS, or, on Poipiku, to `poipiku.com` itself (§3) / はい。ただし保存が始まったときだけ（ダウンロードボタン、または有効にした場合はいいね）、Bluesky の公開 API と投稿者の PDS、ポイピクでは `poipiku.com` 自身に対してのみ（§3） |
| Does it use analytics or telemetry? / 解析・テレメトリはありますか？ | **No / ありません** |
| Does it record what you view? / 閲覧の履歴を記録しますか？ | **No / いいえ** |
| Does it record what you save? / 保存したものを記録しますか？ | Only which media items were saved (post ID and item number), plus the files still waiting while a save is running — on this device, until the browser closes, never synced or sent (§1.2) / どのメディアを保存したか（投稿 ID と何枚目か）と、保存中は保存待ちのファイルの一覧だけを、端末内に、ブラウザを閉じるまで。同期も送信もしません（§1.2） |
| Where are settings stored? / 設定の保存先は？ | `storage.sync` — your browser profile / ブラウザのプロファイル内 |
| Are settings synced across devices? / 端末間で同期されますか？ | **Yes**, via your browser account / **されます**（ブラウザのアカウント経由） |
| Does it read the pages you visit? / 見ているページを読み取りますか？ | Only x.com / twitter.com / bsky.app / poipiku.com, and only the parts described in §2 / x.com・twitter.com・bsky.app・poipiku.com のみ、かつ §2 に書いた範囲だけ |
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
Downloading a file means fetching it, on Bluesky the metadata that makes a good filename has
to be asked for, and on Poipiku the full-size image's address has to be asked for. §3 sets out exactly which hosts are contacted, when, and why.

---

### 1. What gets stored, and what doesn't

#### 1.1 Saved to storage

Four settings:

| Item | Example | Why |
| :--- | :--- | :--- |
| Filename template | `{site}/{user}-{id}-{datetime}-{kind}{n}.{ext}` | So your files are named the way you asked |
| Conflict behaviour | `uniquify` / `overwrite` / `prompt` | Passed to the browser's download API |
| Always show the save dialog | `true` / `false` | Passed to the browser's download API |
| Download when you like a post | `true` / `false` | Whether liking a post also starts a save. Defaults to `false` |

These live in `chrome.storage.sync` / `browser.storage.sync`, which means **your browser syncs
them to your other devices** if you're signed in to it. That's a deliberate convenience — a
filename template you tuned on one machine is worth having on the next. It also means those four
values pass through your browser vendor's sync service (Google or Mozilla), under their privacy
policy, exactly as your bookmarks do.

#### 1.2 Kept until you close the browser

To show which media you've already saved — the green check marks on the buttons — and to stop a
like from saving the same files again, the Extension keeps one small record:

| Item | Example | Why |
| :--- | :--- | :--- |
| Site and post ID | `x:1234567890123456789` (or `bluesky:…`, `poipiku:<postId>`) | To recognise the post wherever it appears |
| How many media items the post has | `4` | To tell "all saved" from "some saved" |
| Which of those items were saved | `0, 2` (the 1st and 3rd) | To mark each item's button |

That's the whole record. It holds no filenames, no URLs, no account names, no post text, no dates or
times, and nothing that says whether a save came from a button or from a like.

It lives in `chrome.storage.session` / `browser.storage.session`, which is:

* **Never synced** to your other devices, and never sent anywhere.
* **Held in memory by the browser**, not written to disk.
* **Cleared when you close the browser**, and also whenever the Extension is updated, reloaded
  or uninstalled.
* **Kept apart for private windows.** If you allow the Extension in private / incognito windows,
  saves made there go into a separate record that normal windows can't see, and that record is
  cleared as soon as the last private window closes.
* Capped at 3000 posts, oldest dropped first.

There's no button to clear it earlier; closing the browser is how you clear it.

**While a save is running**, the same session storage also holds the list of files still waiting to
be saved, and the counter shown in the corner of the page. Browsers stop an idle background script
at any time, and keeping these here is what lets a save carry on from where it was. For each waiting
file, the list holds:

* its download URL (an X media URL, a Bluesky `getBlob` URL, or a signed `cdn.poipiku.com` image URL);
* the file name built from your template — which includes the author's name, the post ID or the
  post's text only if your template uses them;
* the post ID and item number, and the save options (what to do on a name clash, whether to show
  the save dialog).

Each file is removed from the list as soon as it finishes. The whole list is cleared when you close
the browser, and private-window entries as soon as the last private window closes. Like the record
above, it's never synced and never sent anywhere.

Nothing else is stored, and nothing in that list outlives the save. There's no lasting history of
when or what you downloaded, no accounts you viewed, no timestamps of your activity. In particular, **which posts you liked is not recorded.** The
save-on-like feature keeps a set of post IDs in page memory purely to avoid starting the same save
twice, and that set is gone the moment you reload or close the tab. If a like does start a save, the
record above notes only that the media was saved — exactly as if you had pressed the button.

#### 1.3 Only ever in memory (never saved)

| Item | Why |
| :--- | :--- |
| Media URLs harvested from X's API responses | So a video's real URL is known when you press save |
| Bluesky post records and resolved PDS addresses | So the filename can include the post's text, date and resolution |
| Signed full-size image URLs returned by Poipiku | To download the originals rather than the 640-pixel previews; used for that one save and then discarded |
| The post's author, ID, text and timestamp | To fill in the filename template |

The X cache holds at most 2000 entries and is discarded oldest-first; it lives in the page and
disappears when you close or reload the tab. The Bluesky cache holds at most 300 entries and lives
in the service worker, which the browser stops whenever it's idle — so it often empties on its own
within a minute. Neither is ever written to disk or sent anywhere.

#### 1.4 The files you download

They go where your browser puts downloads, under the name your template produced. The Extension
hands the URL and the filename to the browser's download API, then follows that one download until
it settles, so a failed transfer can be retried and a transfer that fails for good can be cleared
away instead of leaving a broken file behind. It looks the download up **by the numeric id it was
just given**, and never lists, reads, or touches any other download. Beyond starting, following and
cleaning up the downloads you asked for, the `downloads` permission isn't used for anything — and
apart from the saved-media record in §1.2, nothing about those downloads is stored or sent anywhere.

---

### 2. Permissions and site access

Three permissions:

| Permission | Why |
| :--- | :--- |
| **`downloads`** | To start the downloads you asked for, follow each one to completion, and retry or clear away the ones that fail. |
| **`storage`** | To save and load the four settings above, and to keep the saved-media record and the list of files waiting to be saved (§1.2) in session storage. |
| **`alarms`** | To check on a running download every 30 seconds, and only while something is waiting to be saved — so a missed "finished" notice is caught, and a transfer that has stalled for three minutes is given up on, even after the browser has stopped the background script. |

Two browser APIs that need no permission are also used, both only to keep open tabs in step:

* **`tabs`** — to send the counter and saved-media updates to open x.com / twitter.com / bsky.app /
  poipiku.com tabs. Tabs are selected by those URL patterns; the Extension reads only each tab's numeric id and
  whether it's a private tab — never its URL, title, or contents.
* **`windows`** — to notice when the last private window has closed, so the private-window record
  can be cleared.

Content scripts run on these sites, and nowhere else:

```
https://x.com/*        https://twitter.com/*        https://bsky.app/*        https://poipiku.com/*
```

On those pages the Extension looks at the post structure — the media elements, the action bar, the
author link, the post text and timestamp — in order to place a button and build a filename. It does
not touch form inputs, cookies, credentials, direct messages, or account settings, and it has no
interest in pages that aren't posts. On Poipiku it does nothing outside a post's own page
(`/{user}/{post}.html`), and it never enters a password or unlocks a post for you.

When **Also download when you like a post** is switched on, the Extension additionally listens for
clicks on the site's like button (on Poipiku, the emoji reaction buttons) so it knows when to start a save. It only observes: it never
clicks, cancels, or alters a like, and it cannot see likes you made on another device or before it
was installed. With the setting off — which is how it ships — the listener does nothing at all.

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

`host_permissions` covers `x.com`, `twitter.com`, `bsky.app`, `public.api.bsky.app`,
`plc.directory`, `poipiku.com` and `cdn.poipiku.com` — and nothing else. That narrowness is why a Bluesky account self-hosting under a
`did:web` identity can't be resolved: fetching its DID document would require read access to
arbitrary domains, and that trade isn't worth making by default.

---

### 3. Network requests

The Extension itself makes requests to exactly four kinds of host — three of them Bluesky
infrastructure, plus Poipiku itself — and all of them **only after a save has been triggered** — by
pressing a download button, or by liking a post (sending an emoji reaction, on Poipiku) if you
switched that on:

| Host | When | What is sent | Why |
| :--- | :--- | :--- | :--- |
| `public.api.bsky.app` | Saving a Bluesky post | The post's AT-URI (its author DID and post ID), or a handle to resolve | To fetch the post's text, timestamp, MIME type and aspect ratio |
| `plc.directory` | First save for a given account | The author's DID | To find which server that account's files live on |
| The author's PDS (usually `bsky.social`) | Saving a Bluesky file | The author's DID and the file's CID | To fetch the file itself |
| `poipiku.com` (`/f/ShowIllustDetailF.jsp`) | Saving a Poipiku post, on that post's own page — one POST per save | The author's user ID and the post ID — and, for a password-protected post, whatever is in that post's password box (normally the password you typed to open it; empty for every other post), exactly as the page sends it | To get the signed full-size image URLs |

The three Bluesky endpoints are public and unauthenticated. No credentials, no cookies of yours, no
identifier of any kind, and nothing about you is attached — the requests say only "which post is
this" and "give me this file", and would look identical coming from anyone.

The Poipiku request is different, and worth spelling out. It is the same request the Poipiku page
itself makes when you click an image to enlarge it, sent from the post page by the content script.
Because it goes to `poipiku.com` from a `poipiku.com` page, your browser attaches your own Poipiku
cookies (your session) to it, exactly as it does for the page's own request — that's what lets
Poipiku hand out full-size URLs for posts you're signed in to see. The Extension doesn't read, store,
or send those cookies anywhere else; it never sees them. The reply is used only to pick out the
image URLs, and nothing from it is kept after the save.

The download of the file itself is performed by your browser's download manager against the media
host (`pbs.twimg.com`, `video.twimg.com`, the PDS, or `cdn.poipiku.com`), exactly as if you had
opened that URL.

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

The Extension isn't acting as a data processor for X, Bluesky or Poipiku. Using those services is still
governed by their own privacy policies, as is your browser vendor's handling of synced settings
(§1.1).

---

### 5. Keeping and deleting data

The saved-media record and the list of files waiting to be saved (§1.2) are cleared when you close
the browser — or, for private windows, when the last private window closes — and whenever the
Extension is updated, reloaded or uninstalled. Waiting files also leave the list one by one as they
finish. Neither ever reaches your other devices.

Your four settings stay in your browser profile until you remove them. You can:

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
Bluesky では、まともなファイル名を作るためのメタ情報を、ポイピクでは原寸画像の URL を
問い合わせる必要があります。
どのホストに、いつ、なぜ接続するのかは §3 に列挙します。

---

### 1. 保存するデータ・しないデータ

#### 1.1 ストレージに保存するもの

設定 4 つです。

| 内容 | 例 | 理由 |
| :--- | :--- | :--- |
| ファイル名テンプレート | `{site}/{user}-{id}-{datetime}-{kind}{n}.{ext}` | 指定どおりのファイル名で保存するため |
| 同名時の動作 | `uniquify` / `overwrite` / `prompt` | ブラウザのダウンロード API へ渡すため |
| 常に保存ダイアログを表示する | `true` / `false` | ブラウザのダウンロード API へ渡すため |
| いいね時にダウンロードする | `true` / `false` | いいねで保存を始めるかどうか。既定は `false` |

保存先は `chrome.storage.sync` / `browser.storage.sync` です。つまり、ブラウザにログインしていれば
**この 4 つは他の端末にも同期されます**。これは意図した利便性です。片方の端末で調整した
テンプレートを、もう片方でも使えたほうがよいからです。
同時にこれは、その 4 つの値がブックマークとまったく同じように、ブラウザベンダー
（Google または Mozilla）の同期サービスを経由し、そのプライバシーポリシーの下に置かれることも意味します。

#### 1.2 ブラウザを閉じるまで保持するもの

保存済みのメディアを示す（ボタンを緑のチェックマークにする）ため、また、いいねで同じファイルを
保存し直さないために、本拡張機能は小さな記録を 1 つだけ持ちます。

| 内容 | 例 | 理由 |
| :--- | :--- | :--- |
| サイトと投稿 ID | `x:1234567890123456789`（または `bluesky:…`、`poipiku:<投稿 ID>`） | どこに表示されても同じ投稿だと分かるようにするため |
| 投稿内のメディア数 | `4` | 「全件保存済み」と「一部だけ保存済み」を区別するため |
| そのうち保存済みのもの | `0, 2`（1 枚目と 3 枚目） | メディアごとのボタンに印を付けるため |

記録はこれで全部です。ファイル名、URL、アカウント名、本文、日付や時刻は含まれず、
保存のきっかけがボタンだったかいいねだったかも残りません。

保存先は `chrome.storage.session` / `browser.storage.session` で、次の性質を持ちます。

* **他の端末へは同期されず**、どこへも送信されません。
* **ブラウザがメモリ上に保持**し、ディスクには書き出しません。
* **ブラウザを閉じると消えます。** 拡張機能の更新・再読み込み・アンインストールでも消えます。
* **シークレットウィンドウの分は別に持ちます。** シークレット（プライベート）ウィンドウでの
  実行を許可している場合、そこでの保存は通常ウィンドウからは見えない別の記録に入り、
  最後のシークレットウィンドウを閉じた時点で消えます。
* 上限は 3000 投稿で、古いものから捨てます。

これより早く消すボタンはありません。消したいときはブラウザを閉じてください。

**保存を実行している間は**、同じセッションストレージに、保存待ちのファイルの一覧と、
画面の隅に出すカウンターも置きます。ブラウザは暇なバックグラウンドをいつでも止めるため、
ここに置いておくことで、止められても保存を続きから再開できるようにしています。
保存待ちの 1 件ごとに持つのは次の情報です。

* ダウンロード元の URL（X のメディア URL、Bluesky の `getBlob` の URL、またはポイピクの `cdn.poipiku.com` の署名付き画像 URL）
* テンプレートから組み立てた保存先のファイル名（テンプレートで使っている場合に限り、
  投稿者の名前・投稿 ID・本文を含みます）
* 投稿 ID と何枚目か、保存時の設定（同名時の動作、保存ダイアログを出すか）

各ファイルは、保存が終わった時点で一覧から消えます。一覧全体はブラウザを閉じると消え、
シークレットウィンドウの分は最後のシークレットウィンドウを閉じた時点で消えます。
上の記録と同じく、同期もどこかへの送信もしません。

これ以外は何も保存せず、この一覧も保存が終われば残りません。いつ・何をダウンロードしたかの
履歴も、閲覧したアカウントも、操作した日時も残しません。とりわけ、**どの投稿にいいねしたかは記録しません**。
いいね連動保存が投稿 ID の集合を持つのは、同じ保存を二重に始めないためだけであり、
その集合はページの再読み込みやタブを閉じた時点で消えます。いいねで保存が始まった場合も、
上の記録に残るのは「そのメディアを保存した」ことだけで、ボタンを押した場合と区別されません。

#### 1.3 メモリ上だけで扱うもの（保存しない）

| 内容 | 理由 |
| :--- | :--- |
| X の API レスポンスから拾ったメディア URL | 保存ボタンを押した時点で動画の実 URL が分かっているようにするため |
| Bluesky の投稿レコードと解決済みの PDS アドレス | 本文・日時・解像度をファイル名に含められるようにするため |
| ポイピクが返す、原寸画像の署名付き URL | 幅 640 ピクセルのプレビューではなく原本を保存するため。その 1 回の保存に使い、そのまま捨てます |
| 投稿者・投稿 ID・本文・投稿日時 | ファイル名テンプレートを埋めるため |

X 側のキャッシュは上限 2000 件で古い順に破棄され、ページ内に存在するためタブを閉じるか
再読み込みすれば消えます。Bluesky 側のキャッシュは上限 300 件でサービスワーカー内にあり、
ブラウザはこれをアイドル状態で停止させるため、多くの場合 1 分以内に自然に空になります。
どちらもディスクへ書き出されることも、どこかへ送信されることもありません。

#### 1.4 ダウンロードしたファイル

ブラウザが通常ダウンロードを置く場所へ、テンプレートが生成した名前で保存されます。
本拡張機能は URL とファイル名をブラウザのダウンロード API へ渡したあと、その 1 件が
終わったかどうかだけを追跡します。失敗したときに再試行し、最終的に駄目だった項目を
履歴から取り除くためです（壊れたファイルを残さないための処理です）。
確認は**開始時に受け取ったダウンロード ID を指定して**行い、他のダウンロードを
一覧したり読み取ったりすることはありません。`downloads` 権限を、あなたが指示した
ダウンロードの開始・追跡・後片付け以外の目的で使うこともありません。
§1.2 の保存済みの記録を除き、その内容はどこにも保存も送信もされません。

---

### 2. 権限とサイトアクセス

要求する権限は 3 つです。

| 権限 | 理由 |
| :--- | :--- |
| **`downloads`** | 指示されたダウンロードを開始し、完了まで追跡し、失敗したものを再試行・後片付けするため |
| **`storage`** | 上記 4 つの設定を保存・読み込みするため、および保存済みの記録と保存待ちのファイルの一覧（§1.2）をセッションストレージに置くため |
| **`alarms`** | 保存待ちがある間だけ、保存中のダウンロードを 30 秒ごとに確かめるため。ブラウザがバックグラウンドを止めた後でも、完了の知らせの取りこぼしを拾い、3 分間止まったままの転送を打ち切れるようにします |

このほか、権限を必要としないブラウザ API を 2 つ使います。どちらも開いているタブの表示を
そろえるためだけのものです。

* **`tabs`** — カウンターと保存済みの更新を、開いている x.com / twitter.com / bsky.app / poipiku.com のタブへ
  送るため。タブはこれらの URL パターンで選び、読み取るのは各タブの番号とシークレットかどうかだけです。
  URL・タイトル・内容は読みません。
* **`windows`** — 最後のシークレットウィンドウが閉じたことを知り、シークレット側の記録を消すため。

コンテンツスクリプトが動くのは以下のサイトだけです。

```
https://x.com/*        https://twitter.com/*        https://bsky.app/*        https://poipiku.com/*
```

これらのページで本拡張機能が見るのは、投稿の構造（メディア要素、操作バー、投稿者リンク、
本文、投稿日時）だけです。ボタンを置き、ファイル名を組み立てるために必要な範囲に限られます。
フォーム入力、Cookie、認証情報、ダイレクトメッセージ、アカウント設定には触れませんし、
投稿ではないページには関心がありません。ポイピクでは投稿の個別ページ（`/{user}/{post}.html`）の
外では何もせず、パスワードを入力したり、代わりに鍵を開けたりもしません。

**「いいねしたときも同時にダウンロードする」をオンにした場合**は、保存を始めるきっかけを
知るために、サイトのいいねボタン（ポイピクでは絵文字リアクションのボタン）へのクリックも見ます。見るだけです。いいねを代わりに押したり、
取り消したり、書き換えたりはしません。他の端末で押したいいねや、導入前のいいねも分かりません。
設定がオフの間（出荷時の状態）は、この待ち受けは何もしません。

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
`plc.directory` / `poipiku.com` / `cdn.poipiku.com` のみで、それ以外はありません。`did:web` で自前運用している Bluesky アカウントを
解決できないのはこの狭さが理由です。DID ドキュメントの取得には任意ドメインへの読み取り権限が必要で、
既定でその取引をする価値は無いと判断しました。

---

### 3. 外部通信

本拡張機能自身が接続するのは、次の 4 種類のホストだけです。うち 3 つは Bluesky の基盤、
残る 1 つはポイピク自身で、いずれも**保存が始まった後にのみ**発生します（ダウンロードボタンを押したとき、
または有効にしている場合はいいねを押したとき。ポイピクでは絵文字リアクションを送ったとき）。

| 接続先 | タイミング | 送る内容 | 理由 |
| :--- | :--- | :--- | :--- |
| `public.api.bsky.app` | Bluesky の投稿を保存するとき | 投稿の AT-URI（投稿者 DID と投稿 ID）、または解決するハンドル | 本文・投稿日時・MIME タイプ・アスペクト比を取得するため |
| `plc.directory` | そのアカウントについて初回の保存時 | 投稿者の DID | そのアカウントのファイルがどのサーバーにあるかを調べるため |
| 投稿者の PDS（多くは `bsky.social`） | Bluesky のファイルを保存するとき | 投稿者の DID とファイルの CID | ファイル本体を取得するため |
| `poipiku.com`（`/f/ShowIllustDetailF.jsp`） | ポイピクの投稿をその個別ページで保存するとき。保存 1 回につき POST 1 回 | 投稿者のユーザー ID と投稿 ID。パスワード付きの投稿では、その投稿のパスワード欄に入っている値（通常は開くときに自分で入力したパスワード。それ以外の投稿では空）も、ページと同じように送ります | 原寸画像の署名付き URL を受け取るため |

Bluesky の 3 つは公開・認証不要のエンドポイントです。認証情報も、あなたの Cookie も、
いかなる識別子も、あなたに関する情報も一切付与しません。
リクエストが伝えるのは「この投稿はどれか」と「このファイルをください」だけで、
誰が送っても同じ内容になります。

ポイピクへのリクエストは事情が異なるので、はっきり書いておきます。これは、画像をクリックして
拡大表示するときにポイピクのページ自身が送るのと同じリクエストで、投稿ページ上のコンテンツスクリプトから送ります。
`poipiku.com` のページから `poipiku.com` へ送るため、ページ自身のリクエストと同じように、
ブラウザがあなたのポイピクの Cookie（ログイン中のセッション）を付けます。ログインして閲覧できる投稿の
原寸 URL をポイピクが返してくれるのは、そのためです。本拡張機能はその Cookie を読み取らず、
保存も、他の場所への送信もしません（そもそも中身を目にしません）。応答は画像の URL を拾うためだけに使い、
保存が終われば何も残しません。

ファイル本体のダウンロードは、ブラウザのダウンロードマネージャがメディアホスト
（`pbs.twimg.com`、`video.twimg.com`、PDS、または `cdn.poipiku.com`）に対して行います。
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

また本拡張機能は X・Bluesky・ポイピクの処理者として動くものでもありません。
これらのサービスの利用にはそれぞれのプライバシーポリシーが適用されます。
同期される設定の扱いについては、お使いのブラウザベンダーのポリシーが適用されます（§1.1）。

---

### 5. データの保持と削除

保存済みの記録と保存待ちのファイルの一覧（§1.2）は、ブラウザを閉じた時点（シークレットウィンドウの分は、
最後のシークレットウィンドウを閉じた時点）と、拡張機能の更新・再読み込み・アンインストール時に消えます。
保存待ちのファイルは、保存が終わるたびに 1 件ずつ一覧から消えます。どちらも他の端末へ届くことはありません。

設定 4 つは、消すまでブラウザのプロファイル内に残ります。消し方は 2 通りです。

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
