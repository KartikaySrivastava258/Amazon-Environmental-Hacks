// Durable local state: a JSON file written atomically (temp file + rename), debounced, flushed on exit.
// It holds the workflow engine's state (executions, timers, outboxes) and, with PN_STORE=file, every record.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function createStateFile(dir, name = 'state.json') {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  let timer = null;
  let state = {};
  if (existsSync(file)) {
    try { state = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) {
      const bad = `${file}.corrupt-${Date.now()}`;
      renameSync(file, bad);
      console.error(`State file was unreadable; moved to ${bad} and starting fresh.`);
      state = {};
    }
  }
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    writeFileSync(`${file}.tmp`, JSON.stringify(state));
    renameSync(`${file}.tmp`, file);
  };
  return {
    file,
    get state() { return state; },
    save() { if (!timer) timer = setTimeout(flush, 150); },
    flush,
    replace(next) { for (const k of Object.keys(state)) delete state[k]; Object.assign(state, next); flush(); },
  };
}
