/**
 * KriVi's Stock Panel — Advanced multi-timeframe stock selection engine.
 * Uses 5m + 4H indicator alignment, hysteresis, cooldown, hard risk checks,
 * and trade diary logging.
 */
import { useState, useCallback, useRef } from 'react';
import { Market } from '../types';
import { getScanUniverse, ScanUniverse } from '../services/stockScanner';
import { fetchMultiTFData } from './services/multiTimeframeEngine';
import { generateKrivisSignal } from './services/signalEngine';
import { validateRisk, loadPortfolio } from './services/hardRiskValidator';
import { logToDiary, loadDiary, clearDiary, exportDiary, getDiaryStats } from './services/tradeDiary';
import type { KrivisSignal, DiaryEntry } from './types';

interface Props {
  market: Market;
  currency: string;
  onSelectSymbol: (s: string) => void;
}

export function KrivisStockPanel({ market, currency, onSelectSymbol }: Props) {
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<KrivisSignal[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [scanTime, setScanTime] = useState('');
  const [universe, setUniverse] = useState<ScanUniverse>('default');
  const [showDiary, setShowDiary] = useState(false);
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [error, setError] = useState('');
  const cancelRef = useRef(false);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError('');
    setResults([]);
    cancelRef.current = false;
    const symbols = getScanUniverse(market, universe);
    setProgress({ done: 0, total: symbols.length });

    const portfolio = loadPortfolio();
    const signals: KrivisSignal[] = [];
    const CONCURRENCY = 3;

    // Process in batches
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      if (cancelRef.current) break;
      const batch = symbols.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(async (sym) => {
          try {
            const mtf = await fetchMultiTFData(sym, market);
            let signal = generateKrivisSignal(mtf);
            signal = validateRisk(signal, portfolio);
            logToDiary(signal);
            return signal;
          } catch (err: any) {
            console.warn(`KriVi scan skip ${sym}:`, err.message);
            return null;
          }
        })
      );

      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value) {
          signals.push(r.value);
        }
      }
      setProgress({ done: Math.min(i + CONCURRENCY, symbols.length), total: symbols.length });
      // Small delay to avoid rate limiting
      if (i + CONCURRENCY < symbols.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // Sort by confidence descending, buys first
    signals.sort((a, b) => {
      const actionRank = (act: string) => act === 'buy' ? 0 : act === 'sell' ? 1 : 2;
      const ra = actionRank(a.action);
      const rb = actionRank(b.action);
      if (ra !== rb) return ra - rb;
      return b.confidence - a.confidence;
    });

    setResults(signals);
    setScanTime(new Date().toLocaleTimeString());
    setScanning(false);
  }, [market, universe]);

  const handleExport = () => {
    const data = exportDiary();
    const blob = new Blob([data], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `krivis-diary-${new Date().toISOString().split('T')[0]}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearDiary = () => {
    if (confirm('Clear all diary entries? This cannot be undone.')) {
      clearDiary();
      setDiary([]);
    }
  };

  const actionBadge = (action: string, blocked: boolean) => {
    if (blocked) return <span className="kv-badge kv-blocked">🚫 BLOCKED</span>;
    if (action === 'buy') return <span className="kv-badge kv-buy">🟢 BUY</span>;
    if (action === 'sell') return <span className="kv-badge kv-sell">🔴 SELL</span>;
    return <span className="kv-badge kv-hold">⚪ HOLD</span>;
  };

  const trendIcon = (trend: string) => {
    if (trend === 'bullish') return '🟢';
    if (trend === 'bearish') return '🔴';
    return '⚪';
  };

  const diaryStats = getDiaryStats();

  return (
    <div className="krivis-panel">
      {/* Header */}
      <div className="card krivis-header-card">
        <div className="krivis-title-row">
          <h2 className="krivis-title">🧠 KriVi's Stock Selection</h2>
          <span className="krivis-subtitle">Multi-TF Engine · Hysteresis · Hard Risk</span>
        </div>

        <div className="krivis-controls">
          <select
            value={universe}
            onChange={e => setUniverse(e.target.value as ScanUniverse)}
            className="krivis-select"
            disabled={scanning}
          >
            <option value="default">{market === 'US' ? 'Popular (30)' : market === 'CRYPTO' ? 'Top 20 Crypto' : 'Popular (30)'}</option>
            {market === 'US' && <option value="sp500">S&P 500 (100)</option>}
            {(market === 'NSE' || market === 'BSE') && <option value="nifty50">Nifty 50</option>}
            {market === 'CRYPTO' && <option value="crypto50">Top 50 Crypto</option>}
          </select>

          <button
            className="krivis-scan-btn"
            onClick={scanning ? () => { cancelRef.current = true; } : runScan}
            disabled={false}
          >
            {scanning ? '⏹ Stop' : '🔍 Scan'}
          </button>

          <button
            className="krivis-diary-btn"
            onClick={() => { setShowDiary(!showDiary); setDiary(loadDiary()); }}
          >
            📖 Diary ({diaryStats.total})
          </button>
        </div>

        {scanning && (
          <div className="krivis-progress">
            <div className="krivis-progress-bar">
              <div
                className="krivis-progress-fill"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            <span className="krivis-progress-text">{progress.done}/{progress.total}</span>
          </div>
        )}

        {error && <div className="krivis-error">{error}</div>}
      </div>

      {/* Pipeline badges */}
      <div className="card krivis-pipeline-card">
        <div className="krivis-pipeline">
          <span className="kv-pipe-step">📡 5m + 4H Data</span>
          <span className="kv-pipe-arrow">→</span>
          <span className="kv-pipe-step">📊 18 Indicators</span>
          <span className="kv-pipe-arrow">→</span>
          <span className="kv-pipe-step">🏗️ Structure Check</span>
          <span className="kv-pipe-arrow">→</span>
          <span className="kv-pipe-step">🧠 Signal + Hysteresis</span>
          <span className="kv-pipe-arrow">→</span>
          <span className="kv-pipe-step">🛡️ 6 Risk Checks</span>
          <span className="kv-pipe-arrow">→</span>
          <span className="kv-pipe-step">📖 Diary Log</span>
        </div>
      </div>

      {/* Results Table */}
      {results.length > 0 && (
        <div className="card krivis-results-card">
          <div className="krivis-results-header">
            <h3>Results ({results.length} stocks) {scanTime && <span className="krivis-scan-time">Scanned at {scanTime}</span>}</h3>
          </div>
          <div className="krivis-table-wrap">
            <table className="krivis-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Symbol</th>
                  <th>Signal</th>
                  <th>Confidence</th>
                  <th>Entry</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>4H</th>
                  <th>5m</th>
                  <th>Aligned</th>
                  <th>ADX</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, idx) => (
                  <tr
                    key={r.symbol}
                    className={`krivis-row ${r.riskBlocked ? 'kv-row-blocked' : ''}`}
                    onClick={() => onSelectSymbol(r.symbol)}
                    title={r.reasoning}
                  >
                    <td>{idx + 1}</td>
                    <td className="kv-sym">{r.symbol}</td>
                    <td>{actionBadge(r.action, r.riskBlocked)}</td>
                    <td>
                      <div className="kv-conf-bar">
                        <div
                          className={`kv-conf-fill ${r.action === 'buy' ? 'kv-green' : r.action === 'sell' ? 'kv-red' : 'kv-gray'}`}
                          style={{ width: `${r.confidence}%` }}
                        />
                        <span className="kv-conf-text">{r.confidence}%</span>
                      </div>
                    </td>
                    <td>{currency === 'INR' ? '₹' : '$'}{r.entryPrice.toFixed(2)}</td>
                    <td className="kv-sl">{currency === 'INR' ? '₹' : '$'}{r.stopLoss.toFixed(2)}</td>
                    <td className="kv-tp">{currency === 'INR' ? '₹' : '$'}{r.takeProfit.toFixed(2)}</td>
                    <td>{trendIcon(r.structure.trend4h)}</td>
                    <td>{trendIcon(r.structure.trend5m)}</td>
                    <td>{r.structure.aligned ? '✅' : '❌'}</td>
                    <td>{r.structure.trendStrength.toFixed(0)}</td>
                    <td>
                      {r.riskChecks.filter(c => !c.passed).length > 0
                        ? <span className="kv-risk-fail">❌ {r.riskChecks.filter(c => !c.passed).length}</span>
                        : <span className="kv-risk-pass">✅</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail panel for selected result — shows on row hover via tooltip (reasoning) */}

      {/* Diary Panel */}
      {showDiary && (
        <div className="card krivis-diary-card">
          <div className="krivis-diary-header">
            <h3>📖 Trade Diary</h3>
            <div className="krivis-diary-stats">
              <span className="kv-stat">🟢 {diaryStats.buys} buys</span>
              <span className="kv-stat">🔴 {diaryStats.sells} sells</span>
              <span className="kv-stat">⚪ {diaryStats.holds} holds</span>
              <span className="kv-stat">🚫 {diaryStats.blocked} blocked</span>
              <span className="kv-stat">📊 {diaryStats.symbols} symbols</span>
            </div>
            <div className="krivis-diary-actions">
              <button className="kv-btn-sm" onClick={handleExport}>📥 Export JSONL</button>
              <button className="kv-btn-sm kv-btn-danger" onClick={handleClearDiary}>🗑️ Clear</button>
            </div>
          </div>
          <div className="krivis-diary-list">
            {diary.slice(-50).reverse().map(entry => (
              <div
                key={entry.id}
                className={`krivis-diary-entry ${entry.riskBlocked ? 'kv-entry-blocked' : ''}`}
              >
                <div className="kv-diary-top">
                  <span className="kv-diary-sym" onClick={() => onSelectSymbol(entry.symbol)}>{entry.symbol}</span>
                  {actionBadge(entry.action, entry.riskBlocked)}
                  <span className="kv-diary-conf">{entry.confidence}%</span>
                  <span className="kv-diary-time">{new Date(entry.timestamp).toLocaleString()}</span>
                </div>
                <div className="kv-diary-detail">
                  <span>Entry: {currency === 'INR' ? '₹' : '$'}{entry.entryPrice.toFixed(2)}</span>
                  <span>SL: {currency === 'INR' ? '₹' : '$'}{entry.stopLoss.toFixed(2)}</span>
                  <span>TP: {currency === 'INR' ? '₹' : '$'}{entry.takeProfit.toFixed(2)}</span>
                  <span>4H: {entry.structure.trend4h} | 5m: {entry.structure.trend5m}</span>
                </div>
                {entry.riskBlocked && (
                  <div className="kv-diary-risk">
                    {entry.riskChecks.filter(c => !c.passed).map(c => (
                      <span key={c.check} className="kv-risk-tag">🚫 {c.check}: {c.reason}</span>
                    ))}
                  </div>
                )}
                <div className="kv-diary-reason">{entry.reasoning}</div>
              </div>
            ))}
            {diary.length === 0 && <p className="empty-text">No diary entries yet. Run a scan to start logging.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
