// PIZZA: the Pentagon Pizza Index from pizzint.watch, an unofficial site that
// watches how busy pizza places near the Pentagon are against their usual level.
// The feed is often empty overnight: then the tile says NO DATA.

import { NoData } from './source.js';

export const id = 'pizza';
export const source = 'pizzint.watch';
export const ttl = 10 * 60_000;

const URL_DATA = 'https://www.pizzint.watch/api/dashboard-data';

const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

export function parse(body) {
  if (!body || body.success === false) throw new Error('pizzint.watch: request failed');
  const data = Array.isArray(body.data) ? body.data : [];
  if (!data.length) throw new NoData('pizzint.watch: no places reporting');
  const places = data.map((p) => ({
    name: String(p.name || p.place_name || 'Unknown').slice(0, 60),
    busy: num(p.current_popularity),
    vsUsual: num(p.percentage_of_usual),
    spike: Boolean(p.is_spike),
  }));
  const index = num(body.overall_index);
  const defcon = num(body.defcon_level);
  if (index === null && defcon === null) throw new NoData('pizzint.watch: no index');
  return {
    index,
    defcon,
    spikes: num(body.active_spikes) ?? places.filter((p) => p.spike).length,
    places,
    asOf: typeof body.timestamp === 'string' ? body.timestamp : null,
    freshness: typeof body.data_freshness === 'string' ? body.data_freshness : null,
  };
}

export function build(p) {
  return {
    headline: p.defcon !== null ? `DEFCON ${p.defcon}` : `INDEX ${p.index}`,
    line: 'Pizza place traffic near the Pentagon',
    spark: null,
    asOf: p.asOf,
    source,
    credit: 'pizzint.watch',
    ...p,
  };
}

export async function load(get) {
  return build(parse(await get.json(URL_DATA)));
}
