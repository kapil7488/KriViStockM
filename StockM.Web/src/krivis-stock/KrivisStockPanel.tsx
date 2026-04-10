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

/** Currency symbol helper */
const cs = (c: string) => c === 'INR' ? '₹' : '$';

export function KrivisStockPanel({ market, currency, onSelectSymbol }: Props) {
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<KrivisSignal[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [scanTime, setScanTime] = useState('');
  const [universe, setUniverse] = useState<ScanUniverse>('default');
  const [showDiary, setShowDiary] = useState(false);
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [error, setError] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
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
            {/* Common */}
            <option value="default">{market === 'US' ? 'Popular (30)' : market === 'CRYPTO' ? 'Top 20 Crypto' : 'Popular (30)'}</option>
            {market === 'US' && <option value="sp500">S&amp;P 500 (100)</option>}
            {(market === 'NSE' || market === 'BSE') && (
              <>
                <optgroup label="Index">
                  <option value="nifty50">Nifty 50</option>
                  <option value="banknifty">Bank Nifty (13)</option>
                </optgroup>
                <optgroup label="Sector">
                  <option value="psubank">PSU Banks (13)</option>
                  <option value="pharma">Pharma &amp; Healthcare (15)</option>
                  <option value="it">IT &amp; Software (15)</option>
                  <option value="steel">Steel &amp; Metals (13)</option>
                  <option value="auto">Auto &amp; Ancillary (15)</option>
                  <option value="fmcg">FMCG (15)</option>
                  <option value="energy">Energy &amp; Power (15)</option>
                  <option value="realty">Realty (13)</option>
                  <option value="defence">Defence &amp; Aerospace (13)</option>
                </optgroup>
                <optgroup label="Cap Size">
                  <option value="midcap">Midcap (20)</option>
                  <option value="smallcap">Smallcap (20)</option>
                </optgroup>
              </>
            )}
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
                  <th>Entry Zone</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>R:R</th>
                  <th>4H</th>
                  <th>5m</th>
                  <th>ADX</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, idx) => {
                  const rr = r.action !== 'hold' && r.stopLoss !== r.entryPrice
                    ? Math.abs((r.takeProfit - r.entryPrice) / (r.entryPrice - r.stopLoss))
                    : 0;
                  const isExpanded = expandedRow === r.symbol;
                  return (
                    <>
                      <tr
                        key={r.symbol}
                        className={`krivis-row ${r.riskBlocked ? 'kv-row-blocked' : ''} ${isExpanded ? 'kv-row-expanded' : ''}`}
                        onClick={() => setExpandedRow(isExpanded ? null : r.symbol)}
                        title="Click to expand entry/exit details"
                      >
                        <td>{idx + 1}</td>
                        <td className="kv-sym" onClick={(e) => { e.stopPropagation(); onSelectSymbol(r.symbol); }}>{r.symbol}</td>
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
                        <td className="kv-entry-zone">
                          <span className="kv-entry-range">{cs(currency)}{r.entryLow.toFixed(2)}</span>
                          <span className="kv-entry-dash">–</span>
                          <span className="kv-entry-range">{cs(currency)}{r.entryHigh.toFixed(2)}</span>
                        </td>
                        <td className="kv-sl">{cs(currency)}{r.stopLoss.toFixed(2)}</td>
                        <td className="kv-tp">{cs(currency)}{r.takeProfit.toFixed(2)}</td>
                        <td className={rr >= 2 ? 'kv-rr-good' : rr >= 1 ? 'kv-rr-ok' : 'kv-rr-bad'}>
                          {rr > 0 ? `1:${rr.toFixed(1)}` : '—'}
                        </td>
                        <td>{trendIcon(r.structure.trend4h)}</td>
                        <td>{trendIcon(r.structure.trend5m)}</td>
                        <td>{r.structure.trendStrength.toFixed(0)}</td>
                        <td>
                          {r.riskChecks.filter(c => !c.passed).length > 0
                            ? <span className="kv-risk-fail">❌ {r.riskChecks.filter(c => !c.passed).length}</span>
                            : <span className="kv-risk-pass">✅</span>
                          }
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${r.symbol}-detail`} className="kv-detail-row">
                          <td colSpan={12}>
                            <div className="kv-detail-grid">
                              <div className="kv-detail-section">
                                <div className="kv-detail-label">📍 Entry Zone</div>
                                <div className="kv-detail-value">
                                  {cs(currency)}{r.entryLow.toFixed(2)} – {cs(currency)}{r.entryHigh.toFixed(2)}
                                  <span className="kv-detail-sub"> (current: {cs(currency)}{r.entryPrice.toFixed(2)})</span>
                                </div>
                              </div>
                              <div className="kv-detail-section">
                                <div className="kv-detail-label">🛡️ Stop Loss</div>
                                <div className="kv-detail-value kv-sl">
                                  {cs(currency)}{r.stopLoss.toFixed(2)}
                                  <span className="kv-detail-sub"> ({((r.stopLoss / r.entryPrice - 1) * 100).toFixed(1)}%)</span>
                                </div>
                              </div>
                              <div className="kv-detail-section">
                                <div className="kv-detail-label">🎯 Take Profit</div>
                                <div className="kv-detail-value kv-tp">
                                  {cs(currency)}{r.takeProfit.toFixed(2)}
                                  <span className="kv-detail-sub"> ({r.action === 'buy' ? '+' : ''}{((r.takeProfit / r.entryPrice - 1) * 100).toFixed(1)}%)</span>
                                </div>
                              </div>
                              <div className="kv-detail-section">
                                <div className="kv-detail-label">📐 Risk : Reward</div>
                                <div className={`kv-detail-value ${rr >= 2 ? 'kv-rr-good' : 'kv-rr-ok'}`}>
                                  1 : {rr.toFixed(2)}
                                </div>
                              </div>
                              <div className="kv-detail-section kv-detail-wide">
                                <div className="kv-detail-label">🚪 Exit Plan</div>
                                <div className="kv-detail-value kv-detail-exit">{r.exitPlan}</div>
                              </div>
                              <div className="kv-detail-section kv-detail-wide">
                                <div className="kv-detail-label">🏗️ Structure</div>
                                <div className="kv-detail-value">
                                  4H: {trendIcon(r.structure.trend4h)} {r.structure.trend4h}
                                  {' · '}5m: {trendIcon(r.structure.trend5m)} {r.structure.trend5m}
                                  {' · '}ADX: {r.structure.trendStrength.toFixed(1)}
                                  {' · '}Aligned: {r.structure.aligned ? '✅' : '❌'}
                                  {r.structure.isBreakout && ' · ⚡ Breakout'}
                                  {' · '}S: {cs(currency)}{r.structure.supportLevel.toFixed(2)}
                                  {' · '}R: {cs(currency)}{r.structure.resistanceLevel.toFixed(2)}
                                </div>
                              </div>
                              <div className="kv-detail-section kv-detail-wide">
                                <div className="kv-detail-label">💡 Reasoning</div>
                                <div className="kv-detail-value kv-detail-reason">{r.reasoning}</div>
                              </div>
                              {r.riskChecks.length > 0 && (
                                <div className="kv-detail-section kv-detail-wide">
                                  <div className="kv-detail-label">🛡️ Risk Checks</div>
                                  <div className="kv-detail-value">
                                    {r.riskChecks.map(c => (
                                      <span key={c.check} className={c.passed ? 'kv-check-pass' : 'kv-check-fail'}>
                                        {c.passed ? '✅' : '❌'} {c.check}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
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
                  <span>Entry: {cs(currency)}{entry.entryPrice.toFixed(2)}</span>
                  <span>Zone: {cs(currency)}{(entry.entryLow || entry.entryPrice).toFixed(2)}–{cs(currency)}{(entry.entryHigh || entry.entryPrice).toFixed(2)}</span>
                  <span>SL: {cs(currency)}{entry.stopLoss.toFixed(2)}</span>
                  <span>TP: {cs(currency)}{entry.takeProfit.toFixed(2)}</span>
                </div>
                {entry.exitPlan && (
                  <div className="kv-diary-exit">🚪 {entry.exitPlan}</div>
                )}
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
