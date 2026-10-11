// Merges every namespace catalog into one flat key → [en, hi, mr, bn, ta] map.
// Server messages (core/messages.js) are merged in by js/i18n.js when that file is present.
import common from './common.js';
import shell from './shell.js';
import speech from './speech.js';
import landing from './landing.js';
import account from './account.js';
import tech from './tech.js';
import owner from './owner.js';
import passport from './passport.js';
import parts from './parts.js';
import stock from './stock.js';
import collector from './collector.js';
import recycler from './recycler.js';
import brand from './brand.js';
import market from './market.js';
import admin from './admin.js';
import journey from './journey.js';
import request from './request.js';
import green from './green.js';
import search from './search.js';
import assist from './assist.js';
import stack from './stack.js';
import my from './my.js';

export const NAMESPACES = { common, shell, speech, landing, account, tech, owner, passport, parts, stock, collector, recycler, brand, market, admin, journey, request, green, search, assist, stack, my };

const merged = {};
for (const [ns, dict] of Object.entries(NAMESPACES)) {
  for (const [key, value] of Object.entries(dict || {})) {
    if (key in merged) console.warn(`[i18n] duplicate key "${key}" in ${ns}.js`);
    merged[key] = value;
  }
}
export default merged;
