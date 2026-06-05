let ACTION_SETTING = {};
let form = null;

// translated strings pushed to the key / notifications
let KEY_LABELS = {
  labelIdle: 'READY', labelFocus: 'FOCUS', labelShortBreak: 'BREAK',
  labelLongBreak: 'REST', labelPaused: 'PAUSED', labelDone: 'DONE'
};
let NOTIFY_MSGS = {
  notifyTitle: 'Pomodoro Timer',
  msgFocusEnd: 'Focus complete — time for a break!',
  msgBreakEnd: 'Break over — back to focus!',
  msgCycleEnd: 'Cycle complete — great job!'
};

const THEME_SWATCHES = {
  classic: ['#E74C3C', '#27AE60', '#2980B9'],
  minimal: ['#FF6B6B', '#6BCB77', '#4D96FF'],
  neon:    ['#FF0040', '#00FF88', '#00BFFF'],
  ocean:   ['#00B4D8', '#48CAE4', '#0077B6'],
  forest:  ['#52B788', '#95D5B2', '#2D6A4F'],
  sunset:  ['#FF5E5B', '#FFB400', '#D7263D'],
  dracula: ['#BD93F9', '#50FA7B', '#8BE9FD'],
  coffee:  ['#C08552', '#A3B18A', '#774936'],
  mono:    ['#FFFFFF', '#BBBBBB', '#888888']
};

// bg + track per theme (mirror of backend THEMES) for the live preview
const THEME_BG = {
  classic: ['#1a1a1a', '#2d2d2d'], minimal: ['#0d0d0d', '#1e1e1e'], neon: ['#0a0a1a', '#1a1a2e'],
  ocean:   ['#011627', '#10314a'], forest:  ['#0b1e16', '#1b3a2c'], sunset: ['#1a0f14', '#3a2027'],
  dracula: ['#282A36', '#44475A'], coffee:  ['#1c1614', '#3a2e29'], mono:   ['#000000', '#333333']
};

// font families (mirror of backend FONTS)
// same bundled fonts as the key (loaded via @font-face in inspector.html)
const PI_FONTS = {
  sans:    "'pomo-sans', Arial, sans-serif",
  mono:    "'pomo-mono', monospace",
  serif:   "'pomo-serif', serif",
  display: "'pomo-display', sans-serif"
};

// contrast highlight (mirror of backend) for shimmer + ring animations
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
function contrastColor(hex) {
  if (!/^#?[0-9a-fA-F]{6}$/.test(String(hex || ''))) return '#FFFFFF';
  const { r, g, b } = hexToRgb(hex);
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (L > 0.85) return rgbToHex(r * 0.7, g * 0.7, b * 0.7);                          // near-white → darker
  return rgbToHex(r + (255 - r) * 0.55, g + (255 - g) * 0.55, b + (255 - b) * 0.55); // lighter same hue
}

$UD.connect('com.pomodoro.timer.deck.timer');

$UD.onConnected(() => {
  form = document.querySelector('#property-inspector');
  document.querySelector('.udpi-wrapper').classList.remove('hidden');

  buildThemeSwatches();
  bindSliders();
  bindReset();

  form.addEventListener('input', Utils.debounce(collectAndSend, 150));

  // <select> and color/checkbox don't always fire 'input' in the Ulanzi webview;
  // bind 'change' explicitly so font/color updates reach the key in real time.
  ['font', 'ringAnim', 'bgAnim', 'customColor', 'useCustomColor', 'textShimmer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', collectAndSend);
  });

  syncPreviewDuration();
  renderPreview();
  startPreviewLoop();
  loadTranslations();
});

// ── theme swatches ──────────────────────────────────────────────────────────
function buildThemeSwatches() {
  const wrap = document.getElementById('theme-swatches');
  wrap.innerHTML = '';
  Object.keys(THEME_SWATCHES).forEach(name => {
    const el = document.createElement('div');
    el.className = 'theme-swatch';
    el.dataset.theme = name;
    el.title = name;
    el.innerHTML = THEME_SWATCHES[name].map(c => `<i style="background:${c}"></i>`).join('');
    el.addEventListener('click', () => selectTheme(name));
    wrap.appendChild(el);
  });
}

function selectTheme(name) {
  document.getElementById('theme').value = name;
  highlightTheme(name);
  collectAndSend();
}

function highlightTheme(name) {
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === name);
  });
}

// ── sliders ──────────────────────────────────────────────────────────────────
function bindSliders() {
  ['focusDuration', 'shortBreakDuration', 'longBreakDuration', 'pomodorosBeforeLongBreak'].forEach(id => {
    const input = document.getElementById(id);
    const out   = document.getElementById(id + '-val');
    if (input && out) input.addEventListener('input', () => { out.textContent = input.value; });
  });
}

function syncSliderLabels() {
  ['focusDuration', 'shortBreakDuration', 'longBreakDuration', 'pomodorosBeforeLongBreak'].forEach(id => {
    const input = document.getElementById(id);
    const out   = document.getElementById(id + '-val');
    if (input && out) out.textContent = input.value;
  });
}

function bindReset() {
  document.getElementById('btn-reset').addEventListener('click', () => {
    $UD.sendParamFromPlugin({ resetTimer: true });
  });
  document.getElementById('btn-tutorial').addEventListener('click', () => {
    const lang = $UD.language || 'en';
    $UD.openUrl('./property-inspector/tutorial.html#lang=' + lang, true);
  });
}

// ── live preview (animated, mirrors the running key) ──────────────────────────
const previewState = { seconds: 25 * 60, total: 25 * 60, frame: 0, acc: 0, mode: 'focus', doneStart: 0 };
let previewTimer = null;
const PREVIEW_FOCUS_FRAMES = 100; // ~15s of focus before demoing the "done" frame
const PREVIEW_DONE_FRAMES  = 33;  // ~5s of the done celebration
const DONE_COLOR_PI        = '#2ECC71';

function startPreviewLoop() {
  if (previewTimer) window.clearInterval(previewTimer);
  previewState.frame = 0; previewState.mode = 'focus'; previewState.acc = 0;
  previewTimer = window.setInterval(() => {
    previewState.frame++;
    if (previewState.mode === 'focus') {
      previewState.acc += 150;
      if (previewState.acc >= 1000) {          // ~1s elapsed → tick the clock
        previewState.acc -= 1000;
        previewState.seconds--;
        if (previewState.seconds < 0) previewState.seconds = previewState.total;
      }
      // periodically demo the "done" celebration
      if (previewState.frame % PREVIEW_FOCUS_FRAMES === 0) {
        previewState.mode = 'done';
        previewState.doneStart = previewState.frame;
      }
    } else { // done demo
      if (previewState.frame - previewState.doneStart > PREVIEW_DONE_FRAMES) {
        previewState.mode = 'focus';
        previewState.seconds = previewState.total; // restart the focus countdown
      }
    }
    renderPreview();
  }, 150);
}

// keep the preview countdown in sync with the configured focus duration
function syncPreviewDuration() {
  const fd = parseInt(document.getElementById('focusDuration').value) || 25;
  previewState.total = fd * 60;
  if (previewState.seconds > previewState.total || previewState.seconds < 0) {
    previewState.seconds = previewState.total;
  }
}

function renderPreview() {
  const el = document.getElementById('preview');
  if (!el) return;

  const theme   = document.getElementById('theme').value || 'classic';
  const font    = document.getElementById('font').value || 'sans';
  const useCust = document.getElementById('useCustomColor').checked;
  const cc      = document.getElementById('customColor').value;

  const [bg, track] = THEME_BG[theme] || THEME_BG.classic;
  const themeRing   = (THEME_SWATCHES[theme] || THEME_SWATCHES.classic)[0];
  const ring        = (useCust && /^#[0-9a-fA-F]{6}$/.test(cc)) ? cc : themeRing;
  const fontFamily  = PI_FONTS[font] || PI_FONTS.sans;
  const label       = KEY_LABELS.labelFocus || 'FOCUS';

  const sec  = Math.max(0, previewState.seconds);
  const tot  = previewState.total || 1;
  const mm   = String(Math.floor(sec / 60));            // no leading zero on minutes
  const ss   = String(sec % 60).padStart(2, '0');
  const C    = 2 * Math.PI * 100;
  const off  = (C * (1 - sec / tot)).toFixed(1);

  const pomoN = Math.min(parseInt(document.getElementById('pomodorosBeforeLongBreak').value) || 4, 8);
  const gapD  = 20, x0D = 128 - ((pomoN - 1) * gapD) / 2;

  // ── 'done' celebration demo: green, blinking/inverting like the key ──
  if (previewState.mode === 'done') {
    const af2   = previewState.frame;
    const blink = (Math.floor(af2 / 3) % 2) === 1;   // ~450ms toggle
    const bgF   = blink ? DONE_COLOR_PI : bg;
    const fg    = blink ? bg : DONE_COLOR_PI;          // check / ring / text / dots
    let dotsD = '';
    for (let i = 0; i < pomoN; i++) dotsD += `<circle cx="${(x0D + i * gapD).toFixed(0)}" cy="240" r="5" fill="${fg}"/>`;
    const doneSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">` +
      `<rect width="256" height="256" fill="${bgF}"/>` +
      `<circle cx="128" cy="116" r="100" fill="none" stroke="${track}" stroke-width="14"/>` +
      `<circle cx="128" cy="116" r="100" fill="none" stroke="${fg}" stroke-width="14" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="0" stroke-linecap="round" transform="rotate(-90 128 116)"/>` +
      `<path d="M90 92 L114 120 L166 62" fill="none" stroke="${fg}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<text x="128" y="172" text-anchor="middle" fill="${fg}" font-size="19" font-weight="bold" font-family="Arial, Helvetica, sans-serif" letter-spacing="3">${KEY_LABELS.labelDone || 'DONE'}</text>` +
      dotsD +
      `</svg>`;
    el.innerHTML = doneSvg;
    return;
  }

  // ring animation (same math as the key); highlight = contrast of dominant color
  const anim   = document.getElementById('ringAnim').value || 'none';
  const af     = previewState.frame;
  const accent = contrastColor(ring);
  let gradDefs = '', overlay = '', progStroke = ring, progWidth = 14, progOpac = 1;
  if (anim === 'pulse') {
    const s = (Math.sin(af * 0.45) + 1) / 2;
    progWidth = (12.5 + 3.5 * s).toFixed(2);
  } else if (anim === 'sweep') {
    const deg = (af * 7) % 360;
    gradDefs += `<linearGradient id="rg" gradientUnits="userSpaceOnUse" x1="28" y1="116" x2="228" y2="116" gradientTransform="rotate(${deg} 128 116)">` +
                `<stop offset="0" stop-color="${ring}"/><stop offset="0.5" stop-color="${accent}"/><stop offset="1" stop-color="${ring}"/></linearGradient>`;
    progStroke = 'url(#rg)';
  } else if (anim === 'comet') {
    progOpac = 0.5;
    const arc = 26, dash = `${arc} ${(C - arc).toFixed(1)}`, doff = (-(af * (C * 0.02))).toFixed(1);
    overlay = `<circle cx="128" cy="116" r="100" fill="none" stroke="${accent}" stroke-width="14" ` +
              `stroke-dasharray="${dash}" stroke-dashoffset="${doff}" stroke-linecap="round" transform="rotate(-90 128 116)"/>`;
  }

  // glossy text shimmer (preview is always "running") — contrast band
  const shimmer = document.getElementById('textShimmer').checked;
  let timeFill = '#FFFFFF', labelFill = ring;
  if (shimmer) {
    const tx = (((af * 0.16) % 2) - 1).toFixed(3);
    gradDefs += `<linearGradient id="shine" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0" gradientTransform="translate(${tx} 0)">` +
                `<stop offset="0" stop-color="${ring}"/><stop offset="0.5" stop-color="${accent}"/><stop offset="1" stop-color="${ring}"/></linearGradient>`;
    timeFill = 'url(#shine)';
    labelFill = 'url(#shine)';
  }

  // background animation (same as the key)
  const bgFx = document.getElementById('bgAnim').value || 'none';
  let bgLayer = '';
  if (bgFx === 'aurora') {
    const cx  = (0.30 + 0.30 * Math.sin(af * 0.040)).toFixed(3);
    const cy  = (0.40 + 0.25 * Math.cos(af * 0.035)).toFixed(3);
    const cx2 = (0.70 + 0.25 * Math.sin(af * 0.030 + 2)).toFixed(3);
    const cy2 = (0.60 + 0.25 * Math.cos(af * 0.045 + 1)).toFixed(3);
    gradDefs += `<radialGradient id="aur1" cx="${cx}" cy="${cy}" r="0.6"><stop offset="0" stop-color="${ring}" stop-opacity="0.35"/><stop offset="1" stop-color="${ring}" stop-opacity="0"/></radialGradient>` +
                `<radialGradient id="aur2" cx="${cx2}" cy="${cy2}" r="0.55"><stop offset="0" stop-color="${accent}" stop-opacity="0.22"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`;
    bgLayer = `<rect width="256" height="256" fill="url(#aur1)"/><rect width="256" height="256" fill="url(#aur2)"/>`;
  } else if (bgFx === 'glow') {
    const k = (Math.sin(af * 0.12) + 1) / 2;
    const r = (0.26 + 0.08 * k).toFixed(3), op = (0.16 + 0.14 * k).toFixed(3);
    gradDefs += `<radialGradient id="glw" cx="0.5" cy="0.45" r="${r}"><stop offset="0" stop-color="${ring}" stop-opacity="${op}"/><stop offset="1" stop-color="${ring}" stop-opacity="0"/></radialGradient>`;
    bgLayer = `<rect width="256" height="256" fill="url(#glw)"/>`;
  } else if (bgFx === 'sweep') {
    const tx = (((af * 0.12) % 2.4) - 1.2).toFixed(3);
    gradDefs += `<linearGradient id="bsw" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="1" gradientTransform="translate(${tx} 0)"><stop offset="0" stop-color="${ring}" stop-opacity="0"/><stop offset="0.5" stop-color="${ring}" stop-opacity="0.20"/><stop offset="1" stop-color="${ring}" stop-opacity="0"/></linearGradient>`;
    bgLayer = `<rect width="256" height="256" fill="url(#bsw)"/>`;
  } else if (bgFx === 'progress') {
    const elapsed = 1 - sec / tot;
    const h = (256 * elapsed).toFixed(1), y = (256 - 256 * elapsed).toFixed(1);
    gradDefs += `<linearGradient id="bpr" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${ring}" stop-opacity="0.22"/><stop offset="1" stop-color="${ring}" stop-opacity="0.04"/></linearGradient>`;
    bgLayer = `<rect x="0" y="${y}" width="256" height="${h}" fill="url(#bpr)"/>`;
  } else if (bgFx === 'vignette') {
    const op = (0.16 + 0.16 * ((Math.sin(af * 0.10) + 1) / 2)).toFixed(3);
    gradDefs += `<radialGradient id="vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="${op}"/></radialGradient>`;
    bgLayer = `<rect width="256" height="256" fill="url(#vig)"/>`;
  }

  const defs = gradDefs ? `<defs>${gradDefs}</defs>` : '';

  // dots = configured pomodoro count (same layout as the key); empty = not done yet
  const pomo = Math.min(parseInt(document.getElementById('pomodorosBeforeLongBreak').value) || 4, 8);
  const gap  = 20;
  const x0   = 128 - ((pomo - 1) * gap) / 2;
  let dots = '';
  for (let i = 0; i < pomo; i++) {
    dots += `<circle cx="${(x0 + i * gap).toFixed(0)}" cy="240" r="5" fill="${track}"/>`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">` +
    defs +
    `<rect width="256" height="256" fill="${bg}"/>` +
    bgLayer +
    `<circle cx="128" cy="116" r="100" fill="none" stroke="${track}" stroke-width="14"/>` +
    `<circle cx="128" cy="116" r="100" fill="none" stroke="${progStroke}" stroke-width="${progWidth}" ` +
      `stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off}" stroke-linecap="round" ` +
      `transform="rotate(-90 128 116)" opacity="${progOpac}"/>` +
    overlay +
    `<text x="128" y="116" text-anchor="middle" dominant-baseline="middle" fill="${timeFill}" ` +
      `font-size="52" font-weight="bold" font-family="${fontFamily}">${mm}:${ss}</text>` +
    `<text x="128" y="164" text-anchor="middle" fill="${labelFill}" font-size="19" font-weight="bold" ` +
      `font-family="Arial, Helvetica, sans-serif" letter-spacing="3">${label}</text>` +
    dots +
    `</svg>`;

  el.innerHTML = svg;
}

// ── translations from language file ───────────────────────────────────────────
async function loadTranslations() {
  try {
    const data = await Utils.readJson(`${Utils.getPluginPath()}/${$UD.language}.json`);
    const loc  = data?.Localization || {};

    KEY_LABELS = {
      labelIdle:       loc['READY']  || KEY_LABELS.labelIdle,
      labelFocus:      loc['FOCUS']  || KEY_LABELS.labelFocus,
      labelShortBreak: loc['BREAK']  || KEY_LABELS.labelShortBreak,
      labelLongBreak:  loc['REST']   || KEY_LABELS.labelLongBreak,
      labelPaused:     loc['PAUSED'] || KEY_LABELS.labelPaused,
      labelDone:       loc['DONE']   || KEY_LABELS.labelDone,
    };
    NOTIFY_MSGS = {
      notifyTitle: data?.Name           || NOTIFY_MSGS.notifyTitle,
      msgFocusEnd: loc['msg_focus_end'] || NOTIFY_MSGS.msgFocusEnd,
      msgBreakEnd: loc['msg_break_end'] || NOTIFY_MSGS.msgBreakEnd,
      msgCycleEnd: loc['msg_cycle_end'] || NOTIFY_MSGS.msgCycleEnd,
    };
    collectAndSend();
  } catch (e) {
    console.warn('[Pomodoro] No translations for', $UD.language);
  }
}

// ── send / receive ──────────────────────────────────────────────────────────
function collectAndSend() {
  if (!form) return;
  const values = Utils.getFormValue(form);
  ACTION_SETTING = { ...ACTION_SETTING, ...values };
  ACTION_SETTING.notify      = !!document.getElementById('notify').checked;
  ACTION_SETTING.textShimmer = !!document.getElementById('textShimmer').checked;

  // custom color: only applied when the toggle is on (else clear → theme color)
  const useCustom   = document.getElementById('useCustomColor').checked;
  const colorInput  = document.getElementById('customColor');
  colorInput.disabled = !useCustom;
  ACTION_SETTING.customColor = useCustom ? colorInput.value : '';

  syncPreviewDuration();
  renderPreview();
  $UD.sendParamFromPlugin({ ...ACTION_SETTING, ...KEY_LABELS, ...NOTIFY_MSGS });
}

function applySettings(params) {
  if (!params) return;
  ACTION_SETTING = { ...ACTION_SETTING, ...params };
  if (!form) return;

  Utils.setFormValue(ACTION_SETTING, form);
  document.getElementById('notify').checked      = !!ACTION_SETTING.notify;
  document.getElementById('textShimmer').checked = !!ACTION_SETTING.textShimmer;

  const theme = ACTION_SETTING.theme || 'classic';
  document.getElementById('theme').value = theme;
  highlightTheme(theme);

  document.getElementById('font').value = ACTION_SETTING.font || 'sans';
  document.getElementById('ringAnim').value = ACTION_SETTING.ringAnim || 'none';
  document.getElementById('bgAnim').value    = ACTION_SETTING.bgAnim   || 'none';

  const cc        = ACTION_SETTING.customColor || '';
  const useCustom = /^#[0-9a-fA-F]{6}$/.test(cc);
  document.getElementById('useCustomColor').checked = useCustom;
  const colorInput = document.getElementById('customColor');
  colorInput.disabled = !useCustom;
  if (useCustom) colorInput.value = cc;

  syncSliderLabels();
  syncPreviewDuration();
  renderPreview();

  // re-push so the backend has translations even on a fresh load
  $UD.sendParamFromPlugin({ ...ACTION_SETTING, ...KEY_LABELS, ...NOTIFY_MSGS });
}

$UD.onAdd((jsn)            => { if (jsn.param) applySettings(jsn.param); });
$UD.onParamFromApp((jsn)  => { if (jsn.param) applySettings(jsn.param); });
$UD.onParamFromPlugin((jsn) => {
  if (jsn.param && !jsn.param.resetTimer) applySettings(jsn.param);
});
