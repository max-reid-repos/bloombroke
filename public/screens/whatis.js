// WHATIS: market words in plain English. Definitions only: what a word means, never
// advice. The words are ../whatis-terms.js, loaded with this screen (never at startup).
//  - WHATIS <term>: a card page (kit.js cardPage): WHATIS, the term, its definition (the
//    words it uses that have their own card are links), the example dim, SEE ALSO.
//  - WHATIS alone: one numbered panel, every term A to Z in columns; a number and Enter
//    opens that term.
//  - A word with no definition: the 3 closest terms (keys 1 to 3; common ones when
//    nothing is close) and TELL US (FEEDBACK, prefilled with the word).

import { esc, q, panel } from './markets.js';
import { cardPage, cardButton, cardLink, raw } from '../kit.js';
import { setPrefill } from './feedback.js';
import { TERMS, findTerm, suggestTerms, plainText, LINK_RE } from '../whatis-terms.js';

export const RULE = 'Definitions only, not advice.';
export const STATUS = 'WHATIS: DEFINITIONS ONLY, NOT ADVICE';
export const FEEDBACK_PREFILL = (word) => `Please add to WHATIS: ${word}`;

// The command that opens a term.
export const termCmd = (t) => `WHATIS ${t.term}`;
const cmdLink = (cmd, label, cls, attrs = '') => `<a class="${cls}" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}"${attrs ? ` ${attrs}` : ''}>${esc(label)}</a>`;

// A-Z, digits first and in number order (2s10s before 10-K).
export const sortedTerms = () => [...TERMS].sort((a, b) => a.term.localeCompare(b.term, 'en', { numeric: true, sensitivity: 'base' }));

// The definition, escaped, its [links] made WHATIS links.
export function definitionHtml(text) {
  let out = '';
  let at = 0;
  for (const m of String(text).matchAll(LINK_RE)) {
    out += esc(text.slice(at, m.index));
    const t = findTerm(m[2] || m[1]);
    out += t ? cmdLink(termCmd(t), m[1], 'wi-def', `title="${esc(`WHATIS ${t.term}`)}"`) : esc(m[1]);
    at = m.index + m[0].length;
  }
  return out + esc(String(text).slice(at));
}

// The hero's size by its length: a short term big, a long one smaller.
const heroSize = (s) => (s.length <= 7 ? 60 : s.length <= 16 ? 44 : 32);

const ALL_TERMS = cardLink({ label: 'ALL TERMS', cmd: 'WHATIS' });

export function termHtml(t) {
  const see = (t.see || []).map(findTerm).filter(Boolean);
  const seeHtml = see.length
    ? `<nav class="wi-see" aria-label="See also"><span class="tag">See also</span>${see.map((s, i) => cmdLink(termCmd(s), s.term, 'chip wi-chip', `data-key="${i + 1}"`)).join('')}</nav>`
    : '';
  return cardPage({
    cls: 'wi-card', label: `WHATIS ${t.term}`,
    kicker: 'WHATIS', hero: t.term, heroSize: heroSize(t.term),
    sub: raw(definitionHtml(t.text)),
    note: t.example ? `Example: ${t.example}` : '',
    media: seeHtml ? raw(seeHtml) : '',
    links: [ALL_TERMS],
  });
}

export function unknownHtml(typed) {
  const word = String(typed).trim();
  const { close, terms: near } = suggestTerms(word, 3);
  const act = near.map((t, i) => cardButton({ label: t.term, cmd: termCmd(t), primary: i === 0, attrs: `data-key="${i + 1}"` })).join('');
  const tell = `<a class="card-link" href="${esc(q('FEEDBACK'))}" data-cmd="FEEDBACK" data-prefill="${esc(FEEDBACK_PREFILL(word))}">TELL US</a>`;
  return cardPage({
    cls: 'wi-card wi-none', label: 'WHATIS: no definition',
    kicker: 'WHATIS', hero: `No definition for ${word} yet.`, heroSize: 24,
    sub: close ? 'The closest terms:' : 'Some common terms:',
    act: raw(act),
    links: [tell, ALL_TERMS],
  });
}

export function listHtml() {
  const terms = sortedTerms();
  const items = terms.map((t, i) => `<li><a class="wi-item" href="${esc(q(termCmd(t)))}" data-cmd="${esc(termCmd(t))}" data-num="${i + 1}" title="${esc(plainText(t.text))}"><span class="wi-n num" aria-hidden="true">${i + 1}</span>${esc(t.term)}</a></li>`).join('');
  const foot = `<p class="wi-foot">Type WHATIS and a word, like ${cmdLink('WHATIS yield', 'WHATIS yield', 'code')}. ${esc(RULE)}</p>`;
  return panel('1', 'WHATIS: market words in plain English', `<ol class="wi-list">${items}</ol>${foot}`, {
    cls: 'panel-solo wi-panel', meta: `${terms.length} TERMS &middot; A-Z`,
  });
}

// What WHATIS <words> draws: { html, status, found }.
export function whatisView(words) {
  const typed = String(words ?? '').trim();
  if (!typed) return { html: listHtml(), status: `${TERMS.length} TERMS. ${STATUS.replace('WHATIS: ', '')}`, found: null };
  const t = findTerm(typed);
  if (t) return { html: termHtml(t), status: STATUS, found: t };
  return { html: unknownHtml(typed), status: `NO DEFINITION FOR ${typed.toUpperCase()} YET`, found: null };
}

export function render(el, cmd, ctx) {
  const v = whatisView(cmd?.args?.words);
  el.innerHTML = v.html;
  const onClick = (e) => {
    const f = e.target.closest?.('[data-prefill]');
    if (f) setPrefill(f.dataset.prefill);
  };
  el.addEventListener('click', onClick);
  ctx.status(v.status);
  return () => el.removeEventListener('click', onClick);
}
