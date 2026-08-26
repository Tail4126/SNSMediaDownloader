# SNS Media Downloader

🌐 English | [日本語](README.ja.md)

> **The media is already on your screen. This puts a save button next to it.**

**SNS Media Downloader** is a browser extension for **X (Twitter)** and **Bluesky**.

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

* 🐦 **Two sites** — X (Twitter) and Bluesky, each with its own adapter and accent colour.
* 🖼️ **Originals, not previews** — `name=orig` for X images, the highest-bitrate MP4 variant for
  video, and `com.atproto.sync.getBlob` straight from the author's PDS for Bluesky.
* 🎯 **Whole post or one item** — the action-bar button saves everything; a small button on each
  thumbnail saves just that one (it appears once a post has two or more).
* 🏷️ **Filename templates** — 24 placeholders, subfolders, conditional blocks, per-variable length
  limits, and a live preview of four sample posts while you type.
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

> **First, swap the manifest.** Copy `manifest-firefox.json` over `manifest.json`, replacing it.
> The Chrome manifest declares a service-worker background, which Firefox doesn't support — load
> it as-is and the extension installs but silently does nothing, because there's no background
> script to run the downloads.

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
A ⬇️ button should appear in the row with reply / repost / like. Click it, and a small toast
should confirm how many files were saved.

---

## 🕹️ Using it

| Button | Where it is | What it saves |
| :--- | :--- | :--- |
| **Main button** | In the action bar, next to like / bookmark. Shows a small count badge when the post has more than one media item. | Every media item in the post |
| **Item button** | Top-right corner of each thumbnail. Only appears when the post has **two or more** items. | That one item |

The result is reported as a toast in the corner of the screen — how many saved, and how many
failed if any did. A file that fails is retried up to three times before it counts as failed, and a
transfer that never completes is cleared away instead of leaving a partial file behind.

### What it deliberately leaves alone

* **Quote posts.** Media inside the quoted post belongs to that post, not this one, so it's
  excluded on both sites. Open the quoted post itself and it gets its own button.
* **Link-card previews** (`card.*` on X, `<a href="http…">` thumbnails on Bluesky).
* **External GIF embeds** such as Tenor — they aren't hosted by the site.
* **The lightbox.** No buttons are injected into the full-screen image viewer; use the buttons
  on the post itself.
* Avatars, banners, and anything that isn't post media.

---

## 🏷️ Filenames

The default template is:

```
{site}/{user}-{id}-{datetime}-{kind}{n}.{ext}
```

which produces, for the second image of a four-image X post:

```
x/example_user-1234567890123456789-20260819_142530-img2.jpg
```

Open the settings popup and the four sample previews update as you type, so you never have to
save a file to find out what the template does.

### Placeholders

**Author & post**

| Placeholder | Value |
| :--- | :--- |
| `{site}` | `x` or `bsky` |
| `{user}` | Screen name (X) or handle (Bluesky) |
| `{name}` | Display name |
| `{id}` | Post ID |
| `{text}` | Post body, with URLs removed |

**Date & time** — the post's own timestamp, converted to your local timezone

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
| `{media_id}` | The original file's ID — the CID on Bluesky, the media hash on X |
| `{res}` | `1280x720` for X video, the aspect ratio for Bluesky, `orig` for X images |

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
* Runs of whitespace collapse to a single space, and leading/trailing spaces are trimmed.
* Length limits count *characters*, not UTF-16 units, so emoji don't get cut in half.
* Each path segment has leading and trailing dots and spaces removed, and empty segments are
  dropped — which also means `..` can never survive into the path.
* The filename stem is capped at 100 characters; the extension is added afterwards.
* If a template renders to nothing at all, the file is saved as `download`.

---

## ⚙️ Settings

Click the toolbar icon (or open the extension's options page — it's the same screen).

| Setting | Default | What it does |
| :--- | :--- | :--- |
| **Filename** | `{site}/{user}-{id}-{datetime}-{kind}{n}.{ext}` | The template. Warnings appear below it for unbalanced `[ ]`, unknown placeholders, and a missing `{ext}`. |
| **If a file exists** | Save with a number suffix | `uniquify` / `overwrite` / `prompt`, passed straight to the browser's download API. |
| **Always show the save dialog** | OFF | Ask where to put every single file. |
| **Restore defaults** | — | Puts all three back. |

There's no Save button — changes are written about 0.4 seconds after you stop typing, and a
short *Saved* appears in the corner.

Settings live in `storage.sync`, so they follow your browser profile to your other devices if
you're signed in. Nothing about the posts you download is stored.

---

## 💡 How it works

Both sites go through the same core (`shared/core.js`): find posts, inject buttons, build
filenames, hand a list of `{url, filename}` pairs to the background script, show a toast.
Everything site-specific lives in an adapter. The two adapters solve very different problems.

### X — reading the response the page already received

The player's `<video>` element has `src="blob:https://x.com/…"`. A blob URL is a handle to data
the page already holds in memory; it means nothing outside that page and can't be downloaded.
The real MP4 URL is in the GraphQL JSON that X itself fetched moments earlier.

So `sites/x/interceptor.js` runs in the **MAIN world** — the same JavaScript world as the page,
which is the only place `window.fetch` can be wrapped — and monkey-patches `fetch` and
`XMLHttpRequest`. For any request to `/graphql/` or `/i/api/`, it clones the response (the body
can only be read once, and X needs its copy), walks the JSON recursively, and picks out every
`rest_id` / `id_str` that has an `extended_entities.media` array next to it.

Images become `pbs.twimg.com/media/…?format=…&name=orig`. Videos get their `variants` filtered
down to `video/mp4` and sorted by bitrate, keeping the highest. The result is posted to the
content script with `postMessage`, which checks the origin and re-validates that every URL is
`https://` before caching it. The cache is keyed by post ID *and* by video ID — the latter can be
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

### Injecting the buttons

A `MutationObserver` watches the whole document, debounced to 200 ms, and rescans for posts
after each burst of changes. Both sites replace their timelines continuously as you scroll, so
there's no load event to hook. Injection is idempotent: a post that already has a button is
skipped.

Item buttons need an ancestor that has a size and doesn't contain any *other* media in the post
— otherwise every button in a four-image grid would stack in the same corner. `anchorOf()` walks
up from the thumbnail until it finds one, and gives up if it can't.

### Saving, and what happens when it fails

`downloads.download()` resolves as soon as the browser has *started* the transfer, which means its
return value can't tell a completed file from a 404. So the background script keeps the download id
and polls `downloads.search({ id })` every 500 ms until the item leaves `in_progress`. Only
`complete` counts as a success.

Anything else is retried — three times, waiting 0.3 s, then 0.8 s, then 1.5 s. Interruption reasons
that can't change on a second attempt (`USER_CANCELED`, a 404, a 403, no disk space, and so on)
skip the retries and fail immediately. Each failed attempt is erased from the download history
before the next one, so a file that never arrives leaves nothing behind — no broken file, no row in
the downloads list.

The polling has a second, useful effect: each `downloads.search()` call resets the service worker's
idle timer, so the background script survives a long video download instead of being shut down
halfway through.

---

## ❓ Troubleshooting

**No button appears on a post.**
The post has no media the extension recognises — link-card previews, Tenor GIFs and quoted media
are excluded on purpose. If the timeline was mid-render, scrolling away and back re-triggers the
scan. Buttons are never injected into the full-screen lightbox.

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

**Part of the filename vanished.**
Either a conditional block was dropped because a placeholder inside it was empty, or the
characters were illegal in a filename and were stripped. `{text}` also has all URLs removed, so
a post that was nothing but a link renders as empty.

**Everything is landing in one folder / in strange subfolders.**
`/` in the template creates subfolders relative to your download folder. Remove it, or add one.

**The save dialog appears for every file (or never appears).**
That's **Always show the save dialog**, plus your browser's own "ask where to save each file"
setting — both have to be off for silent saving.

**Settings reset themselves on another machine.**
They're stored in `storage.sync` and follow your browser profile. If two devices disagree, the
last write wins.

---

## 🌐 Requirements

* **Manifest version:** V3
* **Google Chrome / Chromium-based browsers:** v123 or later
* **Mozilla Firefox:** v140.0 or later

Both floors come from things the extension actually uses. On Chrome it's `light-dark()` in the
settings screen (Chrome 123); MAIN-world content scripts, which make the X interceptor possible,
only need Chrome 111.

On Firefox the binding constraint isn't a JavaScript or CSS feature at all — it's
`browser_specific_settings.gecko.data_collection_permissions`, the key that declares this
extension collects nothing. Firefox only understands it from **140** onwards, and Mozilla's own
guidance is to set `strict_min_version` to match so the extension can't install somewhere the
declaration would be silently ignored. (MAIN-world content scripts would have been satisfied by
Firefox 128.) Firefox 140 is also the current ESR, so ESR users are covered without a separate
line.

**Firefox for Android is not supported.** The `downloads` API — which is the entire point of this
extension — is documented inconsistently there, and `saveAs: true` is known to raise an error.
Until that's tested on real hardware, claiming support would be guessing.

---

## 🔒 Privacy

No analytics, no telemetry, no identifiers, no ads, and no server belonging to the developer.

The extension asks for two permissions — `downloads` to save files (and to follow each save to
completion, so failures can be retried and cleared away), and `storage` to remember your three
settings — plus access to `x.com`, `twitter.com`, `bsky.app`, `public.api.bsky.app` and
`plc.directory`.

It does make network requests, and it's worth being precise about which: **only when you press a
save button**, and only to Bluesky's public API and the author's PDS. On X it makes no requests
of its own at all — it reads responses the page had already received. Nothing about what you
view or save is recorded or transmitted. Full details in [PRIVACY.md](PRIVACY.md).

---

## 🧑💻 For developers

### Project layout

```
manifest.json             Extension manifest (MV3) — a byte-for-byte copy of manifest-chrome.json
manifest-chrome.json      Chrome variant: minimum_chrome_version, service-worker background
manifest-firefox.json     Firefox variant: browser_specific_settings, event-page background
background.js             Service worker: downloads (with retries), Bluesky API, DID → PDS resolution, caching
popup.html/.css/.js       Settings UI (also serves as the options page)
content.css               Button and toast styles, injected into both sites
shared/template.js        SMD  — i18n, filename templates, defaults
shared/core.js            SMDCore — button injection, save flow, toasts
sites/x/interceptor.js    MAIN world: wraps fetch / XHR to harvest media URLs
sites/x/content.js        X adapter
sites/bluesky/content.js  Bluesky adapter
_locales/                 UI translations for 9 languages
icons/
```

`shared/core.js` holds everything that isn't site-specific. Each site supplies one adapter object
with six keys and calls `SMDCore.start()`:

| Key | Role |
| :--- | :--- |
| `site` | `"x"` / `"bluesky"`. Selects the CSS accent colour via `<html data-smd-site>` |
| `postRoot` | Selector matching the container of a single post |
| `mediaContainers(root)` | The elements wrapping each media item |
| `readPost(root)` | `{ site, screenName, postId, name, text, time }` or `null` |
| `getMedia(root, post)` | `[{ kind, url, ext, id, res }]`. May also fill in fields on `post` |
| `actionBar(root)` | The element the main button is appended to |

### Adding a site

Write an adapter with those six keys, add its content-script entry (and any `host_permissions`)
to `manifest.json`, add the site to the `SITE` map in `shared/template.js` so `{site}` renders
sensibly, and add an accent-colour block to `content.css`. `shared/core.js` shouldn't need to
change.

### Debugging

There's no build step, so `chrome://extensions` → **Reload** picks up every edit.

* **Content scripts and the toast** — the page's own console.
* **The interceptor** — also the page's console, but note it runs in the MAIN world, so it shares
  globals with X itself.
* **`background.js`** — the service worker's console, reachable from the extensions page. It stops
  when idle and restarts on the next message, which empties its cache; that's expected.

To preview a UI language without changing your browser settings, note that `popup.js` reads
`api.i18n.getUILanguage()` — switch the browser's display language, or load the folder with a
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
