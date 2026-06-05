import UlanzideckApi from '../libs/node/ulanzideckApi.js';
import { exec, execFile } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import opentype from 'opentype.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_DIR = path.join(__dirname, '..', 'assets', 'icons');

const PLUGIN_VERSION = '1.0.0';
const BOOT_LOG = path.join(os.tmpdir(), 'pomodoro_boot.log');

// Write a boot stamp so it's easy to confirm the latest code is actually running
// (the Node backend is a long-lived process; closing the panel does NOT reload it).
function bootLog(stage) {
  const line = `[${new Date().toLocaleString()}] Pomodoro v${PLUGIN_VERSION} — ${stage} (pid ${process.pid})`;
  console.log('[Pomodoro]', line);
  try { fs.writeFileSync(BOOT_LOG, line + '\n'); } catch (e) {}
}

bootLog('process start');

const NOTIFY_ICONS = {
  focus: path.join(ICON_DIR, 'notify_focus.png'),  // "time for a break" / focus-related
  break: path.join(ICON_DIR, 'notify_break.png'),  // "back to focus"
  done:  path.join(ICON_DIR, 'notify_done.png')    // cycle complete
};
const NOTIFY_APP_ICON = NOTIFY_ICONS.focus; // attribution logo (registry IconUri)

const BLINK_AT = 7; // start blinking when this many seconds remain

const THEMES = {
  classic: { focus: '#E74C3C', shortBreak: '#27AE60', longBreak: '#2980B9', bg: '#1a1a1a', track: '#2d2d2d' },
  minimal: { focus: '#FF6B6B', shortBreak: '#6BCB77', longBreak: '#4D96FF', bg: '#0d0d0d', track: '#1e1e1e' },
  neon:    { focus: '#FF0040', shortBreak: '#00FF88', longBreak: '#00BFFF', bg: '#0a0a1a', track: '#1a1a2e' },
  ocean:   { focus: '#00B4D8', shortBreak: '#48CAE4', longBreak: '#0077B6', bg: '#011627', track: '#10314a' },
  forest:  { focus: '#52B788', shortBreak: '#95D5B2', longBreak: '#2D6A4F', bg: '#0b1e16', track: '#1b3a2c' },
  sunset:  { focus: '#FF5E5B', shortBreak: '#FFB400', longBreak: '#D7263D', bg: '#1a0f14', track: '#3a2027' },
  dracula: { focus: '#BD93F9', shortBreak: '#50FA7B', longBreak: '#8BE9FD', bg: '#282A36', track: '#44475A' },
  coffee:  { focus: '#C08552', shortBreak: '#A3B18A', longBreak: '#774936', bg: '#1c1614', track: '#3a2e29' },
  mono:    { focus: '#FFFFFF', shortBreak: '#BBBBBB', longBreak: '#888888', bg: '#000000', track: '#333333' }
};

const DONE_COLOR = '#2ECC71';  // completion is always green, regardless of theme

// ── color helpers (shimmer/animation highlight = contrast of the dominant color) ──
function hexToRgb(h) {
  h = String(h).replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
// shimmer/animation highlight: a LIGHTER shade of the same color (keeps the hue,
// e.g. orange → light orange). If the color is already near-white, darken a touch
// so the moving band still contrasts.
function contrastColor(hex) {
  if (!/^#?[0-9a-fA-F]{6}$/.test(String(hex || ''))) return '#FFFFFF';
  const { r, g, b } = hexToRgb(hex);
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (L > 0.85) return rgbToHex(r * 0.7, g * 0.7, b * 0.7);                          // near-white → slightly darker
  return rgbToHex(r + (255 - r) * 0.55, g + (255 - g) * 0.55, b + (255 - b) * 0.55); // lighter same hue
}

// timer fonts (must be system fonts available on Win/Mac)
// The deck's SVG rasterizer ignores font-family for system fonts (only its
// default font renders). So the timer DIGITS are converted to vector paths with
// opentype.js + bundled OFL fonts — this makes the font actually change on the
// key, on any renderer and on both Windows and Mac.
const FONT_DIR   = path.join(__dirname, '..', 'assets', 'fonts');
const FONT_FILES = { sans: 'sans.ttf', mono: 'mono.ttf', serif: 'serif.ttf', display: 'display.ttf' };
const _fontCache = {};

function loadFont(key) {
  if (key in _fontCache) return _fontCache[key];
  try {
    const file = FONT_FILES[key] || FONT_FILES.sans;
    _fontCache[key] = opentype.parse(fs.readFileSync(path.join(FONT_DIR, file)).buffer);
  } catch (e) {
    console.error('[Pomodoro] font load failed:', key, e.message);
    _fontCache[key] = null;
  }
  return _fontCache[key];
}

// glyph-by-glyph (charToGlyph) avoids opentype's GSUB/ccmp feature crash
function textToPath(font, text, fontSize, letterSpacing = 0) {
  const full = new opentype.Path();
  let x = 0;
  const scale = fontSize / font.unitsPerEm;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    full.extend(g.getPath(x, 0, fontSize));
    x += g.advanceWidth * scale + letterSpacing;
  }
  return full;
}

// time digits as a centered vector <path>; falls back to <text> if font missing
function glyphSVG(fontKey, text, cx, cy, fontSize, fill, opacity) {
  const font = loadFont(fontKey);
  if (!font) {
    return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
      fill="${fill}" font-size="${fontSize}" font-weight="bold"
      font-family="Arial, Helvetica, sans-serif" opacity="${opacity}">${text}</text>`;
  }
  const p  = textToPath(font, text, fontSize);
  const bb = p.getBoundingBox();
  const dx = cx - (bb.x1 + (bb.x2 - bb.x1) / 2);
  const dy = cy - (bb.y1 + (bb.y2 - bb.y1) / 2);
  return `<path transform="translate(${dx.toFixed(1)} ${dy.toFixed(1)})" d="${p.toPathData(2)}" fill="${fill}" opacity="${opacity}"/>`;
}

const PHASE_LABELS_DEFAULT = {
  idle:       'READY',
  focus:      'FOCUS',
  shortBreak: 'BREAK',
  longBreak:  'REST',
  paused:     'PAUSED',
  done:       'DONE'
};

// ── OS desktop notification ───────────────────────────────────────────────────
const NOTIFY_APP_ID = 'com.pomodoro.timer.deck';
let _lastEnsuredTitle = '';  // last app name registered as a Start Menu shortcut

// escape a string for embedding inside a PowerShell double-quoted literal
function psEscape(str) {
  return String(str).replace(/`/g, '``').replace(/\$/g, '`$').replace(/"/g, '`"');
}

// C# interop that sets PKEY_AppUserModel_ID on a .lnk (compiled once per PS run)
const AUMID_CSHARP =
  `using System;\n` +
  `using System.Runtime.InteropServices;\n` +
  `namespace AumidLnk {\n` +
  `  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] public class CShellLink {}\n` +
  `  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]\n` +
  `  public interface IShellLinkW {\n` +
  `    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder f, int c, IntPtr p, uint fl);\n` +
  `    void GetIDList(out IntPtr ppidl); void SetIDList(IntPtr pidl);\n` +
  `    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder p, int c);\n` +
  `    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string p);\n` +
  `    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder p, int c);\n` +
  `    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string p);\n` +
  `    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder p, int c);\n` +
  `    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string p);\n` +
  `    void GetHotkey(out short w); void SetHotkey(short w);\n` +
  `    void GetShowCmd(out int i); void SetShowCmd(int i);\n` +
  `    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder p, int c, out int i);\n` +
  `    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string p, int i);\n` +
  `    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string p, uint dw);\n` +
  `    void Resolve(IntPtr hwnd, uint fl);\n` +
  `    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string p);\n` +
  `  }\n` +
  `  [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]\n` +
  `  public interface IPersistFile {\n` +
  `    void GetClassID(out Guid id); [PreserveSig] int IsDirty();\n` +
  `    void Load([MarshalAs(UnmanagedType.LPWStr)] string f, int m);\n` +
  `    void Save([MarshalAs(UnmanagedType.LPWStr)] string f, [MarshalAs(UnmanagedType.Bool)] bool r);\n` +
  `    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string f);\n` +
  `    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string f);\n` +
  `  }\n` +
  `  [StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid fmtid; public int pid; }\n` +
  `  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]\n` +
  `  public interface IPropertyStore {\n` +
  `    void GetCount(out uint c); void GetAt(uint i, out PropertyKey k);\n` +
  `    void GetValue(ref PropertyKey k, out PropVariant pv);\n` +
  `    void SetValue(ref PropertyKey k, ref PropVariant pv); void Commit();\n` +
  `  }\n` +
  `  [StructLayout(LayoutKind.Explicit)] public struct PropVariant {\n` +
  `    [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p;\n` +
  `  }\n` +
  `  public static class Lnk {\n` +
  `    public static void Create(string lnkPath, string target, string aumid) {\n` +
  `      var link = (IShellLinkW)new CShellLink();\n` +
  `      link.SetPath(target);\n` +
  `      var store = (IPropertyStore)link;\n` +
  `      var key = new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };\n` +
  `      var pv = new PropVariant { vt = 31, p = Marshal.StringToCoTaskMemUni(aumid) };\n` +
  `      store.SetValue(ref key, ref pv); store.Commit();\n` +
  `      Marshal.FreeCoTaskMem(pv.p);\n` +
  `      ((IPersistFile)link).Save(lnkPath, true);\n` +
  `    }\n` +
  `  }\n` +
  `}\n`;

// run a PowerShell script via a temp .ps1 file (avoids the 8191-char cmdline limit)
function winRunPs(script) {
  const tmp = path.join(os.tmpdir(), `pomodoro_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
  try {
    fs.writeFileSync(tmp, '﻿' + script, 'utf8'); // BOM so PowerShell reads UTF-8 (accents/CJK)
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${tmp}"`,
      () => { try { fs.unlinkSync(tmp); } catch (e) {} });
  } catch (e) { /* ignore */ }
}

// debounce so a rapid burst of title updates (default → saved → language switch)
// collapses into a single registration with the final name (avoids stale shortcuts)
let _ensureTimer = null;
let _pendingTitle = '';
function ensureWinIdentity(title) {
  if (os.platform() !== 'win32' || !title) return;
  _pendingTitle = title;
  if (_ensureTimer) clearTimeout(_ensureTimer);
  _ensureTimer = setTimeout(() => { _ensureTimer = null; registerWinIdentity(_pendingTitle); }, 600);
}

// Pre-register the Start Menu shortcut + registry identity for the (localized)
// app name. Done EARLY (on title change) so Windows has time to index the new
// shortcut before the first notification — otherwise the first toast after a
// language switch shows the old/untranslated name.
function registerWinIdentity(title) {
  if (os.platform() !== 'win32' || !title || title === _lastEnsuredTitle) return;
  const display  = psEscape(title);
  const appIcon  = psEscape(NOTIFY_APP_ICON);
  const programs = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const safeName = (String(title).replace(/[<>:"/\\|?*\n\r]/g, '').trim()) || 'Pomodoro Timer';
  const desiredLnk = path.join(programs, safeName + '.lnk');
  const recordFile = path.join(os.tmpdir(), 'com.pomodoro.timer.deck.notify_lnk');
  let oldLnk = '';
  try { oldLnk = fs.readFileSync(recordFile, 'utf8').trim(); } catch (e) {}

  const lnkPs = psEscape(desiredLnk);
  const oldPs = psEscape(oldLnk);

  const script =
    `$AppId='${NOTIFY_APP_ID}'\n` +
    `$lnk="${lnkPs}"\n` +
    `$old="${oldPs}"\n` +
    `if($old -and ($old -ne $lnk) -and (Test-Path -LiteralPath $old)){Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue}\n` +
    `if(-not(Test-Path -LiteralPath $lnk)){\n` +
    `Add-Type -Language CSharp -TypeDefinition @'\n` + AUMID_CSHARP + `'@\n` +
    `[AumidLnk.Lnk]::Create($lnk,"${appIcon}",$AppId)\n` +
    `Start-Sleep -Milliseconds 300\n` +
    `}\n` +
    `$reg="HKCU:\\Software\\Classes\\AppUserModelId\\$AppId"\n` +
    `if(-not(Test-Path $reg)){New-Item -Path $reg -Force | Out-Null}\n` +
    `New-ItemProperty -Path $reg -Name DisplayName -Value "${display}" -PropertyType String -Force | Out-Null\n` +
    `New-ItemProperty -Path $reg -Name IconUri -Value "${appIcon}" -PropertyType String -Force | Out-Null\n` +
    `$cache="HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\$AppId"\n` +
    `if(Test-Path $cache){Remove-Item -Path $cache -Recurse -Force -ErrorAction SilentlyContinue}\n`;

  try { fs.writeFileSync(recordFile, desiredLnk, 'utf8'); } catch (e) {}
  _lastEnsuredTitle = title;
  winRunPs(script);
}

// show the toast only (assumes identity already registered)
function showWinToast(title, message, iconPath) {
  const t    = psEscape(title);
  const m    = psEscape(message);
  const icon = psEscape(iconPath || NOTIFY_APP_ICON);
  const script =
    `$AppId='${NOTIFY_APP_ID}'\n` +
    `$null=[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]\n` +
    `$xml=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastImageAndText02)\n` +
    `$tx=$xml.GetElementsByTagName('text')\n` +
    `$tx.Item(0).AppendChild($xml.CreateTextNode("${t}"))|Out-Null\n` +
    `$tx.Item(1).AppendChild($xml.CreateTextNode("${m}"))|Out-Null\n` +
    `$img=$xml.GetElementsByTagName('image')\n` +
    `$img.Item(0).SetAttribute('src',"${icon}")|Out-Null\n` +
    `$img.Item(0).SetAttribute('placement','appLogoOverride')|Out-Null\n` +
    `$toast=[Windows.UI.Notifications.ToastNotification]::new($xml)\n` +
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($toast)\n`;
  winRunPs(script);
}

// macOS: prefer `terminal-notifier` (its app bundle drives the banner's name +
// icon — rebrand/sign it for Windows-style attribution). Bundled copy first,
// then common Homebrew/PATH locations.
const MAC_NOTIFIER_CANDIDATES = [
  path.join(__dirname, '..', 'assets', 'mac', 'terminal-notifier.app', 'Contents', 'MacOS', 'terminal-notifier'),
  '/opt/homebrew/bin/terminal-notifier',
  '/usr/local/bin/terminal-notifier',
  '/usr/bin/terminal-notifier'
];
function findMacNotifier() {
  for (const p of MAC_NOTIFIER_CANDIDATES) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  return null;
}

// fallback: native osascript notification (title is shown, but the banner is
// attributed to "Script Editor" — no custom app name/icon without a signed app)
function macOsascript(title, message) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const ascript = `display notification "${esc(message)}" with title "${esc(title)}" sound name "Glass"`;
  execFile('osascript', ['-e', ascript], (err, _o, stderr) => {
    if (err) {
      console.error('[Pomodoro] osascript notify failed:', err.message);
      if (stderr) console.error('[Pomodoro] osascript stderr:', String(stderr).trim());
      console.log(`[Pomodoro] (notify) ${title}: ${message}`);
    }
  });
}

function notifyOS(title, message, iconPath) {
  try {
    if (os.platform() === 'win32') {
      if (title && title !== _lastEnsuredTitle) {
        // identity not yet registered for this name (rare — setConfig usually
        // pre-warms it). Register now, then toast after a delay so Windows can
        // index the new shortcut. (debounce 600ms + shortcut create ~1.5s)
        ensureWinIdentity(title);
        setTimeout(() => showWinToast(title, message, iconPath), 2500);
      } else {
        showWinToast(title, message, iconPath);
      }
    } else if (os.platform() === 'darwin') {
      const tn = findMacNotifier();
      if (tn) {
        // execFile (no shell) → args passed safely (apostrophes/accents OK)
        const args = ['-title', String(title), '-message', String(message), '-sound', 'Glass'];
        if (iconPath) args.push('-contentImage', String(iconPath)); // per-phase icon (right thumbnail)
        execFile(tn, args, (err) => {
          if (err) { console.error('[Pomodoro] terminal-notifier failed:', err.message); macOsascript(title, message); }
        });
      } else {
        macOsascript(title, message);
      }
    } else {
      console.log(`[Pomodoro] (notify, ${os.platform()}) ${title}: ${message}`);
    }
  } catch (e) { /* ignore */ }
}

// ── SVG key renderer ──────────────────────────────────────────────────────────
function generateSVG(opts) {
  const { timeLeft, totalTime, phase, displayLabel, dimmed, flash,
          completedPomodoros, maxPomodoros, theme, font, customColor,
          ringAnim, animFrame, textShimmer, running, bgAnim } = opts;

  const t = THEMES[theme] || THEMES.classic;
  const isDone = phase === 'done';

  // 'done' uses the break/success color
  const colorPhase = phase === 'idle' ? 'focus'
                   : isDone            ? 'shortBreak'
                   : phase;
  const themeColor = colorPhase === 'focus'      ? t.focus
                   : colorPhase === 'shortBreak' ? t.shortBreak
                   : t.longBreak;
  // custom color (color picker) overrides the theme phase color when set
  let ringColor    = (customColor && /^#[0-9a-fA-F]{6}$/.test(customColor)) ? customColor : themeColor;
  if (isDone) ringColor = DONE_COLOR;  // completion is always green
  // highlight used by shimmer + ring animations = auto contrast of the dominant color
  const accent     = contrastColor(ringColor);

  // flash inverts the whole key for a strong alert
  const bgColor    = flash ? ringColor : t.bg;
  const timeColor  = flash ? t.bg      : '#FFFFFF';
  const labelColor = flash ? t.bg      : ringColor;
  const trackColor = flash ? t.bg      : t.track;
  const opacity    = dimmed && !flash ? '0.5' : '1';

  // glossy shimmer sweeping across the digits + label ("AI thinking" look).
  // Only while running (the animation loop is active then).
  const shimmer   = textShimmer && running && !flash && !isDone;
  const timeFill  = shimmer ? 'url(#shine)' : timeColor;
  const labelFill = shimmer ? 'url(#shine)' : labelColor;

  const af = animFrame || 0;

  const progress = isDone ? 1 : (totalTime > 0 ? timeLeft / totalTime : 1);
  const C        = 2 * Math.PI * 100;
  const offset   = (C * (1 - progress)).toFixed(1);

  const mm = Math.floor(timeLeft / 60).toString();        // no leading zero on minutes
  const ss = (timeLeft % 60).toString().padStart(2, '0');
  const timeStr = `${mm}:${ss}`;

  // center: green checkmark when done (blinks/inverts like the last-seconds alert),
  // otherwise the countdown (vector path = real font)
  const centerContent = isDone
    ? `<path d="M90 92 L114 120 L166 62" fill="none" stroke="${flash ? t.bg : ringColor}"
         stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>`
    : glyphSVG(font, timeStr, 128, 116, 52, timeFill, opacity);

  // counter centered on the ring center (y=116), label a touch lower so it
  // doesn't crowd the timer
  const labelY = isDone ? 172 : 164;

  // pomodoro progress dots (all filled when done)
  const max = Math.min(maxPomodoros, 8);
  const gap = 20;
  const dotsX0 = 128 - ((max - 1) * gap) / 2;
  let dots = '';
  for (let i = 0; i < max; i++) {
    const filled = isDone || i < completedPomodoros;
    const fill = filled ? (flash ? t.bg : ringColor) : trackColor;
    dots += `<circle cx="${(dotsX0 + i * gap).toFixed(0)}" cy="240" r="5" fill="${fill}" opacity="${opacity}"/>`;
  }

  // ── ring animations (frame-driven; disabled while flashing or done) ──
  const anim = (flash || isDone) ? 'none' : (ringAnim || 'none');
  let gradDefs = '', overlay = '';
  let progStroke = flash ? t.bg : ringColor;
  let progWidth  = 14;
  let progOpac   = opacity;

  if (anim === 'pulse') {
    // ring gently breathes (subtle width change)
    const s = (Math.sin(af * 0.45) + 1) / 2;       // 0..1
    progWidth = (12.5 + 3.5 * s).toFixed(2);
  } else if (anim === 'sweep') {
    // a rotating gradient sweeps a contrast highlight along the ring
    const deg = (af * 7) % 360;
    gradDefs += `<linearGradient id="rg" gradientUnits="userSpaceOnUse" x1="28" y1="116" x2="228" y2="116" gradientTransform="rotate(${deg} 128 116)">` +
                `<stop offset="0" stop-color="${ringColor}"/><stop offset="0.5" stop-color="${accent}"/><stop offset="1" stop-color="${ringColor}"/></linearGradient>`;
    progStroke = 'url(#rg)';
  } else if (anim === 'comet') {
    // progress ring dims; a short contrast arc travels around the circle
    progOpac = (parseFloat(opacity) * 0.5).toFixed(2);
    const arc  = 26;
    const dash = `${arc} ${(C - arc).toFixed(1)}`;
    const doff = (-(af * (C * 0.02))).toFixed(1);
    overlay = `<circle cx="128" cy="116" r="100" fill="none" stroke="${accent}" stroke-width="14" ` +
              `stroke-dasharray="${dash}" stroke-dashoffset="${doff}" stroke-linecap="round" transform="rotate(-90 128 116)"/>`;
  }

  // moving gloss gradient for the text/timer ("AI thinking" sweep) — contrast band
  if (shimmer) {
    const tx = (((af * 0.16) % 2) - 1).toFixed(3); // sweeps the contrast band across
    gradDefs += `<linearGradient id="shine" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0" gradientTransform="translate(${tx} 0)">` +
                `<stop offset="0" stop-color="${ringColor}"/><stop offset="0.5" stop-color="${accent}"/><stop offset="1" stop-color="${ringColor}"/></linearGradient>`;
  }

  // ── background animation (subtle layer behind the ring; gradient-only, no filters) ──
  const bg = (flash || isDone || !running) ? 'none' : (bgAnim || 'none');
  let bgLayer = '';
  if (bg === 'aurora') {
    const cx  = (0.30 + 0.30 * Math.sin(af * 0.040)).toFixed(3);
    const cy  = (0.40 + 0.25 * Math.cos(af * 0.035)).toFixed(3);
    const cx2 = (0.70 + 0.25 * Math.sin(af * 0.030 + 2)).toFixed(3);
    const cy2 = (0.60 + 0.25 * Math.cos(af * 0.045 + 1)).toFixed(3);
    gradDefs += `<radialGradient id="aur1" cx="${cx}" cy="${cy}" r="0.6"><stop offset="0" stop-color="${ringColor}" stop-opacity="0.35"/><stop offset="1" stop-color="${ringColor}" stop-opacity="0"/></radialGradient>` +
                `<radialGradient id="aur2" cx="${cx2}" cy="${cy2}" r="0.55"><stop offset="0" stop-color="${accent}" stop-opacity="0.22"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`;
    bgLayer = `<rect width="256" height="256" fill="url(#aur1)"/><rect width="256" height="256" fill="url(#aur2)"/>`;
  } else if (bg === 'glow') {
    const k  = (Math.sin(af * 0.12) + 1) / 2;
    const r  = (0.26 + 0.08 * k).toFixed(3);
    const op = (0.16 + 0.14 * k).toFixed(3);
    gradDefs += `<radialGradient id="glw" cx="0.5" cy="0.45" r="${r}"><stop offset="0" stop-color="${ringColor}" stop-opacity="${op}"/><stop offset="1" stop-color="${ringColor}" stop-opacity="0"/></radialGradient>`;
    bgLayer = `<rect width="256" height="256" fill="url(#glw)"/>`;
  } else if (bg === 'sweep') {
    const tx = (((af * 0.12) % 2.4) - 1.2).toFixed(3);
    gradDefs += `<linearGradient id="bsw" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="1" gradientTransform="translate(${tx} 0)"><stop offset="0" stop-color="${ringColor}" stop-opacity="0"/><stop offset="0.5" stop-color="${ringColor}" stop-opacity="0.20"/><stop offset="1" stop-color="${ringColor}" stop-opacity="0"/></linearGradient>`;
    bgLayer = `<rect width="256" height="256" fill="url(#bsw)"/>`;
  } else if (bg === 'progress') {
    const elapsed = 1 - progress;                 // grows as time passes
    const h = (256 * elapsed).toFixed(1);
    const y = (256 - h).toFixed(1);
    gradDefs += `<linearGradient id="bpr" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${ringColor}" stop-opacity="0.22"/><stop offset="1" stop-color="${ringColor}" stop-opacity="0.04"/></linearGradient>`;
    bgLayer = `<rect x="0" y="${y}" width="256" height="${h}" fill="url(#bpr)"/>`;
  } else if (bg === 'vignette') {
    const op = (0.16 + 0.16 * ((Math.sin(af * 0.10) + 1) / 2)).toFixed(3);
    gradDefs += `<radialGradient id="vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="${op}"/></radialGradient>`;
    bgLayer = `<rect width="256" height="256" fill="url(#vig)"/>`;
  }

  const defs = gradDefs ? `<defs>${gradDefs}</defs>` : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  ${defs}
  <rect width="256" height="256" fill="${bgColor}"/>
  ${bgLayer}
  <circle cx="128" cy="116" r="100" fill="none" stroke="${trackColor}" stroke-width="14"/>
  <circle cx="128" cy="116" r="100" fill="none" stroke="${progStroke}" stroke-width="${progWidth}"
    stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${offset}"
    stroke-linecap="round" transform="rotate(-90 128 116)" opacity="${progOpac}"/>
  ${overlay}
  ${centerContent}
  <text x="128" y="${labelY}" text-anchor="middle"
    fill="${labelFill}" font-size="19" font-weight="bold" font-family="Arial, Helvetica, sans-serif"
    letter-spacing="3" opacity="${opacity}">${displayLabel}</text>
  ${dots}
</svg>`;

  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

class PomodoroTimer {
  constructor(context, $UD) {
    this.$UD     = $UD;
    this.context = context;
    this.config  = {
      focusDuration:            25,
      shortBreakDuration:       5,
      longBreakDuration:        15,
      pomodorosBeforeLongBreak: 4,
      notify:                   false,
      theme:                    'classic',
      font:                     'sans',
      customColor:              '',
      ringAnim:                 'none',
      textShimmer:              false,
      bgAnim:                   'none',
      labelIdle: 'READY', labelFocus: 'FOCUS', labelShortBreak: 'BREAK',
      labelLongBreak: 'REST', labelPaused: 'PAUSED', labelDone: 'DONE',
      notifyTitle:  'Pomodoro Timer',
      msgFocusEnd:  'Focus complete — time for a break!',
      msgBreakEnd:  'Break over — back to focus!',
      msgCycleEnd:  'Cycle complete — great job!'
    };

    this.phase              = 'idle';   // idle | focus | shortBreak | longBreak
    this.running            = false;
    this.timeLeft           = this.config.focusDuration * 60;
    this.totalTime          = this.config.focusDuration * 60;
    this.completedPomodoros = 0;
    this.timer              = null;
    this.blinkTimer         = null;
    this.blinkOn            = false;
    this.doneTimer          = null;
    this.animTimer          = null;
    this.animFrame          = 0;
    this.render();
  }

  // ── config ──────────────────────────────────────────────────────────────────
  setConfig(param) {
    if (!param) return;
    if (param.resetTimer) { this.reset(); return; }

    const numFields = ['focusDuration', 'shortBreakDuration', 'longBreakDuration', 'pomodorosBeforeLongBreak'];
    for (const f of numFields) {
      if (param[f] !== undefined && param[f] !== '') {
        const v = parseInt(param[f]);
        if (!Number.isNaN(v) && v > 0) this.config[f] = v;
      }
    }
    if (param.notify !== undefined) {
      this.config.notify = param.notify === true || param.notify === 'true' || param.notify === 'on';
    }
    if (param.theme) this.config.theme = param.theme;
    if (param.font)  this.config.font  = param.font;
    if (param.ringAnim) this.config.ringAnim = param.ringAnim;
    if (param.bgAnim)   this.config.bgAnim   = param.bgAnim;
    if (param.textShimmer !== undefined) {
      this.config.textShimmer = param.textShimmer === true || param.textShimmer === 'true' || param.textShimmer === 'on';
    }
    if (param.customColor !== undefined) this.config.customColor = param.customColor;  // '' clears it

    // start/stop the animation loop to match the new setting
    if (this.running) { this._stopAnim(); this._startAnim(); }

    const strFields = ['labelIdle', 'labelFocus', 'labelShortBreak', 'labelLongBreak', 'labelPaused', 'labelDone',
                       'notifyTitle', 'msgFocusEnd', 'msgBreakEnd', 'msgCycleEnd'];
    for (const f of strFields) {
      if (param[f]) this.config[f] = param[f];
    }

    // pre-register the localized app name early (on language/title change) so the
    // FIRST notification already shows the translated name (Windows needs time to
    // index the Start Menu shortcut)
    if (this.config.notifyTitle && this.config.notifyTitle !== _lastEnsuredTitle) {
      ensureWinIdentity(this.config.notifyTitle);
    }

    // keep idle countdown in sync with focus duration
    if (this.phase === 'idle' && !this.running) {
      this.timeLeft  = this.config.focusDuration * 60;
      this.totalTime = this.config.focusDuration * 60;
    }
    this.render();
  }

  // ── controls ──────────────────────────────────────────────────────────────────
  toggleStartPause() {
    if (this.phase === 'done')  return this._finishDone();  // dismiss completion early
    if (this.phase === 'idle')  return this._startPhase('focus');
    if (this.running)           return this.pause();
    return this.resume();
  }

  _finishDone() {
    if (this.doneTimer) { clearTimeout(this.doneTimer); this.doneTimer = null; }
    this.reset();  // back to the timer (READY)
  }

  _durationFor(phase) {
    if (phase === 'focus')      return this.config.focusDuration * 60;
    if (phase === 'shortBreak') return this.config.shortBreakDuration * 60;
    if (phase === 'longBreak')  return this.config.longBreakDuration * 60;
    return this.config.focusDuration * 60;
  }

  _startPhase(phase) {
    this.phase     = phase;
    this.totalTime = this._durationFor(phase);
    this.timeLeft  = this.totalTime;
    this.running   = true;
    this._startTimer();
  }

  pause() {
    this.running = false;
    this._stopTimer();
    this._stopBlink();
    this.render();
  }

  resume() {
    if (this.phase === 'idle') return this._startPhase('focus');
    this.running = true;
    this._startTimer();
  }

  reset() {
    this._stopTimer();
    this._stopBlink();
    if (this.doneTimer) { clearTimeout(this.doneTimer); this.doneTimer = null; }
    this.phase              = 'idle';
    this.running            = false;
    this.timeLeft           = this.config.focusDuration * 60;
    this.totalTime          = this.config.focusDuration * 60;
    this.completedPomodoros = 0;
    this.render();
  }

  // ── ticking ──────────────────────────────────────────────────────────────────
  _startTimer() {
    this._stopTimer();
    this.render();
    this.timer = setInterval(() => this._tick(), 1000);
    this._startAnim();
  }
  _stopTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this._stopAnim();
  }

  // ── ring animation (frames between ticks) ─────────────────────────────────────
  _startAnim() {
    if (this.animTimer) return;
    const ringActive = this.config.ringAnim && this.config.ringAnim !== 'none';
    const bgActive   = this.config.bgAnim   && this.config.bgAnim   !== 'none';
    if (!this.running || (!ringActive && !this.config.textShimmer && !bgActive)) return;
    this.animTimer = setInterval(() => {
      this.animFrame++;
      if (!this.blinkOn) this.render();  // blink takes precedence over animations
    }, 150);
  }
  _stopAnim() {
    if (this.animTimer) { clearInterval(this.animTimer); this.animTimer = null; }
  }

  _tick() {
    this.timeLeft--;
    if (this.timeLeft <= 0) { this._onPhaseComplete(); return; }

    if (this.running && this.timeLeft <= BLINK_AT) this._startBlink();
    else this._stopBlink();

    this.render();
  }

  // ── blink (last seconds) ──────────────────────────────────────────────────────
  _startBlink() {
    if (this.blinkTimer) return;
    this.blinkOn = true;
    this.render();
    this.blinkTimer = setInterval(() => { this.blinkOn = !this.blinkOn; this.render(); }, 400);
  }
  _stopBlink() {
    if (this.blinkTimer) { clearInterval(this.blinkTimer); this.blinkTimer = null; }
    this.blinkOn = false;
  }

  // ── phase transition ──────────────────────────────────────────────────────────
  _onPhaseComplete() {
    this._stopTimer();
    this._stopBlink();

    const finishedPhase = this.phase;

    // long break done → whole cycle complete → show DONE frame 3s, then back to timer
    if (finishedPhase === 'longBreak') {
      if (this.config.notify) notifyOS(this.config.notifyTitle, this.config.msgCycleEnd, NOTIFY_ICONS.done);
      this.phase     = 'done';
      this.running   = false;
      this.totalTime = this._durationFor('focus');
      this.timeLeft  = 0;
      // green completion blinks (inverts) like the last-seconds alert, for 5s
      this.blinkOn   = false;
      this._stopAnim();
      this.animTimer = setInterval(() => { this.blinkOn = !this.blinkOn; this.render(); }, 400);
      this.render();   // keeps completedPomodoros so all dots stay filled
      this.doneTimer = setTimeout(() => this._finishDone(), 5000);
      return;
    }

    let nextPhase, message, icon;
    if (finishedPhase === 'focus') {
      this.completedPomodoros++;
      const isLong = this.completedPomodoros % this.config.pomodorosBeforeLongBreak === 0;
      nextPhase = isLong ? 'longBreak' : 'shortBreak';
      message   = this.config.msgFocusEnd;
      icon      = NOTIFY_ICONS.break;   // heading into a break
    } else { // short break done → back to focus
      nextPhase = 'focus';
      message   = this.config.msgBreakEnd;
      icon      = NOTIFY_ICONS.focus;   // heading back to focus
    }

    if (this.config.notify) notifyOS(this.config.notifyTitle, message, icon);

    // flow continues automatically; the user only pauses by pressing the key
    this._startPhase(nextPhase);
  }

  // ── render ──────────────────────────────────────────────────────────────────
  render() {
    const L = this.config;
    const isPaused  = !this.running && this.phase !== 'idle' && this.timeLeft < this.totalTime;
    const isPending = !this.running && this.phase !== 'idle' && this.timeLeft === this.totalTime;

    let displayLabel;
    if      (this.phase === 'done') displayLabel = L.labelDone;
    else if (this.phase === 'idle') displayLabel = L.labelIdle;
    else if (isPaused)              displayLabel = L.labelPaused;
    else if (this.phase === 'focus')      displayLabel = L.labelFocus;
    else if (this.phase === 'shortBreak') displayLabel = L.labelShortBreak;
    else if (this.phase === 'longBreak')  displayLabel = L.labelLongBreak;
    displayLabel = displayLabel || PHASE_LABELS_DEFAULT[this.phase] || 'READY';

    const dimmed = isPaused || isPending;  // 'done' stays full-bright

    try {
      const svg = generateSVG({
        timeLeft:           this.timeLeft,
        totalTime:          this.totalTime,
        phase:              this.phase,
        displayLabel,
        dimmed,
        flash:              this.blinkOn,
        completedPomodoros: this.completedPomodoros,
        maxPomodoros:       this.config.pomodorosBeforeLongBreak,
        theme:              this.config.theme,
        font:               this.config.font,
        customColor:        this.config.customColor,
        ringAnim:           this.config.ringAnim,
        animFrame:          this.animFrame,
        textShimmer:        this.config.textShimmer,
        running:            this.running,
        bgAnim:             this.config.bgAnim
      });
      this.$UD.setBaseDataIcon(this.context, svg);
    } catch (e) {
      console.error('[Pomodoro] render error:', e.message);
    }
  }

  destroy() {
    this._stopTimer();
    this._stopBlink();
    if (this.doneTimer) { clearTimeout(this.doneTimer); this.doneTimer = null; }
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────────────
const $UD           = new UlanzideckApi();
const ACTION_CACHES = {};

$UD.connect('com.pomodoro.timer.deck');
$UD.onConnected(() => bootLog('connected to Ulanzi'));
$UD.onError((e)     => console.error('[Pomodoro] Error:', typeof e === 'string' ? e : ''));

$UD.onAdd((jsn) => {
  const ctx = jsn.context;
  if (!ACTION_CACHES[ctx]) ACTION_CACHES[ctx] = new PomodoroTimer(ctx, $UD);
  if (jsn.param) ACTION_CACHES[ctx].setConfig(jsn.param);
});

$UD.onParamFromApp((jsn) => {
  const inst = ACTION_CACHES[jsn.context];
  if (inst && jsn.param) inst.setConfig(jsn.param);
});

$UD.onParamFromPlugin((jsn) => {
  const inst = ACTION_CACHES[jsn.context];
  if (inst && jsn.param) inst.setConfig(jsn.param);
});

$UD.onRun((jsn) => {
  const ctx = jsn.context;
  if (!ACTION_CACHES[ctx]) ACTION_CACHES[ctx] = new PomodoroTimer(ctx, $UD);
  ACTION_CACHES[ctx].toggleStartPause();
});

$UD.onSetActive((jsn) => {
  const inst = ACTION_CACHES[jsn.context];
  if (inst) inst.render();
});

$UD.onClear((jsn) => {
  if (!jsn.param) return;
  for (const item of jsn.param) {
    const inst = ACTION_CACHES[item.context];
    if (inst) { inst.destroy(); delete ACTION_CACHES[item.context]; }
  }
});
