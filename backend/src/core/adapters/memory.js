// In-memory implementation of every port. Used by the browser demo mode and Node tests.
// It runs the SAME core logic (api, workflow, consumers) that the AWS Lambdas run.
import * as workflow from '../workflow.js';
import * as consumers from '../consumers.js';
import { randomString } from '../util.js';
import { POLLY_VOICES, ttsKey } from '../speech.js';

export class ConditionFailed extends Error {
  constructor() { super('Condition failed'); this.code = 'ConditionFailed'; this.status = 409; }
}

export function evalCond(item, cond) {
  if (!cond) return true;
  if (cond.notExists) return !item;
  if (cond.exists) return !!item;
  if (cond.or) return cond.or.some((c) => evalCond(item, c));
  if (cond.and) return cond.and.every((c) => evalCond(item, c));
  if (!item) return false;
  if (cond.missing) return cond.missing.every((k) => item[k] === undefined);
  if (cond.eq) return Object.entries(cond.eq).every(([k, v]) => item[k] === v);
  if (cond.ne) return Object.entries(cond.ne).every(([k, v]) => item[k] !== v);
  if (cond.lt) return Object.entries(cond.lt).every(([k, v]) => item[k] < v);
  if (cond.gt) return Object.entries(cond.gt).every(([k, v]) => item[k] > v);
  return true;
}

export function applyUpdate(item, ops) {
  const next = { ...(item || {}) };
  for (const [k, v] of Object.entries(ops.set || {})) next[k] = v;
  for (const [k, v] of Object.entries(ops.add || {})) next[k] = (next[k] || 0) + v;
  for (const [k, v] of Object.entries(ops.append || {})) next[k] = [...(next[k] || []), ...v];
  for (const k of ops.remove || []) delete next[k];
  return next;
}

export function createMemoryStore(state) {
  state.items ??= {};
  const key = (pk, sk) => `${pk}||${sk}`;
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  return {
    async get(pk, sk) { return clone(state.items[key(pk, sk)]); },
    async put(item, cond) {
      const cur = state.items[key(item.PK, item.SK)];
      if (!evalCond(cur, cond)) throw new ConditionFailed();
      state.items[key(item.PK, item.SK)] = clone(item);
    },
    async update(pk, sk, ops, cond) {
      const cur = state.items[key(pk, sk)];
      if (!evalCond(cur, cond)) throw new ConditionFailed();
      const next = applyUpdate(cur, ops);
      next.PK = pk; next.SK = sk;
      state.items[key(pk, sk)] = next;
      return clone(next);
    },
    async delete(pk, sk) { delete state.items[key(pk, sk)]; },
    async query({ pk, index, skPrefix = '', desc = false, limit }) {
      const pkA = index ? `${index}PK` : 'PK';
      const skA = index ? `${index}SK` : 'SK';
      let rows = Object.values(state.items).filter((it) => it[pkA] === pk && String(it[skA] ?? '').startsWith(skPrefix));
      rows.sort((a, b) => String(a[skA]).localeCompare(String(b[skA])));
      if (desc) rows.reverse();
      if (limit) rows = rows.slice(0, limit);
      return rows.map(clone);
    },
    async batchUpdate(list) {
      for (const u of list) await this.update(u.pk, u.sk, { set: u.set, add: u.add });
    },
  };
}

export function createMemoryContext({ state = {}, config = {}, onChange = () => {}, store: storeOverride = null } = {}) {
  state.executions ??= {};
  state.tokens ??= {};
  state.timers ??= {};
  state.files ??= {};
  state.outbox ??= [];
  const store = storeOverride || createMemoryStore(state);
  const cfg = {
    demoMode: true,
    reminderMinutes: 2,
    followupMinutes: 5,
    ownerTimeoutSeconds: 15 * 60,
    repairTimeoutSeconds: 3 * 24 * 3600,
    enableSms: false,
    ...config,
  };
  const ctx = { store, config: cfg, now: () => Date.now(), svc: {} };

  const runExec = async (exec) => {
    // Mirrors statemachine/repair-job.asl.json
    while (true) {
      if (exec.state === 'BuildOptions') {
        await workflow.handle(ctx, { task: 'buildOptions', jobId: exec.jobId });
        exec.state = 'WaitForOwnerDecision';
      } else if (exec.state === 'WaitForOwnerDecision') {
        if (!exec.token) {
          exec.token = randomString(16);
          state.tokens[exec.token] = exec.id;
          await workflow.handle(ctx, { task: 'notifyOwner', jobId: exec.jobId, taskToken: exec.token });
          state.timers[`sfn-timeout-${exec.token}`] = { at: ctx.now() + cfg.ownerTimeoutSeconds * 1000, payload: { type: 'sfn-timeout', token: exec.token } };
        }
        return;
      } else if (exec.state === 'ApplyDecision') {
        await workflow.handle(ctx, { task: 'applyDecision', jobId: exec.jobId, decision: exec.decision });
        exec.state = String(exec.decision?.option || '').startsWith('repair') ? 'WaitForRepair' : 'Done';
      } else if (exec.state === 'WaitForRepair') {
        if (!exec.token) {
          exec.token = randomString(16);
          state.tokens[exec.token] = exec.id;
          await workflow.handle(ctx, { task: 'registerRepair', jobId: exec.jobId, taskToken: exec.token });
          state.timers[`sfn-timeout-${exec.token}`] = { at: ctx.now() + cfg.repairTimeoutSeconds * 1000, payload: { type: 'sfn-timeout', token: exec.token } };
        }
        return;
      } else if (exec.state === 'CompleteRepair') {
        await workflow.handle(ctx, { task: 'completeRepair', jobId: exec.jobId, repair: exec.repair });
        exec.state = 'Done';
      } else {
        exec.status = 'SUCCEEDED';
        return;
      }
    }
  };

  ctx.svc.workflow = {
    async start(input) {
      const id = `exec-${randomString(8)}`;
      const exec = { id, jobId: input.jobId, state: 'BuildOptions', status: 'RUNNING' };
      state.executions[id] = exec;
      await runExec(exec);
      onChange();
      return id;
    },
    async sendSuccess(token, output) {
      const exec = state.executions[state.tokens[token]];
      if (!exec || exec.token !== token) {
        const e = new Error('Task token is no longer valid'); e.status = 410; throw e;
      }
      delete state.tokens[token];
      delete state.timers[`sfn-timeout-${token}`];
      exec.token = null;
      if (exec.state === 'WaitForOwnerDecision') { exec.decision = output; exec.state = 'ApplyDecision'; }
      else if (exec.state === 'WaitForRepair') { exec.repair = output; exec.state = 'CompleteRepair'; }
      await runExec(exec);
      onChange();
    },
  };

  ctx.svc.scheduler = {
    async at(name, whenMs, payload) { state.timers[name] = { at: whenMs, payload }; },
    async cancel(name) { delete state.timers[name]; },
  };

  ctx.svc.events = {
    async emit(type, detail) {
      // Mirrors the EventBridge rules in template.yaml
      await consumers.aggregate(ctx, { type, detail });
      if (type === 'part.listed') await consumers.partMatcher(ctx, detail);
      if (type === 'pickup.requested') await consumers.pickupDispatcher(ctx, detail);
    },
  };

  ctx.svc.notify = {
    async publish(subject, message) { state.outbox.unshift({ channel: 'sns-topic', subject, message, at: ctx.now() }); state.outbox.length = Math.min(state.outbox.length, 50); },
    async sms(phone, message) {
      state.outbox.unshift({ channel: 'sms', to: phone, message, at: ctx.now(), sent: !!cfg.enableSms });
      state.outbox.length = Math.min(state.outbox.length, 50);
    },
  };

  ctx.svc.files = {
    async presignPut(key) { return `mock-upload:${key}`; },
    async presignGet(key) { return key ? state.files[key] || null : null; },
    async putData(key, dataUrl) { state.files[key] = dataUrl; },
  };

  // No cloud speech in demo mode: the speech routes answer { unsupported: true } and the browser uses its own voices.
  ctx.svc.speech = {
    configured: false,
    voices: {},
    async synthesize() { return null; },
    async presignAudio() { return null; },
    async startTranscription() { return null; },
    async getTranscription() { return { status: 'FAILED', text: '' }; },
    async discard() {},
  };
  ctx.svc.metrics = { emit() {} };
  ctx.svc.ml = { async scoreRcf() { return null; }, configured: false };
  ctx.svc.async = {
    async invoke(fn, payload) {
      if (fn === 'seed') return consumers.seed(ctx, payload);
      if (fn === 'anomaly') return consumers.anomaly(ctx, payload);
      throw new Error(`Unknown function ${fn}`);
    },
  };

  // Due timers (scheduler, Step Functions waits). Retry-safe: a timer is removed only after it ran; a failure keeps it
  // with a back-off (30 s, 1, 2, 4 min), and after 5 attempts it moves to state.deadTimers for the admin/status view.
  let ticking = false;
  ctx.runDueTimers = async () => {
    if (ticking) return 0;
    ticking = true;
    let ran = 0;
    try {
      const due = Object.entries(state.timers).filter(([, t]) => t.at <= ctx.now());
      for (const [name, t] of due) {
        if (state.timers[name] !== t) continue;
        try {
          if (t.payload.type === 'sfn-timeout') {
            const exec = state.executions[state.tokens[t.payload.token]];
            if (exec) {
              delete state.tokens[t.payload.token];
              exec.token = null;
              const task = exec.state === 'WaitForOwnerDecision' ? 'closeNoDecision' : 'closeRepairTimeout';
              await workflow.handle(ctx, { task, jobId: exec.jobId });
              exec.state = 'Done';
              exec.status = 'SUCCEEDED';
            }
          } else {
            await consumers.scheduled(ctx, t.payload);
          }
          if (state.timers[name] === t) delete state.timers[name];
          ran++;
        } catch (e) {
          t.attempts = (t.attempts || 0) + 1;
          t.lastError = String(e?.message || e).slice(0, 300);
          if (t.attempts >= 5) {
            delete state.timers[name];
            state.deadTimers = [{ name, ...t, failedAt: ctx.now() }, ...(state.deadTimers || [])].slice(0, 20);
          } else {
            t.at = ctx.now() + 2 ** (t.attempts - 1) * 30000;
          }
          ctx.onBackgroundError?.({ name, error: t.lastError, attempts: t.attempts });
        }
      }
    } finally {
      ticking = false;
    }
    if (ran) onChange();
    return ran;
  };
  ctx.state = state;
  return ctx;
}


/**
 * A configured stand-in for svc.speech (tests only): same cache keys and cache-hit rule as the AWS adapter,
 * audio "stored" in state.files, and transcription jobs that finish after `polls` polls.
 */
export function createFakeSpeech(state, { polls = 2 } = {}) {
  state.files ??= {};
  const jobs = {};
  const calls = { synth: 0, started: [], discarded: [] };
  return {
    configured: true,
    voices: Object.fromEntries(Object.entries(POLLY_VOICES).map(([l, v]) => [l, v[0].voice])),
    calls,
    async synthesize({ text, lang }) {
      const v = POLLY_VOICES[lang]?.[0];
      if (!v) return null;
      const key = await ttsKey({ lang, voice: v.voice, engine: v.engine, text });
      if (state.files[key]) return { key, cached: true, voice: v.voice, engine: v.engine };
      calls.synth++;
      state.files[key] = 'data:audio/mpeg;base64,';
      return { key, cached: false, voice: v.voice, engine: v.engine };
    },
    async presignAudio(key) { return key?.startsWith('tts/') ? `mock-audio:${key}` : null; },
    async startTranscription({ key, languageCode, jobName, mediaFormat }) {
      calls.started.push({ key, languageCode, jobName, mediaFormat });
      jobs[jobName] = { key, languageCode, left: polls };
    },
    async getTranscription(jobName) {
      const j = jobs[jobName];
      if (!j || !state.files[j.key]) return { status: 'FAILED', text: '' };
      if (--j.left > 0) return { status: 'IN_PROGRESS', text: '' };
      delete jobs[jobName];
      return { status: 'COMPLETED', text: `heard in ${j.languageCode}` };
    },
    async discard(key) { delete state.files[key]; calls.discarded.push(key); },
  };
}
