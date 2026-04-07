import { useState, useCallback } from 'react';
import { Market, StockQuote } from '../types';
import { getScanUniverse, ScanUniverse, getUniverseLabel } from '../services/stockScanner';
import { fetchYahooHistorical } from '../services/stockApi';
import { vwap as calcVwap } from '../services/indicators';

export interface VwapScanResult {
  symbol: string;
  price: number;
  vwap: number;
  distPct: number;       // (price - vwap) / vwap * 100
  position: 'Above' | 'Below' | 'At';
  crossover: 'Bullish' | 'Bearish' | 'None';
  strength: number;      // 0-100 signal strength
  dayChange: number;
  volume: number;
  avgVolume: number;
  volRatio: number;
}

function detectCrossover(quotes: StockQuote[], vwapArr: number[]): 'Bullish' | 'Bearish' | 'None' {
  const n = quotes.length;
  if (n < 3) return 'None';
  const prevAbove = quotes[n - 2].close > vwapArr[n - 2];
  const currAbove = quotes[n - 1].close > vwapArr[n - 1];
  if (!prevAbove && currAbove) return 'Bullish';
  if (prevAbove && !currAbove) return 'Bearish';
  return 'None';
}

async function scanVwap(
  market: Market,
  universe: ScanUniverse,
  onProgress: (done: number, total: number) => void,
): Promise<VwapScanResult[]> {
  const stocks = getScanUniverse(market, universe);
  const results: VwapScanResult[] = [];
  const CONCURRENCY = 4;
  let done = 0;

  for (let i = 0; i < stocks.length; i += CONCURRENCY) {
    const batch = stocks.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (sym) => {
        const data = await fetchYahooHistorical(sym, market);
        if (data.quotes.length < 30) return null;
        const quotes = data.quotes;
        const vwapArr = calcVwap(quotes);
        const last = quotes[quotes.length - 1];
        const prev = quotes[quotes.length - 2];
        const vwapVal = vwapArr[vwapArr.length - 1];
        if (vwapVal <= 0) return null;

        const distPct = ((last.close - vwapVal) / vwapVal) * 100;
        const position = Math.abs(distPct) < 0.3 ? 'At' : distPct > 0 ? 'Above' : 'Below';
        const crossover = detectCrossover(quotes, vwapArr);

        // Strength: closer to VWAP + crossover = stronger signal
        const proximityScore = Math.max(0, 100 - Math.abs(distPct) * 10);
        const crossBonus = crossover !== 'None' ? 25 : 0;
        const strength = Math.min(100, Math.round(proximityScore + crossBonus));

        // Average volume (20-day)
        const vol20 = quotes.slice(-20).reduce((s, q) => s + q.volume, 0) / 20;
        const volRatio = vol20 > 0 ? last.volume / vol20 : 1;

        const dayChange = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;

        return {
          symbol: sym,
          price: last.close,
          vwap: vwapVal,
          distPct,
          position,
          crossover,
          strength,
          dayChange,
          volume: last.volume,
          avgVolume: vol20,
          volRatio,
        } as VwapScanResult;
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

type VwapFilter = 'all' | 'bullish-cross' | 'bearish-cross' | 'above' | 'below' | 'near';
type VwapSort = 'strength' | 'distPct' | 'volRatio' | 'dayChange';

interface VwapScreenerProps {
  market: Market;
  currency: string;
  onSelectSymbol: (s: string) => void;
}

export function VwapScreener({ market, currency, onSelectSymbol }: VwapScreenerProps) {
  const [results, setResults] = useState<VwapScanResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [universe, setUniverse] = useState<ScanUniverse>('default');
  const [filter, setFilter] = useState<VwapFilter>('all');
  const [sortBy, setSortBy] = useState<VwapSort>('strength');
  const [lastScan, setLastScan] = useState<string | null>(null);

  const isIndian = market === 'NSE' || market === 'BSE';
  const sym = currency === 'INR' ? '₹' : '$';

  const handleScan = useCallback(async () => {
    setScanning(true);
    setResults([]);
    setProgress({ done: 0, total: 0 });
    try {
      const res = await scanVwap(market, universe, (done, total) => setProgress({ done, total }));
      setResults(res);
      setLastScan(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('[VWAP Screener]', err);
    } finally {
      setScanning(false);
    }
  }, [market, universe]);

  const filtered = results.filter(r => {
    if (filter === 'bullish-cross') return r.crossover === 'Bullish';
    if (filter === 'bearish-cross') return r.crossover === 'Bearish';
    if (filter === 'above') return r.position === 'Above';
    if (filter === 'below') return r.position === 'Below';
    if (filter === 'near') return Math.abs(r.distPct) < 1.5;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'strength') return b.strength - a.strength;
    if (sortBy === 'distPct') return Math.abs(a.distPct) - Math.abs(b.distPct);
    if (sortBy === 'volRatio') return b.volRatio - a.volRatio;
    return Math.abs(b.dayChange) - Math.abs(a.dayChange);
  });

  return (
    <div className="card vwap-screener">
      <h3 className="card-title">📏 VWAP Screener — {market}</h3>

      <div className="vs-controls">
        <div className="vs-row">
          <span className="vs-label">Universe:</span>
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

        <div className="vs-row">
          <span className="vs-label">Filter:</span>
          <div className="vs-filter-chips">
            {([['all', 'All'], ['bullish-cross', '🟢 Bull Cross'], ['bearish-cross', '🔴 Bear Cross'],
              ['above', '↑ Above'], ['below', '↓ Below'], ['near', '≈ Near']] as [VwapFilter, string][]).map(([f, label]) => (
              <button key={f} className={`vs-chip ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)} disabled={scanning}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="vs-row">
          <span className="vs-label">Sort:</span>
          <div className="vs-filter-chips">
            {([['strength', 'Strength'], ['distPct', 'Proximity'], ['volRatio', 'Volume'], ['dayChange', 'Change']] as [VwapSort, string][]).map(([s, label]) => (
              <button key={s} className={`vs-chip ${sortBy === s ? 'active' : ''}`}
                onClick={() => setSortBy(s)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <button className="tp-scan-btn" onClick={handleScan} disabled={scanning}>
          {scanning ? `Scanning... ${progress.done}/${progress.total}` : '🔍 Scan VWAP'}
        </button>
      </div>

      {scanning && progress.total > 0 && (
        <div className="tp-progress-bar">
          <div className="tp-progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}

      {sorted.length > 0 && (
        <div className="vs-results">
          <div className="vs-header-row">
            <span>#</span>
            <span>Symbol</span>
            <span>Price</span>
            <span>VWAP</span>
            <span>Dist%</span>
            <span>Signal</span>
            <span>Str</span>
            <span>Vol Ratio</span>
          </div>
          {sorted.map((r, i) => (
            <div key={r.symbol} className="vs-row-data" onClick={() => onSelectSymbol(r.symbol)}
              title={`${r.symbol}: Price ${sym}${r.price.toFixed(2)} | VWAP ${sym}${r.vwap.toFixed(2)} | Distance ${r.distPct.toFixed(2)}%`}>
              <span className="vs-rank">{i + 1}</span>
              <span className="vs-sym">{r.symbol}</span>
              <span className="vs-price">{sym}{r.price.toFixed(2)}</span>
              <span className="vs-vwap">{sym}{r.vwap.toFixed(2)}</span>
              <span className={`vs-dist ${r.distPct >= 0 ? 'up' : 'down'}`}>
                {r.distPct >= 0 ? '+' : ''}{r.distPct.toFixed(2)}%
              </span>
              <span>
                {r.crossover === 'Bullish' && <span className="vs-signal-badge bullish">🟢 Bull Cross</span>}
                {r.crossover === 'Bearish' && <span className="vs-signal-badge bearish">🔴 Bear Cross</span>}
                {r.crossover === 'None' && r.position === 'Above' && <span className="vs-signal-badge above">↑ Above</span>}
                {r.crossover === 'None' && r.position === 'Below' && <span className="vs-signal-badge below">↓ Below</span>}
                {r.crossover === 'None' && r.position === 'At' && <span className="vs-signal-badge at">≈ At VWAP</span>}
              </span>
              <span className="vs-strength">
                <span className="vs-str-bar">
                  <span className="vs-str-fill" style={{
                    width: `${r.strength}%`,
                    background: r.strength >= 70 ? '#22c55e' : r.strength >= 40 ? '#f59e0b' : '#ef4444',
                  }} />
                </span>
                <span className="vs-str-val">{r.strength}</span>
              </span>
              <span className={`vs-vol ${r.volRatio >= 1.5 ? 'high' : r.volRatio < 0.7 ? 'low' : ''}`}>
                {r.volRatio.toFixed(1)}x
              </span>
            </div>
          ))}
        </div>
      )}

      {!scanning && results.length > 0 && sorted.length === 0 && (
        <div className="vs-empty"><p>No stocks match the current filter.</p></div>
      )}

      {!scanning && results.length === 0 && (
        <div className="vs-empty">
          <p>Click <b>Scan VWAP</b> to screen stocks by VWAP position and crossovers.</p>
          <p className="tp-note">
            Scans <b>{getUniverseLabel(market, universe)}</b> for bullish/bearish VWAP crossovers,
            price proximity to VWAP, and volume confirmation.
          </p>
          <div className="vs-legend">
            <div><span className="vs-signal-badge bullish">🟢 Bull Cross</span> Price crossed above VWAP — potential buy</div>
            <div><span className="vs-signal-badge bearish">🔴 Bear Cross</span> Price crossed below VWAP — potential sell</div>
            <div><span className="vs-signal-badge above">↑ Above</span> Trading above VWAP (bullish bias)</div>
            <div><span className="vs-signal-badge below">↓ Below</span> Trading below VWAP (bearish bias)</div>
            <div><span className="vs-signal-badge at">≈ At VWAP</span> Within 0.3% of VWAP (decision zone)</div>
          </div>
        </div>
      )}

      {lastScan && <div className="tp-footer">Last scanned at {lastScan} — {sorted.length} results</div>}
    </div>
  );
}
