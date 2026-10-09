# SNS Media Downloader

🌐 English | [日本語](README.ja.md)

> **The media is already on your screen. This puts a save button next to it.**

**SNS Media Downloader** is a browser extension for **X (Twitter)**, **Bluesky**, **Poipiku**, **Privatter** and **Privatter+**.

It adds a download button to the action bar of every post that has media, and saves the
**original** files — full-resolution images, the highest-bitrate video — straight to your
download folder, under a filename you design yourself.

No API keys, no third-party service, no ZIP to unpack, no "open this post on our website".

---

## 🤔 What problem does this solve?

Saving one image from a post is a right-click away. Everything past that gets tedious fast.

| What you actually want | What the browser gives you | What this extension does |
| :--- | :--- | :--- |
| The original image | The display-sized copy that happened to be on screen | Refetches it at `name=orig` |
| The video | Nothing — X hands the player a `blob:` URL that only exists inside the page | Reads the real MP4 URL and picks the highest bitrate |
| All four images at once | Four right-clicks, four dialogs | One click |
| A filename you can find later | `GxAbCdEfGhIjKlM.jpg` | `x/example_user-1234567890123456789-20260819_142530-img2.jpg`, or whatever you specify |

---

## ✨ Features

* 🐦 **Five sites** — X (Twitter), Bluesky, Poipiku, Privatter and Privatter+, each with its own adapter and accent colour.
* 🖼️ **Originals, not previews** — `name=orig` for X images, the highest-bitrate MP4 variant for
  video, `com.atproto.sync.getBlob` straight from the author's PDS for Bluesky, and the signed
  full-size URL the page itself uses for Poipiku, and the full-size link already on the page for Privatter and Privatter+.
* 🎯 **Whole post or one item** — the action-bar button saves everything; a small button on each
  thumbnail saves just that one (it appears once a post has two or more).
* ❤️ **Save when you like** — optionally, liking a post (sending an emoji reaction, on Poipiku;
  picking a reaction icon from ♡いいね, on Privatter; picking a reaction, on Privatter+)
  saves its media at the same time.
  **Off by default**; turn it on in settings when you want it.
* 📊 **Progress and saved state at a glance** — a counter in the bottom-left corner shows
  *Pending* and *Done* (and *Failed*, if anything failed). Buttons for media you've saved turn into
  a green check mark, and stay that way across page changes and reloads until you close the browser.
* 🏷️ **Filename templates** — 24 placeholders, subfolders, conditional blocks, per-variable length
  limits, and a live preview of seven sample posts while you type.
* 🔁 **Failed transfers are retried** — up to three times, with a growing pause between attempts.
  Anything that still won't come down is reported as an error and cleared away, rather than left in
  your download folder as a broken file.
* 🔑 **No API keys, no account** — nothing to register, nothing to sign in to.
* 🌍 **9 UI languages** — English, 日本語, 한국어, Deutsch, Español, Français, Português (BR),
  简体中文, 繁體中文.
* 🌗 **Follows your system theme** and honours *reduce motion*.
* 🔒 **No analytics, no telemetry, no developer server** — see [PRIVACY.md](PRIVACY.md).

---

## 🛠️ Installation

There's no build step. The repository *is* the extension — download it and load it as-is.

### 🌐 Chrome / Edge / Brave / other Chromium browsers

1. Download this repository as a ZIP and extract it (or `git clone` it).
2. Type `chrome://extensions` into the address bar and press Enter.
3. Turn on **Developer mode** with the toggle in the top-right corner.
4. Click **Load unpacked** and pick the extracted folder — the one containing `manifest.json`.

> The extension stays installed until you remove it. You can pin its icon to the toolbar from
> the puzzle-piece menu.

### 🦊 Firefox

> `manifest.json` works in Firefox as it is — there's nothing to swap. Firefox may list warnings
> about the Chrome-only keys in it (such as `minimum_chrome_version` or `background.service_worker`);
> it simply ignores those keys, and the extension works normally.

**A. Temporary install (easiest, but disappears when you close Firefox)**

1. Type `about:debugging#/runtime/this-firefox` into the address bar.
2. Click **Load Temporary Add-on…**.
3. Select the **`manifest.json`** file inside the extracted folder.

**B. Permanent install (Developer Edition / Nightly only)**

1. ZIP up the *contents* of the folder (not the folder itself).
2. Open `about:config` and set `xpinstall.signatures.required` to **`false`**.
3. Open `about:addons` → ⚙️ gear icon → **Install Add-on From File…** → choose your ZIP.

### ✅ Check that it works

Open any post with an image on [x.com](https://x.com/) or [bsky.app](https://bsky.app/).
A ⬇️ button should appear in the row with reply / repost / like. On [poipiku.com](https://poipiku.com/)
it appears next to the share / bookmark buttons of each post, on a post's own page and in the
こそフォロ (secret-follow) and フォロータグ (followed-tags) lists. On [privatter.net](https://privatter.net/)
it appears after the お気に入り / いいね / Share row of an image post (`/i/…`) or a text post with
images in it (`/p/…`). On [privatter.me](https://privatter.me/) (Privatter+) it appears right after the
リアクション / コメント (reactions / comments) tabs under a post (`/page/…`). Click it, and a counter appears
in the bottom-left corner; once the save finishes, the button turns into a green check mark.

---

## 🕹️ Using it

| Button | Where it is | What it saves |
| :--- | :--- | :--- |
| **Main button** | In the action bar, next to like / bookmark. Shows a small count badge when the post has more than one media item. | Every media item in the post |
| **Item button** | Top-right corner of each thumbnail. Only appears when the post has **two or more** items. | That one item |
| **The like button** | The site's own like button (on Poipiku, any emoji reaction button; on Privatter, any reaction icon under ♡いいね; on Privatter+, any icon in the reaction picker) — only when you switch this on in settings. | Every media item in the post |

### The download counter

Progress is shown by a counter in the bottom-left corner of the page.

| Label | What it counts |
| :--- | :--- |
| **Pending** | Files waiting their turn, plus the one being transferred |
| **Done** | Files that were saved |
| **Failed** | Files that still failed after retrying — only shown when there's at least one |

It counts files, not posts, and it's the total across every open tab. Saves started by a button and
saves started by a like are counted the same way. **Five seconds** after *Pending* reaches zero the
counter fades out, and *Done* and *Failed* reset to zero. If another save starts within those five
seconds, the counter stays up and keeps its numbers.

Clicks pass straight through the counter, so whatever the site has underneath it (the account
switcher, for instance) still works. On narrow, phone-sized layouts it sits above the bottom
navigation bar.

Failures are also reported with a toast — how many saved and how many failed, or just how many
failed if nothing made it. A fully successful save shows no toast; the counter already says so. A
file that fails is retried up to three times before it counts as failed, and a transfer that never
completes is cleared away instead of leaving a partial file behind.

### Saved-state buttons

Once a media item has been saved, its buttons change:

* **Item buttons** turn into a green check mark and stay visible without hovering, so you can see
  at a glance which images in a set you've already saved.
* **The main button** turns into a check mark when every item in the post is saved. When only some
  are, its count badge reads like `2/4`.

A checked button still works — press it and the file is saved again. The record is kept per post ID
and item number, so the same post shows the same state when it turns up as a repost or in another
tab, and it survives navigating around and reloading.

The record is **cleared when you close the browser**, and also when the extension is updated or
reloaded. Saves made in a private window are kept separately from normal windows, and are cleared
as soon as the last private window closes.

### Saving when you like a post

Turn on **Also download when you like a post** and the like button starts doing two jobs. The
filename, the folder and the conflict behaviour are exactly the same as pressing the download
button — this only changes *when* a save begins, never *what* it produces.

It is **off by default**, and deliberately so: a download you didn't ask for is a worse surprise
than one you have to click for. A few details worth knowing:

* **Only liking triggers it.** Removing a like does nothing — the two states are different buttons
  underneath, and only the "not yet liked" one is watched. On Poipiku, every emoji reaction you
  send counts as a like. On Privatter, picking any reaction icon (heart, paw, face…) from the panel
  that ♡いいね opens counts as a like; opening the panel itself doesn't, and neither does ★お気に入り.
  On Privatter+, picking any icon in the reaction picker counts as a like. Clicking a reaction that's
  already been sent (which cancels it on Privatter+) and the bookmark button don't.
* **Text-only posts are ignored silently.** No toast, no error. Nothing happens at all.
* **A like never re-saves something already saved.** Like → unlike → like again produces one set
  of files, not two. The same goes for a post you saved with a button: if every item is saved, a
  like does nothing; if only some are, it saves the rest. This uses the same record as the
  saved-state buttons above, so it lasts until you close the browser. (Buttons, by contrast, will
  save again as often as you like.)
* **The like itself is untouched.** The extension watches the click and gets out of the way; it
  never cancels or delays the site's own handling.

### What it deliberately leaves alone

* **Quote posts.** Media inside the quoted post belongs to that post, not this one, so it's
  excluded on both sites. Open the quoted post itself and it gets its own button.
* **Link-card previews** (`card.*` on X, `<a href="http…">` thumbnails on Bluesky).
* **External GIF embeds** such as Tenor — they aren't hosted by the site.
* **The lightbox.** No buttons are injected into the full-screen image viewer; use the buttons
  on the post itself.
* Avatars, banners, and anything that isn't post media.
* **On Poipiku: anything you haven't unlocked.** Password, follower-only, age-gated and warning
  posts only get buttons for the images you can already see. The extension never enters a password
  or opens a post for you. While such a post is still locked, its main button is shown anyway;
  pressing it just tells you to unlock the post first (a reaction on a locked post does nothing). Buttons appear only on a post's own page (`/{user}/{post}.html`) and in the
  こそフォロ / フォロータグ lists (`/MyHomePcV.jsp`, `/MyHomeTagPcV.jsp`), not in other lists or
  timelines (the お気に入り bookmark list uses a different layout).
* **On Privatter: anything you haven't unlocked, and the lists.** A password or login-only post shows
  no images until you open it yourself; once you do, the page reloads with the images and the buttons
  appear. The extension never enters a password or signs in for you. Buttons appear only on image
  posts (`/i/…`) and text posts (`/p/…`), not on user pages (`/u/…`) or other lists. Privatter+ works the
  same way: a password-protected post gets buttons once you've entered the password and the page has
  reloaded, and buttons appear only on posts (`/page/…`), not on user pages (`/user/…`) or other lists.

---

## 🏷️ Filenames

The default template is:

```
{site}/{user}-{id}[-{datetime}]-{kind}{n}.{ext}
```

which produces, for the second image of a four-image X post:

```
x/example_user-1234567890123456789-20260819_142530-img2.jpg
```

Open the settings popup and the seven sample previews update as you type, so you never have to
save a file to find out what the template does.

### Placeholders

**Author & post**

| Placeholder | Value |
| :--- | :--- |
| `{site}` | `x`, `bsky`, `poipiku`, `privatter` or `privatterplus` |
| `{user}` | Screen name (X), handle (Bluesky), numeric user ID (Poipiku) or user name (Privatter, Privatter+) |
| `{name}` | Display name |
| `{id}` | Post ID. On Privatter, the post type plus its number — `i7962168` for an image post, `p12082367` for a text post (the two are numbered separately). On Privatter+, the post's ID from its URL (`6975d5e22c2c3`) |
| `{text}` | Post body, with URLs removed. On Privatter, the caption of an image post, or the title of a text post. On Privatter+, the post's title |

**Date & time** — the post's own timestamp, converted to your local timezone. Poipiku pages don't
show when a post was made, so these are empty there (wrap them in `[ ]`, or use `{dl_datetime}`).
Privatter and Privatter+ show the time in Japan time, and it is read as such

| Placeholder | Example |
| :--- | :--- |
| `{datetime}` | `20260819_142530` |
| `{date}` | `20260819` |
| `{time}` | `142530` |
| `{yyyy}` `{mm}` `{dd}` | `2026` `08` `19` |
| `{hh}` `{mi}` `{ss}` | `14` `25` `30` |
| `{dl_date}` `{dl_datetime}` | When *you* pressed the button, not when it was posted |

**Media**

| Placeholder | Value |
| :--- | :--- |
| `{n}` | Index within the post — `1`, `2`, `3` … |
| `{nn}` | Same, zero-padded — `01`, `02` … |
| `{n?}` | Same as `{n}`, but empty when the post has only one item |
| `{total}` | How many items the post has |
| `{kind}` | `img` / `vid` / `gif` |
| `{ext}` | `jpg`, `png`, `mp4`, `webm` … |
| `{media_id}` | The original file's ID — the CID on Bluesky, the media hash on X, the file name on Poipiku, Privatter and Privatter+ |
| `{res}` | `1280x720` for X video, the aspect ratio for Bluesky, `orig` for X images (empty on Poipiku, Privatter and Privatter+) |

### Syntax

| Syntax | Meaning |
| :--- | :--- |
| `/` | Subfolder separator (relative to your download folder) |
| `[ … ]` | Conditional block — if any placeholder inside it is empty, **the whole block disappears** |
| `\[` `\]` | A literal square bracket |
| `:20` | Length limit, e.g. `{text:20}` or `{name:12}` — works on any placeholder |

Conditional blocks are what make one template work everywhere. `{user}-{id}[-{res}].{ext}` gives
you `user-123-1280x720.mp4` for an X video and `user-123.jpg` for an image, without leaving a
dangling hyphen behind.

### Rules the renderer applies for you

* Characters that filenames can't contain (`\ / : * ? " < > |` and control characters) are stripped
  from **values**, so a display name full of emoji and slashes can't break out into a folder path.
* The same characters are also stripped if you typed them into the template itself (a literal `:`
  or `?`, say), so the browser never rejects the name.
* Runs of whitespace collapse to a single space, and leading/trailing spaces are trimmed.
* Length limits (`:20` and so on) count *visible characters*, so even joined emoji like `👨‍👩‍👧`
  are never cut in half.
* Each path segment has leading and trailing dots and spaces removed, and empty segments are
  dropped — which also means `..` can never survive into the path.
* Each segment — folder or file name — is capped at **150 bytes** of UTF-8: roughly 150 Latin
  characters, or about 50 Japanese ones. File names are trimmed from the stem so the extension
  survives. Most file systems allow 255 bytes; the rest is headroom for the temporary suffix the
  browser adds while downloading.
* A segment that turns out to be a reserved Windows name (`CON`, `NUL`, `COM1` …) gets a `_` prefix.
* If the file-name part renders to nothing, the file is saved as `download`.
* If the template itself is blank (or only spaces), the default template is used instead.
* A name that isn't in the placeholder list, such as `{toString}`, renders as nothing (and the
  settings screen warns about it).

---

## ⚙️ Settings

Click the toolbar icon (or open the extension's options page — it's the same screen).

| Setting | Default | What it does |
| :--- | :--- | :--- |
| **Filename** | `{site}/{user}-{id}[-{datetime}]-{kind}{n}.{ext}` | The template. Warnings appear below it for unbalanced `[ ]`, unknown placeholders, and a missing `{ext}`. |
| **If a file exists** | Save with a number suffix | `uniquify` / `overwrite` / `prompt`, passed straight to the browser's download API. Firefox doesn't support `prompt` (*Ask every time*), so it isn't offered there. |
| **Always show the save dialog** | OFF | Ask where to put every single file. |
| **Also download when you like a post** | OFF | Liking a post saves its media too. See above. |
| **Restore defaults** | — | Puts all four back. |

There's no Save button. Switches and the drop-down are saved the moment you change them; the
filename is saved about 0.4 seconds after you stop typing (or as soon as you leave the field or
close the popup). A short *Saved* appears in the corner.

Settings live in `storage.sync`, so they follow your browser profile to your other devices if
you're signed in. The record behind the saved-state buttons — post IDs and which items of each
were saved — is kept separately in `storage.session`: it isn't synced, and it's gone when you close
the browser.

---

## 💡 How it works

Every site goes through the same core (`shared/core.js`): find posts, inject buttons, build
filenames, hand a list of `{url, filename}` pairs to the background script, update the counter
and the buttons' saved state, and show a toast if something failed.
Everything site-specific lives in an adapter. The adapters solve very different problems.

### X — reading the response the page already received

The player's `<video>` element has `src="blob:https://x.com/…"`. A blob URL is a handle to data
the page already holds in memory; it means nothing outside that page and can't be downloaded.
The real MP4 URL is in the GraphQL JSON that X itself fetched moments earlier.

So `sites/x/interceptor.js` runs in the **MAIN world** — the same JavaScript world as the page,
which is the only place `window.fetch` can be wrapped — and monkey-patches `fetch` and
`XMLHttpRequest`. For any request to `/graphql/` or `/i/api/`, it clones the response (the body
can only be read once, and X needs its copy), walks the JSON recursively, and picks out every
`rest_id` / `id_str` that has an `extended_entities.media` array next to it.

X receives a great many API responses, so all of this is extra work on top of rendering the page.
The response is therefore read as text first, and anything that doesn't contain `"media_url_https"`
— badge counts, settings and the like — is skipped without ever being parsed as JSON. Parsing and
walking run through `requestIdleCallback`, when the browser has nothing better to do (within a second
at most, well before anyone presses a download button). The one exception is an XHR whose
`responseType` is `"json"`: the browser has already parsed it, and X may modify that object
afterwards, so it's walked on the spot — which is cheap, since there's nothing left to parse.

Images become `pbs.twimg.com/media/…?format=…&name=orig`. Videos get their `variants` filtered
down to `video/mp4` and sorted by bitrate, keeping the highest. The result is posted to the
content script with `postMessage`, which validates it before caching. Because scripts on the page
can post messages of the same shape, only `https` URLs on `pbs.twimg.com` / `video.twimg.com` and
image / MP4 extensions are accepted. Media that couldn't be converted stays in the list as `null`,
so item numbers keep lining up with what's on screen. The cache is keyed by post ID *and* by video ID — the latter can be
recovered from a thumbnail's `poster` attribute when the post ID isn't reachable.

If the interceptor missed the response — you opened the page on a permalink, or the entry was
served before the script ran — `scrapeDom()` takes over and reconstructs what it can from the
DOM: `name=orig` images, GIFs (whose real URL is derivable from the thumbnail name), and any
video whose `src` isn't a blob.

### Bluesky — the URL already contains everything

No interception needed. A Bluesky image URL is
`cdn.bsky.app/img/feed_…/plain/{did}/{cid}@jpeg`, and a video poster is
`video.bsky.app/watch/{did}/{cid}/…`. The DID identifies the account permanently and the CID
identifies the file by its content, which is all `com.atproto.sync.getBlob` needs.

What the DOM *doesn't* give you is the post text, the timestamp, the true MIME type, or the
resolution. So when you press save, the extension calls `app.bsky.feed.getPosts` **once** and
fills those in. The timestamp it takes is `indexedAt` — the moment the server received the post.
`record.createdAt` is whatever the author's device claimed it was, and isn't used at all. The blob
itself is then fetched from the author's own PDS, resolved through `plc.directory` (or the
`did:web` document) and falling back to `bsky.social`.

Every one of those calls is optional. If the API is unreachable, the DID and CID from the DOM
are enough to build a working download URL — you just lose the nicer metadata.

### Poipiku — asking for the same URL the page asks for

The thumbnails on a Poipiku post are 640-pixel previews (`cdn.poipiku.com/{user}/{file}_640.jpg`).
The full-size file is behind a CloudFront signed URL (`…/{file}?Expires=…&Signature=…`), which is
what the page itself requests from `/f/ShowIllustDetailF.jsp` when you click an image to enlarge it.
Like the page, it sends the post's password box (`PAS`) as it is: empty for an ordinary post, and the
password you typed for a password-protected one. Sending anything else makes Poipiku return no images.
When you press save, the adapter sends that same request **once**, with your own session, picks the
signed URLs out of the reply and matches them to the thumbnails on screen by file name.

Only thumbnails that are actually on screen are saved. The placeholder images Poipiku shows for a
locked or warning post (`/img/…`) are ignored, and nothing is unlocked on your behalf: a password,
follower-only or age-gated post gets buttons only once you've opened it yourself. If you aren't
signed in, Poipiku doesn't hand out full-size URLs, so nothing can be saved. The page carries no
post date, so the date placeholders are empty.

A single-image warning post is a special case: unlocking it jumps straight to the enlarged view, and
the thumbnail on the page stays a warning image. The enlarged view (`#DetailOverlay`) sits outside the
post, so the adapter watches it separately. Once it shows a signed image belonging to this post, the
warning thumbnail gets a button for that image and the URL already on screen is used directly, with
no extra request. The URL is remembered, so closing the enlarged view doesn't take the button away.

### Privatter — the link is already on the page

Privatter is the easy one. Each image on a post is a resized copy
(`d2pqhom6oey9wx.cloudfront.net/img_resize/{file}`) wrapped in a lightbox link that points straight at
the original (`…/img_original/{file}`, same file name). That URL needs no signature and no session,
so the adapter makes **no requests of its own**: it reads the links already on the page. Images are
lazy-loaded (the `src` is a blank GIF until you scroll to it, and the real URL sits in
`data-original`), so the adapter looks at the link's `href`, then `data-original`, then `src`.

A whole page is one post, and its content lives in the left column (`#left`). Text posts get the
same treatment for any images embedded in the body. Password and login-only posts render a page
without that column until they're unlocked, which reloads the page with the images in it, so a
locked post simply has no buttons. The posting time is printed in Japan time
(`2026-10-10 01:16:59`) and read as `+09:00`. Image and text posts are numbered separately, so the
post ID carries a type letter (`i…` / `p…`) to keep the saved-state record from mixing them up.

Each image link is an inline element wrapped around a block image, so its box doesn't cover the
image. `content.css` turns only the links that carry an item button into image-sized blocks
(centred when the image is), so the button lands on the image's corner and the page layout is
otherwise unchanged.

### Privatter+ — the same idea, on its own site

Privatter+ (`privatter.me`) is a separate service with its own markup. A post lives at
`/page/{id}`, and its images are lazy-loaded `<img>`s whose `src` — and the lightbox link around
them — already point at the original (`media.privatter.me/img/{user number}/original/{file}`), so,
again, the adapter makes no requests of its own. The post is the column that holds the body's
divider (`hr#contents`); a password-protected post renders without it until it's unlocked, so a
locked post has no buttons. The author link (`/user/{name}`) gives the user name and its text the
display name, the title gives `{text}`, and the posting time is read as Japan time.

The reaction picker and the list of reactions already sent use the same class, and clicking a sent
reaction cancels it, so save-on-like only watches the picker (`#reaction_icons .add-reaction`).
Images there are inline and separated by `<br>`, so the links that carry an item button become
`inline-block` rather than blocks (a block would add a blank line). The main button goes right after
the リアクション / コメント tabs under the post, because the share-button row at the top is missing on
some posts; a post without the tabs falls back to the share row, then to the date box. The button is
centred in the row, and its padding isn't counted towards the row's height, so nothing below shifts.

### Injecting the buttons

X and Bluesky replace their timelines continuously as you scroll, so there's no load event to hook.
A `MutationObserver` watches the whole document instead — but since the DOM never stops changing on
either site, it never rescans the page. (Poipiku is a plain server-rendered page, but unlocking a
post adds its images later, so it uses the same mechanism. Privatter's images load lazily, and the
same mechanism picks them up too.) Only **the posts that changed** are looked at again:

* **Only relevant changes mark a post.** A post is marked when an element containing posts is
  added; when, inside a post, an element the buttons depend on (the adapter's `watch`: media, links
  to the post, action-bar buttons) is added or removed; or when an image's `src`, a video's
  `poster` or a link's `href` changes. A playing video's timestamp, or the extension's own buttons
  being added, don't mark anything.
* **Marked posts are handled together on the next animation frame**, via `requestAnimationFrame`,
  so new buttons make it into the next paint.
* **Reading and writing happen in separate passes.** Reading an element's size forces the browser to
  lay out the page, so interleaving reads and writes would cost one layout per post. Every marked
  post is examined first; only then is anything written. Sizes are read only when looking for a
  place to put the button of a newly found media item.
* **Buttons are remembered**, in `WeakMap`s keyed by the media item and the post, so the DOM isn't
  searched again. Those entries disappear with their elements, so nothing accumulates.
* **Clicks are caught in one place**: a single capture-phase listener on `document` rather than one
  per button. It runs before anything on the page, so the site's own handlers (opening the post and
  so on) never see the click.

Injection is idempotent: a post that already has buttons gets no new ones, only a refresh of their
saved state — and a button whose look hasn't changed isn't touched at all. An exception on one post
doesn't stop the others.

Item buttons need an ancestor that has a size and doesn't contain any *other* media in the post
— otherwise every button in a four-image grid would stack in the same corner. `anchorOf()` walks
up from the thumbnail until it finds one. If nothing has a size yet — an image that hasn't loaded,
say — it tries again every half-second, up to six times, before giving up on that one item.

### Watching the like button

The like button is not one button but two: X swaps `data-testid="like"` for
`data-testid="unlike"` once a post is liked, and Bluesky does the same with `likeBtn` and
`unlikeBtn`. An adapter supplies only the first of the pair, which is what makes "like saves,
unlike doesn't" fall out of the selector rather than out of extra state-tracking. Poipiku has no
like, only emoji reactions that can be sent repeatedly, so every reaction button counts; the
saved-media record is what stops a second reaction from saving the same files again.

The listener sits on `document` in the capture phase, so it still fires on sites that stop
propagation further down. It reads the event and returns — no `preventDefault()`, no
`stopPropagation()`. Liking remains entirely the site's business.

What it deliberately *doesn't* do is watch the DOM for a post's like state flipping. That would
also catch the keyboard shortcut, but both timelines recycle elements as you scroll, and a
recycled node changing state looks identical to a real like. Downloads that start on their own are
worse than downloads that occasionally don't, so only a real click counts.

### Saving, and what happens when it fails

Browsers stop an idle background script. Chrome stops it after 30 seconds with nothing happening,
or when a single event takes more than five minutes to handle; Firefox stops it after 30 seconds
without an incoming event, and merely calling APIs doesn't count. So the background script never
sits inside a function waiting for a download to finish. Instead, it's built to **pick up where it
left off whenever it's woken**:

* **The queue, the item being saved and the counter are written to `storage.session` on every
  change.** A restarted background script reads them back and carries on.
* **A save request is answered immediately** with how many items were accepted. Progress and
  results follow separately — the counter together with any file that was just saved
  (`smdUpdate`), and the result of one button press (`smdBatch`), which is also what clears the
  button's busy state.
* **Completion arrives as a `downloads.onChanged` event.** `downloads.download()` returns as soon as
  a transfer *starts*, so this event is what tells a finished file from a 404. Only `complete`
  counts as a success.
* **An `alarms` tick every 30 seconds** (only while something is queued) catches any missed event,
  and gives up on a transfer whose received byte count hasn't moved for **three minutes**. Total
  time doesn't matter, so a big video on a slow line still gets to finish. A transfer given up on
  this way is left in place, since the user may simply have paused it.

Saves run **one at a time**, even across posts. Parallel transfers fail more often, and with
*Always show the save dialog* on they'd open a stack of dialogs at once. The background script also
checks every URL and file name itself: nothing but X's media hosts, Bluesky's `getBlob` and
Poipiku's `cdn.poipiku.com` and Privatter's `img_original` path on its CloudFront host and Privatter+'s `/img/{user number}/original/` path on `media.privatter.me` are downloaded, and nothing is written outside the downloads folder. Anything rejected counts as failed.

Failures are retried — three times, waiting 0.3 s, then 0.8 s, then 1.5 s. Interruption reasons that
can't change on a second attempt (a 404, a 403, no disk space, and so on) skip the retries and fail
immediately. Each failed attempt is erased from the download history before the next one, so a file
that never arrives leaves nothing behind — no broken file, no row in the downloads list.

Closing the save dialog, or cancelling a download from the browser's download list, doesn't count as
a failure: it isn't added to *Failed*, and no toast appears.

### The counter and the saved-media record

The counter is stored in `storage.session` alongside the queue, and every time a file changes
state the background sends an `smdUpdate` message to every open X / Bluesky / Poipiku / Privatter / Privatter+ tab (a file that was
just saved rides along in the same message, halving the number of messages). Because it's saved
with the queue, the numbers stay right even if the background script is stopped and restarted. The
background also decides *when* the counter should disappear (`hideAt`) and sends that along, so every
tab hides it at the same moment; the next save after that starts counting from zero again.

The saved-media record lives in `storage.session`, shaped like `{ "x:1234567890": value }`. The key
is `site:postId`, and the value is a single number: *media count × 2³² + a bit mask of the saved
items*, where bit *n* is set once item *n* (zero-based) has been saved — so items 1 and 3 of four
saved is `4 × 2³² + 0b101`. That's much lighter than an object or array per post, in memory, in
messages and in writes (and it's why only posts with up to 32 media items are recorded; X and
Bluesky both stop at four). A Poipiku post with more than 32 images still saves normally, it just
never shows the saved state — and for the same reason, reacting to it again saves it again. It's capped at 3000 posts, oldest dropped first. A tab that has just
loaded sends `smdState` to receive the current record and counter.

X sometimes reuses a post's elements to show a different post. Link `href` changes are watched too,
so the buttons are repainted when that happens. When a file is saved, only the places showing that
post are repainted.

Normal and private windows share the same background script, so both the counter and the record
are kept per the sending tab's `incognito` flag. Because `storage.session` survives until the whole
browser closes, the private-window record is dropped from a `windows.onRemoved` listener as soon as
no private windows remain.

---

## ❓ Troubleshooting

**No button appears on a post.**
The post has no media the extension recognises — link-card previews, Tenor GIFs and quoted media
are excluded on purpose. If the timeline was mid-render, scrolling away and back re-triggers the
scan. Buttons are never injected into the full-screen lightbox.

**Liking a post doesn't download anything.**
Check the setting is on — it ships off. Then check the post actually has media the extension
recognises: quoted media, link-card previews and Tenor GIFs are excluded here exactly as they are
for the buttons. Note also that X's `L` keyboard shortcut isn't detected; only a click on the like
button is. And a like never re-saves media that's already saved — if the buttons show a check
mark, that's why. Press the download button instead; buttons will save again as often as you like.

**The saved-state check marks disappeared.**
The record is cleared when the browser closes, and when the extension is updated or reloaded.
Private-window records are cleared when the last private window closes.

**The counter shows more files than I saved in this tab.**
It's the total across all open tabs (private windows are counted separately), so saves running in
another tab are included.

**On X: "Could not get the media URL. Please reload the page."**
The GraphQL response for that post was never seen, and the DOM fallback found nothing usable —
which is the normal outcome for a video whose `src` is a blob. Reload the page so X refetches it
with the interceptor already in place.

**A Bluesky download fails for one particular account.**
That account probably self-hosts with a `did:web` identity. Its DID document lives on its own
domain, which isn't in `host_permissions`, so the PDS can't be resolved and the request falls
back to `bsky.social` — where the blob isn't. Adding `"https://*/*"` to `host_permissions` in
`manifest.json` fixes it, at the cost of granting read access to every site. The default is
deliberately narrow.

**"Failed to download N file(s)."**
The transfer was attempted four times — once, then three retries — and never completed. On Bluesky
this usually means the PDS lookup landed on the wrong server (see the `did:web` entry above); on X
it usually means the media URL had already expired, and reloading the page gets a fresh one. The
failed attempts are erased, so there's no half-written file to clean up.

**Files are saved without an extension.**
Your template is missing `{ext}` — the warning line under the input says so.

**Firefox doesn't offer "Ask every time".**
Firefox's download API doesn't support it. To choose a location for every file, turn on
*Always show the save dialog* instead.

**Part of the filename vanished.**
Either a conditional block was dropped because a placeholder inside it was empty, the characters
were illegal in a filename and were stripped, or the segment hit the 150-byte cap. `{text}` also has all URLs removed, so
a post that was nothing but a link renders as empty.

**Everything is landing in one folder / in strange subfolders.**
`/` in the template creates subfolders relative to your download folder. Remove it, or add one.

**The save dialog appears for every file (or never appears).**
That's **Always show the save dialog**, plus your browser's own "ask where to save each file"
setting — both have to be off for silent saving.

**On Poipiku: "Could not get the media URL."**
You need to be signed in to Poipiku — the full-size URLs are only handed out to a signed-in
session. For a locked post (password, follower-only, age-gated, warning), open it first; only
images that are already visible on the page are saved. Buttons only appear on a post's own page
and in the こそフォロ / フォロータグ lists, not in other lists.

**On Privatter: no button appears.**
Buttons only appear on image posts (`/i/…`) and text posts (`/p/…`) whose images you can see. For a
password or login-only post, enter the password or sign in first; the page reloads with the images
and the buttons appear. User pages (`/u/…`) and other lists get no buttons. On Privatter+, buttons
appear only on posts (`/page/…`); for a password-protected post, enter the password first.

**Settings reset themselves on another machine.**
They're stored in `storage.sync` and follow your browser profile. If two devices disagree, the
last write wins.

---

## 🌐 Requirements

* **Manifest version:** V3
* **Google Chrome:** latest (the manifest's floor is v126)
* **Mozilla Firefox:** latest (the manifest's floor is v140.0)

**Only the latest Chrome and Firefox are targeted.** There is no compatibility code for older
versions or for other browsers, Chromium-based ones included.

The floors written into the manifests come from things the extension actually uses. On Chrome it's
`URL.parse` (Chrome 126), used to validate URLs; older versions of Chrome can't install it.

On Firefox the binding constraint isn't a JavaScript or CSS feature at all — it's
`browser_specific_settings.gecko.data_collection_permissions`, the key that declares this
extension collects nothing. Firefox only understands it from **140** onwards, and Mozilla's own
guidance is to set `strict_min_version` to match so the extension can't install somewhere the
declaration would be silently ignored.

`manifest.json` is written to load as it is in both browsers. It carries the browser-specific key
for each side (`minimum_chrome_version` for Chrome, `browser_specific_settings` for Firefox) and
declares the background both ways: `service_worker`, which Chrome uses, and `scripts`, which Firefox
runs as an event page. Each browser ignores the half meant for the other — both have accepted this
since version 121, well below the floors above. `manifest-chrome.json` and `manifest-firefox.json`
are single-browser versions that keep only their own side of those three keys; everything else is
identical across all three.

**Firefox for Android is not supported.** The `downloads` API — which is the entire point of this
extension — is documented inconsistently there, and `saveAs: true` is known to raise an error.
Until that's tested on real hardware, claiming support would be guessing.

---

## 🔒 Privacy

No analytics, no telemetry, no identifiers, no ads, and no server belonging to the developer.

The extension asks for three permissions — `downloads` to save files (and to follow each save to
completion, so failures can be retried and cleared away), `storage` to remember your four settings
and, until the browser closes, which media you've saved and what's still queued, and `alarms` to
check on a running download every 30 seconds — plus access to `x.com`, `twitter.com`, `bsky.app`,
`public.api.bsky.app`, `plc.directory`, `poipiku.com`, `cdn.poipiku.com`, `privatter.net` and `privatter.me`.

It does make network requests, and it's worth being precise about which: **only when a save is
triggered** — by the download button, or by a like if you turned that on — and only to Bluesky's
public API and the author's PDS, or, on Poipiku, to `poipiku.com` itself (the same request the page
makes when you enlarge an image, sent with your Poipiku session) and its image server. On X, Privatter
and Privatter+ it makes no requests of its own apart from the download itself — it reads what the page
had already received (on Privatter and Privatter+, the image links on the page). Which media you've saved is recorded only on your device, in
`storage.session`, for the saved-state buttons — never synced, never sent, and cleared when the
browser closes. What you view and which posts you like aren't recorded at all (a save triggered by a
like is remembered as a save, nothing more), and nothing about what you view or save is transmitted.
Full details in [PRIVACY.md](PRIVACY.md).

---

## 🧑💻 For developers

### Project layout

```
manifest.json             Extension manifest (MV3) — loads as-is in both Chrome and Firefox
manifest-chrome.json      Chrome-only version: minimum_chrome_version, service-worker background
manifest-firefox.json     Firefox-only version: browser_specific_settings, event-page background
background.js             Service worker: download queue (retries, resumes after being stopped), counter, saved-media record, Bluesky API, DID → PDS resolution, caching
popup.html/.css/.js       Settings UI (also serves as the options page)
content.css               Button, toast and counter styles, injected into every site
shared/template.js        SMD  — i18n, filename templates, defaults
shared/core.js            SMDCore — button injection, save flow, toasts, counter, saved-state buttons
sites/x/interceptor.js    MAIN world: wraps fetch / XHR to harvest media URLs
sites/x/content.js        X adapter
sites/bluesky/content.js  Bluesky adapter
sites/poipiku/content.js  Poipiku adapter
sites/privatter/content.js  Privatter adapter
sites/privatterplus/content.js  Privatter+ adapter
_locales/                 UI translations for 9 languages
icons/
```

`shared/core.js` holds everything that isn't site-specific. Each site supplies one adapter object
— six required keys plus one optional — and calls `SMDCore.start()`:

| Key | Role |
| :--- | :--- |
| `site` | `"x"` / `"bluesky"` / `"poipiku"` / `"privatter"` / `"privatterplus"`. Selects the CSS accent colour via `<html data-smd-site>` |
| `postRoot` | Selector matching the container of a single post |
| `mediaContainers(root)` | The elements wrapping each media item |
| `postId(root)` | Just the post ID (or `null`), quickly. Called every time the buttons are repainted, so keep it light |
| `readPost(root)` | `{ site, screenName, postId, name, text, time }` or `null`. May be expensive (it reads the post text); only called when saving |
| `getMedia(root, post)` | `[{ kind, url, ext, id, res }]`, in the same order as `mediaContainers`, with `null` for any item whose URL is unknown (never drop it — item buttons are matched by position). May also fill in fields on `post` |
| `actionBar(root)` | The element the main button is appended to |
| `likeButton` | *Optional.* Selector for the like button, used by save-on-like. Must **not** match the un-like button. Omit it and only that feature switches off |
| `isLocked(root)` | *Optional.* `true` for a post whose media exists but isn't shown yet (password, warning…). Such a post gets a main button even with no media, and pressing it asks the user to unlock the post first. Omit it and posts without media get no buttons |
| `watch` | *Optional.* Selector for the elements the buttons depend on (media, links to the post, action-bar buttons). Only additions or removals of these inside a post cause its buttons to be looked at again. Omit it and any change inside a post does (it works, just more slowly) |

### Adding a site

Write an adapter with those keys, add its content-script entry (and any `host_permissions`)
to all three manifests, add the site to the `SITE` map in `shared/template.js` so `{site}` renders
sensibly, and add an accent-colour block to `content.css`. `shared/core.js` shouldn't need to
change.

### Debugging

There's no build step, so `chrome://extensions` → **Reload** picks up every edit.

* **Content scripts, the toast and the counter** — the page's own console.
* **The interceptor** — also the page's console, but note it runs in the MAIN world, so it shares
  globals with X itself.
* **`background.js`** — the service worker's console, reachable from the extensions page. It stops
  when idle and restarts on the next message, which empties its cache; that's expected. The queue
  and counter (key `queue`) and the saved-media record can be inspected there with
  `chrome.storage.session.get()` — unlike the cache, they survive the service worker stopping.

To preview a UI language without changing your browser settings, note that `popup.js` reads
`chrome.i18n.getUILanguage()` — switch the browser's display language, or load the folder with a
different `default_locale` while testing.

---

## License

Licensed under either of

* Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
* MIT License ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in
the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any
additional terms or conditions.
