// 8-K item codes in plain words, for WHY (data/why.js) and the chart's N flags. One
// source for the server and the browser. 9.01 (exhibits) says nothing on its own and is
// left out.

export const WHY_ITEMS = {
  '1.01': 'major agreement', '1.02': 'agreement ended', '1.03': 'bankruptcy', '1.04': 'mine safety',
  '1.05': 'cybersecurity incident', '2.01': 'bought or sold assets', '2.02': 'earnings', '2.03': 'new debt',
  '2.04': 'debt due early', '2.05': 'restructuring costs', '2.06': 'write-down', '3.01': 'listing notice',
  '3.02': 'unregistered share sale', '3.03': 'shareholder rights change', '4.01': 'auditor change',
  '4.02': 'restatement', '5.01': 'change in control', '5.02': 'executive change', '5.03': 'bylaws change',
  '5.04': 'benefit plan blackout', '5.05': 'ethics code change', '5.06': 'shell status change',
  '5.07': 'shareholder vote', '5.08': 'director nominations', '6.01': 'asset-backed securities',
  '7.01': 'investor disclosure', '8.01': 'other events',
};

// ["2.02", "9.01"] or "2.02,9.01" -> ["earnings"]. Unknown codes and 9.01 drop out.
export function itemWords(items) {
  const codes = Array.isArray(items) ? items : String(items || '').split(/[,\s]+/);
  const out = [];
  for (const c of codes) {
    const m = /^(\d)\.(\d{1,2})$/.exec(String(c).trim());
    const w = m && WHY_ITEMS[`${m[1]}.${m[2].padStart(2, '0')}`];
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

// "8-K: earnings, executive change", "8-K filing" (no words), "(amended)" for 8-K/A.
export function filingText(items, form = '8-K') {
  const words = itemWords(items);
  const amended = /\/A$/i.test(form) ? ' (amended)' : '';
  return `${words.length ? `8-K: ${words.join(', ')}` : '8-K filing'}${amended}`;
}
