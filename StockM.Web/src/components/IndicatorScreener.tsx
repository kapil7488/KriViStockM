import { useState, useCallback } from 'react';
import { Market, StockQuote } from '../types';
import { getScanUniverse, ScanUniverse, getUniverseLabel } from '../services/stockScanner';
import { fetchYahooHistorical } from '../services/stockApi';
import {
  vwap as calcVwap, rsi as calcRsi, macd as calcMacd, bollingerBands,
  stochastic, sma, ema, atr as calcAtr,
} from '../services/indicators';

// ── Indicator definitions ──────────────────────────────────────
export type IndicatorId = 'vwap' | 'rsi' | 'macd' | 'bollinger' | 'stochastic' | 'sma-cross' | 'ema-cross' | 'atr';

interface IndicatorDef {
  id: IndicatorId;
  label: string;
  emoji: string;
  description: string;
}

const INDICATORS: IndicatorDef[] = [
  { id: 'vwap', label: 'VWAP', emoji: '📏', description: 'Price vs Volume-Weighted Average Price' },
  { id: 'rsi', label: 'RSI', emoji: '📈', description: 'Relative Strength Index (oversold / overbought)' },
  { id: 'macd', label: 'MACD', emoji: '📊', description: 'MACD line crossover & histogram momentum' },
  { id: 'bollinger', label: 'Bollinger Bands', emoji: '🎯', description: 'Squeeze & breakout detection' },
  { id: 'stochastic', label: 'Stochastic', emoji: '🔄', description: '%K/%D crossover & oversold/overbought' },
  { id: 'sma-cross', label: 'SMA Cross', emoji: '✂️', description: 'SMA 50/200 Golden Cross & Death Cross' },
  { id: 'ema-cross', label: 'EMA Cross', emoji: '⚡', description: 'EMA 12/26 short-term crossover' },
  { id: 'atr', label: 'ATR', emoji: '🌊', description: 'Average True Range — volatility screening' },
];

// ── Scan result type ───────────────────────────────────────────
export interface ScreenerResult {
  symbol: string;
  price: number;
  dayChange: number;
  indicator: IndicatorId;
  value1: number;       // primary value (RSI, VWAP, MACD line, etc.)
  value2: number;       // secondary value (signal line, band, etc.)
  signal: string;       // human-readable signal label
  signalType: 'bullish' | 'bearish' | 'neutral';
  strength: number;     // 0-100
  detail: string;       // tooltip detail
}

// ── Per-indicator analyzers ────────────────────────────────────
function analyzeVwap(sym: string, quotes: StockQuote[]): ScreenerResult | null {
  const vwapArr = calcVwap(quotes);
  const n = quotes.length;
  const last = quotes[n - 1];
  const prev = quotes[n - 2];
  const v = vwapArr[n - 1];
  if (v <= 0) return null;

  const dist = ((last.close - v) / v) * 100;
  const prevAbove = prev.close > vwapArr[n - 2];
  const currAbove = last.close > vwapArr[n - 1];
  let signal: string, signalType: 'bullish' | 'bearish' | 'neutral';

  if (!prevAbove && currAbove) { signal = '🟢 Bull Cross'; signalType = 'bullish'; }
  else if (prevAbove && !currAbove) { signal = '🔴 Bear Cross'; signalType = 'bearish'; }
  else if (currAbove) { signal = '↑ Above'; signalType = 'bullish'; }
  else { signal = '↓ Below'; signalType = 'bearish'; }

  const proximity = Math.max(0, 100 - Math.abs(dist) * 10);
  const crossBonus = (signal.includes('Cross')) ? 25 : 0;
  const strength = Math.min(100, Math.round(proximity + crossBonus));

  const change = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
  return { symbol: sym, price: last.close, dayChange: change, indicator: 'vwap', value1: last.close, value2: v, signal, signalType, strength, detail: `Price: ${last.close.toFixed(2)} | VWAP: ${v.toFixed(2)} | Dist: ${dist.toFixed(2)}%` };
}

function analyzeRsi(sym: string, quotes: StockQuote[]): ScreenerResult | null {
  const rsiArr = calcRsi(quotes);
  const n = quotes.length;
  const rsiVal = rsiArr[n - 1];
  const prevRsi = rsiArr[n - 2];
  const last = quotes[n - 1];
  const prev = quotes[n - 2];
  if (rsiVal === 0) return null;

  let signal: string, signalType: 'bullish' | 'bearish' | 'neutral';
  if (rsiVal < 30) { signal = '🟢 Oversold'; signalType = 'bullish'; }
  else if (rsiVal > 70) { signal = '🔴 Overbought'; signalType = 'bearish'; }
  else if (prevRsi < 30 && rsiVal >= 30) { signal = '🟢 Exiting Oversold'; signalType = 'bullish'; }
  else if (prevRsi > 70 && rsiVal <= 70) { signal = '🔴 Exiting Overbought'; signalType = 'bearish'; }
  else if (rsiVal < 45) { signal = '↓ Weak'; signalType = 'bearish'; }
  else if (rsiVal > 55) { signal = '↑ Strong'; signalType = 'bullish'; }
  else { signal = '≈ Neutral'; signalType = 'neutral'; }

  // Strength: distance from extremes = stronger signal
  const distFromExtreme = Math.min(Math.abs(rsiVal - 30), Math.abs(rsiVal - 70));
  const strength = rsiVal < 30 || rsiVal > 70
    ? Math.min(100, Math.round(70 + (100 - distFromExtreme)))
    : Math.round(Math.max(0, 50 - distFromExtreme));

  const change = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
  return { symbol: sym, price: last.close, dayChange: change, indicator: 'rsi', value1: rsiVal, value2: prevRsi, signal, signalType, strength, detail: `RSI: ${rsiVal.toFixed(1)} (prev: ${prevRsi.toFixed(1)})` };
}

function analyzeMacd(sym: string, quotes: StockQuote[]): ScreenerResult | null {
  const m = calcMacd(quotes);
  const n = quotes.length;
  const last = quotes[n - 1];
  const prev = quotes[n - 2];
  const line = m.line[n - 1], sig = m.signal[n - 1], hist = m.histogram[n - 1];
  const prevLine = m.line[n - 2], prevSig = m.signal[n - 2], prevHist = m.histogram[n - 2];
  if (line === 0 && sig === 0) return null;

  let signal: string, signalType: 'bullish' | 'bearish' | 'neutral';
  if (prevLine <= prevSig && line > sig) { signal = '🟢 Bull Cross'; signalType = 'bullish'; }
  else if (prevLine >= prevSig && line < sig) { signal = '🔴 Bear Cross'; signalType = 'bearish'; }
  else if (hist > 0 && hist > prevHist) { signal = '↑ Rising'; signalType = 'bullish'; }
  else if (hist < 0 && hist < prevHist) { signal = '↓ Falling'; signalType = 'bearish'; }
  else if (hist > 0) { signal = '↑ Positive'; signalType = 'bullish'; }
  else if (hist < 0) { signal = '↓ Negative'; signalType = 'bearish'; }
  else { signal = '≈ Flat'; signalType = 'neutral'; }

  const crossBonus = signal.includes('Cross') ? 30 : 0;
  const histStr = Math.min(50, Math.abs(hist) / (last.close * 0.005) * 50);
  const strength = Math.min(100, Math.round(histStr + crossBonus + 20));

  const change = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
  return { symbol: sym, price: last.close, dayChange: change, indicator: 'macd', value1: line, value2: sig, signal, signalType, strength, detail: `MACD: ${line.toFixed(3)} | Signal: ${sig.toFixed(3)} | Hist: ${hist.toFixed(3)}` };
}

function analyzeBollinger(sym: string, quotes: StockQuote[]): ScreenerResult | null {
  const bb = bollingerBands(quotes);
  const n = quotes.length;
  const last = quotes[n - 1];
  const prev = quotes[n - 2];
  const upper = bb.upper[n - 1], mid = bb.middle[n - 1], lower = bb.lower[n - 1];
  if (upper === 0) return null;

  const bandwidth = ((upper - lower) / mid) * 100;
  const pctB = (last.close - lower) / (upper - lower); // 0 = at lower, 1 = at upper

  let signal: string, signalType: 'bullish' | 'bearish' | 'neutral';
  if (last.close <= lower) { signal = '🟢 Below Lower'; signalType = 'bullish'; }
  else if (last.close >= upper) { signal = '🔴 Above Upper'; signalType = 'bearish'; }
  else if (prev.close <= bb.lower[n - 2] && last.close > lower) { signal = '🟢 Bounce Off Lower'; signalType = 'bullish'; }
  else if (prev.close >= bb.upper[n - 2] && last.close < upper) { signal = '🔴 Rejected Upper'; signalType = 'bearish'; }
  else if (bandwidth < 10) { signal = '⚡ Squeeze'; signalType = 'neutral'; }
  else if (pctB > 0.5) { signal = '↑ Upper Half'; signalType = 'bullish'; }
  else { signal = '↓ Lower Half'; signalType = 'bearish'; }

  const extremeBonus = (pctB <= 0 || pctB >= 1) ? 30 : 0;
  const squeezeBonus = bandwidth < 10 ? 20 : 0;
  const strength = Math.min(100, Math.round(Math.abs(pctB - 0.5) * 100 + extremeBonus + squeezeBonus));

  const change = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
  return { symbol: sym, price: last.close, dayChange: change, indicator: 'bollinger', value1: pctB * 100, value2: bandwidth, signal, signalType, strength, detail: `%B: ${(pctB * 100).toFixed(1)}% | BW: ${bandwidth.toFixed(1)}% | Upper: ${upper.toFixed(2)} | Lower: ${lower.toFixed(2)}` };
}

function analyzeStochastic(sym: string, quotes: StockQuote[]): ScreenerResult | null {
  const st = stochastic(quotes);
  const n = quotes.length;
  const last = quotes[n - 1];
  const prev = quotes[n - 2];
  const k = st.k[n - 1], d = st.d[n - 1];
  const prevK = st.k[n - 2], prevD = st.d[n - 2];
  if (k === 0 && d === 0) return null;

  let signal: string, signalType: 'bullish' | 'bearish' | 'neutral';
  if (k < 20 && prevK <= prevD && k > d) { signal = '🟢 Bull Cross (Oversold)'; signalType = 'bullish'; }
  else if (k > 80 && prevK >= prevD && k < d) { signal = '🔴 Bear Cross (Overbought)'; signalType = 'bearish'; }
  else if (prevK <= prevD && k > d) { signal = '🟢 Bull Cross'; signalType = 'bullish'; }
  else if (prevK >= prevD && k < d) { signal = '🔴 Bear Cross'; signalType = 'bearish'; }
  else if (k < 20) { signal = '🟢 Oversold'; signalType = 'bullish'; }
  else if (k > 80) { signal = '🔴 Overbought'; signalType = 'bearish'; }
  else { signal = '≈ Mid Range'; signalType = 'neutral'; }

  const crossBonus = signal.includes('Cross') ? 25 : 0;
  const extremeBonus = (k < 20 || k > 80) ? 20 : 0;
  const strength = Math.min(100, Math.round(crossBonus + extremeBonus + Math.abs(k - 50)));

  const change = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
  return { symbol: sym, price: last.close, dayChange: change, indicator: 'stochastic', value1: k, value2: d, signal, signalType, strength, detail: `%K: ${k.toFixed(1)} | %D: ${d.toFixed(1)}` };
}

function analyzeSmaCross(sym: string, quotes: StockQuote[]): ScreenerResult | null {
  if (quotes.length < 201) return null;
  const sma50 = sma(quotes, 50);
  const sma200 = sma(quotes, 200);
  const n = quotes.length;
  const last = quotes[n - 1];
  const prev = quotes[n - 2];
  const s50 = sma50[n - 1], s200 = sma200[n - 1];
  const ps50 = sma50[n - 2], ps200 = sma200[n - 2];
  if (s200 === 0) return null;

  let signal: string, signalType: 'bullish' | 'bearish' | 'neutral';
  if (ps50 <= ps200 && s50 > s200) { signal = '🟢 Golden Cross'; signalType = 'bullish'; }
  else if (ps50 >= ps200 && s50 < s200) { signal = '🔴 Death Cross'; signalType = 'bearish'; }
  else if (s50 > s200) { signal = '↑ Bullish Trend'; signalType = 'bullish'; }
  else { signal = '↓ Bearish Trend'; signalType = 'bearish'; }

  const crossBonus = signal.includes('Cross') ? 40 : 0;
  const gapPct = ((s50 - s200) / s200) * 100;
  const strength = Math.min(100, Math.round(crossBonus + Math.min(60, Math.abs(gapPct) * 5)));

  const change = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
  return { symbol: sym, price: last.close, dayChange: change, indicator: 'sma-cross', value1: s50, value2: s200, signal, signalType, strength, detail: `SMA50: ${s50.toFixed(2)} | SMA200: ${s200.toFixed(2)} | Gap: ${gapPct.toFixed(2)}%` };
}

function analyzeEmaCross(sym: string, quotes: StockQuote[]): ScreenerResult | null {
  const ema12Arr = ema(quotes, 12);
  const ema26Arr = ema(quotes, 26);
  const n = quotes.length;
  const last = quotes[n - 1];
  const prev = quotes[n - 2];
  const e12 = ema12Arr[n - 1], e26 = ema26Arr[n - 1];
  const pe12 = ema12Arr[n - 2], pe26 = ema26Arr[n - 2];
  if (e26 === 0) return null;

  let signal: string, signalType: 'bullish' | 'bearish' | 'neutral';
  if (pe12 <= pe26 && e12 > e26) { signal = '🟢 Bull Cross'; signalType = 'bullish'; }
  else if (pe12 >= pe26 && e12 < e26) { signal = '🔴 Bear Cross'; signalType = 'bearish'; }
  else if (e12 > e26) { signal = '↑ Bullish'; signalType = 'bullish'; }
  else { signal = '↓ Bearish'; signalType = 'bearish'; }

  const crossBonus = signal.includes('Cross') ? 35 : 0;
  const gapPct = ((e12 - e26) / e26) * 100;
  const strength = Math.min(100, Math.round(crossBonus + Math.min(65, Math.abs(gapPct) * 20)));

  const change = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
  return { symbol: sym, price: last.close, dayChange: change, indicator: 'ema-cross', value1: e12, value2: e26, signal, signalType, strength, detail: `EMA12: ${e12.toFixed(2)} | EMA26: ${e26.toFixed(2)} | Gap: ${gapPct.toFixed(2)}%` };
}

function analyzeAtr(sym: string, quotes: StockQuote[]): ScreenerResult | null {
  const atrArr = calcAtr(quotes);
  const n = quotes.length;
  const last = quotes[n - 1];
  const prev = quotes[n - 2];
  const atrVal = atrArr[n - 1];
  const prevAtr = atrArr[n - 2];
  if (atrVal === 0) return null;

  const atrPct = (atrVal / last.close) * 100;
  const expanding = atrVal > prevAtr;

  let signal: string, signalType: 'bullish' | 'bearish' | 'neutral';
  if (atrPct > 4) { signal = expanding ? '🔴 High & Rising' : '⚠️ High & Falling'; signalType = expanding ? 'bearish' : 'neutral'; }
  else if (atrPct < 1.5) { signal = expanding ? '⚡ Low & Rising' : '🟢 Low & Stable'; signalType = expanding ? 'neutral' : 'bullish'; }
  else { signal = expanding ? '↑ Expanding' : '↓ Contracting'; signalType = 'neutral'; }

  const strength = Math.min(100, Math.round(atrPct * 15));

  const change = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
  return { symbol: sym, price: last.close, dayChange: change, indicator: 'atr', value1: atrVal, value2: atrPct, signal, signalType, strength, detail: `ATR: ${atrVal.toFixed(2)} (${atrPct.toFixed(2)}% of price) | ${expanding ? 'Expanding' : 'Contracting'}` };
}

// ── Dispatcher ─────────────────────────────────────────────────
function analyzeStock(sym: string, quotes: StockQuote[], indicator: IndicatorId): ScreenerResult | null {
  switch (indicator) {
    case 'vwap': return analyzeVwap(sym, quotes);
    case 'rsi': return analyzeRsi(sym, quotes);
    case 'macd': return analyzeMacd(sym, quotes);
    case 'bollinger': return analyzeBollinger(sym, quotes);
    case 'stochastic': return analyzeStochastic(sym, quotes);
    case 'sma-cross': return analyzeSmaCross(sym, quotes);
    case 'ema-cross': return analyzeEmaCross(sym, quotes);
    case 'atr': return analyzeAtr(sym, quotes);
    default: return null;
  }
}

// ── Value display helpers ──────────────────────────────────────
function formatValue(indicator: IndicatorId, value: number): string {
  switch (indicator) {
    case 'rsi': return value.toFixed(1);
    case 'stochastic': return value.toFixed(1);
    case 'bollinger': return `${value.toFixed(1)}%`;
    case 'atr': return value.toFixed(2);
    default: return value.toFixed(2);
  }
}
function getValueLabels(indicator: IndicatorId): [string, string] {
  switch (indicator) {
    case 'vwap': return ['Price', 'VWAP'];
    case 'rsi': return ['RSI', 'Prev'];
    case 'macd': return ['MACD', 'Signal'];
    case 'bollinger': return ['%B', 'BW%'];
    case 'stochastic': return ['%K', '%D'];
    case 'sma-cross': return ['SMA50', 'SMA200'];
    case 'ema-cross': return ['EMA12', 'EMA26'];
    case 'atr': return ['ATR', 'ATR%'];
  }
}

// ── Scan engine ────────────────────────────────────────────────
async function scanIndicator(
  market: Market, universe: ScanUniverse, indicator: IndicatorId,
  onProgress: (done: number, total: number) => void,
): Promise<ScreenerResult[]> {
  const stocks = getScanUniverse(market, universe);
  const results: ScreenerResult[] = [];
  const CONCURRENCY = 4;
  let done = 0;

  for (let i = 0; i < stocks.length; i += CONCURRENCY) {
    const batch = stocks.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (sym) => {
        const data = await fetchYahooHistorical(sym, market);
        if (data.quotes.length < 30) return null;
        return analyzeStock(sym, data.quotes, indicator);
      }),
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
      done++;
      onProgress(done, stocks.length);
    }
  }
  return results;
}

// ── Component ──────────────────────────────────────────────────
type SignalFilter = 'all' | 'bullish' | 'bearish' | 'neutral';
type SortMode = 'strength' | 'value' | 'change';

interface IndicatorScreenerProps {
  market: Market;
  currency: string;
  onSelectSymbol: (s: string) => void;
}

export function IndicatorScreener({ market, currency, onSelectSymbol }: IndicatorScreenerProps) {
  const [indicator, setIndicator] = useState<IndicatorId>('vwap');
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [universe, setUniverse] = useState<ScanUniverse>('default');
  const [filter, setFilter] = useState<SignalFilter>('all');
  const [sortBy, setSortBy] = useState<SortMode>('strength');
  const [limit, setLimit] = useState<10 | 20 | 50>(10);
  const [lastScan, setLastScan] = useState<string | null>(null);

  const isIndian = market === 'NSE' || market === 'BSE';
  const sym = currency === 'INR' ? '₹' : '$';
  const def = INDICATORS.find(i => i.id === indicator)!;
  const [valLabel1, valLabel2] = getValueLabels(indicator);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setResults([]);
    setProgress({ done: 0, total: 0 });
    try {
      const res = await scanIndicator(market, universe, indicator, (d, t) => setProgress({ done: d, total: t }));
      setResults(res);
      setLastScan(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('[Screener]', err);
    } finally {
      setScanning(false);
    }
  }, [market, universe, indicator]);

  const filtered = results.filter(r => {
    if (filter === 'bullish') return r.signalType === 'bullish';
    if (filter === 'bearish') return r.signalType === 'bearish';
    if (filter === 'neutral') return r.signalType === 'neutral';
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'strength') return b.strength - a.strength;
    if (sortBy === 'value') return Math.abs(b.value1) - Math.abs(a.value1);
    return Math.abs(b.dayChange) - Math.abs(a.dayChange);
  }).slice(0, limit);

  return (
    <div className="card is-panel">
      <h3 className="card-title">{def.emoji} Indicator Screener — {market}</h3>

      {/* Indicator Dropdown */}
      <div className="is-controls">
        <div className="is-row">
          <span className="is-label">Indicator:</span>
          <select className="is-select" value={indicator}
            onChange={e => { setIndicator(e.target.value as IndicatorId); setResults([]); }}
            disabled={scanning}>
            {INDICATORS.map(ind => (
              <option key={ind.id} value={ind.id}>{ind.emoji} {ind.label}</option>
            ))}
          </select>
        </div>
        <div className="is-desc">{def.description}</div>

        {/* Universe */}
        <div className="is-row">
          <span className="is-label">Universe:</span>
          <div className="tp-limit-toggle">
            <button className={`tp-limit-btn ${universe === 'default' ? 'active' : ''}`}
              onClick={() => setUniverse('default')} disabled={scanning}>
              {isIndian ? 'Popular (30)' : 'Popular (30)'}
            </button>
            <button className={`tp-limit-btn ${universe === (isIndian ? 'nifty50' : 'sp500') ? 'active' : ''}`}
              onClick={() => setUniverse(isIndian ? 'nifty50' : 'sp500')} disabled={scanning}>
              {isIndian ? 'Nifty 50' : 'S&P 500 (100)'}
            </button>
          </div>
        </div>

        {/* Top N */}
        <div className="is-row">
          <span className="is-label">Show:</span>
          <div className="tp-limit-toggle">
            {([10, 20, 50] as const).map(n => (
              <button key={n} className={`tp-limit-btn ${limit === n ? 'active' : ''}`}
                onClick={() => setLimit(n)} disabled={scanning}>
                Top {n}
              </button>
            ))}
          </div>
        </div>

        {/* Filter & Sort */}
        <div className="is-row">
          <span className="is-label">Filter:</span>
          <div className="is-chips">
            {([['all', 'All'], ['bullish', '🟢 Bullish'], ['bearish', '🔴 Bearish'], ['neutral', '⚪ Neutral']] as [SignalFilter, string][]).map(([f, l]) => (
              <button key={f} className={`is-chip ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)} disabled={scanning}>{l}</button>
            ))}
          </div>
        </div>
        <div className="is-row">
          <span className="is-label">Sort:</span>
          <div className="is-chips">
            {([['strength', 'Strength'], ['value', 'Value'], ['change', 'Change %']] as [SortMode, string][]).map(([s, l]) => (
              <button key={s} className={`is-chip ${sortBy === s ? 'active' : ''}`}
                onClick={() => setSortBy(s)}>{l}</button>
            ))}
          </div>
        </div>

        <button className="tp-scan-btn" onClick={handleScan} disabled={scanning}>
          {scanning ? `Scanning... ${progress.done}/${progress.total}` : `🔍 Scan ${def.label}`}
        </button>
      </div>

      {/* Progress */}
      {scanning && progress.total > 0 && (
        <div className="tp-progress-bar">
          <div className="tp-progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}

      {/* Results Table */}
      {sorted.length > 0 && (
        <div className="is-results">
          <div className="is-header-row">
            <span>#</span>
            <span>Symbol</span>
            <span>Price</span>
            <span>{valLabel1}</span>
            <span>{valLabel2}</span>
            <span>Signal</span>
            <span>Str</span>
            <span>Chg</span>
          </div>
          {sorted.map((r, i) => (
            <div key={r.symbol} className="is-data-row" onClick={() => onSelectSymbol(r.symbol)}
              title={r.detail}>
              <span className="is-rank">{i + 1}</span>
              <span className="is-sym">{r.symbol}</span>
              <span className="is-price">{sym}{r.price.toFixed(2)}</span>
              <span className="is-val">{formatValue(r.indicator, r.value1)}</span>
              <span className="is-val">{formatValue(r.indicator, r.value2)}</span>
              <span>
                <span className={`is-signal-badge ${r.signalType}`}>{r.signal}</span>
              </span>
              <span className="is-strength">
                <span className="is-str-bar">
                  <span className="is-str-fill" style={{
                    width: `${r.strength}%`,
                    background: r.strength >= 70 ? '#22c55e' : r.strength >= 40 ? '#f59e0b' : '#ef4444',
                  }} />
                </span>
                <span className="is-str-val">{r.strength}</span>
              </span>
              <span className={`is-change ${r.dayChange >= 0 ? 'up' : 'down'}`}>
                {r.dayChange >= 0 ? '+' : ''}{r.dayChange.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {!scanning && results.length > 0 && sorted.length === 0 && (
        <div className="is-empty"><p>No stocks match the current filter.</p></div>
      )}

      {!scanning && results.length === 0 && (
        <div className="is-empty">
          <p>Select an indicator and click <b>Scan {def.label}</b> to screen {getUniverseLabel(market, universe)}.</p>
          <div className="is-indicator-grid">
            {INDICATORS.map(ind => (
              <div key={ind.id} className={`is-ind-card ${indicator === ind.id ? 'active' : ''}`}
                onClick={() => { setIndicator(ind.id); setResults([]); }}>
                <span className="is-ind-emoji">{ind.emoji}</span>
                <span className="is-ind-name">{ind.label}</span>
                <span className="is-ind-desc">{ind.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {lastScan && <div className="tp-footer">Last scanned at {lastScan} — {sorted.length} results shown</div>}
    </div>
  );
}
