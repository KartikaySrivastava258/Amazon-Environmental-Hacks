// Voice: compatibility layer over speech.js (old names keep working) plus the voice-note recorder.
// New code should import from speech.js directly.
import { t } from './i18n.js';
import { toast, esc, icon } from './ui.js';
import { canSpeak, canListen, canRecord, stop, speak, listen, enhanceVoiceInputs, uploadBlob, recordMime, showNoVoiceHelp, MIC } from './speech.js';

export { canSpeak, canListen, canRecord, enhanceVoiceInputs };
export const stopSpeaking = () => stop();

/** Speak items in order. Resolves true once reading starts (false if it cannot). onItem(item, i) fires per item. */
export function speakSequence(items, { onItem, onDone } = {}) {
  return new Promise((resolve) => {
    let started = false;
    speak(items, { onItem, onDone, onStart: () => { started = true; resolve(true); } }).then((r) => {
      if (r.ok || r.reason === 'stopped') { if (!started) resolve(false); return; }
      if (started) { onDone?.(); return; } // started, then failed: let the caller reset its button
      if (r.reason === 'no-voice') showNoVoiceHelp(r.lang);
      else toast(t('speech.err.speak'), true);
      resolve(false);
    });
  });
}

/** Old one-shot recognizer API. Returns a stop function. */
export function listenOnce({ onInterim, onResult, onEnd } = {}) {
  const h = listen({ onInterim });
  h.done.then((r) => {
    if (r.text) onResult?.(r.text, r.alternatives);
    else if (r.error && r.error !== 'speech.err.noSpeech' && !r.cancelled) toast(t(r.error), true);
    onEnd?.();
  });
  return () => h.stop();
}

/** One-shot recognition returning all alternatives (or null), for "say the part". */
export function hear(opts = {}) {
  if (!canListen()) { toast(t('speech.err.unsupported'), true); return Promise.resolve(null); }
  return listen(opts).done.then((r) => {
    if (r.error && r.error !== 'speech.err.noSpeech' && !r.cancelled) toast(t(r.error), true);
    return r.alternatives.length ? r.alternatives : null;
  });
}

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Voice-note recorder with live waveform. Calls onSaved(key) after upload. owner: { jobId, token } for owner links. */
export function mountRecorder(el, { max = 60, onSaved, owner } = {}) {
  if (!el) return;
  if (!canRecord()) { el.innerHTML = `<p class="small muted">${esc(t('speech.rec.unsupported'))}</p>`; return; }
  el.innerHTML = `
    <div class="recorder">
      <button type="button" class="rec-btn" data-rec aria-pressed="false" aria-label="${esc(t('speech.record'))}" title="${esc(t('speech.record'))}">${MIC}</button>
      <canvas class="wave" width="320" height="56" aria-hidden="true"></canvas>
      <span class="rec-time" data-time>0:00 / ${clock(max)}</span>
    </div>
    <div class="rec-out" data-out aria-live="polite"></div>`;
  const btn = el.querySelector('[data-rec]');
  const canvas = el.querySelector('canvas');
  const time = el.querySelector('[data-time]');
  const out = el.querySelector('[data-out]');
  const g = canvas.getContext('2d');
  let rec = null;
  let raf = 0;
  let timer = 0;
  const mime = recordMime();
  const live = (on) => {
    const s = t(on ? 'speech.rec.stop' : 'speech.record');
    btn.classList.toggle('live', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', s);
    btn.title = s;
  };
  const draw = (analyser) => {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteFrequencyData(data);
      g.clearRect(0, 0, canvas.width, canvas.height);
      const bars = 40;
      const w = canvas.width / bars;
      g.fillStyle = getComputedStyle(el).getPropertyValue('--stamp').trim() || '#c21f3a';
      for (let i = 0; i < bars; i++) {
        const v = data[Math.floor((i / bars) * data.length * 0.6)] / 255;
        const h = Math.max(3, v * canvas.height);
        g.fillRect(i * w + 1, (canvas.height - h) / 2, w - 3, h);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
  };
  btn.addEventListener('click', async () => {
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    stop();
    let stream = null;
    let ac = null;
    const stopAll = () => { cancelAnimationFrame(raf); clearInterval(timer); stream?.getTracks().forEach((tr) => tr.stop()); ac?.close?.().catch?.(() => {}); };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast(t(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'speech.rec.micBlocked' : 'speech.rec.cantStart'), true);
      return;
    }
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = ac.createAnalyser();
        analyser.fftSize = 256;
        ac.createMediaStreamSource(stream).connect(analyser);
        draw(analyser);
      } catch { /* the waveform is decoration; recording still works */ }
      const started = Date.now();
      timer = setInterval(() => {
        const s = Math.floor((Date.now() - started) / 1000);
        time.textContent = `${clock(Math.min(s, max))} / ${clock(max)}`;
        if (s >= max && rec.state === 'recording') rec.stop();
      }, 250);
      live(true);
      rec.onstop = async () => {
        stopAll();
        live(false);
        const type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        out.innerHTML = `<audio controls src="${URL.createObjectURL(blob)}"></audio> <span class="small muted"><span class="spinner" aria-hidden="true"></span> ${esc(t('speech.rec.saving'))}</span>`;
        try {
          const key = await uploadBlob(blob, type, { owner });
          el.dataset.key = key;
          out.querySelector('.small').innerHTML = `${icon('shieldcheck')} ${esc(t('speech.rec.saved'))}`;
          onSaved?.(key);
        } catch {
          out.querySelector('.small').textContent = t('speech.rec.failed');
          toast(t('speech.rec.failed'), true);
        }
      };
      rec.start();
    } catch {
      stopAll();
      live(false);
      toast(t('speech.rec.cantStart'), true);
    }
  });
}
