import { useState, useCallback, useRef } from 'react';
import { Market, StockQuote } from '../types';
import { SymbolAutocomplete } from './SymbolAutocomplete';
import { fetchYahooHistorical } from '../services/stockApi';
import {
  STRATEGIES, StrategyId, HoldingPeriod,
  BacktestConfig, BacktestResult, runBacktest, precomputeIndicators,
} from '../services/backtestEngine';

interface Props {
  market: Market;
  currency: string;
  onSelectSymbol: (s: string) => void;
}

type BacktestDuration = '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL';
const DURATIONS: { id: BacktestDuration; label: string; days: number }[] = [
  { id: '1W', label: '1W', days: 7 },
  { id: '1M', label: '1M', days: 30 },
  { id: '3M', label: '3M', days: 90 },
  { id: '6M', label: '6M', days: 180 },
  { id: '1Y', label: '1Y', days: 365 },
  { id: '5Y', label: '5Y', days: 1825 },
  { id: 'ALL', label: 'All', days: Infinity },
];

function sliceByDuration(quotes: StockQuote[], dur: BacktestDuration): StockQuote[] {
  if (dur === 'ALL') return quotes;
  const days = DURATIONS.find(d => d.id === dur)!.days;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutStr = cutoff.toISOString().split('T')[0];
  const filtered = quotes.filter(q => q.timestamp >= cutStr);
  return filtered.length >= 30 ? filtered : quotes.slice(-Math.max(30, days));
}

const DEFAULT_CONFIG: Omit<BacktestConfig, 'strategy'> = {
  holdingPeriod: 'swing',
  initialCapital: 10000,
  riskPerTradePct: 2,
  stopLossPct: 5,
  takeProfitPct: 15,
  commissionPct: 0.1,
};

export function BacktestPanel({ market, currency }: Props) {
  const [symbol, setSymbol] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyId>('macd');
  const [holdingPeriod, setHoldingPeriod] = useState<HoldingPeriod>('swing');
  const [initialCapital, setInitialCapital] = useState(DEFAULT_CONFIG.initialCapital);
  const [riskPerTrade, setRiskPerTrade] = useState(DEFAULT_CONFIG.riskPerTradePct);
  const [stopLoss, setStopLoss] = useState(DEFAULT_CONFIG.stopLossPct);
  const [takeProfit, setTakeProfit] = useState(DEFAULT_CONFIG.takeProfitPct);
  const [commission, setCommission] = useState(DEFAULT_CONFIG.commissionPct);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [compareResults, setCompareResults] = useState<BacktestResult[]>([]);
  const [error, setError] = useState('');
  const [showTradeLog, setShowTradeLog] = useState(false);
  const [tradeLogPage, setTradeLogPage] = useState(0);
  const [duration, setDuration] = useState<BacktestDuration>('1Y');
  const quotesCache = useRef<{ sym: string; quotes: StockQuote[] } | null>(null);

  const cur = currency === 'INR' ? '₹' : '$';
  const TRADES_PER_PAGE = 20;

  const fetchData = useCallback(async (sym: string): Promise<StockQuote[]> => {
    if (quotesCache.current && quotesCache.current.sym === sym) return quotesCache.current.quotes;
    // Fetch max available data (all daily history)
    const bar = await fetchYahooHistorical(sym, market);
    const quotes = bar.quotes;
    if (!quotes || quotes.length < 250) throw new Error(`Need at least 250 bars. Got ${quotes?.length || 0} for ${sym}`);
    quotesCache.current = { sym, quotes };
    return quotes;
  }, [market]);

  const handleRun = useCallback(async () => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) { setError('Enter a symbol'); return; }
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const allQuotes = await fetchData(sym);
      const quotes = sliceByDuration(allQuotes, duration);
      const config: BacktestConfig = {
        strategy: selectedStrategy,
        holdingPeriod,
        initialCapital,
        riskPerTradePct: riskPerTrade,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
        commissionPct: commission,
      };
      const res = runBacktest(sym, quotes, config);
      setResult(res);
      setShowTradeLog(false);
      setTradeLogPage(0);
    } catch (e: any) {
      setError(e.message || 'Backtest failed');
    } finally {
      setRunning(false);
    }
  }, [symbol, selectedStrategy, holdingPeriod, duration, initialCapital, riskPerTrade, stopLoss, takeProfit, commission, fetchData]);

  const handleCompareAll = useCallback(async () => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) { setError('Enter a symbol'); return; }
    setRunning(true);
    setError('');
    setCompareResults([]);
    try {
      const allQuotes = await fetchData(sym);
      const quotes = sliceByDuration(allQuotes, duration);
      const cachedInd = precomputeIndicators(quotes); // compute once, reuse for all 14 strategies
      const results: BacktestResult[] = [];
      for (const strat of STRATEGIES) {
        const config: BacktestConfig = {
          strategy: strat.id,
          holdingPeriod,
          initialCapital,
          riskPerTradePct: riskPerTrade,
          stopLossPct: stopLoss,
          takeProfitPct: takeProfit,
          commissionPct: commission,
        };
        results.push(runBacktest(sym, quotes, config, cachedInd));
      }
      results.sort((a, b) => b.netProfitPct - a.netProfitPct);
      setCompareResults(results);
      setResult(null);
    } catch (e: any) {
      setError(e.message || 'Compare failed');
    } finally {
      setRunning(false);
    }
  }, [symbol, holdingPeriod, duration, initialCapital, riskPerTrade, stopLoss, takeProfit, commission, fetchData]);

  const stratDef = STRATEGIES.find(s => s.id === selectedStrategy)!;

  return (
    <div className="backtest-panel">
      {/* ── Config Card ─────────────────────────────── */}
      <div className="card backtest-config-card">
        <h3 className="card-title">🧪 Strategy Backtester</h3>
        <p className="card-subtitle">Test any strategy against historical data</p>

        <div className="bt-input-row">
          <label className="bt-label">Symbol</label>
          <SymbolAutocomplete
            value={symbol}
            onChange={setSymbol}
            onSelect={handleRun}
            placeholder={market === 'US' ? 'AAPL' : market === 'CRYPTO' ? 'BTC-USD' : 'RELIANCE.NS'}
            className="bt-input"
          />
        </div>

        <div className="bt-input-row">
          <label className="bt-label">Strategy</label>
          <select className="bt-select" value={selectedStrategy} onChange={e => setSelectedStrategy(e.target.value as StrategyId)}>
            <optgroup label="📊 Single Indicators">
              {STRATEGIES.filter(s => s.category === 'single').map(s => (
                <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>
              ))}
            </optgroup>
            <optgroup label="🔗 Combo Strategies">
              {STRATEGIES.filter(s => s.category === 'combo').map(s => (
                <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>
              ))}
            </optgroup>
            <optgroup label="🤖 Algo / ML">
              {STRATEGIES.filter(s => s.category === 'algo').map(s => (
                <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>
              ))}
            </optgroup>
          </select>
        </div>

        <div className="bt-desc">{stratDef.emoji} {stratDef.description}</div>

        <div className="bt-input-row">
          <label className="bt-label">Holding Period</label>
          <div className="bt-toggle-group">
            <button className={`bt-toggle ${holdingPeriod === 'swing' ? 'active' : ''}`}
              onClick={() => setHoldingPeriod('swing')}>🏄 Swing (≤20d)</button>
            <button className={`bt-toggle ${holdingPeriod === 'longterm' ? 'active' : ''}`}
              onClick={() => setHoldingPeriod('longterm')}>📈 Long Term</button>
          </div>
        </div>

        <div className="bt-input-row">
          <label className="bt-label">Test Period</label>
          <div className="bt-toggle-group bt-duration-group">
            {DURATIONS.map(d => (
              <button key={d.id} className={`bt-toggle bt-dur ${duration === d.id ? 'active' : ''}`}
                onClick={() => setDuration(d.id)}>{d.label}</button>
            ))}
          </div>
        </div>

        <div className="bt-params-grid">
          <div className="bt-param">
            <label>Capital ({cur})</label>
            <input type="number" value={initialCapital} onChange={e => setInitialCapital(Number(e.target.value))} min={1000} step={1000} />
          </div>
          <div className="bt-param">
            <label>Risk/Trade (%)</label>
            <input type="number" value={riskPerTrade} onChange={e => setRiskPerTrade(Number(e.target.value))} min={0.5} max={10} step={0.5} />
          </div>
          <div className="bt-param">
            <label>Stop Loss (%)</label>
            <input type="number" value={stopLoss} onChange={e => setStopLoss(Number(e.target.value))} min={1} max={20} step={0.5} />
          </div>
          <div className="bt-param">
            <label>Take Profit (%)</label>
            <input type="number" value={takeProfit} onChange={e => setTakeProfit(Number(e.target.value))} min={1} max={50} step={1} />
          </div>
          <div className="bt-param">
            <label>Commission (%)</label>
            <input type="number" value={commission} onChange={e => setCommission(Number(e.target.value))} min={0} max={1} step={0.01} />
          </div>
        </div>

        <div className="bt-actions">
          <button className="bt-run-btn" onClick={handleRun} disabled={running}>
            {running ? '⏳ Running...' : '▶️ Run Backtest'}
          </button>
          <button className="bt-compare-btn" onClick={handleCompareAll} disabled={running}>
            {running ? '⏳' : '📊'} Compare All Strategies
          </button>
        </div>

        {error && <div className="bt-error">⚠️ {error}</div>}
      </div>

      {/* ── Single Result ───────────────────────────── */}
      {result && <BacktestReport result={result} cur={cur} showTradeLog={showTradeLog}
        setShowTradeLog={setShowTradeLog} tradeLogPage={tradeLogPage}
        setTradeLogPage={setTradeLogPage} tradesPerPage={TRADES_PER_PAGE} />}

      {/* ── Compare All Table ───────────────────────── */}
      {compareResults.length > 0 && (
        <div className="card bt-compare-card">
          <h3 className="card-title">📊 Strategy Comparison — {compareResults[0].symbol}</h3>
          <p className="card-subtitle">{compareResults[0].dataRange} · {holdingPeriod === 'swing' ? 'Swing' : 'Long-Term'} · {cur}{initialCapital.toLocaleString()} capital</p>

          <div className="bt-compare-scroll">
            <table className="bt-compare-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Strategy</th>
                  <th>Net P/L</th>
                  <th>Win Rate</th>
                  <th>Profit Factor</th>
                  <th>Max DD</th>
                  <th>Sharpe</th>
                  <th>Trades</th>
                  <th>Avg Hold</th>
                </tr>
              </thead>
              <tbody>
                {compareResults.map((r, idx) => {
                  const isProfitable = r.netProfit > 0;
                  return (
                    <tr key={r.strategy.id} className={idx === 0 ? 'bt-best-row' : ''}>
                      <td>{idx + 1}</td>
                      <td>{r.strategy.emoji} {r.strategy.label}</td>
                      <td className={isProfitable ? 'green' : 'red'}>
                        {isProfitable ? '+' : ''}{r.netProfitPct.toFixed(1)}%
                      </td>
                      <td className={r.winRate >= 50 ? 'green' : 'red'}>{r.winRate.toFixed(1)}%</td>
                      <td className={r.profitFactor >= 1.5 ? 'green' : r.profitFactor >= 1 ? 'yellow' : 'red'}>
                        {r.profitFactor.toFixed(2)}
                      </td>
                      <td className={r.maxDrawdownPct <= 15 ? 'green' : 'red'}>
                        {r.maxDrawdownPct.toFixed(1)}%
                      </td>
                      <td className={r.sharpeRatio >= 1 ? 'green' : r.sharpeRatio >= 0 ? 'yellow' : 'red'}>
                        {r.sharpeRatio.toFixed(2)}
                      </td>
                      <td>{r.totalTrades}</td>
                      <td>{r.avgHoldingDays.toFixed(1)}d</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bt-compare-legend">
            <span className="green">● Meets target</span>
            <span className="yellow">● Borderline</span>
            <span className="red">● Below target</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Report sub-component ───────────────────────────────────────
function BacktestReport({ result, cur, showTradeLog, setShowTradeLog, tradeLogPage, setTradeLogPage, tradesPerPage }: {
  result: BacktestResult; cur: string;
  showTradeLog: boolean; setShowTradeLog: (v: boolean) => void;
  tradeLogPage: number; setTradeLogPage: (v: number) => void;
  tradesPerPage: number;
}) {
  const r = result;
  const isProfitable = r.netProfit > 0;
  const totalPages = Math.ceil(r.trades.length / tradesPerPage);
  const pageTrades = r.trades.slice(tradeLogPage * tradesPerPage, (tradeLogPage + 1) * tradesPerPage);

  // Mini equity curve using CSS (simple bar representation)
  const maxEq = Math.max(...r.equityCurve.map(e => e.equity));
  const minEq = Math.min(...r.equityCurve.map(e => e.equity));
  const eqRange = maxEq - minEq || 1;

  // Downsample equity curve for display (max ~80 points)
  const step = Math.max(1, Math.floor(r.equityCurve.length / 80));
  const sampledEq = r.equityCurve.filter((_, i) => i % step === 0);

  return (
    <div className="card bt-result-card">
      <div className="bt-result-header">
        <h3 className="card-title">
          {r.strategy.emoji} {r.strategy.label} — {r.symbol}
        </h3>
        <span className={`bt-verdict ${isProfitable ? 'profitable' : 'unprofitable'}`}>
          {isProfitable ? '✅ Profitable' : '❌ Unprofitable'}
        </span>
      </div>
      <p className="card-subtitle">
        {r.dataRange} · {r.holdingPeriod === 'swing' ? 'Swing Trade' : 'Long-Term'} · {r.totalBars} trading days
      </p>

      {/* ── Performance Summary Table ─────────────── */}
      <div className="bt-metrics-grid">
        <div className="bt-metric">
          <span className="bt-metric-label">Net P/L</span>
          <span className={`bt-metric-value ${isProfitable ? 'green' : 'red'}`}>
            {isProfitable ? '+' : ''}{cur}{r.netProfit.toLocaleString()} ({r.netProfitPct > 0 ? '+' : ''}{r.netProfitPct.toFixed(1)}%)
          </span>
        </div>
        <div className="bt-metric">
          <span className="bt-metric-label">Final Capital</span>
          <span className="bt-metric-value">{cur}{r.finalCapital.toLocaleString()}</span>
        </div>
        <div className="bt-metric">
          <span className="bt-metric-label">Total Trades</span>
          <span className="bt-metric-value">{r.totalTrades}</span>
        </div>
        <div className="bt-metric">
          <span className="bt-metric-label">Win Rate</span>
          <span className={`bt-metric-value ${r.winRate >= 50 ? 'green' : 'red'}`}>
            {r.winRate.toFixed(1)}% ({r.winningTrades}W / {r.losingTrades}L)
          </span>
          <div className="bt-bar-wrap">
            <div className="bt-bar-fill green-bg" style={{ width: `${r.winRate}%` }} />
          </div>
        </div>
        <div className="bt-metric">
          <span className="bt-metric-label">Profit Factor</span>
          <span className={`bt-metric-value ${r.profitFactor >= 1.75 ? 'green' : r.profitFactor >= 1 ? 'yellow' : 'red'}`}>
            {r.profitFactor >= 999 ? '∞' : r.profitFactor.toFixed(2)}
          </span>
          <span className="bt-metric-target">Target: &gt;1.75</span>
        </div>
        <div className="bt-metric">
          <span className="bt-metric-label">Max Drawdown</span>
          <span className={`bt-metric-value ${r.maxDrawdownPct <= 15 ? 'green' : 'red'}`}>
            {r.maxDrawdownPct.toFixed(1)}% ({cur}{r.maxDrawdown.toLocaleString()})
          </span>
          <span className="bt-metric-target">Target: &lt;15%</span>
        </div>
        <div className="bt-metric">
          <span className="bt-metric-label">Sharpe Ratio</span>
          <span className={`bt-metric-value ${r.sharpeRatio >= 2 ? 'green' : r.sharpeRatio >= 1 ? 'yellow' : 'red'}`}>
            {r.sharpeRatio.toFixed(2)}
          </span>
          <span className="bt-metric-target">Target: &gt;2.0</span>
        </div>
        <div className="bt-metric">
          <span className="bt-metric-label">Avg Win / Avg Loss</span>
          <span className="bt-metric-value">
            {cur}{r.avgWin.toFixed(2)} / {cur}{r.avgLoss.toFixed(2)}
          </span>
        </div>
        <div className="bt-metric">
          <span className="bt-metric-label">Avg Holding</span>
          <span className="bt-metric-value">{r.avgHoldingDays.toFixed(1)} days</span>
        </div>
        <div className="bt-metric">
          <span className="bt-metric-label">Streaks</span>
          <span className="bt-metric-value">
            <span className="green">▲{r.longestWinStreak}</span> / <span className="red">▼{r.longestLoseStreak}</span>
          </span>
        </div>
      </div>

      {/* ── Equity Curve ─────────────────────────────── */}
      <div className="bt-equity-section">
        <h4>📈 Equity Curve</h4>
        <div className="bt-equity-chart">
          {sampledEq.map((pt, i) => {
            const h = ((pt.equity - minEq) / eqRange) * 100;
            const isUp = pt.equity >= r.initialCapital;
            return (
              <div key={i} className="bt-eq-bar-wrap" title={`${pt.date.split('T')[0]}: ${cur}${pt.equity.toLocaleString()}`}>
                <div className={`bt-eq-bar ${isUp ? 'green-bg' : 'red-bg'}`} style={{ height: `${Math.max(2, h)}%` }} />
              </div>
            );
          })}
        </div>
        <div className="bt-equity-labels">
          <span>{cur}{minEq.toLocaleString()}</span>
          <span>{cur}{maxEq.toLocaleString()}</span>
        </div>
      </div>

      {/* ── Trade Log ────────────────────────────────── */}
      <div className="bt-trade-section">
        <button className="bt-toggle-log" onClick={() => setShowTradeLog(!showTradeLog)}>
          {showTradeLog ? '▼' : '▶'} Trade Log ({r.trades.length} trades)
        </button>

        {showTradeLog && (
          <>
            <div className="bt-trade-scroll">
              <table className="bt-trade-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>Type</th>
                    <th>Entry {cur}</th>
                    <th>Exit {cur}</th>
                    <th>P/L</th>
                    <th>Exit</th>
                    <th>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {pageTrades.map((t, idx) => (
                    <tr key={idx} className={t.pnl > 0 ? 'bt-win-row' : 'bt-lose-row'}>
                      <td>{tradeLogPage * tradesPerPage + idx + 1}</td>
                      <td>{t.entryDate.split('T')[0]}</td>
                      <td>{t.exitDate.split('T')[0]}</td>
                      <td className={t.type === 'Long' ? 'green' : 'red'}>{t.type}</td>
                      <td>{t.entryPrice.toFixed(2)}</td>
                      <td>{t.exitPrice.toFixed(2)}</td>
                      <td className={t.pnl > 0 ? 'green' : 'red'}>
                        {t.pnl > 0 ? '+' : ''}{cur}{t.pnl.toFixed(2)} ({t.pnlPct > 0 ? '+' : ''}{t.pnlPct.toFixed(1)}%)
                      </td>
                      <td><span className={`bt-exit-badge bt-exit-${t.exitReason.toLowerCase()}`}>{t.exitReason}</span></td>
                      <td>{t.holdingDays}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="bt-pagination">
                <button disabled={tradeLogPage === 0} onClick={() => setTradeLogPage(tradeLogPage - 1)}>← Prev</button>
                <span>Page {tradeLogPage + 1} / {totalPages}</span>
                <button disabled={tradeLogPage >= totalPages - 1} onClick={() => setTradeLogPage(tradeLogPage + 1)}>Next →</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Observations ─────────────────────────────── */}
      <div className="bt-observations">
        <h4>📋 Observations</h4>
        <ul>
          {r.totalTrades === 0 && <li>⚠️ No trades generated — strategy may not suit this asset or timeframe.</li>}
          {r.winRate >= 55 && <li>✅ Win rate above 55% — good signal accuracy.</li>}
          {r.winRate < 40 && r.totalTrades > 5 && <li>⚠️ Low win rate ({r.winRate.toFixed(0)}%) — consider adding filters to reduce false entries.</li>}
          {r.profitFactor >= 1.75 && <li>✅ Profit factor {r.profitFactor.toFixed(2)} exceeds 1.75 target.</li>}
          {r.profitFactor < 1 && r.totalTrades > 5 && <li>❌ Profit factor below 1.0 — strategy loses money on average.</li>}
          {r.maxDrawdownPct > 20 && <li>⚠️ Max drawdown {r.maxDrawdownPct.toFixed(1)}% is high — tighten risk or reduce position size.</li>}
          {r.maxDrawdownPct <= 10 && r.totalTrades > 5 && <li>✅ Max drawdown under 10% — excellent risk control.</li>}
          {r.sharpeRatio >= 2 && <li>✅ Sharpe ratio {r.sharpeRatio.toFixed(2)} is excellent (risk-adjusted returns).</li>}
          {r.sharpeRatio < 0.5 && r.totalTrades > 5 && <li>⚠️ Low Sharpe ratio — poor risk-adjusted returns.</li>}
          {r.avgHoldingDays > 15 && r.holdingPeriod === 'swing' && <li>💡 Avg hold {r.avgHoldingDays.toFixed(0)}d is long for swing — may want tighter exit rules.</li>}
          {r.longestLoseStreak >= 5 && <li>⚠️ Longest losing streak: {r.longestLoseStreak} trades — prepare for drawdowns.</li>}
          {r.avgWin > r.avgLoss * 2 && r.totalTrades > 5 && <li>✅ Avg win is {(r.avgWin / r.avgLoss).toFixed(1)}× avg loss — excellent risk/reward.</li>}
        </ul>
      </div>
    </div>
  );
}
