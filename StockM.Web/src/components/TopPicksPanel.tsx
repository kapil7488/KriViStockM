import { useState, useCallback } from 'react';
import { Market } from '../types';
import { ScanResult, ScanUniverse, scanTopStocks, getUniverseLabel } from '../services/stockScanner';
import { getSignalColor } from './Header';

interface TopPicksPanelProps {
  market: Market;
  currency: string;
  onSelectSymbol: (s: string) => void;
}

export function TopPicksPanel({ market, currency, onSelectSymbol }: TopPicksPanelProps) {
  const [results, setResults] = useState<ScanResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [limit, setLimit] = useState<10 | 20>(10);
  const [universe, setUniverse] = useState<ScanUniverse>('default');
  const [lastScan, setLastScan] = useState<string | null>(null);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setResults([]);
    setProgress({ done: 0, total: 0 });
    try {
      const res = await scanTopStocks(market, limit, (done, total) => {
        setProgress({ done, total });
      }, universe);
      setResults(res);
      setLastScan(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('[Scanner]', err);
    } finally {
      setScanning(false);
    }
  }, [market, limit, universe]);

  const sym = currency === 'INR' ? '₹' : '$';
  const isIndian = market === 'NSE' || market === 'BSE';

  return (
    <div className="card tp-card">
      <h3 className="card-title">🔥 Top Buy Picks — {market}</h3>

      {/* Universe selector */}
      <div className="tp-universe">
        <span className="tp-universe-label">Scan from:</span>
        <div className="tp-limit-toggle">
          <button
            className={`tp-limit-btn ${universe === 'default' ? 'active' : ''}`}
            onClick={() => setUniverse('default')}
            disabled={scanning}
          >
            {isIndian ? 'Popular (30)' : 'Popular (30)'}
          </button>
          <button
            className={`tp-limit-btn ${universe === (isIndian ? 'nifty50' : 'sp500') ? 'active' : ''}`}
            onClick={() => setUniverse(isIndian ? 'nifty50' : 'sp500')}
            disabled={scanning}
          >
            {isIndian ? 'Nifty 50' : 'S&P 500 (100)'}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="tp-controls">
        <div className="tp-limit-toggle">
          <button
            className={`tp-limit-btn ${limit === 10 ? 'active' : ''}`}
            onClick={() => setLimit(10)}
            disabled={scanning}
          >
            Top 10
          </button>
          <button
            className={`tp-limit-btn ${limit === 20 ? 'active' : ''}`}
            onClick={() => setLimit(20)}
            disabled={scanning}
          >
            Top 20
          </button>
        </div>
        <button className="tp-scan-btn" onClick={handleScan} disabled={scanning}>
          {scanning ? `Scanning... ${progress.done}/${progress.total}` : '🔍 Scan Stocks'}
        </button>
      </div>

      {/* Progress bar */}
      {scanning && progress.total > 0 && (
        <div className="tp-progress-bar">
          <div
            className="tp-progress-fill"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="tp-results">
          <div className="tp-results-header">
            <span>#</span>
            <span>Symbol</span>
            <span>Score</span>
            <span>Signal</span>
            <span>Price</span>
            <span>Change</span>
          </div>
          {results.map((r, i) => (
            <div
              key={r.symbol}
              className="tp-result-row"
              onClick={() => onSelectSymbol(r.symbol)}
              title={r.signal.reasoning}
            >
              <span className="tp-rank">{i + 1}</span>
              <span className="tp-sym">{r.symbol}</span>
              <span className="tp-cell-score">
                <span className="tp-score-bar">
                  <span
                    className="tp-score-fill"
                    style={{
                      width: `${r.signal.modelScore * 100}%`,
                      background: getSignalColor(r.signal.signal),
                    }}
                  />
                </span>
                <span className="tp-score-val">{(r.signal.modelScore * 100).toFixed(1)}%</span>
              </span>
              <span>
                <span
                  className="tp-signal-badge"
                  style={{ background: getSignalColor(r.signal.signal) + '22', color: getSignalColor(r.signal.signal) }}
                >
                  {r.signal.signal}
                </span>
              </span>
              <span className="tp-cell-price">{sym}{r.price.toFixed(2)}</span>
              <span className={`tp-cell-change ${r.change >= 0 ? 'up' : 'down'}`}>
                {r.change >= 0 ? '+' : ''}{r.change.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!scanning && results.length === 0 && (
        <div className="tp-empty">
          <p>Click <b>Scan Stocks</b> to find the top {limit} stocks with the highest buy scores.</p>
          <p className="tp-note">
            Currently set to scan <b>{getUniverseLabel(market, universe)}</b> using
            the H-BLSTM + XGBoost scoring engine on 2 years of daily data.
          </p>
        </div>
      )}

      {lastScan && (
        <div className="tp-footer">Last scanned at {lastScan}</div>
      )}
    </div>
  );
}
