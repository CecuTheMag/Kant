# Kant UI: from "works" to "premium" — implementation plan

Written 2026-11-12 from a full walkthrough of **Kant 0.7.0** on a real Android phone (Nothing Phone, Android 15),
in dark and light mode, plus the web build at phone and desktop width. Every finding below was seen on the device;
"before" screenshots are in [`before/`](before/) (432 px wide, cheap to open — only open one when a task names it).

**Who this is for:** the agent that implements it. Everything is decided already — colours, sizes, copy, file and
line. Do not redesign; implement. When a task says "exact", copy it. When something in the code doesn't match
what this plan says, trust the code, make the smallest change that reaches the stated result, and note it in the
commit message.

---

## 0. Ground rules (read once)

1. **Start fresh:** `git fetch && git pull --ff-only` on `main`, then `npx pnpm install` (the checkout's
   `node_modules` was stale on 2026-11-12: Capacitor 6.2.1 installed vs 6.2.2 locked, `@capacitor/keyboard` missing).
   Work on a branch `ui/premium` — one commit per task group (1.x, 2.x …).
2. **Commits:** style is `Area: what changed` (e.g. `UI: sheets close with a swipe and Android back`).
   **No `Co-Authored-By` / "Generated with" lines** — the owner removed them from history on purpose. Don't push or
   open a PR unless the owner asks.
3. **Scope:** UI only — `packages/app/src/ui/**`, `packages/app/src/lib/**`, `packages/app/src/App.tsx`,
   `src/main.tsx`, `src/hooks/useKant.ts` / `useGroups.ts` only where a task names a line, `package.json` for the two
   new dependencies, `capacitor.config.ts` and `packages/app/android/**` where a task says so. Don't touch `packages/core`, crypto, protocol, relay, storage
   formats, or what a security/legal sentence *means* (you may shorten wording, not change the claim).
4. **Architecture you must respect** (from `CLAUDE.md`): components talk only to the `Store` in
   `ui/core/store.tsx`; new backend needs go in `ui/core/realkant.tsx`. Pure helpers that have tests
   (`*.test.ts`) must stay free of DOM/Capacitor imports. Native features are detected by availability
   (`Capacitor.isPluginAvailable`), never by platform name alone, because an iOS app exists too.
5. **No new UI libraries.** Styles live in `packages/app/src/ui/kant.css` with the existing `--tokens`. The only new
   dependencies allowed are the two named in tasks 1.6 and 3.6. No CDN anything — the CSP
   (`packages/app/vite.config.ts`) allows `font-src 'self' data:` only.
6. **Save tokens:** never read all of `kant.css` (1700 lines) — `grep -n` for the selector, then read ±30 lines.
   Same for `useKant.ts` / `useGroups.ts` (huge). Screenshots: read the 432-px `.jpg`, never the `.png`.
7. **Checks after every task group** (all must pass):
   ```bash
   pnpm run typecheck
   pnpm --dir packages/app test
   pnpm --dir packages/app build
   ```
   Then look at it on the phone (section 7). A task is done when its **Done when** lines are true on the device.

---

## 1. What the walkthrough found (summary)

The app is already closer to iOS than most web-tech apps: grouped settings, large titles, sheets, a real
design-token file. What makes it read as "vibe-coded" is not the palette — it is **feel and finish**:

| # | Finding (seen on the phone) | Screenshot | Task |
|---|---|---|---|
| F1 | Light mode: Android status bar and navigation bar stay **solid black** above a white app | `before/46-light-mode-black-status-bar.jpg` | 1.2 |
| F2 | Android **Back** on a file preview, photo, editor, context menu or any Settings sheet leaves the whole screen (closes the chat / Settings) instead of closing the overlay; a second Back exits the app | — | 1.1 |
| F3 | Sheets show a grabber but **can't be swiped down**; they vanish without animation; the screen behind doesn't react | `before/11-mycode.jpg` | 1.3 |
| F4 | Disabled primary buttons are a muddy navy (blue at 40 % opacity on black) | `before/02-network.jpg`, `before/05-create.jpg` | 1.4 |
| F5 | Toast is near-black on black in dark mode, and sits over message content | `before/18-toast-dark.jpg` | 1.5 |
| F6 | Roboto on Android makes every screen look like a stock Android form | all | 1.6 |
| F7 | Onboarding is a left-aligned form with an app-icon tile, 3 small navy feature tiles and a big empty gap; the network step is a bare text field with jargon | `before/01-welcome.jpg`, `before/02-network.jpg`, `before/05-create.jpg` | 2.1–2.4 |
| F8 | Onboarding in landscape (or any window ≥ 768 px wide but short) cuts off the top of the card — title and icon unreachable | `before/01b-welcome-landscape.jpg` | 2.5 |
| F9 | Notification permission pops up cold as a system dialog right after unlock, with no explanation | `before/52-after-unlock.jpg` | 2.6 |
| F10 | Long-press menu is a small popover at the finger, covering the message; no focus, no blur | `before/21-msg-menu.jpg` | 3.2 |
| F11 | Attach "+" is a 4-line popover list; no camera | `before/23-attach-menu.jpg` | 3.3 |
| F12 | Photo viewer: dim overlay (chat shows through while it fades), no sender/time, no save/share, no swipe-down | `before/28-lightbox.jpg` | 3.4 |
| F13 | Bubbles have no tails; the conversation header is left-aligned Android style | `before/20-chat-after-send.jpg` | 3.1 |
| F14 | Message-request header shows "Not in your contacts" in **green** (online colour) | `before/16-request-chat.jpg` | 3.5 |
| F15 | Settings is one 4.5-screen scroll mixing everyday and expert options; Chats rows have no icons while every other row does; "Quick reaction" label wraps | `before/38-settings-1.jpg`, `before/38b-settings-rest.jpg` | 4.1 |
| F16 | Backup / Move / Duress sheets are walls of 13-px text with bare fields | `before/41-diagnostics-backup-move-duress.jpg` | 4.2 |
| F17 | Erase footnote says "There's no backup" although backups exist | `before/38b-settings-rest.jpg` | 4.1 |
| F18 | Chat list with only a message request shows a huge empty black screen | `before/14-home-request.jpg` | 5.1 |
| F19 | After unlock, every **group** row says "2 members" and sorts by creation date — previews are only kept for the current session | `before/52-after-unlock.jpg` | 5.2 |
| F20 | Launcher icon ignores Android 13+ themed (monochrome) icons — it is the only white circle on a themed home screen | — | 5.3 |
| F21 | No haptics anywhere | — | 3.6 |

Things that are already good and must **not** regress: the large-title + frosted bar pattern, grouped lists
(`Section`/`Cell`), the QR "My code" card, the verify-words sheet, the file preview/editor, swipe-to-reply,
double-tap reactions, reduced-motion support, the desktop two-pane layout.

---

## 2. Order of work

Do the groups in order; each leaves the app shippable.

1. **Foundations** (1.1–1.6) — back handling, system bars, sheets, buttons, toast, font. Biggest "feel" win per line.
2. **First impression** (2.1–2.6) — onboarding, unlock, notification prompt.
3. **Conversation** (3.1–3.6) — bubbles, header, message menu, attach tray, photo viewer, haptics.
4. **Settings** (4.1–4.2).
5. **Chat list and loose ends** (5.1–5.3).
6. **Final pass** (section 8).

---

## Group 1 — Foundations

### 1.1 Android Back closes the top overlay first  (F2)

**Now:** `KantApp.tsx:121-138` only knows the `sheet` state of `Shell`. Settings' own sheets
(`Settings.tsx:43`, `130-138`), `Menu`, `Lightbox` (`Conversation.tsx:530`), `FilePreview`, `FileEditor`,
`DeleteSheet`, `Confirm` are invisible to it.

**Do:**
- New file `packages/app/src/ui/core/backStack.ts` (no DOM/Capacitor imports, so it can be unit-tested):
  ```ts
  type Handler = () => void;
  const stack: { id: number; run: Handler }[] = [];
  let next = 0;
  /** Register an overlay; returns an unregister function. Last registered closes first. */
  export function pushBack(run: Handler): () => void {
    const id = next++;
    stack.push({ id, run });
    return () => { const i = stack.findIndex((h) => h.id === id); if (i >= 0) stack.splice(i, 1); };
  }
  /** Close the top overlay. False when nothing was open. */
  export function popBack(): boolean {
    const top = stack[stack.length - 1];
    if (!top) return false;
    top.run();
    return true;
  }
  ```
  plus a React hook in `parts.tsx`: `useBackHandler(onBack: () => void, active = true)` that calls `pushBack` in a
  `useEffect` and keeps the latest `onBack` in a ref.
- Use it in: `Sheet` (calls its close — see 1.3), `Menu`, `Lightbox` (or its replacement in 3.4), and the Settings
  sub-page stack (4.1). `FilePreview`, `FileEditor`, `DeleteSheet`, `Confirm` and all Settings sheets are `Sheet`s,
  so they get it for free. `FileEditor` passes `requestClose` (it already asks before discarding edits).
- `KantApp.tsx` back listener: `if (popBack()) return true;` **before** the existing `sheet` / `view` checks.
- Unit test `backStack.test.ts`: last-in closes first; unregister removes the right entry; `popBack()` on empty is
  false.

**Done when:** on the phone, in a chat, open a file preview → Back closes only the preview; open the photo →
Back closes only the photo; long-press a message → Back closes only the menu; Settings → Relay → Back returns to
Settings; Back on the chat list still minimises the app.

### 1.2 System bars follow the theme  (F1)

**Now:** `MainActivity` / `styles.xml` never set bar colours; `useAppliedTheme` (`ui/lib.ts:158-175`) only sets a
`<meta theme-color>`, which a Capacitor WebView ignores.

**Do (not edge-to-edge — keep the WebView below the status bar; it's the low-risk path):**
- `KantScreenPlugin.java`: add
  ```java
  @PluginMethod
  public void setBars(PluginCall call) {
      final String color = call.getString("color", "#000000");
      final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", true));
      final Activity activity = getActivity();
      if (activity == null) { call.reject("no activity"); return; }
      activity.runOnUiThread(() -> {
          Window w = activity.getWindow();
          int c = Color.parseColor(color);
          w.setStatusBarColor(c);
          w.setNavigationBarColor(c);
          WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(w, w.getDecorView());
          ic.setAppearanceLightStatusBars(!dark);
          ic.setAppearanceLightNavigationBars(!dark);
          call.resolve();
      });
  }
  ```
  (imports: `android.graphics.Color`, `android.view.Window`, `androidx.core.view.WindowCompat`,
  `androidx.core.view.WindowInsetsControllerCompat` — `androidx.core` is already on the classpath via appcompat.)
- New `packages/app/src/lib/systemBars.ts`: `setSystemBars(color: string, dark: boolean)` → calls
  `KantScreen.setBars` when `Capacitor.isPluginAvailable('KantScreen')`, otherwise no-op. Follow the style of
  `lib/screenSecurity.ts`.
- Colour per screen (the bar must match the pixels right under it):
  | Where | Light | Dark |
  |---|---|---|
  | Chat list, conversation, onboarding, unlock | `#ffffff` | `#000000` |
  | Settings (grouped background) | `#f2f2f7` | `#000000` |
  | Any sheet open on a phone (card-stack effect, 1.3) | `#000000`, dark = true | `#000000` |
  Call it from `useAppliedTheme` (default = `--bg`), and from `KantApp` `Shell` in an effect on `[view, theme,
  sheetOpen]` (settings → grouped). Read the colours from CSS with
  `getComputedStyle(document.documentElement).getPropertyValue('--bg')` so they never drift from the tokens.
- Also set `capacitor.config.ts` `android.backgroundColor` and `SplashScreen.backgroundColor` to `#000000`
  (they're `#08090b`, a slightly different black than the app).

**Done when:** light mode on the phone shows a white status bar with dark icons on the chat list, `#f2f2f7` on
Settings, and a white navigation bar; dark mode shows black bars with light icons. Compare with
`before/46-light-mode-black-status-bar.jpg`.

### 1.3 Sheets: swipe to dismiss, animate out, card-stack background  (F3)

All in `parts.tsx` `Sheet` (`:34-66`) + `kant.css` `/* ── Sheets */` (`grep -n "Sheets ──" kant.css`).

**Do:**
1. **Close animation.** `Sheet` gets internal `closing` state. All closes the sheet owns (backdrop tap, Escape,
   Back via 1.1, swipe) go through `dismiss()`: set `closing`, wait for `animationend` (fallback timeout 320 ms),
   then call `onClose()`. CSS:
   ```css
   .k-sheet.is-closing { animation: k-sheet-down 0.28s var(--ease) both; }
   .k-backdrop.is-closing { animation: k-fade-out 0.28s var(--ease) both; }
   @keyframes k-sheet-down { from { transform: translateY(var(--drag, 0px)); } to { transform: translateY(100%); } }
   @keyframes k-fade-out { to { opacity: 0; } }
   @media (min-width: 768px) {
     .k-sheet.is-closing { animation: k-pop-out 0.2s var(--ease) both; }
     @keyframes k-pop-out { to { opacity: 0; transform: scale(0.96); } }
   }
   ```
   Expose `dismiss` through a context (`SheetCloseContext`) and make the `Cancel`/`Done` buttons in `sheets.tsx`
   (`:20-25`), `Settings.tsx` and `TransferSheets.tsx` use it when present, so every exit animates.
2. **Swipe down** (phones only, `max-width: 767px`): pointer events on the sheet. Start a drag when the pointer
   goes down on `.k-sheet-grabber` or `.k-sheet-head`, **or** anywhere when `.k-sheet-body.scrollTop === 0` and the
   first move is downward (|dy| > |dx|, dy > 6 px). While dragging set `transform: translateY(dy)` (dy ≥ 0; above 0
   use `dy * 0.2` rubber-band) with `transition: none`, and fade the backdrop by `1 - dy / height`. On release:
   dismiss if `dy > 120` or velocity > 0.6 px/ms; otherwise spring back
   (`transition: transform 0.35s var(--spring)`). Don't start a drag from inside `input`, `textarea`,
   `.k-editor-grid`, `.k-preview-body` (they scroll sideways) — check `event.target.closest(...)`.
3. **Card stack** (phones only, top-level sheet only — `depth === 0` in `Sheet`): while a top-level sheet is open
   add `k-sheet-open` to `document.body`; remove it when it starts closing.
   ```css
   @media (max-width: 767px) {
     .k-app { transform-origin: 50% 0; transition: transform 0.45s var(--spring), border-radius 0.45s var(--spring), filter 0.45s var(--ease); }
     body.k-sheet-open { background: #000; }
     body.k-sheet-open .k-app { transform: translateY(10px) scale(0.93); border-radius: 12px; overflow: hidden; filter: brightness(0.92); }
   }
   ```
   Also give the sheet `max-height: calc(100dvh - 18px)` on phones so the scaled app peeks above it.
   **Caution:** a `transform` on `.k-app` turns `position: fixed` descendants into "fixed to `.k-app`". Sheets,
   menus and toasts are already portaled to `body`. The `Lightbox` (`Conversation.tsx:530`) is not — portal it
   (3.4 replaces it anyway).
   Status bar goes black while `k-sheet-open` (1.2).

**Done when:** on the phone every sheet (My code, Contact, Settings → Relay, file preview) can be dragged down and
follows the finger; a short drag springs back; closing by any means slides it down; the chat list behind shrinks
back with rounded corners while a sheet is open. Nested sheets (Contact → Verify) don't shrink the app twice.

### 1.4 Buttons: disabled and pressed states  (F4)

`kant.css` `.k-btn:disabled` (`:174`). Replace opacity with real colours:
```css
.k-btn:disabled { opacity: 1; }
.k-btn-primary:disabled, .k-btn-danger:disabled { background: var(--fill); color: var(--text-3); }
.k-btn-secondary:disabled, .k-btn-plain:disabled { color: var(--text-3); }
.k-btn:active:not(:disabled) { transform: scale(0.97); opacity: 1; filter: brightness(0.92); }
```
Also `.k-btn-danger` in a sheet (e.g. "They don't match", "Erase and start over", every `Confirm`) is a
red-tinted slab; iOS action sheets use a neutral button with red text. In `.k-sheet-foot` only:
`.k-sheet-foot .k-btn-danger { background: var(--surface); color: var(--danger); }`
(dark: `#2c2c2e`, like the other sheet surfaces). Keep the tint in `.k-callout-actions`.

**Done when:** `before/02-network.jpg`'s Continue button is a neutral grey pill with grey text until there is
input.

### 1.5 Toast becomes a HUD  (F5)

`kant.css` `.k-toast` (`grep -n "k-toast" kant.css`):
- Background `var(--hud-bg)`, text `var(--hud-text)`; new tokens: light `--hud-bg: rgba(29, 29, 31, 0.86); --hud-text: #fff`,
  dark `--hud-bg: rgba(72, 72, 76, 0.92); --hud-text: #fff`. Add `box-shadow: 0 0 0 0.5px rgba(255,255,255,0.08), 0 10px 30px rgba(0,0,0,0.3)`.
- Position: **top**, under the bar: `top: calc(var(--safe-top) + 64px); bottom: auto;` and slide down from
  `-8px` in `@keyframes k-toast` (top-anchored HUDs never cover the composer or the newest message).
- Font 15 px / 600, padding `10px 16px 10px 14px`, icon 18 px.

### 1.6 Typeface: Inter where there is no SF  (F6)

SF Pro may not be bundled outside Apple platforms (licence). Inter is the closest open alternative and is what
makes Android screens read as "designed".
- `pnpm --dir packages/app add @fontsource-variable/inter` (OFL, self-hosted woff2, works with the CSP).
- `packages/app/src/main.tsx`: `import '@fontsource-variable/inter';` before `./ui/kant.css`.
- `kant.css` `:root`: put `"Inter Variable"` right after `"SF Pro Text"` / `"SF Pro Display"` in `--font` and
  `--font-display` (Apple devices still get SF via `-apple-system`; Android, Windows and Linux get Inter).
- No `font-feature-settings` (Inter's defaults are the SF-like ones; `cv11` would switch to a single-storey "a").
- Headings already have negative tracking; leave the values.

**Done when:** the phone shows Inter (check: `phone.sh eval "getComputedStyle(document.body).fontFamily"` and a
screenshot — the "a" and "t" of "Chats" no longer look like Roboto). Electron build still starts (fonts load from
`./assets`).

---

## Group 2 — First impression

Files: `packages/app/src/ui/Onboarding.tsx`, `App.tsx`, `kant.css` `/* ── Onboarding */`
(`grep -n "Onboarding ──" kant.css`).

Shared layout for every onboarding screen (replaces the left-aligned form look):
- Content **centred** (text-align center), max-width 440 px, generous top space.
- Hero: 96 px. Welcome and Unlock use the app icon; the other steps use a **symbol in a soft circle**
  (`.k-hero-symbol`: 88 px circle, background `var(--accent-tint)`, icon 40 px `var(--accent)`), never the app icon
  again — repeating the logo on every step is what makes it look templated.
- Title 32 px/700 (`.k-onboard h1`, currently 34 px), lede 17 px `--text-2`, max 34ch, centred.
- Bottom block pinned: primary button, then at most one plain text button. Step dots: remove them (iOS setup
  doesn't use them; they add noise). Delete the `Dots` component and its CSS.
- Behind the welcome hero only: a soft brand glow,
  `background: radial-gradient(closest-side, color-mix(in srgb, var(--brand) 22%, transparent), transparent)`,
  a 320 px circle centred behind the icon, `filter: blur(10px)`. Nothing else decorative.

### 2.1 Welcome  (F7) — `Onboarding.tsx:42-73`
- Icon 96 px (`.k-app-icon` → 96/24 px radius; image 64 px) with the glow above.
- Title "Welcome to Kant"; lede "Private messaging with no one in the middle." (unchanged copy).
- Feature rows: **no tile behind the icon.** Icon 30 px, filled style, coloured: lock `var(--accent)`, person
  `#34c759` (dark `#30d158`), bubble `var(--brand)`. Title 17 px/600, body 15 px `--text-2`. Rows left-aligned
  inside a centred 340-px column, gap 24 px. Keep the three texts.
- Bottom: legal line, then "Agree and continue" (keep exact wording — it's the terms acceptance).
- **Done when:** compared with `before/01-welcome.jpg`, the screen is centred, the three features read as a
  list of coloured symbols, and there is no dead gap above the button on a 6.5" phone.

### 2.2 Network step  (F7) — `Onboarding.tsx:77-134`

Context: release builds bake `VITE_RELAY_URL` from the repo variable `KANT_DEFAULT_RELAY`
(`.github/workflows/release.yml`), so store users skip this step. It shows in self-built, dev and self-hosted
builds — exactly the technical-but-curious people who judge the polish.

New layout:
- Hero symbol: `Globe` icon. Title **"Connect to a network"**. Lede: "Paste an invite link from a friend, or the
  address of a Kant relay. Relays only pass along sealed messages — they can't read them."
- One inset field (`.k-field`, 52 px) with a leading `Link` icon (18 px, `--text-3`) and, when
  `navigator.clipboard?.readText` exists and the field is empty, a trailing small pill button **Paste**
  (`.k-btn-secondary.k-btn-sm.k-btn-pill`) that fills the field from the clipboard.
- Live recognition under the field (instead of the static hint), using the existing `parseInvite` /
  `normalizeRelayUrl`:
  - invite with relay → a `.k-found`-style chip: avatar (from `Avatar` with the invite's name/hex) + "Invite from
    **{name or 'a friend'}**" + host in `--text-2`;
  - plain address → chip with `Globe` + the host;
  - nothing yet → hint "You'll find it in Kant under **My code** → **Copy link**."
- Secondary plain button **"Scan a friend's code"** (`Scan` icon) → opens a `Sheet` containing the existing
  `QrScanner` from `Scanner.tsx`; on result, put the text in the field and run the same submit.
- Errors stay as today (copy unchanged), shown in the chip area in `--danger`.
- On success: the button shows a `Check` for 400 ms before `onConfigured` (feels confirmed, not abrupt).
- **Done when:** compared with `before/02-network.jpg`: centred hero symbol, Paste pill, a recognised invite
  shows the friend's name before Continue, scanning a QR works on the phone (camera permission prompt appears).

### 2.3 Create account  (F7) — `Onboarding.tsx:148-229`
- Hero: a live `Avatar` (88 px) that shows the initials of the name as it's typed (`seed` = the name, or `'kant'`
  when empty) — replaces the app icon. Title **"Create your Kant"**. Lede (unchanged meaning): "Your password
  locks Kant on this device. There's no account, so it can't be reset — keep it somewhere safe."
- Fields as **iOS inset groups** (reuse `Section`/`Cell` + `input.k-cell-input`):
  - group 1: "Your name" (placeholder "Name (optional)"), foot: "Only shared in the invite link you send."
  - group 2: "Password" row and "Confirm" row in **one** rounded group with a hairline between; eye toggle stays
    on the password row; strength bar sits in the section foot.
- `enterKeyHint`: name `next`, password `next`, confirm `go`; Enter on confirm submits (already a form).
- "Already use Kant?" + two plain buttons → **one** plain button "I already use Kant" that opens a small `Sheet`
  with two `Cell`s with icons: "Move from your other phone" (`Refresh`, green) and "Restore a backup" (`Doc`,
  blue), each with its current action.
- **Done when:** compared with `before/05-create.jpg` and `before/08-create-ready.jpg`: avatar updates live, fields
  read as one grouped card, only one secondary action at the bottom.

### 2.4 Unlock and Forgot password — `Onboarding.tsx:397-503`
- Keep the centred layout; app icon 80 px; title **"Kant is locked"**; lede "Enter your password."
- When biometric is ready, put a large round fingerprint button (64 px circle, `--fill`, icon 30 px `--accent`)
  **above** the field and make "Unlock with fingerprint" the first thing users see; the password field stays.
- Password field gets a trailing circular submit button inside the field (32 px, `--accent`, `ArrowUp` rotated
  90°, disabled = `--fill`) — and drop the big separate Unlock button. Enter still submits.
- Wrong password: shake the field (`@keyframes k-shake` 0.4 s, 4 px, honours reduced motion) + existing message.
- Forgot sheet: "Erase and start over" becomes plain red text per 1.4; "Keep trying" primary.

### 2.5 Onboarding never clips  (F8) — `kant.css` `.k-onboard` (`:1388-1411`)
The `@media (min-width: 768px)` rule centres the card with `justify-content: center`, which pushes overflow off
the top. Change to: `.k-onboard { justify-content: flex-start; }` and `.k-onboard-card { margin: auto; }`
(auto margins centre when there's room and fall back to top-aligned when there isn't). Also apply when
`(max-height: 560px)`: no card chrome, normal phone layout.
**Done when:** the phone in landscape shows the whole welcome screen and it scrolls (compare
`before/01b-welcome-landscape.jpg`).

### 2.6 Ask for notifications with a reason  (F9)
- Native only (`Capacitor.isNativePlatform()`). After unlock / setup, if notification permission is not granted
  and `localStorage['kant_notify_prompted'] !== '1'`, `KantApp` `Shell` shows a `Sheet`:
  hero `Bell` symbol (red circle like the settings icon), title "Know when friends write",
  text "Kant can tell you about new messages even when it's closed.", primary **"Turn on notifications"** →
  `ensureNotificationPermission()`, plain **"Not now"**. Either button sets the flag.
- `useKant.ts:670-676`: keep the automatic `ensureNotificationPermission()` only when
  `!Capacitor.isNativePlatform()` (web/desktop keep today's behaviour).
- Settings → Notifications keeps its "Allow" button for later.

---

## Group 3 — Conversation

Files: `Conversation.tsx`, `chat/ChatParts.tsx`, `parts.tsx`, `kant.css` `/* ── Conversation */`, `/* ── Composer */`.

### 3.1 Bubbles with tails; centred header on phones  (F13)
**Tails** on the last bubble of each run (`.k-msg.is-last`), except image-only bubbles (`.has-image`, they keep
their rounded photo) and deleted ones:
```css
.k-msg.is-last .k-bubble:not(.has-image):not(.is-deleted)::before,
.k-msg.is-last .k-bubble:not(.has-image):not(.is-deleted)::after { content: ""; position: absolute; bottom: 0; height: 20px; z-index: -1; }
.k-msg.out.is-last .k-bubble:not(.has-image):not(.is-deleted)::before { right: -7px; width: 20px; background: var(--bubble-out); border-bottom-left-radius: 16px 14px; }
.k-msg.out.is-last .k-bubble:not(.has-image):not(.is-deleted)::after  { right: -10px; width: 10px; background: var(--bg-chat); border-bottom-left-radius: 10px; }
.k-msg.in.is-last  .k-bubble:not(.has-image):not(.is-deleted)::before { left: -7px; width: 20px; background: var(--bubble-in); border-bottom-right-radius: 16px 14px; }
.k-msg.in.is-last  .k-bubble:not(.has-image):not(.is-deleted)::after  { left: -10px; width: 10px; background: var(--bg-chat); border-bottom-right-radius: 10px; }
.k-msg.out.is-last .k-bubble { border-bottom-right-radius: 19px; }
.k-msg.in.is-last  .k-bubble { border-bottom-left-radius: 19px; }
```
Give `.k-thread-inner` `isolation: isolate` so `z-index: -1` stays inside the thread. Check the editing ring
(`.k-msg.is-editing`) and the swipe-to-reply offset still look right.

**Header on phones** (`Conversation.tsx:225-238`, compact only — `useIsCompact()`; desktop keeps today's row):
three-column grid: back chevron (left) · centred stack [avatar 36 px above name 12 px/600 with a 10-px
`ChevronRight`] · info button removed (the whole centre stack opens info). Subtitle ("Online", "2 members") is
not shown on phones — the online dot on the avatar carries it. Bar height 64 px + safe top.
**Done when:** compared with `before/20-chat-after-send.jpg` the last bubble in each run has a tail and the header
looks like iMessage.

### 3.2 Long-press: focused message with blur  (F10)
Replace the popover for **messages** (keep `Menu` for the chat-list row menu and desktop right-click):
- New component `MessageFocus` in `chat/ChatParts.tsx`, rendered through a portal:
  - full-screen layer: `backdrop-filter: blur(18px) saturate(140%)` + `background: color-mix(in srgb, var(--bg) 45%, transparent)`;
  - a **copy of the bubble** (render the same `MessageRow` content, or `cloneNode(true)` of the bubble element)
    positioned at the bubble's `getBoundingClientRect()`, animating `scale(1) → scale(1.03)` with `var(--spring)`;
  - the existing `ReactionBar` as a pill **above** the bubble (left-aligned for incoming, right for outgoing);
  - the actions as a 250-px rounded list (existing `MenuItem`s, same order) **below** the bubble; if there's no
    room below, move the bubble up (translateY) so bar + bubble + list fit between the safe areas.
  - tap outside / Back (1.1) closes; selecting an item closes then runs it.
- Wire-up: `MessageRow` gets a `ref` on the bubble div; `useLongPress(onMenu)` (and `onContextMenu` on touch)
  pass the bubble's rect along with `at`. `openMenu` in `Conversation.tsx:165-176` stores `{ m, rect, items,
  header }` and renders `MessageFocus` on touch devices (`isTouch()`), `Menu` otherwise.
- Haptic `tap()` when it opens (3.6).
**Done when:** long-pressing a message on the phone blurs the chat, lifts the message, reactions above, actions
below — none of it covering the message (compare `before/21-msg-menu.jpg`).

### 3.3 Attach tray  (F11)
`Conversation.tsx:729-731, 782-789`: the "+" opens a `Sheet` (not tall) titled nothing, with a 4-column grid of
round tiles (60 px circle, 26 px white icon, label 12 px below):
| Tile | Icon (`icons.tsx`) | Colour | Action |
|---|---|---|---|
| Photos | `Photo` | `#007aff` | existing `photoRef` (accept `image/*`) |
| Camera | `Camera` | `#8e8e93` | new hidden input `accept="image/*" capture="environment"` |
| File | `Doc` | `#5856d6` | existing `fileRef` |
| Table | `TableIcon` | `#34c759` | `onCreate('table')` |
| Document | `DocText` | `#ff9500` | `onCreate('document')` |
Five tiles wrap to 4 + 1; that's fine. Close the sheet before opening the picker.

### 3.4 Photo viewer  (F12)
Replace `Lightbox` (`Conversation.tsx:530-544`, CSS `.k-lightbox`) with a portaled viewer:
- Background `#000` (no transparency), fade 0.2 s; image fills the space between bars with `object-fit: contain`.
- Top bar (white text): close `Close` icon left; centre: sender name 15 px/600 + time 12 px (use `nameOf(m.from)`
  and `formatTime(m.ts)` — pass the message, not only the URL); bars hide/show on single tap.
- Bottom bar: **Open with…** — only when `canOpenExternally()` (`lib/fileActions.ts:52`): `fetch(objectUrl)` →
  `Uint8Array` → `openExternally(name, mime, bytes)` (`:74`); and **Save** (`store.downloadAttachment(attachment)`
  with the same toast as files). Pass the `MessageAttachment` + message to the viewer, not only the URL.
- Drag down to dismiss: image follows the finger (translateY + scale down to 0.85), background opacity follows;
  release > 120 px closes, else springs back. Double-tap toggles 2× zoom centred on the tap (CSS transform).
- Registers with the back stack (1.1).

### 3.5 Small fixes in the conversation
- **F14:** `Conversation.tsx:234`: online colour only when the subtitle is the online label:
  `const subOnline = isDm && !isRequest && !!contact!.online;` → use it for `is-online`.
- Request bar (`Conversation.tsx:548-567`): put it in a `.k-callout`-style card (radius 16, `--surface-2`) above
  the composer area, title "{name} wants to message you", the name field as a `Cell` input, buttons Block (plain
  red text) and Accept (primary).
- Day separator `.k-day`: 12 px/600 `--text-3`, format "Today 20:07" (iOS) — `dayLabel(m.ts)` + `formatTime(m.ts)`.
- `Composer`: when not connected the note above the composer is fine; keep.

### 3.6 Haptics  (F21)
- `pnpm --dir packages/app add @capacitor/haptics@^6` then `npx cap sync android` (and iOS when building it).
- `packages/app/src/lib/haptics.ts`: `tap()` = `Haptics.impact({ style: ImpactStyle.Light })`,
  `select()` = `selectionStart()` → `selectionChanged()` → `selectionEnd()` (iOS needs the start/end pair),
  `success()` / `warning()` = `Haptics.notification({ type: NotificationType.Success | Warning })` — each a no-op
  unless `Capacitor.isPluginAvailable('Haptics')`, each wrapped in `catch(() => {})`, never awaited by callers.
- Call sites: message focus opens (3.2) `tap`; reaction picked `select`; swipe-to-reply passes its threshold
  (`chat/ChatParts.tsx` `useBubbleGestures`) `select`; voice recording starts / locks / cancels (`VoiceComposer.tsx`)
  `tap`; message sent `tap` (light); `Switch` toggled (`parts.tsx:117`) `select`; verify "They match" `success`;
  wrong unlock password `warning`; sheet dismissed by swipe `tap`.

---

## Group 4 — Settings

### 4.1 Settings as pages  (F15, F17)
`Settings.tsx` keeps all its section components; only the structure changes.

Root page (large title "Settings"):
1. **Profile card** (`Settings.tsx:60-69`): avatar 64, name 22 px/600, subtitle **"Kant ID · 27EA 571A"**
   (`shortId(meHex)`), then the "My code" row inside the same group.
2. **Delivery warning** — only when something is wrong (from the existing health check): one orange row
   `Alert` icon "Messages may not arrive while Kant is closed" › opens Notifications. Nothing when all is good.
3. Group: **Notifications** (red `Bell`, value "On" / "Off") › · **Appearance** (gray `Moon`, value
   Automatic/Light/Dark) › · **Chats** (green `Bubble`) ›
4. Group: **Privacy & Security** (blue `Shield`) › · **Backup & Transfer** (green `Refresh`) ›
5. Group: **Network** (teal `Globe`, value = status dot + "Connected" / "Offline") ›
6. Group: How Kant protects you · Terms of Service · Help & community · Source code (unchanged links).
7. "Erase this device" (centred red) — foot becomes: **"Deletes your identity, contacts and messages from this
   device. Unless you saved a backup, this can't be undone."**
8. Version footer.

Sub-pages (each: bar with back "‹ Settings", large title, `k-push` animation, Back stack registration 1.1):
- **Notifications:** `DeliveryHealth` / `IosDeliveryNote` rows + their foot. Extract the health check into a hook
  `useDeliveryHealth()` so the root warning row and the page share it.
- **Appearance:** Theme as three rows with a check (`Cell selected`): Automatic / Light / Dark (iOS style) instead
  of the segmented control.
- **Chats:** `ChatSettings`. Quick reaction: label row, then the segmented control full-width on its own row
  (`.k-seg-full`, like Auto-lock), so the label no longer wraps. Foot on touch devices: "Formatting:
  \*\*bold\*\*, \_italic\_, \~\~strike\~\~, \`code\`. Select text while typing for the formatting bar." — drop the
  Ctrl/⌘ shortcuts when `isTouch()`.
- **Privacy & Security:** `SecuritySection` + Extra privacy switch + Blocked row (move them from "Privacy").
  Give Screen security the `EyeOff` icon (gray) so it no longer shares the lock icon with Auto-lock.
- **Backup & Transfer:** the two rows + foot.
- **Network:** Status, Relay ›, Diagnostics › (unchanged sheets).

Implementation: `const [page, setPage] = useState<Page>('root')` in `SettingsPane`; render
`<SettingsPage title="…" onBack={() => setPage('root')}>…</SettingsPage>` (new small component in `Settings.tsx`
mirroring the existing bar markup at `:52-58`). Keep each page's scroll position independent (`key={page}`).
**Done when:** the root fits on about one and a half phone screens; every option from the old page is reachable;
Back from a sub-page returns to the root, Back on the root returns to Chats.

### 4.2 Task sheets: Backup, Move, Duress, Relay  (F16)
Common pattern (new tiny component `TaskSheetHero({ icon, tone, title, children })` in `parts.tsx`):
SheetHead with Cancel · hero (64 px circle in the tone's tint, icon 30 px; title-2; 15-px `--text-2` text, max
3 lines) · inputs as an inset `Section` with `Cell` + `input.k-cell-input` (type password) · details as the
section foot · the primary button **pinned** in `.k-sheet-foot`.
- **Backup** (`TransferSheets.tsx:42-60`): icon `Doc`, blue. Hero text: "One encrypted file with your identity,
  contacts and messages. Anyone with the file **and** your password can become you." The "Include photos and
  files" switch row + password row in one group. Restore hint → foot.
- **Move** (`TransferSheets.tsx:114-170`): icon `Refresh`, green. Steps as a numbered inset list (each step a
  `Cell` with a 24-px numbered circle) instead of an `<ol>`. The SAS code (`.k-sas`) stays big; put it in a
  `--surface` card.
- **Duress** (`Settings.tsx:463-525`): icon `ShieldAlert`, red. Hero text: "If someone forces you to unlock
  Kant, type this instead. Kant silently erases everything and opens a new, empty account." Rest of the current
  paragraph goes to the foot (don't drop the "nothing shows that a duress password was set" claim).
- **Relay** (`Settings.tsx:168-219`): show the URL in normal font (not mono) with the host bold; "Your address"
  row: label "Copy your address", tone action, no value.

---

## Group 5 — Chat list and loose ends

### 5.1 Empty states  (F18) — `ChatList.tsx:74, 108-126`
- When `items.length === 0 && !q && requests.length > 0`: under the requests row, a compact empty state (no
  buttons): `Bubble` symbol in a soft circle, "No chats yet", "Accept a request or share your code to start one."
  with a plain button "Share my code".
- Requests row (`.k-requests-row`): make it a normal list row (avatar-sized 54 px circle with `PersonAdd` in
  `--accent-tint`, title "Message requests", subtitle "{n} people want to message you", chevron) instead of a
  tinted pill, so it sits in the list like iOS "Unknown Senders".
- Main empty state (`:108-117`): keep, but use the soft-circle hero symbol (`QR`) and move it to the vertical
  optical centre (`min-height: 70vh`).

### 5.2 Group previews survive unlock  (F19)
`ui/core/realkant.tsx:155-157, 302-313`: `groupLast` only holds groups seen this session. Hydrate once after
unlock, like DMs are hydrated at `:183-200`:
- in `hooks/useGroups.ts` add `async function lastMessages(): Promise<Record<string, PlainMessage>>` that, for each
  group, calls `getGroupMessages(group.id)` and decrypts only what `rowsToThread` needs (reuse it as `selectGroup`
  does at `:901-902`; taking the last row of the result is fine for now), and export it in the returned API
  (`:1297`).
- in `realkant.tsx`, an effect keyed on the identity + group ids calls it once and merges into `groupLast` (live
  updates win: only set entries that are still missing).
**Done when:** lock and unlock on the phone — the group row still shows "Welcome to the group! Who's bringing
snacks?" and sorts by that message's time.

### 5.3 Themed launcher icon  (F20)
`android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml`: add
`<monochrome android:drawable="@mipmap/ic_launcher_foreground"/>` inside `<adaptive-icon>`. The foreground PNGs
are transparent (checked 2026-11-12), so Android can tint their shape. Check on the phone's home screen with
themed icons on.

---

## Section 7 — How to look at it on the phone (cheap)

The owner's phone is on USB with debugging on. **Never uninstall, clear or update `com.kant.messenger` — that's
the owner's real install with their identity.** All testing uses a separate app id,
`com.kant.messenger.uireview`, built by the helper:

```bash
docs/ui-redesign/tools/phone.sh build                       # ~1 min after the first gradle download
adb shell pm clear com.kant.messenger.uireview              # fresh onboarding (review build ONLY)
docs/ui-redesign/tools/phone.sh launch
docs/ui-redesign/tools/phone.sh shot 01-welcome             # → /tmp/kant-shots/01-welcome.jpg (read the .jpg)
docs/ui-redesign/tools/phone.sh text "Agree and continue"   # real tap on a button by its text / aria-label
docs/ui-redesign/tools/phone.sh eval "document.querySelector('.k-app')?.dataset.view"
docs/ui-redesign/tools/phone.sh back
```
- The build needs JDK 21 (`/usr/lib/jvm/java-21-openjdk`; the default JDK 27 is too new for AGP) — the helper sets it.
- Type into a focused field with `adb shell input text "words%swith%sspaces"`.
- Relay for testing: `https://majesticrelay.duckdns.org` (production relay; normal client use is fine, don't
  load-test it).
- A second user to chat with: `pnpm --dir packages/app dev`, open it in a browser at 390×844, onboard there by
  pasting the phone user's invite link into the network step (it sets the relay and adds the contact). Get the
  phone's invite link with:
  ```bash
  docs/ui-redesign/tools/phone.sh eval "(()=>{const o=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=t=>{window.__c=t;return o(t).catch(()=>{})};[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Copy link').click();return new Promise(r=>setTimeout(()=>r(window.__c),400))})()"
  ```
  (with the My code sheet open). Test passwords: generate one, keep it out of chat and out of git.
- Screens to check after each group, in **both** themes (Settings → Appearance), in portrait and once in
  landscape: welcome · network · create · chat list (empty, with a request, with chats) · a DM with text, a photo,
  a CSV, a link, a reaction · a group · long-press menu · attach · photo viewer · contact info · verify · My code ·
  Settings root and every sub-page · Backup · Move · Duress · Relay · lock/unlock. Compare with `before/`.
- Desktop width: the same dev server at 1280×800 — the two-pane layout must still work (no centred phone header,
  no card-stack scaling, no swipe-to-dismiss).

## Section 8 — Final pass (last commit)
- Run the checks in section 0 (rule 7), plus `pnpm --dir packages/app build:electron` (Inter must load from `./assets`).
- Walk the full list in section 7 on the phone in both themes; fix anything that looks off.
- Write `release-notes/unreleased.md` entries in the existing style (user-facing, one line each): new look for
  setup, swipe to close, system bars, photo viewer, settings pages, haptics, fixed: Back button, group previews,
  request colour, landscape setup.
- Tell the owner: what changed (one line per group), anything skipped and why, and that nothing was pushed.
