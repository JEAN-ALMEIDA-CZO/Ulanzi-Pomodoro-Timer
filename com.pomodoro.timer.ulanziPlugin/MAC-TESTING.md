# macOS — Validation Guide (for the Ulanzi team)

Plugin: **Pomodoro Timer** (`com.pomodoro.timer.ulanziPlugin`)
UUID: `com.pomodoro.timer.deck`

The plugin was developed and tested on **Windows**. All Windows-specific code
(PowerShell, AppUserModelID shortcut, registry, `%APPDATA%`, `.lnk`) is **gated**
behind `os.platform() === 'win32'` and never runs on macOS. The macOS path uses
`osascript` (or `terminal-notifier`, see below). This document is a checklist to
validate on a real Mac.

> Author has no Mac — please validate functionality and notifications, and report
> anything that misbehaves.

---

## 1. Functional checklist

| # | Test | Expected |
|---|------|----------|
| 1 | Add the **Pomodoro Timer** key to the deck | Key shows ring + time (e.g. `25:00`, `FOCUS`) |
| 2 | Press the key | Starts / pauses / resumes |
| 3 | Change **theme** and **font** in the panel | Key updates in real time (confirms vector-font rendering) |
| 4 | **Custom color** + **ring animation** (Pulse/Comet/Sweep) + **Glossy text** | Key reflects each, live |
| 5 | Set Focus to **1 min** to test fast | Last 7 s **blink** → phase ends → next phase auto-starts |
| 6 | Complete a full cycle (lower all durations) | Long break → **green ✓ blinks for 5 s** → back to READY |
| 7 | Progress **dots** | Match the configured pomodoro count / completed |
| 8 | Switch the Ulanzi UI language | Key labels + settings panel + tutorial all translate |
| 9 | Click **Tutorial** | Opens the tutorial page in the browser (with favicon) |
| 10 | **Reset Timer** button | Returns to idle READY |

Boot log (diagnostics): `"$TMPDIR/pomodoro_boot.log"` — shows version + pid.

---

## 2. Notifications

Enable the **Notify** toggle in the settings panel, then end a phase (use 1-min
durations). A macOS notification should appear with sound **Glass**.

### Current behavior (no extra setup)
- Uses `osascript display notification`.
- **Title** = plugin name (localized) ✓
- **Body** = phase message (localized) ✓
- **Attribution (top-left name + icon)** = **"Script Editor"** — this is a macOS
  limitation: the banner identity comes from the *posting bundle*, not a parameter.
- If nothing shows → **System Settings → Notifications** (allow Script Editor),
  and **Privacy & Security** may prompt on first run.

### To match the Windows experience (custom name + icon)
The plugin auto-detects a bundled **`terminal-notifier.app`** and, if present, uses
it with the per-phase icon as `-contentImage`. Rebrand + sign that bundle so the
banner shows **"Pomodoro Timer" + custom icon**.

Full step-by-step: see [`assets/mac/README.md`](assets/mac/README.md). Summary:
1. `brew install terminal-notifier` (MIT, open source).
2. Edit `Info.plist` → `CFBundleName` / `CFBundleDisplayName` = `Pomodoro Timer`,
   `CFBundleIdentifier` = `com.pomodoro.timer.notifier`.
3. Replace the app icon with `assets/icons/brand-red.png` converted to `.icns`.
4. **Re-sign** — ad-hoc (`codesign --force --deep --sign -`) for testing, or
   **Developer ID + notarization** for distribution.
5. Place it at `assets/mac/terminal-notifier.app`.

`plugin/app.js → notifyOS()` already calls:
```
terminal-notifier -title "<name>" -message "<msg>" -sound Glass -contentImage <icon.png>
```
and falls back to `osascript` if the bundle is missing — nothing breaks either way.

> Signing/notarization requires Apple tools (`codesign`, `notarytool`) and an Apple
> Developer account — must be done on macOS by the team.

---

## 3. Tech notes

- Backend: Node.js over WebSocket (`ws`).
- Timer digits = **vector paths** via `opentype.js` + bundled OFL/Apache fonts
  (Roboto / Roboto Mono / Roboto Slab / Orbitron) — font changes render correctly
  on any rasterizer, including macOS.
- Key images generated **frame by frame** as base64 SVG.
- No native binaries; pure JS deps (`ws`, `opentype.js`).
- Paths use `path.join` + `import.meta.url`; `getPluginPath()` handles `/` and `\`.

Thanks for validating! — Jean Almeida
