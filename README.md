# Focus Lock

A Chrome extension that blocks sites, sections, and single pages you type in. A manual lock or a committed schedule cannot be weakened until it ends. The options page cannot override that. The service worker rejects the change.

YouTube Shorts is not built in. To block that section and leave the rest of YouTube open, add both of these entries and then lock the list or commit a schedule:

- `youtube.com/shorts/*`
- `*.youtube.com/shorts/*`

The first is the bare host. The second covers `www`, `m`, and other subdomains. A site entry such as `reddit.com` does not include `www.reddit.com`.

Nothing is blocked until a list is locked or a schedule window is in effect.

## Install

1. `npm install`
2. `npm test`
3. `npm run build`
4. Open `chrome://extensions`.
5. Turn on Developer mode.
6. Choose Load unpacked and select the `dist` folder.
7. On the card, open Details and allow the extension in Incognito if you want the same blocks there.
8. Click the extension icon to open the options page.

After a code change, run `npm run build` and click Reload on the extension card.

## How a block is applied

- A static-looking network rule is registered dynamically while a list is blocking. It redirects a full document load to the blocking page. `blocked.html` is listed in `web_accessible_resources`, which that redirect needs.
- YouTube and other single-page apps often change the address without a new document. `history-hook.js` runs in the page's JavaScript world and wraps `history.pushState`. It only fires a DOM event. `guard.js` is the isolated content script: it can use extension APIs, and it redirects the tab. The service worker's `webNavigation` listener is the backup.
- The blocking page names every matching list and when each restriction ends. It has no unlock control.

## What the lock will not survive

You are the administrator of this Mac. This extension is a commitment device, not a control that you cannot undo.

- Remove or disable the extension on `chrome://extensions`. This Mac is not enrolled in device management, so Chrome will not force the extension to stay installed. Details are in [docs/macos-chrome-policies.md](docs/macos-chrome-policies.md).
- Use another browser, another Chrome profile, or Guest mode.
- Incognito, unless the extension is allowed there.
- Edit the extension files or clear its storage from the service worker inspector.
- A hosts file or Screen Time rule. Those see hosts, not a path, so they cannot block Shorts and leave `/watch` open.

Closing the options page does not stop a block. Quitting Chrome stops blocking until Chrome opens again. After a restart, saved lists, active locks, and committed schedules are loaded again. A schedule window that is in effect at startup starts blocking. A committed schedule stays committed between windows.

Setting the clock backward does not end a lock. A normal passage of time can end it, including offline. A single jump of more than 15 minutes does not end it until a response from `https://www.google.com/generate_204` has a `Date` header at or after the end. While that check is unavailable, the lock stays.

## Accounts

Accounts are optional. Create a Supabase project, run [supabase/schema.sql](supabase/schema.sql) in its SQL editor, then save the project URL and anon key in the options page. The anon key is the public client key. Do not paste the service role key.

Passwords are sent to Supabase Auth and are not stored by the extension. Logging out clears the session only. Lists and locks remain on this Mac.

The database trigger rejects a client update that ends a lock early, clears an active lock, or weakens a schedule whose commitment has not ended. Row policies limit each account to its own rows. The Supabase dashboard can still edit rows, because it is your project.

Sync keeps the newer revision. An older cloud copy does not replace newer local lists. A newer cloud copy that would drop an active local lock, or weaken a committed schedule, is rejected locally and the stricter version is sent back. If the network is down, local data stays as it is.

## Where errors show

- `npm test` fails: the matcher, clock, schedule, overlap, or sync rule is wrong. The test name says which case.
- The extension card shows Errors: the manifest or a script failed to load. A missing `blocked.html` web-accessible resource is reported when a redirect runs.
- Service worker → Inspect: a crash while applying rules or saving state. Reload the extension after fixing it.
- A typed `/shorts` URL still opens YouTube: the list is not locked, the pattern does not include that host (`www` and the bare host are different), or the service worker did not register rules. Inspect the service worker.
- Shorts still plays after a click inside YouTube: the page-context hook or `webNavigation` missed that navigation, or YouTube kept you on `/` / `/watch` while the Shorts player ran. Rebuild, reload the extension, and confirm both patterns are on a **locked** list. Home and feed Shorts are checked using the `/shorts/…` path plus on-page Shorts UI when the address bar never changes.
- The whole site is blocked: the entry is a host, such as `youtube.com`, rather than a section ending in `/*`.

## Checks to do by hand

Unit tests cannot restart Chrome.

- Quit Chrome, reopen it, and confirm the lists are still there.
- Lock a list, quit Chrome before the end, and confirm it is still locked.
- Disconnect the network and open a blocked URL. The block still works. A smooth end time can pass offline. A large clock jump while offline does not end the lock.
- Commit a schedule, quit during a window and outside a window, and restart the Mac during a window. Blocking follows the window. The schedule still cannot be weakened in either case.
