// Speech: read aloud, voice typing and audio mode. Browser speech first, AWS as the fallback.
// Contract: docs/I18N.md section 6. voice.js re-exports the old names from here.
import { t, lang, LANGS, onLangChange } from './i18n.js';
import { call, uploadData } from './api.js';
import { toast, esc } from './ui.js';
import { currentSession } from './auth.js';

/* ── Pure helpers (exported for tests) ── */

const pack = (pieces, max) => {
  const out = [];
  let cur = '';
  for (const p of pieces) {
    if (cur && cur.length + 1 + p.length > max) { out.push(cur); cur = p; } else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
};
const splitWords = (s, max) => {
  const out = [];
  for (const w of s.split(' ')) {
    if (w.length <= max) out.push(w);
    else for (let i = 0; i < w.length; i += max) out.push(w.slice(i, i + max));
  }
  return pack(out, max);
};
const splitLong = (s, max) => {
  if (s.length <= max) return [s];
  const parts = s.replace(/([,;:])\s+/g, '$1\u0000').split('\u0000');
  return pack(parts, max).flatMap((p) => (p.length > max ? splitWords(p, max) : [p]));
};

/** Split text into sentence chunks of at most `max` characters (merging short sentences). */
export function chunkText(text, max = 180) {
  const sentences = String(text ?? '').split(/\n+/)
    .flatMap((p) => p.replace(/\s+/g, ' ').trim().replace(/([.!?।॥]+)\s+/g, '$1\u0000').split('\u0000'))
    .map((s) => s.trim()).filter(Boolean);
  return pack(sentences.flatMap((s) => splitLong(s, max)), max);
}

const ZEROS = [0x0966, 0x09e6, 0x0be6]; // Devanagari, Bengali, Tamil digit zero
/** Devanagari, Bengali and Tamil digits to ASCII. Everything else unchanged. */
export const toAsciiDigits = (s) => String(s ?? '').replace(/[०-९০-৯௦-௯]/g, (c) => {
  const n = c.charCodeAt(0);
  return String(n - ZEROS.find((z) => n >= z && n <= z + 9));
});

const NUM_WORDS = {
  0: ['zero', 'oh', 'शून्य', 'शुन्य', 'सुन्न', 'जीरो', 'ज़ीरो', 'শূন্য', 'শুন্য', 'জিরো', 'பூஜ்ஜியம்', 'பூஜ்யம்', 'சுழியம்', 'ஜீரோ'],
  1: ['one', 'एक', 'वन', 'এক', 'ஒன்று', 'ஒண்ணு', 'ஒன்னு'],
  2: ['two', 'to', 'too', 'दो', 'दोन', 'দুই', 'দু', 'இரண்டு', 'ரெண்டு'],
  3: ['three', 'तीन', 'তিন', 'மூன்று', 'மூணு'],
  4: ['four', 'for', 'चार', 'চার', 'நான்கு', 'நாலு'],
  5: ['five', 'पाँच', 'पांच', 'पाच', 'পাঁচ', 'ஐந்து', 'அஞ்சு'],
  6: ['six', 'छह', 'छः', 'छे', 'छै', 'सहा', 'ছয়', 'ছয়', 'ஆறு'],
  7: ['seven', 'सात', 'সাত', 'ஏழு'],
  8: ['eight', 'आठ', 'আট', 'எட்டு'],
  9: ['nine', 'नौ', 'नऊ', 'নয়', 'নয়', 'ஒன்பது'],
  10: ['ten', 'दस', 'दहा', 'দশ', 'பத்து'],
};
const POINT = ['point', 'dot', 'दशमलव', 'पॉइंट', 'प्वाइंट', 'पॉईंट', 'দশমিক', 'পয়েন্ট', 'புள்ளி', 'பாயிண்ட்'];
const TIMES = { double: 2, 'डबल': 2, 'ডাবল': 2, 'டபுள்': 2, triple: 3, 'ट्रिपल': 3, 'ট্রিপল': 3, 'ட்ரிபிள்': 3 };
const nfc = (s) => String(s ?? '').normalize('NFC').toLowerCase();
const WORD_TO_DIGIT = new Map(Object.entries(NUM_WORDS).flatMap(([d, ws]) => ws.map((w) => [nfc(w), d])));
const POINT_SET = new Set(POINT.map(nfc));
const TIMES_MAP = new Map(Object.entries(TIMES).map(([w, n]) => [nfc(w), n]));

/** Spoken digits ("nine eight double one", "दो दशमलव पाँच", "௯௮") to an ASCII digit string. */
export function normalizeDigits(text, { decimal = false } = {}) {
  const s = nfc(toAsciiDigits(text));
  let out = '';
  let times = 1;
  for (const raw of s.split(/[\s,;:!?।॥()\-–/+₹]+/)) {
    const tok = raw.replace(/^\.+|\.+$/g, '');
    if (!tok) continue;
    let piece = null;
    if (/\d/.test(tok)) piece = tok.replace(/[^\d.]/g, '');
    else if (WORD_TO_DIGIT.has(tok)) piece = WORD_TO_DIGIT.get(tok);
    else if (POINT_SET.has(tok)) piece = '.';
    else if (TIMES_MAP.has(tok)) { times = TIMES_MAP.get(tok); continue; }
    if (piece == null) continue;
    out += piece === '.' ? piece : piece.repeat(times);
    times = 1;
  }
  if (!decimal) return out.replace(/\./g, '');
  const [whole, ...rest] = out.split('.');
  const frac = rest.join('');
  return frac ? `${whole || '0'}.${frac}` : whole;
}

/** Lowercase, NFC, letters/marks/digits only, single spaces. Works for every script. */
export const normText = (s) => nfc(s).replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
const near = (a, b) => { // edit distance <= 1
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
};
/** Match what was heard (string or alternatives) against [{ id, words: [...] }]. Returns { id, score } or null. */
export function matchChoice(said, choices = []) {
  const alts = (Array.isArray(said) ? said : [said]).map(normText).filter(Boolean);
  let best = null;
  alts.forEach((a, ai) => {
    const padded = ` ${a} `;
    const toks = a.split(' ');
    for (const c of choices) {
      for (const w0 of c.words || []) {
        const w = normText(w0);
        if (!w) continue;
        let s;
        if (padded.includes(` ${w} `)) s = 1;
        else if (w.length >= 4 && a.includes(w)) s = 0.85;
        else if (a.length >= 3 && ` ${w} `.includes(padded)) s = 0.75;
        else {
          const all = w.split(' ');
          const wt = all.filter((x) => x.length > 1);
          const use = wt.length ? wt : all;
          const hits = use.filter((x) => toks.some((y) => y === x || (x.length >= 4 && near(x, y)))).length;
          s = (0.9 * hits) / use.length;
        }
        s *= 1 - 0.05 * ai;
        if (!best || s > best.score || (s === best.score && w.length > best.len)) best = { id: c.id, score: s, len: w.length };
      }
    }
  });
  return best && best.score >= 0.5 ? { id: best.id, score: Math.round(best.score * 100) / 100 } : null;
}

/** Best browser voice for a BCP-47 code: exact language first, then the base language. */
/**
 * Clarity score of a browser voice: natural/neural/online voices first (Edge "Online (Natural)", Google, Apple
 * enhanced/premium), robotic engines (eSpeak, compact) last. Ties: the system default, then offline voices.
 */
export function voiceQuality(v) {
  const n = String(v?.name || '');
  let q = 0;
  if (/natural|neural|wavenet|online|enhanced|premium|siri/i.test(n)) q += 6;
  if (/google/i.test(n)) q += 4;
  if (/microsoft/i.test(n)) q += 1;
  if (/espeak|compact|robot|mbrola/i.test(n)) q -= 8;
  if (v?.default) q += 2;
  if (v?.localService) q += 1;
  return q;
}
/** Best browser voice for a BCP-47 code: exact language first, then the base language; best quality within each. */
export function pickVoice(vs, speech, preferred = null) {
  const norm = (l) => String(l || '').replace('_', '-').toLowerCase();
  const want = norm(speech);
  const base = want.split('-')[0];
  const same = vs.filter((v) => norm(v.lang).split('-')[0] === base);
  if (preferred) { const p = same.find((v) => v.voiceURI === preferred || v.name === preferred); if (p) return p; }
  const best = (list) => [...list].sort((a, b) => voiceQuality(b) - voiceQuality(a))[0] || null;
  return best(vs.filter((v) => norm(v.lang) === want)) || best(same);
}

/** Text as it should be heard: currency, arrows and separators spoken naturally (used before every utterance). */
export function speakable(text, code = 'en') {
  return String(text ?? '')
    .replace(/₹\s?([\d,]+(?:\.\d+)?)\s*[–-]\s*₹\s?([\d,]+)/g, (m, a, b) => `${a} – ${b} ${t('common.rupees', { n: 2 }).replace(/^\S*\s*/, '')}`)
    .replace(/₹\s?([\d,]+(?:\.\d+)?)/g, (m, n) => t('common.rupees', { n: Number(n.replace(/,/g, '')) }).replace('{n}', n).replace(/^\d[\d,.]*/, n))
    .replace(/\s*[→·•|]\s*/g, ', ')
    .replace(/\s*\/\s*(?=\D)/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ── Environment ── */

const W = typeof window === 'undefined' ? {} : window;
const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
const synth = () => W.speechSynthesis;
const store = {
  get(k) { try { return W.localStorage?.getItem(k) ?? null; } catch { return null; } },
  set(k, v) { try { if (v == null) W.localStorage?.removeItem(k); else W.localStorage?.setItem(k, v); } catch { /* private mode or blocked storage */ } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ua = () => W.navigator?.userAgent || '';
const isIOS = () => /iP(hone|ad|od)/.test(ua()) || (W.navigator?.platform === 'MacIntel' && W.navigator?.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(ua());
const appLangOrNull = (l) => { const c = String(l || '').toLowerCase().split(/[-_]/)[0]; return LANGS[c] ? c : null; };
const appLang = (l) => appLangOrNull(l || lang()) || 'en';
const speechCode = (code) => LANGS[code]?.speech || `${code}-IN`;
const signedIn = () => { try { return !!currentSession(); } catch { return false; } };
const cloudOn = () => { const c = W.PUNARNAVA_CONFIG || {}; return !!c.apiUrl && c.cloudSpeech !== false; };
const CLOUD_TTS = ['en', 'hi']; // Amazon Polly has Indian voices only for these
const cloudDead = new Set(); // languages the server said it cannot voice

export const canSpeak = () => !!synth();
// Microphones (and so voice typing) only work on https:// or localhost. On plain http (a phone opening the demo by
// its LAN address) Chrome still exposes SpeechRecognition but every start fails with "not-allowed".
export const insecureContext = () => W.isSecureContext === false;
export const canRecord = () => !!(W.navigator?.mediaDevices?.getUserMedia && W.MediaRecorder) && !insecureContext();
const cloudTts = (code) => cloudOn() && CLOUD_TTS.includes(code) && !cloudDead.has(code);
const cloudStt = (owner) => cloudOn() && canRecord() && (!!owner || signedIn());
const srUsable = () => !!SR && !insecureContext();
export const canListen = () => srUsable() || cloudStt();

/** Microphone permission without prompting: 'granted' | 'denied' | 'prompt' | 'unknown' (Safari/Firefox may not say). */
export async function micPermission() {
  try {
    const p = await W.navigator?.permissions?.query?.({ name: 'microphone' });
    return p?.state || 'unknown';
  } catch { return 'unknown'; }
}

/**
 * Whether voice typing can work here, in language l, and if not, the message key that explains why.
 * { ok, key, engine: 'browser'|'cloud'|null }. Views show the key next to text fields; typing always still works.
 */
export function voiceTypingStatus(l, { owner } = {}) {
  const code = appLang(l);
  if (insecureContext()) return { ok: false, key: 'speech.err.insecure', engine: null };
  if (srUsable() && !srBroken.has(code)) return { ok: true, key: null, engine: 'browser' };
  if (cloudStt(owner)) return { ok: true, key: null, engine: 'cloud' };
  if (srUsable()) return { ok: false, key: 'speech.err.langListen', engine: null };
  return { ok: false, key: 'speech.err.unsupported', engine: null };
}
/** A short localized note when voice typing is not available (empty string when it is). */
export function voiceTypingNote(l, opts) {
  const st = voiceTypingStatus(l, opts);
  return st.ok ? '' : `<p class="small muted voice-unavailable" role="note" data-no-read>${esc(t(st.key))} ${esc(t('speech.typeInstead'))}</p>`;
}

/* ── Shared state (every control renders from this, not from DOM flags) ── */

const RATES = [0.75, 1, 1.25];
const RATE_KEYS = { 0.75: 'speech.rateSlow', 1: 'speech.rateNormal', 1.25: 'speech.rateFast' };
export function getRate() { const r = Number(store.get('pn-rate')); return RATES.includes(r) ? r : 1; }
export const audioMode = () => store.get('pn-audio-mode') === '1';

let state = { mode: 'idle', engine: null, lang: null, rate: getRate(), audio: audioMode() };
const subs = new Set();
export const getState = () => state;
/** Subscribe to { mode: 'idle'|'loading'|'speaking'|'listening'|'processing', engine, lang, rate, audio }. Returns unsubscribe. */
export function onState(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); }
function setState(patch) {
  state = { ...state, ...patch };
  for (const fn of [...subs]) { try { fn(state); } catch (e) { console.error(e); } }
}
export function setRate(r) {
  const v = RATES.includes(Number(r)) ? Number(r) : 1;
  store.set('pn-rate', String(v));
  if (audioEl && !audioEl.paused) audioEl.playbackRate = v;
  setState({ rate: v });
  return v;
}

/* ── Voices and capabilities ── */

const voiceCache = new Map(); // app language → SpeechSynthesisVoice | null
const guessFailed = new Set();
const waiters = new Set();
if (synth()) {
  synth().addEventListener?.('voiceschanged', () => { voiceCache.clear(); for (const w of waiters) w(); waiters.clear(); });
  try { synth().getVoices(); } catch { /* warm-up only */ }
}
function loadVoices() {
  if (!synth()) return Promise.resolve([]);
  const now = synth().getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((res) => {
    const done = () => { waiters.delete(done); res(synth().getVoices()); };
    waiters.add(done);
    setTimeout(done, 1500);
  });
}
async function voiceFor(code) {
  const vs = await loadVoices();
  if (!voiceCache.has(code)) voiceCache.set(code, pickVoice(vs, speechCode(code), store.get(`pn-voice-${code}`)));
  return { voice: voiceCache.get(code), empty: !vs.length };
}
/** Voices this browser offers for a language, best first: [{ name, voiceURI, lang, local, quality }]. */
export async function voicesFor(l) {
  const code = appLang(l);
  const base = speechCode(code).split('-')[0].toLowerCase();
  return (await loadVoices()).filter((v) => String(v.lang || '').replace('_', '-').toLowerCase().split('-')[0] === base)
    .sort((a, b) => voiceQuality(b) - voiceQuality(a))
    .map((v) => ({ name: v.name, voiceURI: v.voiceURI, lang: v.lang, local: !!v.localService, quality: voiceQuality(v) }));
}
export const preferredVoice = (l) => store.get(`pn-voice-${appLang(l)}`);
/** Remember the person's chosen voice for a language (null = automatic, best available). */
export function setPreferredVoice(l, voiceURI) {
  const code = appLang(l);
  store.set(`pn-voice-${code}`, voiceURI || null);
  voiceCache.delete(code);
}

export const voiceFallback = (l) => store.get(`pn-voice-fallback-${appLang(l)}`);
/** Remember an explicit "use another voice" choice, e.g. setVoiceFallback('mr', 'hi'). Pass null to clear. */
export function setVoiceFallback(l, to) { store.set(`pn-voice-fallback-${appLang(l)}`, to || null); }

// How to voice a language: { engine: 'browser'|'cloud'|'none', voice?, speech?, code, guess?, fallback? }
async function plan(code, { noFallback = false } = {}) {
  let guess = null;
  if (synth()) {
    const { voice, empty } = await voiceFor(code);
    if (voice) return { engine: 'browser', voice, speech: speechCode(code), code };
    // Some Android WebViews list no voices at all but still speak by language tag.
    if (empty && !guessFailed.has(code)) guess = { engine: 'browser', voice: null, speech: speechCode(code), code, guess: true };
  }
  if (cloudTts(code)) return { engine: 'cloud', code };
  if (guess) return guess;
  const fb = !noFallback && voiceFallback(code);
  if (fb && fb !== code && LANGS[fb]) {
    const p = await plan(fb, { noFallback: true });
    if (p.engine !== 'none') return { ...p, fallback: fb };
  }
  return { engine: 'none', code };
}

/** What works on this device for a language: { tts, stt, record, fallback? }. Voice probe is cached per language. */
export async function capabilities(l, { owner } = {}) {
  const code = appLang(l);
  const p = await plan(code);
  return {
    tts: p.engine,
    stt: srUsable() && !srBroken.has(code) ? 'browser' : cloudStt(owner) ? 'cloud' : 'none',
    record: canRecord(),
    ...(p.fallback ? { fallback: p.fallback } : {}),
  };
}

/* ── Text to speech ── */

let session = 0;
let cancelCurrent = null;
let liveUtterance = null; // keeps Chrome from garbage-collecting the utterance before onend
let audioEl = null;
let lastRequest = null;
let audioUnlocked = false;
let lit = null;
let lastCancel = 0; // when speechSynthesis.cancel() last ran
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const reducedMotion = () => !!W.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function highlight(el) {
  if (lit && lit !== el) lit.removeAttribute('data-speaking');
  lit = el?.isConnected ? el : null;
  if (!lit) return;
  lit.setAttribute('data-speaking', '');
  try { lit.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch { /* old browsers */ }
}

function stopTts() {
  session++;
  const c = cancelCurrent;
  cancelCurrent = null;
  c?.();
  const s = synth();
  if (s && (s.speaking || s.pending || s.paused)) { try { s.cancel(); lastCancel = Date.now(); } catch { /* ignore */ } }
  if (audioEl) { try { audioEl.pause(); } catch { /* ignore */ } }
  highlight(null);
  readingEl = null;
  if (state.mode === 'speaking' || state.mode === 'loading') setState({ mode: 'idle', engine: null });
}
/** Stop reading aloud. */
export function stop() { stopTts(); }

function sayBrowser(text, p) {
  return new Promise((res) => {
    const s = synth();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = p.speech;
    if (p.voice) u.voice = p.voice;
    u.rate = getRate() * 0.92; // slightly slower than the engine default: clearer for Indian-language voices
    u.pitch = 1;
    u.volume = 1;
    liveUtterance = u;
    let done = false;
    let started = false;
    let extra = 0;
    let wd = 0;
    let sw = 0;
    let keep = 0;
    const fin = (ok, err) => {
      if (done) return;
      done = true;
      clearTimeout(wd); clearTimeout(sw); clearInterval(keep);
      if (cancelCurrent === stopMe) cancelCurrent = null;
      res({ ok, err });
    };
    const stopMe = () => fin(false, 'stopped');
    // Watchdog: Chrome Android sometimes never fires onend; move on once the engine goes quiet.
    const arm = () => {
      clearTimeout(wd);
      wd = setTimeout(() => {
        if (s.speaking && !s.paused && extra++ < 3) return arm();
        try { s.cancel(); } catch { /* ignore */ }
        fin(true, 'watchdog');
      }, extra ? 4000 : (text.length / (12 * u.rate)) * 1000 + 3000);
    };
    u.onstart = () => {
      started = true; clearTimeout(sw); arm();
      // Desktop Chrome cuts network voices after ~15 s; pause/resume keeps them alive (breaks Android, so not there).
      if (p.voice && !p.voice.localService && !isAndroid()) keep = setInterval(() => { if (s.speaking) { s.pause(); s.resume(); } }, 10000);
    };
    u.onend = () => fin(true);
    u.onerror = (e) => fin(false, e.error || 'synthesis-failed');
    sw = setTimeout(() => {
      if (started) return;
      if (s.speaking || s.pending) { started = true; arm(); } else fin(false, 'no-start');
    }, 4000);
    cancelCurrent = stopMe;
    try {
      if (s.paused) s.resume(); // a backgrounded tab can leave the engine paused, and nothing would play
      s.speak(u);
    } catch { fin(false, 'synthesis-failed'); }
  });
}

const urlCache = new Map(); // `${lang}|${text}` → { p: Promise<url|null>, at }
function ttsUrl(text, code) {
  const k = `${code}|${text}`;
  const hit = urlCache.get(k);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.p;
  const p = call('POST', signedIn() ? '/api/tts' : '/public/tts', { text, lang: code }).then((r) => {
    if (r?.unsupported) { cloudDead.add(code); return null; }
    return r?.url || null;
  });
  p.catch(() => urlCache.delete(k));
  urlCache.set(k, { p, at: Date.now() });
  if (urlCache.size > 200) urlCache.delete(urlCache.keys().next().value);
  return p;
}
const audio = () => (audioEl ||= new Audio());
function playUrl(url) {
  return new Promise((res) => {
    const a = audio();
    let done = false;
    let wd = 0;
    const fin = (ok, err) => {
      if (done) return;
      done = true;
      clearTimeout(wd);
      a.onended = a.onerror = a.onloadedmetadata = null;
      if (cancelCurrent === stopMe) cancelCurrent = null;
      res({ ok, err });
    };
    const stopMe = () => { try { a.pause(); } catch { /* ignore */ } fin(false, 'stopped'); };
    a.onended = () => fin(true);
    a.onerror = () => fin(false, 'audio-error');
    a.onloadedmetadata = () => {
      clearTimeout(wd);
      const d = Number.isFinite(a.duration) ? a.duration : 20;
      wd = setTimeout(() => fin(true, 'watchdog'), (d / (a.playbackRate || 1)) * 1000 + 3000);
    };
    wd = setTimeout(() => fin(false, 'audio-timeout'), 15000);
    cancelCurrent = stopMe;
    a.src = url;
    a.defaultPlaybackRate = getRate();
    a.playbackRate = getRate();
    const pr = a.play();
    pr?.catch?.((e) => fin(false, e?.name === 'NotAllowedError' ? 'not-allowed' : 'audio-error'));
  });
}

async function sayChunk(text, p, mine) {
  if (p.engine === 'browser') return sayBrowser(text, p);
  try {
    const url = await ttsUrl(text, p.code);
    if (mine !== session) return { ok: false, err: 'stopped' };
    if (!url) return { ok: false, err: 'unsupported' };
    return await playUrl(url);
  } catch { return { ok: false, err: 'cloud-error' }; }
}

const RETRY_ON_CLOUD = new Set(['no-start', 'synthesis-failed', 'language-unavailable', 'voice-unavailable', 'synthesis-unavailable']);

/**
 * Speak items in order: [{ text, el?, lang? }] or strings. onItem(item, i) fires as each one starts.
 * Resolves { ok, engine } or { ok: false, reason: 'no-voice'|'not-allowed'|'error'|'stopped', lang }.
 */
export async function speak(items, { lang: l, onItem, onDone, onError, onStart } = {}) {
  stopTts();
  const mine = ++session;
  const code = appLang(l);
  const list = (Array.isArray(items) ? items : [items])
    .map((it) => (typeof it === 'string' ? { text: it } : it))
    .filter((it) => it && String(it.text ?? '').trim());
  lastRequest = { items, opts: { lang: l } };
  const stopped = { ok: false, reason: 'stopped', lang: code };
  if (!list.length) { onDone?.(); return { ok: true, engine: 'none' }; }
  // iOS only lets speech start inside a tap; unlock both engines before the first await.
  if (isIOS() && synth()) { try { synth().speak(new SpeechSynthesisUtterance(' ')); } catch { /* ignore */ } }
  if (cloudOn() && !audioUnlocked) { audioUnlocked = true; try { const a = audio(); a.src = SILENT; a.play()?.catch?.(() => {}); } catch { /* ignore */ } }
  setState({ mode: 'loading', engine: null, lang: code });
  const main = await plan(code);
  if (mine !== session) return stopped;
  const fail = (reason, extra = {}) => {
    highlight(null);
    setState({ mode: 'idle', engine: null });
    const r = { ok: false, reason, lang: code, ...extra };
    onError?.(r);
    return r;
  };
  if (main.engine === 'none') return fail('no-voice');
  // People's content (bdi[data-user][lang]) is read in its own voice when this phone has one.
  const plans = new Map([[code, main]]);
  const queue = [];
  for (const [i, it] of list.entries()) {
    let p = main;
    const il = appLangOrNull(it.lang);
    if (il && il !== code) {
      if (!plans.has(il)) plans.set(il, await plan(il, { noFallback: true }));
      if (mine !== session) return stopped;
      const q = plans.get(il);
      if (q.engine !== 'none' && !q.guess) p = q;
    }
    chunkText(speakable(it.text, il || code), p.engine === 'cloud' ? 300 : 180).forEach((text, k) => queue.push({ it, i, first: k === 0, text, p }));
  }
  // Chrome silently drops an utterance queued within ~100 ms of cancel(): give the engine a moment.
  if (main.engine === 'browser') {
    const wait = 160 - (Date.now() - lastCancel);
    if (wait > 0) await sleep(wait);
    if (mine !== session) return stopped;
  }
  setState({ mode: 'speaking', engine: main.engine });
  onStart?.(main.engine);
  for (let q = 0; q < queue.length; q++) {
    const e = queue[q];
    if (mine !== session) return stopped;
    if (e.first) { highlight(e.it.el || null); onItem?.(e.it, e.i); }
    const nx = queue[q + 1];
    if (nx?.p.engine === 'cloud') ttsUrl(nx.text, nx.p.code).catch(() => {});
    let r = await sayChunk(e.text, e.p, mine);
    if (mine !== session) return stopped;
    if (!r.ok && e.p.engine === 'browser' && RETRY_ON_CLOUD.has(r.err)) {
      if (e.p.guess) { guessFailed.add(e.p.code); voiceCache.delete(e.p.code); }
      if (cloudTts(e.p.code)) {
        const cp = { engine: 'cloud', code: e.p.code };
        const old = e.p;
        for (const x of queue) if (x.p === old) x.p = cp;
        setState({ engine: 'cloud' });
        r = await sayChunk(e.text, cp, mine);
        if (mine !== session) return stopped;
      } else if (e.p.guess) return fail('no-voice');
    }
    if (!r.ok) {
      if (r.err === 'stopped') return stopped;
      if (r.err === 'unsupported') return fail('no-voice');
      return fail(r.err === 'not-allowed' ? 'not-allowed' : 'error', { error: r.err });
    }
    if (r.err === 'watchdog') await sleep(80); // let a stuck engine settle after cancel()
  }
  highlight(null);
  setState({ mode: 'idle', engine: null });
  onDone?.();
  return { ok: true, engine: main.engine };
}

/* ── Reading the screen ── */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'svg', 'SVG', 'CANVAS', 'AUDIO', 'VIDEO', 'IFRAME', 'OBJECT', 'IMG', 'PICTURE', 'DATALIST', 'OPTION']);
const CONTROLS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
const BLOCKY = 'p, div, h1, h2, h3, h4, h5, h6, li, dl, ul, ol, table, section, article';
function skipEl(el, cs) {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.hidden || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('data-no-read') || el.classList.contains('sr-only')) return true;
  if (el.tagName === 'DIALOG' && !el.open) return true;
  if (el.parentElement?.tagName === 'DETAILS' && !el.parentElement.open && el.tagName !== 'SUMMARY') return true;
  return cs.display === 'none' || cs.visibility === 'hidden';
}
const style = (el) => (W.getComputedStyle ? W.getComputedStyle(el) : { display: 'block', visibility: 'visible' });
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
function textOf(el) {
  let out = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 3) out += n.nodeValue;
    else if (n.nodeType === 1 && !CONTROLS.has(n.tagName) && !skipEl(n, style(n))) out += ` ${textOf(n)} `;
  }
  return squash(out);
}
function controlValue(c) {
  if (c.tagName === 'SELECT') return squash([...c.selectedOptions].map((o) => o.textContent).join(', '));
  if (c.type === 'checkbox' || c.type === 'radio') return c.checked ? t('speech.selected') : '';
  if (['password', 'hidden', 'file'].includes(c.type)) return '';
  return squash(c.value);
}
function labelFor(c) {
  const by = c.getAttribute('aria-labelledby');
  const viaBy = by && squash(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' '));
  return squash(c.getAttribute('aria-label')) || viaBy || (c.labels?.[0] ? textOf(c.labels[0]) : '') || squash(c.getAttribute('placeholder')) || squash(c.title);
}
const joinLV = (label, value) => (label && value ? `${label}: ${value}` : label || value);

/** Visible text of `el` as speakable items [{ text, el, lang? }] in DOM order. */
export function collectItems(root) {
  const items = [];
  let buf = [];
  let host = root;
  const flush = () => { const text = squash(buf.join(' ')); buf = []; if (text) items.push({ text, el: host }); };
  const unit = (text, el, l) => { flush(); const s = squash(text); if (s) items.push(l ? { text: s, el, lang: l } : { text: s, el }); };
  const walk = (node) => {
    if (node.nodeType === 3) { if (node.nodeValue.trim()) buf.push(node.nodeValue); return; }
    if (node.nodeType !== 1) return;
    const el = node;
    const cs = style(el);
    if (skipEl(el, cs)) return;
    const say = el.getAttribute('data-say');
    if (say && say.trim()) return unit(say, el);
    if (el.hasAttribute('data-user') && el.getAttribute('lang')) {
      flush();
      const s = textOf(el);
      if (s) items.push({ text: s, el: host, lang: el.getAttribute('lang') });
      return;
    }
    if (CONTROLS.has(el.tagName)) return unit(joinLV(labelFor(el), controlValue(el)), el);
    if (el.tagName === 'LABEL') {
      const c = el.querySelector('input, select, textarea');
      if (c && !skipEl(c, style(c))) return unit(joinLV(textOf(el), controlValue(c)), el);
    }
    const inline = cs.display.startsWith('inline') || cs.display === 'contents';
    const action = el.matches('button, [role=button], summary') || (el.matches('a[href], [role=link]') && (!inline || el.classList.contains('btn')));
    if (action && !el.querySelector(BLOCKY)) return unit(textOf(el) || el.getAttribute('aria-label') || el.title, el);
    if (cs.display === 'table-cell') { if (buf.length) buf[buf.length - 1] = `${buf[buf.length - 1].trimEnd()},`; el.childNodes.forEach(walk); return; }
    if (inline) { el.childNodes.forEach(walk); return; }
    flush();
    const prev = host;
    host = el;
    el.childNodes.forEach(walk);
    flush();
    host = prev;
  };
  if (root) root.childNodes.forEach(walk);
  flush();
  return items;
}

let readingEl = null;
const helpShown = new Set();
function report(r, quiet) {
  if (r.ok || r.reason === 'stopped') return;
  if (r.reason === 'no-voice') {
    if (quiet && helpShown.has(r.lang)) return;
    helpShown.add(r.lang);
    showNoVoiceHelp(r.lang);
  } else if (r.reason === 'not-allowed') announce(t('speech.tapListen'));
  else if (!quiet) toast(t('speech.err.speak'), true);
}

/** Read an element's visible text aloud, highlighting each block. { quiet } suppresses error toasts. */
export async function readElement(el, { quiet = false, lang: l } = {}) {
  if (!el) return { ok: false, reason: 'empty' };
  const items = collectItems(el);
  const r = await speak(items, { lang: l, onStart: () => { readingEl = el; } });
  if (readingEl === el && r.reason !== 'stopped') readingEl = null;
  report(r, quiet);
  return r;
}
export const mainEl = () => (typeof document === 'undefined' ? null : document.getElementById('main') || document.querySelector('main'));
/** Read the main content of the current screen. */
export const readMain = (opts) => readElement(mainEl(), opts);

/* ── Speech to text ── */

const srBroken = new Set(); // languages where the browser recognizer said no
const ERR = {
  'not-allowed': 'speech.err.micBlocked',
  'service-not-allowed': 'speech.err.service',
  network: 'speech.err.network',
  'audio-capture': 'speech.err.noMic',
  'language-not-supported': 'speech.err.langListen',
  'no-speech': 'speech.err.noSpeech',
  'bad-grammar': 'speech.err.generic',
  'start-failed': 'speech.err.generic',
  unsupported: 'speech.err.unsupported',
  aborted: null,
};
const FALL_THROUGH = new Set(['language-not-supported', 'service-not-allowed', 'network']);
let activeListen = null;

function srRun(code, { onInterim, maxAlts }) {
  let r;
  try { r = new SR(); } catch { return { stop() {}, abort() {}, done: Promise.resolve({ err: 'start-failed', engine: 'browser' }) }; }
  r.lang = speechCode(code);
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = maxAlts;
  let guard = 0;
  let end = () => {};
  const done = new Promise((res) => {
    let finals = [];
    let interim = '';
    let err = null;
    let ended = false;
    end = () => {
      if (ended) return;
      ended = true;
      clearTimeout(guard); clearTimeout(cap);
      const alts = [];
      for (let k = 0; k < maxAlts; k++) alts.push(squash(finals.map((res) => (res[k] || res[0]).transcript).join(' ')));
      const text = alts[0] || squash(interim);
      res({ text, alternatives: alts.filter(Boolean), err: text ? null : err, engine: 'browser' });
    };
    r.onresult = (e) => {
      const list = [...e.results];
      finals = list.filter((x) => x.isFinal).map((x) => [...x].map((a) => ({ transcript: a.transcript })));
      interim = list.filter((x) => !x.isFinal).map((x) => x[0].transcript).join(' ');
      onInterim?.(squash(`${finals.map((x) => x[0].transcript).join(' ')} ${interim}`));
    };
    r.onerror = (e) => { err = e.error || 'start-failed'; };
    r.onend = end;
    const cap = setTimeout(() => { try { r.stop(); } catch { /* ignore */ } guard = setTimeout(end, 3000); }, 20000);
    try { r.start(); } catch { err = 'start-failed'; end(); }
  });
  return {
    stop() { try { r.stop(); } catch { /* ignore */ } clearTimeout(guard); guard = setTimeout(end, 3000); },
    abort() { try { r.abort(); } catch { /* ignore */ } clearTimeout(guard); guard = setTimeout(end, 1500); },
    done,
  };
}

const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
export const recordMime = () => MIMES.find((m) => W.MediaRecorder?.isTypeSupported?.(m)) || '';
const blobToDataUrl = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });

/**
 * Upload a recorded clip through the presigned upload. Returns the key.
 * owner: { jobId, token } uses the owner-link route. stt: a throwaway voice-typing clip (POST /api/stt/uploads,
 * uploads/tmp/, deleted once read); without it a signed-in clip is kept (voice notes).
 */
export async function uploadBlob(blob, type, { owner, stt = false } = {}) {
  const { key, url } = owner
    ? await call('POST', `/public/owner/${encodeURIComponent(owner.jobId)}/uploads`, { contentType: type, t: owner.token }, { t: owner.token })
    : await call('POST', stt ? '/api/stt/uploads' : '/api/uploads', { contentType: type });
  if (String(url).startsWith('mock-upload:')) await uploadData(key, await blobToDataUrl(blob));
  else {
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': type }, body: blob });
    if (!r.ok) throw Object.assign(new Error('upload failed'), { code: 'upload' });
  }
  return key;
}

// Record up to maxMs; stops early after ~1.6 s of quiet once speech was heard.
async function record({ maxMs, setStopper }) {
  const stream = await W.navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = recordMime();
  let rec;
  try { rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch (e) { stream.getTracks().forEach((tr) => tr.stop()); throw e; }
  return new Promise((res, rej) => {
    const chunks = [];
    let iv = 0;
    let cap = 0;
    let ac = null;
    const t0 = Date.now();
    const cleanup = () => { clearInterval(iv); clearTimeout(cap); stream.getTracks().forEach((tr) => tr.stop()); ac?.close?.().catch?.(() => {}); };
    const stopNow = () => { if (rec.state !== 'inactive') { try { rec.stop(); } catch (e) { cleanup(); rej(e); } } };
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = () => { cleanup(); const type = (rec.mimeType || mime || 'audio/webm').split(';')[0]; res({ blob: new Blob(chunks, { type }), type, ms: Date.now() - t0 }); };
    rec.onerror = (e) => { cleanup(); rej(e.error || e); };
    setStopper(stopNow);
    cap = setTimeout(stopNow, maxMs);
    try {
      ac = new (W.AudioContext || W.webkitAudioContext)();
      ac.resume?.().catch?.(() => {});
      const an = ac.createAnalyser();
      an.fftSize = 512;
      ac.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let spoke = false;
      let quietSince = 0;
      iv = setInterval(() => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        if (Math.sqrt(sum / buf.length) > 6) { spoke = true; quietSince = 0; } else if (spoke) {
          quietSince ||= Date.now();
          if (Date.now() - quietSince > 1600) stopNow();
        }
      }, 100);
    } catch { /* no level meter: the time cap and the stop button still end it */ }
    rec.start(250);
  });
}

function cloudRun(code, { owner, maxMs }) {
  let stopRec = null;
  let aborted = false;
  const h = { stop: () => stopRec?.(), abort: () => { aborted = true; stopRec?.(); } };
  h.done = (async () => {
    const base = owner ? `/public/owner/${encodeURIComponent(owner.jobId)}/stt` : '/api/stt';
    const q = owner ? { t: owner.token } : undefined;
    let clip;
    try {
      setState({ mode: 'listening', engine: 'cloud' });
      announce(t('speech.listening'));
      clip = await record({ maxMs, setStopper: (fn) => { stopRec = fn; } });
    } catch (e) {
      const n = e?.name;
      return { err: n === 'NotAllowedError' || n === 'SecurityError' ? 'not-allowed' : n === 'NotFoundError' ? 'audio-capture' : 'start-failed', engine: 'cloud' };
    }
    stopRec = null;
    if (aborted) return { err: 'aborted', engine: 'cloud' };
    if (clip.ms < 600 || clip.blob.size < 800) return { err: 'no-speech', engine: 'cloud' };
    setState({ mode: 'processing', engine: 'cloud' });
    announce(t('speech.processing'));
    try {
      const key = await uploadBlob(clip.blob, clip.type, { owner, stt: true });
      if (aborted) return { err: 'aborted', engine: 'cloud' };
      const job = await call('POST', base, { key, lang: code, ...(owner ? { t: owner.token } : {}) }, q);
      if (job?.unsupported || !job?.jobName) return { err: 'speech.err.cloud', engine: 'cloud' };
      const until = Date.now() + 60000;
      while (Date.now() < until) {
        await sleep(2000);
        if (aborted) return { err: 'aborted', engine: 'cloud' };
        const r = await call('GET', `${base}/${encodeURIComponent(job.jobName)}`, undefined, q);
        const st = String(r?.status || '').toLowerCase();
        if (r?.unsupported || /fail|error/.test(st)) return { err: 'speech.err.cloud', engine: 'cloud' };
        if (/complet|done|succe/.test(st) || (!st && typeof r?.text === 'string')) {
          return { text: squash(r.text), alternatives: r.alternatives || [], err: r.text ? null : 'no-speech', engine: 'cloud' };
        }
      }
      return { err: 'speech.err.timeout', engine: 'cloud' };
    } catch { return { err: 'speech.err.cloud', engine: 'cloud' }; }
  })();
  return h;
}

/**
 * Listen once. mode 'text' | 'digits' | 'choice' (with choices [{ id, words }]). decimal: allow a point in digits mode.
 * owner: { jobId, token } enables the cloud fallback on owner links. Returns { stop(), cancel(), done }.
 * done resolves { text, alternatives, engine, error?, cancelled?, choice?, raw? }; error is a speech.* key.
 */
export function listen({ lang: l, mode = 'text', choices = [], decimal = false, owner = null, onInterim, maxMs = 15000 } = {}) {
  activeListen?.cancel();
  stopTts();
  const code = appLang(l);
  let cancelled = false;
  let cur = null;
  const h = {
    stop: () => cur?.stop(),
    cancel: () => { cancelled = true; cur?.abort(); },
    done: null,
  };
  activeListen = h;
  const finalize = (res) => {
    if (activeListen === h) { activeListen = null; setState({ mode: 'idle', engine: null }); }
    const alternatives = [...new Set([res.text, ...(res.alternatives || [])].map(squash).filter(Boolean))];
    const out = { text: alternatives[0] || '', alternatives, engine: res.engine || null };
    if (cancelled || res.err === 'aborted') return { ...out, cancelled: true };
    if (res.err) {
      const blockedish = ['not-allowed', 'service-not-allowed', 'audio-capture', 'start-failed'].includes(res.err);
      const key = blockedish && insecureContext() ? 'speech.err.insecure'
        : res.err in ERR ? ERR[res.err] : String(res.err).startsWith('speech.') ? res.err : 'speech.err.generic';
      if (key) out.error = key;
    } else if (!out.text) out.error = 'speech.err.noSpeech';
    if (!out.error && mode === 'digits') {
      out.raw = out.text;
      out.text = alternatives.map((a) => normalizeDigits(a, { decimal })).find(Boolean) || '';
      if (!out.text) out.error = 'speech.err.noDigits';
    }
    if (!out.error && mode === 'choice') {
      const m = matchChoice(alternatives, choices);
      out.choice = m?.id ?? null;
      if (!m) out.error = 'speech.err.noMatch';
    }
    if (out.error) announce(t(out.error), { assertive: true });
    return out;
  };
  h.done = (async () => {
    let res = null;
    if (insecureContext()) return finalize({ err: 'not-allowed' });
    // Known-denied microphone: say so at once instead of starting a recognizer that can only fail.
    if ((await micPermission()) === 'denied') return finalize({ err: 'not-allowed' });
    if (cancelled) return finalize({});
    if (srUsable() && !srBroken.has(code)) {
      setState({ mode: 'listening', engine: 'browser', lang: code });
      announce(t('speech.listening'));
      cur = srRun(code, { onInterim, maxAlts: mode === 'choice' ? 5 : 3 });
      res = await cur.done;
      if (res.err === 'language-not-supported' || res.err === 'service-not-allowed') srBroken.add(code);
      if (cancelled || !(res.err && FALL_THROUGH.has(res.err) && cloudStt(owner))) return finalize(res);
    }
    if (cancelled) return finalize(res || {});
    if (!cloudStt(owner)) return finalize(res || { err: 'unsupported' });
    cur = cloudRun(code, { owner, maxMs });
    return finalize(await cur.done);
  })();
  return h;
}

/* ── Voice typing ── */

export const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const MIC_SEL = 'input:not([type]), input[type=text], input[type=search], input[type=tel], input[type=number], textarea';

function attachMic(input) {
  input.dataset.micReady = '1';
  const wrap = document.createElement('span');
  wrap.className = 'mic-wrap';
  const parent = input.parentElement;
  if (parent && /flex|grid/.test(style(parent).display)) { wrap.style.flex = style(input).flex; wrap.style.minWidth = '0'; }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mic-btn';
  btn.setAttribute('data-no-read', '');
  btn.innerHTML = MIC;
  const paint = (live) => {
    const s = t(live ? 'speech.micStop' : 'speech.mic');
    btn.setAttribute('aria-pressed', String(live));
    btn.setAttribute('aria-label', s);
    btn.title = s;
    btn.classList.toggle('live', live);
  };
  paint(false);
  input.replaceWith(wrap);
  wrap.append(input, btn);
  let h = null;
  btn.addEventListener('click', async () => {
    if (h) { h.stop(); return; }
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    const im = input.inputMode;
    const digits = type === 'number' || type === 'tel' || im === 'numeric' || im === 'decimal';
    const decimal = type === 'number' ? (input.step === 'any' || /\./.test(input.step || '')) : im === 'decimal';
    const voiceLang = input.dataset.voiceLang || input.closest('[data-voice-lang]')?.dataset.voiceLang;
    const before = input.value;
    const base = digits || !before ? '' : `${before.trimEnd()} `;
    const max = input.maxLength > 0 ? input.maxLength : undefined;
    const put = (v) => { input.value = v.slice(0, max); };
    paint(true);
    h = listen({ lang: voiceLang, mode: digits ? 'digits' : 'text', decimal, onInterim: digits ? null : (txt) => put(base + txt) });
    const res = await h.done;
    h = null;
    paint(false);
    if (res.cancelled) put(before);
    else if (res.text) put(digits ? res.text : base + res.text);
    else if (res.error) put(before); // drop partial interim text from a failed attempt
    if (input.value !== before) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (res.error && !res.cancelled) toast(t(res.error), true);
    // The recognized text is only placed in the field: it is never submitted. Focus returns so it can be edited.
    if (!res.cancelled && input.isConnected) { try { input.focus({ preventScroll: true }); } catch { /* old browsers */ } }
  });
}

/** Adds a mic button to every text-like input and textarea under root (skips readonly, disabled, [data-novoice]). */
export function enhanceVoiceInputs(root = document) {
  if (!root?.querySelectorAll || !canListen()) return;
  for (const input of root.querySelectorAll(MIC_SEL)) {
    if (input.dataset.micReady || input.readOnly || input.disabled || input.closest('[data-novoice]') || input.hidden || style(input).display === 'none') continue;
    attachMic(input);
  }
}

/* ── Low-literacy controls ── */

const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${p}</svg>`;
const gauge = (x, y) => svg(`<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17L${x} ${y}"/><circle cx="12" cy="17" r="1.2"/>`);
const I = {
  speaker: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  headphones: svg('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>'),
  0.75: gauge(7.1, 13.6),
  1: gauge(12, 11),
  1.25: gauge(16.9, 13.6),
};

/**
 * Listen/Stop button, reading-speed button and Auto-read toggle, all driven by onState.
 * opts { rate = true, audio = true } choose the parts. Returns a destroy function.
 */
export function mountListenControl(container, { rate = true, audio = true } = {}) {
  if (!container) return () => {};
  const box = document.createElement('div');
  box.className = 'listen-ctl';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', t('speech.controls'));
  box.setAttribute('data-no-read', '');
  box.innerHTML = `<button type="button" class="lc-btn lc-main" data-lc-listen></button>${rate ? '<button type="button" class="lc-btn lc-rate" data-lc-rate hidden></button>' : ''}${audio ? '<button type="button" class="lc-btn lc-audio" data-lc-audio></button>' : ''}${canSpeak() ? `<button type="button" class="lc-btn lc-voice" data-lc-voice title="${esc(t('speech.voicePick.title'))}" aria-label="${esc(t('speech.voicePick.title'))}">${I.speaker}<span>${esc(t('speech.voicePick.short'))}</span></button>` : ''}`;
  const main = box.querySelector('[data-lc-listen]');
  const rateBtn = box.querySelector('[data-lc-rate]');
  const audioBtn = box.querySelector('[data-lc-audio]');
  let seen = false;
  let unsub = () => {};
  const paint = (s) => {
    if (box.isConnected) seen = true;
    else if (seen) { unsub(); return; }
    const busy = s.mode === 'speaking' || s.mode === 'loading';
    main.innerHTML = `${s.mode === 'loading' ? '<span class="spinner" aria-hidden="true"></span>' : busy ? I.stop : I.speaker}<span>${esc(t(s.mode === 'loading' ? 'speech.wait' : busy ? 'speech.stop' : 'speech.listen'))}</span>`;
    main.title = t(busy ? 'speech.stopReading' : 'speech.readPage');
    main.classList.toggle('on', busy);
    if (rateBtn) {
      const word = t(RATE_KEYS[s.rate] || RATE_KEYS[1]);
      rateBtn.hidden = !busy;
      rateBtn.innerHTML = `${I[s.rate] || I[1]}<span>${esc(word)}</span>`;
      rateBtn.setAttribute('aria-label', t('speech.rateLabel', { rate: word }));
    }
    if (audioBtn) {
      audioBtn.setAttribute('aria-pressed', String(!!s.audio));
      audioBtn.title = t('speech.autoReadHint');
      audioBtn.innerHTML = `${I.headphones}<span>${esc(t('speech.autoRead'))}</span><b>${esc(t(s.audio ? 'speech.on' : 'speech.off'))}</b>`;
    }
  };
  main.addEventListener('click', () => {
    if (state.mode === 'speaking' || state.mode === 'loading') stop();
    else readMain();
  });
  rateBtn?.addEventListener('click', () => setRate(RATES[(RATES.indexOf(getRate()) + 1) % RATES.length]));
  audioBtn?.addEventListener('click', () => setAudioMode(!audioMode()));
  box.querySelector('[data-lc-voice]')?.addEventListener('click', () => showVoicePicker());
  container.append(box);
  unsub = onState(paint);
  return () => { unsub(); box.remove(); };
}

let readRoute = null;
const routeKey = () => `${W.location?.hash || ''}|${W.location?.pathname || ''}`;

/** Turn Audio mode on or off (saved per device as pn-audio-mode). */
export function setAudioMode(on) {
  store.set('pn-audio-mode', on ? '1' : '0');
  setState({ audio: !!on });
  const said = t(on ? 'speech.audioOnSaid' : 'speech.audioOffSaid');
  announce(said);
  if (on) {
    readRoute = routeKey(); // do not also auto-read the screen over the confirmation
    afterRender(document);
    speak([{ text: said }]).then((r) => report(r, true));
  } else {
    stop();
    for (const b of document.querySelectorAll('.say-btn')) b.remove();
    for (const h of document.querySelectorAll('[data-say-host]')) h.removeAttribute('data-say-host');
  }
}

function addSayButton(el) {
  if ([...el.children].some((c) => c.classList.contains('say-btn'))) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'say-btn';
  b.setAttribute('data-no-read', '');
  b.setAttribute('aria-label', t('speech.readThis'));
  b.title = t('speech.readThis');
  b.innerHTML = I.speaker;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (readingEl === el && state.mode !== 'idle') stop();
    else readElement(el);
  });
  if (style(el).position === 'static') el.style.position = 'relative';
  el.setAttribute('data-say-host', '');
  el.append(b);
}

/** Call after each render. In Audio mode: speaker buttons on [data-speak] and #main .card, and one auto-read per route. */
export function afterRender(root = document) {
  if (!audioMode() || typeof document === 'undefined') return;
  const main = mainEl();
  const hosts = new Set(root?.querySelectorAll ? root.querySelectorAll('[data-speak]') : []);
  if (main) for (const c of main.querySelectorAll('.card')) hosts.add(c);
  hosts.forEach(addSayButton);
  if (!main || readRoute === routeKey()) return;
  const key = (readRoute = routeKey());
  setTimeout(() => {
    if (readRoute !== key || !audioMode() || state.mode === 'listening' || state.mode === 'processing') return;
    readElement(mainEl(), { quiet: true });
  }, 350);
}

/** Call on navigation and language change: stops reading and listening, and re-arms the auto-read. */
export function onRouteChange() {
  stopTts();
  activeListen?.cancel();
  readRoute = null;
}

// A language change stops reading and listening (the next read uses the new language's voice).
onLangChange?.(() => { stopTts(); activeListen?.cancel(); });

let liveRegion = null;
/** Announce text to screen readers through one aria-live region. */
export function announce(text, { assertive = false } = {}) {
  if (!text || typeof document === 'undefined') return;
  if (!liveRegion?.isConnected) {
    liveRegion = document.getElementById('pn-live') || document.createElement('div');
    liveRegion.id = 'pn-live';
    liveRegion.className = 'sr-only';
    liveRegion.setAttribute('aria-atomic', 'true');
    if (!liveRegion.isConnected) document.body.append(liveRegion);
  }
  liveRegion.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
  liveRegion.textContent = '';
  setTimeout(() => { liveRegion.textContent = text; }, 60);
}

/** Speak a toast in Audio mode (no-op otherwise). Errors interrupt whatever is being read. */
export function speakToast(text, isError = false) {
  if (!audioMode() || !text || state.mode === 'listening' || state.mode === 'processing') return;
  if (!isError && state.mode === 'speaking') return;
  speak([{ text: String(text) }]).then((r) => report(r, true));
}

/** Say a language's own name in its own voice (for the language picker). */
export function speakLangName(code) {
  const c = appLangOrNull(code);
  if (!c) return Promise.resolve({ ok: false, reason: 'empty' });
  return speak([{ text: LANGS[c].name, lang: c }], { lang: c });
}

/** Choose (and test) the voice for the current language. Best available is picked automatically by default. */
export async function showVoicePicker(l) {
  if (typeof document === 'undefined') return;
  const code = appLang(l);
  const list = await voicesFor(code);
  if (!list.length) { showNoVoiceHelp(code); return; }
  const cur = preferredVoice(code) || '';
  document.querySelector('dialog.vp-dlg')?.close();
  const d = document.createElement('dialog');
  d.className = 'vp-dlg nv-dlg';
  d.setAttribute('data-no-read', '');
  const opt = (v, i) => `<label class="vp-row"><input type="radio" name="vp" value="${esc(v.voiceURI)}" ${cur === v.voiceURI ? 'checked' : ''}> <span data-en lang="en">${esc(v.name)}</span>${i === 0 ? ` <span class="badge good">${esc(t('speech.voicePick.best'))}</span>` : ''}${v.local ? '' : ` <span class="small muted">${esc(t('speech.voicePick.online'))}</span>`}</label>`;
  d.innerHTML = `<div class="dlg"><h2>${I.speaker}<span>${esc(t('speech.voicePick.title'))}</span></h2>
    <p class="small">${esc(t('speech.voicePick.hint', { lang: LANGS[code]?.name || code }))}</p>
    <label class="vp-row"><input type="radio" name="vp" value="" ${cur ? '' : 'checked'}> <span>${esc(t('speech.voicePick.auto'))}</span></label>
    ${list.map(opt).join('')}
    <div class="btn-row nv-actions"><button type="button" class="btn" data-vp-test>${esc(t('speech.voicePick.test'))}</button><button type="button" class="btn primary" data-vp-close>${esc(t('speech.nv.close'))}</button></div></div>`;
  const chosen = () => d.querySelector('input[name=vp]:checked')?.value || '';
  d.addEventListener('change', () => setPreferredVoice(code, chosen() || null));
  d.querySelector('[data-vp-test]').addEventListener('click', () => { setPreferredVoice(code, chosen() || null); speak([{ text: t('speech.voicePick.sample') }], { lang: code }); });
  d.querySelector('[data-vp-close]').addEventListener('click', () => { stop(); d.close(); });
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}

/** Translated help when a language has no voice on this phone. For Marathi it offers an explicit Hindi-voice opt-in. */
export async function showNoVoiceHelp(l) {
  if (typeof document === 'undefined') return;
  const code = appLang(l);
  const name = LANGS[code]?.name || code;
  const offerHindi = code === 'mr' && voiceFallback('mr') !== 'hi' && (await plan('hi', { noFallback: true })).engine !== 'none';
  document.querySelector('dialog.nv-dlg')?.close();
  const step = (k) => `<li>${esc(t(`speech.nv.${k}`, { lang: name }))}</li>`;
  const d = document.createElement('dialog');
  d.className = 'nv-dlg';
  d.setAttribute('aria-labelledby', 'nv-title');
  d.setAttribute('data-no-read', '');
  d.innerHTML = `<div class="dlg">
    <h2 id="nv-title">${I.speaker}<span>${esc(t('speech.nv.title', { lang: name }))}</span></h2>
    <p>${esc(t('speech.nv.intro'))}</p>
    <h3>${esc(t('speech.nv.android'))}</h3>
    <ol class="nv-steps">${['a1', 'a2', 'a3', 'a4', 'a5'].map(step).join('')}</ol>
    <h3>${esc(t('speech.nv.ios'))}</h3>
    <ol class="nv-steps">${['i1', 'i2'].map(step).join('')}</ol>
    ${offerHindi ? `<div class="note nv-hindi"><p>${esc(t('speech.nv.useHindiHint'))}</p><button type="button" class="btn primary" data-nv-hindi>${I.speaker}<span>${esc(t('speech.nv.useHindi'))}</span></button></div>` : ''}
    <div class="btn-row nv-actions">
      <button type="button" class="btn" data-nv-retry>${esc(t('speech.nv.retry'))}</button>
      <button type="button" class="btn ghost" data-nv-close>${esc(t('speech.nv.close'))}</button>
    </div>
  </div>`;
  const again = () => {
    d.close();
    const req = lastRequest;
    if (req) speak(req.items, req.opts).then((r) => report(r, false));
  };
  d.addEventListener('close', () => d.remove());
  d.querySelector('[data-nv-close]').addEventListener('click', () => d.close());
  d.querySelector('[data-nv-retry]').addEventListener('click', () => { voiceCache.clear(); helpShown.delete(code); again(); });
  d.querySelector('[data-nv-hindi]')?.addEventListener('click', () => { setVoiceFallback('mr', 'hi'); again(); });
  document.body.append(d);
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  announce(t('speech.nv.title', { lang: name }), { assertive: true });
}
