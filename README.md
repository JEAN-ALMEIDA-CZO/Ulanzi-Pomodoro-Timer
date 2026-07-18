<p align="center">
  <img alt="Pomodoro Timer" src="/com.pomodoro.timer.ulanziPlugin/assets/icons/brand-red.png" width="12%">
</p>
<h1 align="center">Pomodoro Timer — Ulanzi Deck Plugin</h1>

<p align="center">
  <b>A focus timer on a single key.</b><br>
  Runs the full Pomodoro flow — focus, short break, long break — right on your Ulanzi Deck.
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.0.1-E74C3C">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-1a1a1a">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-E74C3C">
  <img alt="i18n" src="https://img.shields.io/badge/i18n-10%20locales-27AE60">
</p>
<img alt="Pomodoro Timer banner" src="/com.pomodoro.timer.ulanziPlugin/assets/icons/brand-og.png">

---

## ✨ What it does

One key becomes a complete Pomodoro timer:

- **Full Pomodoro flow** — focus → short break → every 4 pomodoros a long break — running automatically.
- **Press to start / pause** — single click starts, pauses and resumes the countdown.
- **Long press to reset** — **hold the key ~1.5 s to restart** the timer, no need to open the settings panel. (Falls back gracefully to press-only on older Ulanzi Studio builds.)
- **Live countdown ring** — drains as time runs out; the centre shows the time left (mm:ss) in a real vector font.
- **Progress dots** — how many pomodoros are set and how many you've completed.
- **Per-phase colours** — focus, short break and long break each have their own colour; the last 7 seconds blink, and a green ✓ blinks when the cycle completes.
- **9 themes** (Classic, Minimal, Neon, Ocean, Forest, Sunset, Dracula, Coffee, Mono) + custom color, **4 vector fonts** (Sans / Mono / Serif / Display), ring & background animations, optional text shimmer.
- **Desktop notifications** (Windows + macOS) announce each phase change.
- **Built-in tutorial** — a modern, fully-localized guide (the Pomodoro method, how to use the key, and every state).

Everything runs **locally** — no accounts, no API keys, no telemetry.

---

## 🎛️ Settings

| Option | Description |
|--------|-------------|
| **Focus** | Focus length in minutes (default 25). |
| **Short break** | Short break length (default 5). |
| **Long break** | Long break length (default 15). |
| **Pomodoros before long break** | How many focus sessions before the long break (default 4). |
| **Notify** | Desktop alert on each phase change. |
| **Theme / Font** | Colour palette and typeface for the digits. |
| **Animation** | Ring style (clean / glow / …) + background animation + optional text shimmer. |

---

## ⌨️ Controls

| Gesture | Action |
|---------|--------|
| **Short press** | Start · Pause · Resume (and dismiss the completion screen). |
| **Long press (~1.5 s)** | Reset the timer back to READY. |

> The long press uses the Ulanzi `keydown` / `keyup` events (Plugin Protocol V2.1.2, Ulanzi Studio 3.0.11+). On older builds that don't emit them, the key keeps its original press-only behaviour — nothing breaks.

---

## 🍅 The Pomodoro method

1. Pick one task.
2. Focus fully for **25 minutes** (one pomodoro).
3. Take a **5-minute** short break.
4. Every **4 pomodoros**, take a longer **15–30 minute** break.
5. Repeat — the long break lets your mind recover.

---

## 🌍 Languages

English · Português (BR/PT) · Español · Deutsch · Français · 日本語 · 한국어 · 中文 (简体/繁體)

UI and the built-in **tutorial page** auto-detect the Ulanzi/system language.

---

## 💾 Installation

### From the Ulanzi Store
Search for **Pomodoro Timer** in the UlanziDeck plugin store and install.

### Manual / from source
1. Clone or download this repository.
2. Run `npm install` (installs `opentype.js` and `ws`).
3. Copy the folder `com.pomodoro.timer.ulanziPlugin` into:
   - **Windows:** `%AppData%\Roaming\Ulanzi\UlanziDeck\Plugins\`
   - **macOS:** `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`
4. Restart **UlanziDeck Studio**.

> Requires UlanziDeck software **2.1.0+**. Long-press reset needs **3.0.11+**.

---

## 🛠️ Tech & compatibility

- **Cross-platform** — `os`/`path` aware, no hardcoded paths. Windows + macOS.
- **No native binaries** — pure-JS dependencies (`opentype.js`, `ws`), fully portable.
- **Lightweight** — the countdown uses a single 1 s tick; animated rings/backgrounds run a low-fps loop; **vector digits are cached** and **identical frames are never re-sent to the deck**, so a resting key barely touches the CPU.
- **Vector digits** — fonts converted to SVG paths so the chosen font renders on every deck renderer, on Windows and macOS.
- **One instance per action** — moving a key to another slot cleans up the old instance (no flicker or duplicate timers).

---

## 📦 Project structure

```
com.pomodoro.timer.ulanziPlugin/
├── manifest.json
├── plugin/app.js               # backend: timer state + SVG renderer + notifications
├── property-inspector/
│   ├── inspector.html / .js     # settings panel
│   └── tutorial.html            # modern multi-language guide
├── libs/                        # Ulanzi SDK + css
├── assets/                      # icons, fonts
├── <locale>.json                # localization files
├── LICENSE
└── THIRD-PARTY-LICENSES.md
```

---

## 📄 License

Released under the **MIT License** — see [LICENSE](com.pomodoro.timer.ulanziPlugin/LICENSE).
Bundled libraries and fonts are credited in [THIRD-PARTY-LICENSES.md](com.pomodoro.timer.ulanziPlugin/THIRD-PARTY-LICENSES.md).

---

<p align="center">Made by <b>Jean Almeida</b> for the Ulanzi Deck community.</p>
