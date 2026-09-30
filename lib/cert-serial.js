// The listing certificate's serial number, for the server's share card (lib/og-nosuch.js).
// A pure copy of certSerial in public/screens/nosuch.js (the page's certificate), so the
// server never loads a screen module. test/og-ipo-cert.test.js checks the two agree.
// FNV-1a over the letters, upper case: the same word always gets the same six digits.
export function certSerial(word) {
  let h = 2166136261;
  for (const ch of String(word || '').toUpperCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return String(100000 + (h % 900000));
}
