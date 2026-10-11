// Cut-paper illustrations drawn for Punarnava in the deck's style: flat shapes, rough edges, grain.
// Palette: forest #123b2a, leaf #6fa45d, sage #dde8d5, cream #fcfaf4, kraft #b89a75, earth #594633, ochre #c8963e.
import { t } from './i18n.js';

const escAttr = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rough = (id) => `<defs><filter id="${id}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2"/></filter></defs>`;
const wrap = (id, body, label) => `<svg viewBox="0 0 120 120" role="img" aria-label="${escAttr(label)}" xmlns="http://www.w3.org/2000/svg">${rough(id)}<g filter="url(#${id})">${body}</g></svg>`;
const leaf = (x, y, s = 1, r = 0, c = '#6fa45d') => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0 0 C10 -14 26 -14 32 -4 C22 6 8 8 0 0Z" fill="${c}"/><path d="M2 -1 C12 -5 20 -6 28 -4" stroke="#123b2a" stroke-width="1" fill="none" opacity=".5"/></g>`;

// Each entry: [svg filter id, drawing, aria-label key in frontend/i18n/shell.js].
const ART = {
  identify: ['r1', `
    <circle cx="60" cy="62" r="50" fill="#dde8d5"/>
    <rect x="34" y="18" width="42" height="78" rx="7" fill="#123b2a"/>
    <rect x="38" y="25" width="34" height="58" rx="3" fill="#fcfaf4"/>
    <g fill="#123b2a"><rect x="42" y="30" width="10" height="10"/><rect x="58" y="30" width="10" height="10"/><rect x="42" y="46" width="10" height="10"/><rect x="58" y="48" width="4" height="4"/><rect x="64" y="52" width="4" height="4"/><rect x="58" y="56" width="4" height="4"/></g>
    <rect x="42" y="64" width="26" height="4" rx="2" fill="#b89a75"/><rect x="42" y="72" width="18" height="4" rx="2" fill="#b89a75"/>
    <circle cx="80" cy="72" r="15" fill="none" stroke="#c8963e" stroke-width="6"/><path d="M90 84 L104 100" stroke="#594633" stroke-width="8" stroke-linecap="round"/>
    ${leaf(14, 96, 0.9, -30)}`, 'shell.ill.identify'],
  diagnose: ['r2', `
    <circle cx="60" cy="62" r="50" fill="#dde8d5"/>
    <rect x="18" y="34" width="72" height="54" rx="5" fill="#2e6b3f"/>
    <g stroke="#c8963e" stroke-width="2" fill="none"><path d="M24 44 H44 V56 H60"/><path d="M24 76 H40 V66 H70"/><path d="M84 44 H72 V80"/></g>
    <rect x="44" y="48" width="20" height="16" rx="2" fill="#123b2a"/><rect x="66" y="70" width="12" height="10" rx="2" fill="#123b2a"/>
    <circle cx="30" cy="62" r="4" fill="#fcfaf4"/><circle cx="54" cy="80" r="3" fill="#fcfaf4"/>
    <path d="M70 28 L98 56" stroke="#b89a75" stroke-width="8" stroke-linecap="round"/><circle cx="100" cy="58" r="9" fill="none" stroke="#b89a75" stroke-width="6"/>
    <circle cx="66" cy="24" r="8" fill="none" stroke="#b89a75" stroke-width="6"/>
    ${leaf(86, 98, 1, -150)}`, 'shell.ill.diagnose'],
  reuse: ['r3', `
    <circle cx="60" cy="62" r="50" fill="#dde8d5"/>
    <path d="M30 36 A36 36 0 0 1 92 40" stroke="#6fa45d" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M86 28 L96 42 L80 44Z" fill="#6fa45d"/>
    <path d="M90 86 A36 36 0 0 1 28 82" stroke="#3d7a35" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M34 94 L24 80 L40 78Z" fill="#3d7a35"/>
    <rect x="44" y="40" width="30" height="48" rx="6" fill="#123b2a"/><rect x="48" y="46" width="22" height="32" rx="2" fill="#fcfaf4"/>
    <path d="M70 70 L88 62 L96 72 L80 84Z" fill="#c8963e"/><circle cx="88" cy="70" r="2.5" fill="#fcfaf4"/>
    <path d="M52 62 l5 5 9-11" stroke="#3d7a35" stroke-width="3" fill="none" stroke-linecap="round"/>`, 'shell.ill.reuse'],
  recover: ['r4', `
    <circle cx="60" cy="62" r="50" fill="#dde8d5"/>
    <path d="M18 76 H102 L94 100 H26Z" fill="#b89a75"/><path d="M18 76 H102" stroke="#594633" stroke-width="2"/>
    <rect x="30" y="50" width="22" height="18" rx="2" fill="#123b2a"/><g stroke="#c8963e" stroke-width="2"><path d="M34 50 V44M41 50 V44M48 50 V44M34 68 V74M41 68 V74M48 68 V74"/></g>
    <rect x="60" y="44" width="10" height="26" rx="4" fill="#2e6b3f"/><path d="M63 70 V78M67 70 V78" stroke="#594633" stroke-width="2"/>
    <circle cx="86" cy="60" r="11" fill="#fcfaf4" stroke="#123b2a" stroke-width="3"/><circle cx="86" cy="60" r="4" fill="#123b2a"/>
    ${leaf(40, 30, 1.1, -20)}${leaf(70, 26, 0.8, 200, '#3d7a35')}`, 'shell.ill.recover'],
  deliver: ['r5', `
    <circle cx="60" cy="62" r="50" fill="#dde8d5"/>
    <path d="M12 86 H108" stroke="#594633" stroke-width="3" stroke-dasharray="6 6"/>
    <rect x="16" y="46" width="52" height="34" rx="3" fill="#123b2a"/><path d="M68 56 H86 L98 68 V80 H68Z" fill="#2e6b3f"/><path d="M74 60 H85 L92 68 H74Z" fill="#dde8d5"/>
    <circle cx="32" cy="84" r="8" fill="#594633"/><circle cx="32" cy="84" r="3" fill="#fcfaf4"/><circle cx="84" cy="84" r="8" fill="#594633"/><circle cx="84" cy="84" r="3" fill="#fcfaf4"/>
    <g transform="translate(42 63)" fill="none" stroke="#6fa45d" stroke-width="3.2" stroke-linecap="round"><path d="M-8 4 L-2 -7 L4 2"/><path d="M8 -2 L4 9 L-8 8"/></g>
    ${leaf(76, 36, 0.9, -40)}`, 'shell.ill.deliver'],
  insights: ['r6', `
    <circle cx="60" cy="62" r="50" fill="#dde8d5"/>
    <rect x="22" y="22" width="76" height="74" rx="6" fill="#fcfaf4"/>
    <path d="M30 86 H90" stroke="#594633" stroke-width="2"/>
    <rect x="34" y="62" width="10" height="24" rx="2" fill="#b89a75"/><rect x="50" y="48" width="10" height="38" rx="2" fill="#123b2a"/><rect x="66" y="56" width="10" height="30" rx="2" fill="#6fa45d"/>
    <rect x="82" y="38" width="8" height="48" rx="2" fill="#a8432f"/>
    <path d="M32 50 L52 40 L68 46 L88 30" stroke="#c8963e" stroke-width="3" fill="none" stroke-linecap="round"/>
    ${leaf(84, 30, 0.8, -60)}`, 'shell.ill.insights'],
};

/** The illustrations as SVG strings; each read builds the aria-label in the current language. */
export const ILL = Object.defineProperties({}, Object.fromEntries(Object.entries(ART).map(([name, [id, body, key]]) => [
  name, { enumerable: true, get: () => wrap(id, body, t(key)) },
])));
