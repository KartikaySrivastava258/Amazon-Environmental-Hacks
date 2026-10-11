// Cloud read-aloud (Amazon Polly) and cloud voice typing (Amazon Transcribe batch): routes and pure helpers.
// The browser tries its own voices and SpeechRecognition first (frontend/js/speech.js); these routes are the fallback.
// Same code runs in the API Lambda and the browser demo. In demo mode ctx.svc.speech.configured is false, so the
// routes answer { unsupported: true } and nothing is stored. Port (adapters/aws.js svc.speech):
//   { configured, voices, synthesize({ text, lang }) → { key, cached, voice, engine } | null,
//     presignAudio(key) → url, startTranscription({ key, lang, languageCode, jobName, mediaFormat }),
//     getTranscription(jobName) → { status: 'QUEUED'|'IN_PROGRESS'|'COMPLETED'|'FAILED', text }, discard(key) }
import { apiError, randomString, sha256, iso } from './util.js';

export const SPEECH_LANGS = ['en', 'hi', 'mr', 'bn', 'ta'];

// Amazon Polly has Indian voices only for en-IN and hi-IN (no Marathi, Bengali or Tamil voice).
// Generative Kajal is not offered in ap-south-1, so neural first, then standard.
export const POLLY_VOICES = {
  en: [{ voice: 'Kajal', engine: 'neural', code: 'en-IN' }, { voice: 'Raveena', engine: 'standard', code: 'en-IN' }],
  hi: [{ voice: 'Kajal', engine: 'neural', code: 'hi-IN' }, { voice: 'Aditi', engine: 'standard', code: 'hi-IN' }],
};
// Amazon Transcribe batch supports all five in ap-south-1.
export const TRANSCRIBE_CODES = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', bn: 'bn-IN', ta: 'ta-IN' };

// Recorder content types accepted for a voice-typing clip, and the file extension stored.
export const AUDIO_TYPES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac' };
// File extension → Transcribe MediaFormat (an m4a file is an mp4 container).
const MEDIA_FORMATS = { webm: 'webm', ogg: 'ogg', m4a: 'mp4', mp4: 'mp4', mp3: 'mp3', wav: 'wav', flac: 'flac' };

// Throwaway clips live under uploads/tmp/ (template.yaml expires them after 1 day; they are also deleted once read).
export const CLIP_PREFIX = 'uploads/tmp/';

/** Limits; ctx.config.speech may override any of them (tests use this). Rates are requests per minute. */
export const LIMITS = {
  publicChars: 300, // POST /public/tts (anyone)
  authChars: 1500, // POST /api/tts (signed in); Polly allows 3000 billed characters per request
  ttsPerIp: 20,
  ttsPerUser: 60,
  clipsPerIp: 6, // owner-link uploads and transcriptions
  clipsPerUser: 20,
  pollsPerMinute: 90, // the browser polls every 2 s
};
const limits = (ctx) => ({ ...LIMITS, ...(ctx.config?.speech || {}) });

/** 'hi', 'hi-IN', 'HI_in' → 'hi'. Anything else → 400 badLang. */
export function parseLang(raw) {
  const m = /^(en|hi|mr|bn|ta)(?:[-_]in)?$/i.exec(String(raw ?? '').trim());
  if (!m) throw apiError(400, 'badLang');
  return m[1].toLowerCase();
}

/**
 * Text to read: control, bidi and zero-width characters removed (ZWJ/ZWNJ are kept, Indic scripts need them),
 * whitespace collapsed, at most `max` characters. Polly gets it as TextType 'text', so markup is never SSML.
 */
export function cleanText(raw, max) {
  if (typeof raw !== 'string') throw apiError(400, 'speechEmpty');
  const text = raw.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[​‎‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) throw apiError(400, 'speechEmpty');
  if ([...text].length > max) throw apiError(400, 'speechTooLong', { max });
  return text;
}

/** Cache key for one synthesized clip: tts/<lang>/<voice>/<engine>/<sha256(text)>.mp3 */
export async function ttsKey({ lang, voice, engine, text }) {
  return `tts/${lang}/${voice}/${engine}/${await sha256(text)}.mp3`;
}

/** Transcribe MediaFormat for a stored clip, from its extension; null when unsupported. */
export function mediaFormatOf(key) {
  const ext = String(key || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (ext && MEDIA_FORMATS[ext]) || null;
}

/** A clip key the caller may transcribe: under one of `prefixes`, plain characters, a known audio extension. */
export function clipKeyOk(key, prefixes) {
  return typeof key === 'string' && key.length <= 300 && !key.includes('..') && /^uploads\/[\w\-./]+$/.test(key)
    && prefixes.some((p) => key.startsWith(p)) && !!mediaFormatOf(key);
}

const JOB_NAME = /^pn-[A-Z0-9]{8,40}$/;

/**
 * Fixed-window counter per minute in the main table: PK RATE#<sha256(who)>, SK <name>#<minute>, atomic ADD, ttl.
 * `who` is 'ip:<address>' or 'user:<id>'; only the hash is stored. Throws 429 tooMany over the limit.
 */
export async function rateLimit(ctx, who, name, limit) {
  const now = ctx.now();
  const minute = Math.floor(now / 60000);
  const row = await ctx.store.update(`RATE#${await sha256(`punarnava-rate|${who}`)}`, `${name}#${minute}`, {
    add: { n: 1 },
    set: { type: 'rate', ttl: Math.floor(now / 1000) + 180 },
  });
  if ((row?.n || 0) > limit) {
    ctx.svc.metrics?.emit?.('speechRateLimited', 1);
    throw apiError(429, 'tooMany');
  }
}

const speechOn = (ctx) => !!ctx.svc.speech?.configured;
const OFF = { unsupported: true, reason: 'cloudSpeechOff' };

// Order in every handler: validate input, answer "off" when there is no cloud speech (demo mode stores nothing),
// then count the request against the rate limit, then call AWS.
async function tts(ctx, body, { max, who, limit, name }) {
  const lang = parseLang(body.lang);
  const text = cleanText(body.text, max);
  if (!speechOn(ctx)) return OFF;
  if (!POLLY_VOICES[lang]) return { unsupported: true, reason: 'noCloudVoice' };
  await rateLimit(ctx, who, name, limit);
  const r = await ctx.svc.speech.synthesize({ text, lang });
  if (!r?.key) return { unsupported: true, reason: 'noCloudVoice' };
  ctx.svc.metrics?.emit?.(r.cached ? 'ttsCacheHit' : 'ttsChars', r.cached ? 1 : [...text].length);
  return { url: await ctx.svc.speech.presignAudio(r.key), cached: !!r.cached, voice: r.voice, engine: r.engine };
}

// Presigned PUT for one voice-typing clip under `prefix` (audio only).
async function presignClip(ctx, body, prefix, gate) {
  const type = String(body.contentType || '').split(';')[0].trim().toLowerCase();
  const ext = AUDIO_TYPES[type];
  if (!ext) throw apiError(400, 'audioType');
  if (!speechOn(ctx)) throw apiError(400, 'cloudSpeechOff');
  await gate();
  const key = `${prefix}/${iso(ctx.now()).slice(0, 10)}/${randomString(10)}.${ext}`;
  return { key, url: await ctx.svc.files.presignPut(key, type), contentType: type };
}

async function startStt(ctx, body, { owner, prefixes, gate }) {
  const lang = parseLang(body.lang);
  if (!clipKeyOk(body.key, prefixes)) {
    // A key with a non-audio extension gets audioType; a missing key or someone else's key gets sttKey.
    const badType = typeof body.key === 'string' && !mediaFormatOf(body.key);
    throw apiError(400, badType ? 'audioType' : 'sttKey');
  }
  if (!speechOn(ctx)) return OFF;
  await gate();
  const jobName = `pn-${randomString(20)}`;
  await ctx.svc.speech.startTranscription({ key: body.key, lang, languageCode: TRANSCRIBE_CODES[lang], jobName, mediaFormat: mediaFormatOf(body.key) });
  const now = ctx.now();
  // Who may read the result. No transcript text is stored.
  await ctx.store.put({ PK: `STT#${jobName}`, SK: 'META', type: 'stt', owner, key: body.key, lang, status: 'started', at: iso(now), ttl: Math.floor(now / 1000) + 3600 });
  ctx.svc.metrics?.emit?.('sttStarted', 1);
  return { jobName };
}

async function pollStt(ctx, jobName, owner, gate) {
  if (!JOB_NAME.test(String(jobName || ''))) throw apiError(404, 'sttJob');
  if (!speechOn(ctx)) return OFF;
  await gate();
  const rec = await ctx.store.get(`STT#${jobName}`, 'META');
  if (!rec || rec.owner !== owner) throw apiError(404, 'sttJob');
  // Finished jobs are deleted from Transcribe after the first read, so a late repeat poll gets no text.
  if (rec.status === 'done') return { status: 'COMPLETED', text: '', gone: true };
  const r = await ctx.svc.speech.getTranscription(jobName);
  const status = String(r?.status || 'IN_PROGRESS').toUpperCase();
  if (status === 'COMPLETED' || status === 'FAILED') {
    await ctx.store.update(`STT#${jobName}`, 'META', { set: { status: 'done' } });
    if (rec.key.startsWith(CLIP_PREFIX) && ctx.svc.speech.discard) {
      try { await ctx.svc.speech.discard(rec.key); } catch (e) { console.warn('speech: could not delete clip', e?.name || e); }
    }
    if (status === 'FAILED') ctx.svc.metrics?.emit?.('sttFailed', 1);
  }
  return { status, text: status === 'COMPLETED' ? String(r?.text || '') : '' };
}

/**
 * Route table for core/api.js: [method, pattern, access, fn]. ownerJob(ctx, jobId, token) is api.js's owner-link check.
 * Paths match frontend/js/speech.js exactly.
 */
export function speechRoutes({ ownerJob }) {
  const ipOf = (ip) => `ip:${ip || 'unknown'}`;
  const ownerToken = ({ body, query }) => body?.t ?? query?.t;
  return [
    ['POST', '/public/tts', 'public', async (ctx, { body, ip }) => {
      const l = limits(ctx);
      return tts(ctx, body, { max: l.publicChars, who: ipOf(ip), limit: l.ttsPerIp, name: 'tts' });
    }],
    ['POST', '/api/tts', 'any', async (ctx, { body }, me) => {
      const l = limits(ctx);
      return tts(ctx, body, { max: l.authChars, who: `user:${me.userId}`, limit: l.ttsPerUser, name: 'tts' });
    }],

    // Signed in: the clip may come from POST /api/uploads (uploads/<userId>/…) or POST /api/stt/uploads (expires in a day).
    ['POST', '/api/stt/uploads', 'any', async (ctx, { body }, me) => presignClip(ctx, body, `${CLIP_PREFIX}u/${me.userId}`,
      () => rateLimit(ctx, `user:${me.userId}`, 'clip', limits(ctx).clipsPerUser))],
    ['POST', '/api/stt', 'any', async (ctx, { body }, me) => startStt(ctx, body, {
      owner: `u:${me.userId}`,
      prefixes: [`uploads/${me.userId}/`, `${CLIP_PREFIX}u/${me.userId}/`],
      gate: () => rateLimit(ctx, `user:${me.userId}`, 'stt', limits(ctx).clipsPerUser),
    })],
    ['GET', '/api/stt/:jobName', 'any', async (ctx, { params }, me) => pollStt(ctx, params.jobName, `u:${me.userId}`,
      () => rateLimit(ctx, `user:${me.userId}`, 'poll', limits(ctx).pollsPerMinute))],

    // Owner link: gated by the owner token like every other owner route, plus a per-IP limit.
    ['POST', '/public/owner/:jobId/uploads', 'public', async (ctx, input) => {
      const job = await ownerJob(ctx, input.params.jobId, ownerToken(input));
      return presignClip(ctx, input.body, `${CLIP_PREFIX}o/${job.jobId}`, () => rateLimit(ctx, ipOf(input.ip), 'clip', limits(ctx).clipsPerIp));
    }],
    ['POST', '/public/owner/:jobId/stt', 'public', async (ctx, input) => {
      const job = await ownerJob(ctx, input.params.jobId, ownerToken(input));
      return startStt(ctx, input.body, {
        owner: `o:${job.jobId}`,
        prefixes: [`${CLIP_PREFIX}o/${job.jobId}/`],
        gate: () => rateLimit(ctx, ipOf(input.ip), 'stt', limits(ctx).clipsPerIp),
      });
    }],
    ['GET', '/public/owner/:jobId/stt/:jobName', 'public', async (ctx, input) => {
      const job = await ownerJob(ctx, input.params.jobId, ownerToken(input));
      return pollStt(ctx, input.params.jobName, `o:${job.jobId}`, () => rateLimit(ctx, ipOf(input.ip), 'poll', limits(ctx).pollsPerMinute));
    }],
  ];
}
