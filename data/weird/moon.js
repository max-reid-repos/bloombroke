// Moon phases, computed here with no source. New and full moon times use the method in
// Jean Meeus, "Astronomical Algorithms" (2nd ed.), chapter 49, with the main periodic
// terms: good to a few minutes. The phase name and the lit share follow from where
// "now" falls between the new moon before it and the one after.

const SYNODIC = 29.530588861;
const rad = (d) => (d * Math.PI) / 180;
const JD_UNIX = 2440587.5;

export const jdFromMs = (ms) => ms / 86400_000 + JD_UNIX;
export const msFromJd = (jd) => (jd - JD_UNIX) * 86400_000;

// k: lunation number (0 = the new moon of 2000-01-06). An integer gives a new moon,
// k + 0.5 a full moon. Returns the time in ms (dynamical time, within about a minute of UTC).
export function truePhase(k) {
  const T = k / 1236.85;
  const T2 = T * T; const T3 = T2 * T; const T4 = T3 * T;
  let jde = 2451550.09766 + SYNODIC * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = rad(2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3);
  const Mp = rad(201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4);
  const F = rad(160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4);
  const Om = rad(124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3);
  const full = Math.abs(k % 1) === 0.5;
  const c = full
    ? [-0.40614, 0.17302, 0.01614, 0.01043, 0.00734, -0.00515, 0.00209]
    : [-0.40720, 0.17241, 0.01608, 0.01039, 0.00739, -0.00514, 0.00208];
  jde += c[0] * Math.sin(Mp)
    + c[1] * E * Math.sin(M)
    + c[2] * Math.sin(2 * Mp)
    + c[3] * Math.sin(2 * F)
    + c[4] * E * Math.sin(Mp - M)
    + c[5] * E * Math.sin(Mp + M)
    + c[6] * E * E * Math.sin(2 * M)
    - 0.00111 * Math.sin(Mp - 2 * F)
    - 0.00057 * Math.sin(Mp + 2 * F)
    + 0.00056 * E * Math.sin(2 * Mp + M)
    - 0.00042 * Math.sin(3 * Mp)
    + 0.00042 * E * Math.sin(M + 2 * F)
    + 0.00038 * E * Math.sin(M - 2 * F)
    - 0.00024 * E * Math.sin(2 * Mp - M)
    - 0.00017 * Math.sin(Om);
  return msFromJd(jde);
}

// The new moon at or before `ms`, and the next one after it: { prev, next, k }.
export function lunation(ms) {
  let k = Math.floor((jdFromMs(ms) - 2451550.09766) / SYNODIC);
  while (truePhase(k) > ms) k -= 1;
  while (truePhase(k + 1) <= ms) k += 1;
  return { k, prev: truePhase(k), next: truePhase(k + 1) };
}

const NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
const DAY = 86400_000;

// ms -> { name, age (days), lit (0..1), lastNew, full (this cycle's full moon), nextNew, nextFull }.
// Within a day of a new, quarter or full moon the day gets that name.
export function moonPhase(ms) {
  const { k, prev, next } = lunation(ms);
  const full = truePhase(k + 0.5);
  const first = prev + (full - prev) / 2;
  const last = full + (next - full) / 2;
  const f = (ms - prev) / (next - prev);
  const lit = (1 - Math.cos(2 * Math.PI * f)) / 2;
  let name;
  if (ms - prev < DAY || next - ms < DAY) name = NAMES[0];
  else if (Math.abs(ms - full) < DAY) name = NAMES[4];
  else if (Math.abs(ms - first) < DAY) name = NAMES[2];
  else if (Math.abs(ms - last) < DAY) name = NAMES[6];
  else if (ms < first) name = NAMES[1];
  else if (ms < full) name = NAMES[3];
  else if (ms < last) name = NAMES[5];
  else name = NAMES[7];
  const nextFull = full > ms ? full : truePhase(k + 1.5);
  return { name, age: (ms - prev) / DAY, lit, lastNew: prev, full, nextNew: next, nextFull };
}
