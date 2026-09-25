// WORLD: stock indexes by region, from the public CNBC quote service (no key).
// `ex` is the exchange id; the screen knows each exchange's hours and time zone.

import { makeCnbcList, withCmd } from './lists.js';

export const WORLD = [
  { id: 'SPX', src: '.SPX', name: 'S&P 500', cc: 'US', region: 'Americas', ex: 'NYSE', cmd: 'SPX' },
  { id: 'DJI', src: '.DJI', name: 'Dow', cc: 'US', region: 'Americas', ex: 'NYSE', cmd: 'DJI' },
  { id: 'IXIC', src: '.IXIC', name: 'Nasdaq Comp.', cc: 'US', region: 'Americas', ex: 'NASDAQ' },
  { id: 'GSPTSE', src: '.GSPTSE', name: 'S&P/TSX', cc: 'CA', region: 'Americas', ex: 'TSX' },
  { id: 'BVSP', src: '.BVSP', name: 'Bovespa', cc: 'BR', region: 'Americas', ex: 'B3' },
  { id: 'MXX', src: '.MXX', name: 'IPC', cc: 'MX', region: 'Americas', ex: 'BMV' },
  { id: 'MERV', src: '.MERV', name: 'Merval', cc: 'AR', region: 'Americas', ex: 'BYMA' },
  { id: 'SOX', src: '.SOX', name: 'Semiconductors', cc: 'US', region: 'Americas', ex: 'NASDAQ' },
  { id: 'DJT', src: '.DJT', name: 'Dow Transports', cc: 'US', region: 'Americas', ex: 'NYSE' },
  { id: 'SPXEW', src: '.SPXEW', name: 'S&P 500 Eq. Wt', cc: 'US', region: 'Americas', ex: 'NYSE' },
  { id: 'NYA', src: '.NYA', name: 'NYSE Composite', cc: 'US', region: 'Americas', ex: 'NYSE' },
  { id: 'FTSE', src: '.FTSE', name: 'FTSE 100', cc: 'UK', region: 'Europe', ex: 'LSE', cmd: 'FTSE' },
  { id: 'DAX', src: '.GDAXI', name: 'DAX', cc: 'DE', region: 'Europe', ex: 'XETRA', cmd: 'DAX' },
  { id: 'CAC', src: '.FCHI', name: 'CAC 40', cc: 'FR', region: 'Europe', ex: 'EURONEXT' },
  { id: 'SX5E', src: '.STOXX50E', name: 'Euro Stoxx 50', cc: 'EU', region: 'Europe', ex: 'XETRA' },
  { id: 'AEX', src: '.AEX', name: 'AEX', cc: 'NL', region: 'Europe', ex: 'AMS' },
  { id: 'IBEX', src: '.IBEX', name: 'IBEX 35', cc: 'ES', region: 'Europe', ex: 'BME' },
  { id: 'FTMIB', src: '.FTMIB', name: 'FTSE MIB', cc: 'IT', region: 'Europe', ex: 'BIT' },
  { id: 'SMI', src: '.SSMI', name: 'SMI', cc: 'CH', region: 'Europe', ex: 'SIX' },
  { id: 'STOXX', src: '.STOXX', name: 'STOXX Europe 600', cc: 'EU', region: 'Europe', ex: 'XETRA' },
  { id: 'XU100', src: '.XU100', name: 'BIST 100', cc: 'TR', region: 'Europe', ex: 'BIST' },
  { id: 'N225', src: '.N225', name: 'Nikkei 225', cc: 'JP', region: 'Asia-Pacific', ex: 'TSE', cmd: 'N225' },
  { id: 'HSI', src: '.HSI', name: 'Hang Seng', cc: 'HK', region: 'Asia-Pacific', ex: 'HKEX' },
  { id: 'HSCE', src: '.HSCE', name: 'HS China Ent.', cc: 'HK', region: 'Asia-Pacific', ex: 'HKEX' },
  { id: 'SSEC', src: '.SSEC', name: 'Shanghai Comp.', cc: 'CN', region: 'Asia-Pacific', ex: 'SSE' },
  { id: 'KOSPI', src: '.KS11', name: 'KOSPI', cc: 'KR', region: 'Asia-Pacific', ex: 'KRX' },
  { id: 'TWII', src: '.TWII', name: 'Taiwan Weighted', cc: 'TW', region: 'Asia-Pacific', ex: 'TWSE' },
  { id: 'ASX', src: '.AXJO', name: 'S&P/ASX 200', cc: 'AU', region: 'Asia-Pacific', ex: 'ASX' },
  { id: 'NIFTY', src: '.NSEI', name: 'Nifty 50', cc: 'IN', region: 'Asia-Pacific', ex: 'NSE' },
  { id: 'SET', src: '.SETI', name: 'SET', cc: 'TH', region: 'Asia-Pacific', ex: 'SET' },
  { id: 'STI', src: '.STI', name: 'Straits Times', cc: 'SG', region: 'Asia-Pacific', ex: 'SGX' },
  { id: 'NZ50', src: '.NZ50', name: 'NZX 50', cc: 'NZ', region: 'Asia-Pacific', ex: 'NZX' },
  { id: 'VNI', src: '.VNI', name: 'VN-Index', cc: 'VN', region: 'Asia-Pacific', ex: 'HOSE' },
].map(withCmd);

export function makeWorld(opts = {}) {
  const list = makeCnbcList({ key: 'world', items: WORLD, ...opts });
  return {
    async getWorld() {
      const { rows, stale, updated } = await list();
      return { indexes: rows, stale, updated };
    },
  };
}

export const { getWorld } = makeWorld();
