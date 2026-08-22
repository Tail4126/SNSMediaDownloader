# Security Policy / セキュリティポリシー

## English

### Supported versions

Only the latest release gets fixes. If you're running an older build, update first and check
whether the issue still shows up before reporting it.

### Reporting a vulnerability

**Don't open a public issue for a security problem.** That's basically the same as publishing the
exploit.

Use GitHub's private reporting instead:

1. Open the **Security** tab on this repository.
2. Click **Report a vulnerability**.
3. Fill out the form.

This creates a private advisory that only you and I can see.

It helps if you include:

* Extension version, browser + version, and OS.
* Which site it affects (X, Bluesky, the settings screen, or the background script), if it's specific.
* Steps to reproduce, and what an attacker could actually pull off.
* A proof of concept, if you have one — for anything involving a crafted post, a link to a live
  post that demonstrates it is worth more than a description.

### What to expect

This is a one-person hobby project, so I can't promise a response time. Realistically, here's how
it usually goes:

* I'll acknowledge it within about a week.
* Once I understand the report, I'll assess how severe it is and give you a rough plan.
* I'll ship a fix as a patch release, and credit you in the release notes if you'd like.

Haven't heard anything after two weeks? Feel free to nudge the advisory thread.

### Scope

**In scope** — anything in this repository: the MAIN-world interceptor, the message channel
between it and the content script, the site adapters, the shared core, the filename renderer, the
background script, the settings page, and the manifest. Specifically:

* Anything that lets a **crafted post** cause a download from a URL that isn't its own media —
  bypassing either the `https://` check on message receipt or the one in the download handler, or
  getting past both.
* Anything that lets a **page script** or another origin send a message that the content script
  accepts as coming from the interceptor.
* Anything that makes the filename renderer produce a path that escapes the download directory,
  or a filename containing characters it's supposed to strip. Segment trimming is what currently
  makes `..` impossible — a way around it is a real finding.
* Anything that makes the Extension contact a host outside those in `host_permissions`, transmit
  user data, or load remote code. [PRIVACY.md](PRIVACY.md) says it never does any of that.
* Anything that lets a page read or change the Extension's stored settings without the user
  doing anything.
* Anything that causes the interceptor to retain or forward parts of an API response beyond the
  media URLs it's supposed to extract.

**Out of scope**

* Bugs in X, Bluesky, or the browser itself — report those to whoever makes them.
* Breakage from one of those sites changing their DOM or their API shape. That's a normal bug,
  not a security issue — use the [issue tracker](../../issues) for that.
* The fact that saving a file contacts the media host. That's what downloading is; it's
  documented in [PRIVACY.md](PRIVACY.md) §3.
* The fact that settings sync through your browser account. Also documented, in §1.1.
* Rate limits, or being blocked by a site for downloading a lot. Not a vulnerability.
* Anything that already assumes arbitrary code execution on your machine, or a malicious
  extension running alongside this one.
* Issues that only show up in a fork, a modified build, or with `host_permissions` widened past
  the defaults.

### Disclosure

Give me a reasonable amount of time to ship a fix before you publish details. Once the fix is out,
write about it however you like — I'll publish the advisory with credit to you.

---

## 日本語

### サポート対象バージョン

修正を出すのは最新版だけです。古いビルドを使っている場合は、報告の前にまず更新して、
症状が直らないか確認してください。

### 脆弱性の報告方法

**セキュリティ関連の問題は公開 Issue に書かないでください。**
それをやると、実質エクスプロイトを公開しているようなものです。

代わりに GitHub の非公開報告機能を使ってください。

1. このリポジトリの **Security** タブを開く
2. **Report a vulnerability** をクリック
3. フォームに記入する

これで、報告者と自分だけが見られる非公開のアドバイザリが作られます。

書いてもらえると助かるのは次のあたりです。

* 拡張機能のバージョン、ブラウザとそのバージョン、OS
* 対象が限定される場合は、どこか（X / Bluesky / 設定画面 / バックグラウンド）
* 再現手順と、悪用されたときに何ができてしまうか
* 実証コードがあればそれも。細工した投稿が絡む場合は、説明よりも
  実際に再現する投稿へのリンクのほうが助かります

### 対応の目安

一人で趣味でやっているプロジェクトなので、対応期限は約束できません。だいたいの流れはこんな感じです。

* 1 週間くらいで受け取った旨を返信します
* 内容を理解したら、深刻度とだいたいの対応方針を伝えます
* パッチ版として修正を出します。名前を出してほしければリリースノートに書きます

2 週間経っても反応がなければ、アドバイザリのスレッドで催促してもらって大丈夫です。

### 報告の範囲

**対象** — このリポジトリに含まれるものすべて（MAIN world の interceptor、
そこからコンテンツスクリプトへのメッセージ経路、各サイトアダプタ、共通コア、
ファイル名の生成処理、バックグラウンドスクリプト、設定画面、マニフェスト）。
特に次のようなものが対象です。

* **細工した投稿**によって、その投稿のメディア以外の URL からダウンロードを発生させられる経路。
  メッセージ受信時の `https://` 検証、ダウンロード直前の検証、そのどちらか、
  あるいは両方をすり抜けるもの
* **ページ側のスクリプト**や他のオリジンが、interceptor から来たものとして
  コンテンツスクリプトに受理されるメッセージを送れる経路
* ファイル名の生成処理が、ダウンロードフォルダの外へ出るパスや、
  除去されるはずの文字を含むファイル名を作ってしまう経路。
  現在 `..` を成立させないのは各階層の前後トリムなので、これを回避する方法は有効な報告です
* 本拡張機能が `host_permissions` の外のホストへ接続する、ユーザーデータを送信する、
  外部コードを読み込む、といったもの（[PRIVACY.md](PRIVACY.md) で「一切やらない」と
  明言している部分です）
* ユーザーが何もしていないのに、ページ側が保存済みの設定を読み書きできてしまうもの
* interceptor が、抽出すべきメディア URL を超えて API レスポンスの一部を保持・転送してしまうもの

**対象外**

* X・Bluesky、またはブラウザ自体のバグ。それぞれの開発元に報告してください
* サイト側の DOM や API の形が変わって動かなくなる不具合。これは普通のバグなので
  [Issue](../../issues) にお願いします
* ファイルを保存するとメディアホストへ接続すること。それがダウンロードそのものであり、
  [PRIVACY.md](PRIVACY.md) §3 に記載済みです
* 設定がブラウザアカウント経由で同期されること。こちらも §1.1 に記載済みです
* レート制限、大量ダウンロードによるサイト側の制限。脆弱性ではありません
* 端末上ですでに任意コード実行が成立している、または悪意のある別の拡張機能が
  同居していることが前提のもの
* フォーク、改変版、または `host_permissions` を既定より広げた状態でしか起きないもの

### 公表について

詳細を公表する前に、修正版を出す時間を少しもらえると助かります。
修正版が出たあとは、記事でも何でも自由に書いてもらって構いません。
アドバイザリも謝辞付きで公開します。
