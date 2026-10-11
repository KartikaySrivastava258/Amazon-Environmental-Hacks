// Voice typing and read-aloud against fake browser environments. Loads the real frontend/js/speech.js
// (a fresh copy per scenario, since it detects the browser's APIs when it loads). No browser needed.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; }
};
const SPEECH = new URL('../../frontend/js/speech.js', import.meta.url);
if (!existsSync(new URL('../../frontend/core/messages.js', import.meta.url))) {
  console.error('Run ./scripts/sync-core.sh first (frontend/core is a copy of backend/src/core).');
  process.exit(1);
}

class Utterance { constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; } }
globalThis.SpeechSynthesisUtterance = Utterance;

/** A speechSynthesis stand-in. voices: [{ lang, name }]; late: voices appear only after voiceschanged. */
function fakeSynth(voices, { late = false } = {}) {
  const s = {
    list: late ? [] : voices, spoken: [], cancels: 0, resumes: 0, speaking: false, pending: false, paused: false, on: {},
    getVoices() { return this.list; },
    addEventListener(n, f) { (this.on[n] ||= []).push(f); },
    speak(u) {
      this.spoken.push(u);
      this.speaking = true;
      setTimeout(() => { if (u.dead) return; u.onstart?.(); setTimeout(() => { if (u.dead) return; this.speaking = false; u.onend?.(); }, 15); }, 3);
    },
    cancel() { this.cancels++; for (const u of this.spoken) if (!u.ended) u.dead = true; this.speaking = false; },
    pause() { this.paused = true; },
    resume() { this.paused = false; this.resumes++; },
  };
  if (late) setTimeout(() => { s.list = voices; (s.on.voiceschanged || []).forEach((f) => f()); }, 40);
  return s;
}
/** A SpeechRecognition stand-in that answers with text or fails with an error code. */
function fakeSR(behave) {
  return class {
    start() {
      behave.starts = (behave.starts || 0) + 1;
      setTimeout(() => {
        if (behave.error) { this.onerror?.({ error: behave.error }); this.onend?.(); return; }
        const res = Object.assign(behave.alts.map((transcript) => ({ transcript })), { isFinal: true });
        this.onresult?.({ results: [res] });
        this.onend?.();
      }, 5);
    }
    stop() {}
    abort() { this.onend?.(); }
  };
}

let n = 0;
/** Install a fake window and load a fresh speech.js. */
async function env({ synth = null, SR = null, secure = true, permission = null, config = {} } = {}) {
  globalThis.window = {
    PUNARNAVA_CONFIG: config, isSecureContext: secure, speechSynthesis: synth, SpeechRecognition: SR,
    navigator: { userAgent: 'node', languages: ['en-IN'], permissions: permission ? { query: async () => ({ state: permission }) } : undefined, mediaDevices: undefined },
    location: { hash: '', pathname: '/', search: '' },
    localStorage: (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })(),
    matchMedia: () => ({ matches: true }),
  };
  return import(`${SPEECH.href}?env=${++n}`);
}

console.log('Voice: read-aloud and voice typing degrade gracefully');

await test('no speech APIs at all: nothing claims to work, and the reasons are explained', async () => {
  const s = await env();
  assert.equal(s.canSpeak(), false);
  assert.equal(s.canListen(), false);
  assert.deepEqual(s.voiceTypingStatus('hi'), { ok: false, key: 'speech.err.unsupported', engine: null });
  assert.ok(s.voiceTypingNote('hi').includes('voice-unavailable'));
  const caps = await s.capabilities('hi');
  assert.equal(caps.tts, 'none');
  assert.equal(caps.stt, 'none');
  const r = await s.speak(['नमस्ते'], { lang: 'hi' });
  assert.deepEqual([r.ok, r.reason], [false, 'no-voice']);
  const l = await s.listen({ lang: 'hi' }).done;
  assert.equal(l.error, 'speech.err.unsupported');
  assert.equal(l.text, '');
});

await test('voices that load late are waited for, and the language is matched to the right voice', async () => {
  const synth = fakeSynth([{ lang: 'en-IN', name: 'English India' }, { lang: 'hi-IN', name: 'Hindi' }, { lang: 'bn_IN', name: 'Bangla' }], { late: true });
  const s = await env({ synth });
  const r = await s.speak([{ text: 'आपका सामान ठीक हो गया।' }], { lang: 'hi' });
  assert.equal(r.ok, true);
  assert.equal(r.engine, 'browser');
  assert.equal(synth.spoken.at(-1).voice.name, 'Hindi');
  assert.equal(synth.spoken.at(-1).lang, 'hi-IN');
  assert.equal((await s.speak(['নমস্কার'], { lang: 'bn' })).ok, true, 'bn_IN is normalised to bn-IN');
  assert.equal(synth.spoken.at(-1).voice.name, 'Bangla');
  synth.paused = true; // a backgrounded tab
  assert.equal((await s.speak(['Hello'], { lang: 'en' })).ok, true);
  assert.ok(synth.resumes >= 1, 'a paused engine is resumed before speaking');
});

await test('a language with no voice is never read in another voice unless the person opts in', async () => {
  const synth = fakeSynth([{ lang: 'en-IN', name: 'English India' }, { lang: 'hi-IN', name: 'Hindi' }]);
  const s = await env({ synth });
  for (const l of ['ta', 'mr', 'bn']) {
    const before = synth.spoken.length;
    const r = await s.speak(['வணக்கம்'], { lang: l });
    assert.deepEqual([r.ok, r.reason, r.lang], [false, 'no-voice', l]);
    assert.equal(synth.spoken.length, before, `${l}: nothing was spoken in a wrong voice`);
  }
  s.setVoiceFallback('mr', 'hi'); // the explicit "use the Hindi voice" choice from the help dialog
  const r = await s.speak(['नमस्कार'], { lang: 'mr' });
  assert.equal(r.ok, true);
  assert.equal(synth.spoken.at(-1).voice.name, 'Hindi');
});

await test('stop and repeated clicks cancel cleanly; long text is chunked; nothing stale stays queued', async () => {
  const synth = fakeSynth([{ lang: 'en-IN', name: 'English India' }]);
  const s = await env({ synth });
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} explains one more detail about the repair.`).join(' ');
  assert.ok(s.chunkText(long).every((c) => c.length <= 180));
  assert.ok(s.chunkText('x'.repeat(1000)).every((c) => c.length <= 180), 'even without spaces');
  const first = s.speak([long], { lang: 'en' });
  await new Promise((r) => setTimeout(r, 220));
  assert.equal(s.getState().mode, 'speaking');
  s.stop();
  assert.equal((await first).reason, 'stopped');
  assert.equal(s.getState().mode, 'idle', 'no stuck indicator');
  const spokenAfterStop = synth.spoken.length;
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(synth.spoken.length, spokenAfterStop, 'no more chunks after stop');
  assert.ok(spokenAfterStop < s.chunkText(long).length);
  // Two quick taps: the first reading is replaced, the second finishes.
  const a = s.speak(['First text.'], { lang: 'en' });
  const b = s.speak(['Second text.'], { lang: 'en' });
  assert.equal((await a).reason, 'stopped');
  assert.equal((await b).ok, true);
  assert.equal(synth.spoken.at(-1).text, 'Second text.');
});

await test('voice typing: result, no speech, permission denied, insecure page, unsupported language', async () => {
  const ok = { alts: ['drum does not spin'] };
  let s = await env({ SR: fakeSR(ok) });
  assert.equal(s.canListen(), true);
  assert.deepEqual(s.voiceTypingStatus('hi'), { ok: true, key: null, engine: 'browser' });
  let r = await s.listen({ lang: 'hi' }).done;
  assert.equal(r.text, 'drum does not spin');
  assert.equal(r.error, undefined);
  assert.equal(s.getState().mode, 'idle');

  s = await env({ SR: fakeSR({ error: 'no-speech' }) });
  assert.equal((await s.listen({}).done).error, 'speech.err.noSpeech');

  const denied = { error: 'not-allowed' };
  s = await env({ SR: fakeSR(denied) });
  assert.equal((await s.listen({}).done).error, 'speech.err.micBlocked');

  const neverStarted = { alts: ['x'] };
  s = await env({ SR: fakeSR(neverStarted), permission: 'denied' });
  assert.equal((await s.listen({}).done).error, 'speech.err.micBlocked');
  assert.equal(neverStarted.starts, undefined, 'a known-denied microphone is not started');

  s = await env({ SR: fakeSR(ok), secure: false });
  assert.equal(s.canListen(), false, 'no mic buttons on an http:// page');
  assert.equal(s.voiceTypingStatus('en').key, 'speech.err.insecure');
  assert.equal((await s.listen({}).done).error, 'speech.err.insecure');

  s = await env({ SR: fakeSR({ error: 'language-not-supported' }) });
  assert.equal((await s.listen({ lang: 'ta' }).done).error, 'speech.err.langListen');
  assert.equal(s.voiceTypingStatus('ta').key, 'speech.err.langListen', 'remembered for that language');
  assert.equal(s.voiceTypingStatus('hi').ok, true, 'other languages unaffected');

  s = await env({ SR: fakeSR({ alts: ['नौ आठ सात'] }) });
  r = await s.listen({ mode: 'digits' }).done;
  assert.equal(r.text, '987');
});

await test('a second listen cancels the first, so only one microphone is ever live', async () => {
  const s = await env({ SR: fakeSR({ alts: ['hello'] }) });
  const a = s.listen({});
  const b = s.listen({});
  assert.equal((await a.done).cancelled, true);
  assert.equal((await b.done).text, 'hello');
  assert.equal(s.getState().mode, 'idle');
});

await test('clearest voice first, the person\'s choice remembered, and text cleaned for speech', async () => {
  const synth = fakeSynth([
    { lang: 'hi-IN', name: 'eSpeak Hindi', localService: true, voiceURI: 'espeak-hi' },
    { lang: 'hi-IN', name: 'Microsoft Swara Online (Natural) - Hindi (India)', localService: false, voiceURI: 'ms-swara' },
    { lang: 'hi-IN', name: 'Google हिन्दी', localService: false, voiceURI: 'google-hi' },
    { lang: 'en-IN', name: 'English India', voiceURI: 'en' },
  ]);
  const s = await env({ synth });
  const list = await s.voicesFor('hi');
  assert.deepEqual(list.map((v) => v.voiceURI), ['ms-swara', 'google-hi', 'espeak-hi'], 'natural voices first, robotic last');
  await s.speak(['नमस्ते'], { lang: 'hi' });
  assert.equal(synth.spoken.at(-1).voice.voiceURI, 'ms-swara');
  s.setPreferredVoice('hi', 'google-hi');
  await s.speak(['नमस्ते'], { lang: 'hi' });
  assert.equal(synth.spoken.at(-1).voice.voiceURI, 'google-hi', 'the chosen voice is used');
  s.setPreferredVoice('hi', null);
  await s.speak(['नमस्ते'], { lang: 'hi' });
  assert.equal(synth.spoken.at(-1).voice.voiceURI, 'ms-swara', 'back to automatic');
  assert.equal(s.speakable('Pay ₹3,600 → repair'), 'Pay 3,600 rupees, repair');
  assert.equal(s.speakable('Fair price: ₹3,250–₹4,350'), 'Fair price: 3,250 – 4,350 rupees');
  assert.equal(s.speakable('WM-7 · Brand X'), 'WM-7, Brand X');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
