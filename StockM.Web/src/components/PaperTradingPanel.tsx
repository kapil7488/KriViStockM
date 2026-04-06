import { useState, useCallback, useEffect } from 'react';
import {
  PaperPortfolio, Market, LiveQuote, StockSignal,
} from '../types';
import {
  loadPortfolio, executeTrade, resetPortfolio, calculatePortfolioValue,
  getMarketPositions, getMarketTrades, getPosition,
} from '../services/paperTrading';

/* ─── helpers ─── */

function pctColor(v: number): string {
  return v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#94a3b8';
}

function actionColor(a: string): string {
  return a === 'BUY' ? '#22c55e' : '#ef4444';
}

function modeLabel(m: string): string {
  return m === 'algo' ? '🤖 Algo' : '👤 Self';
}

/* ─── main component ─── */

interface PaperTradingPanelProps {
  market: Market;
  symbol: string;
  liveQuote: LiveQuote | null;
  signal: StockSignal | null;
  watchlistQuotes: LiveQuote[];
  currency: string;
  onSelectSymbol: (s: string) => void;
}

export function PaperTradingPanel({
  market, symbol, liveQuote, signal, watchlistQuotes, currency: _currency, onSelectSymbol,
}: PaperTradingPanelProps) {
  const [portfolio, setPortfolio] = useState<PaperPortfolio>(loadPortfolio);
  const [quantity, setQuantity] = useState(10);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Refresh portfolio from localStorage on market change
  useEffect(() => setPortfolio(loadPortfolio()), [market]);

  // Build a price map from watchlist + current live quote
  const priceMap: Record<string, number> = {};
  watchlistQuotes.forEach(q => { priceMap[q.symbol] = q.lastPrice; });
  if (liveQuote) priceMap[liveQuote.symbol] = liveQuote.lastPrice;
  // Also include positions' avgCost as fallback
  portfolio.positions.forEach(p => { if (!priceMap[p.symbol]) priceMap[p.symbol] = p.avgCost; });

  const pv = calculatePortfolioValue(portfolio, market, priceMap);
  const positions = getMarketPositions(portfolio, market);
  const trades = getMarketTrades(portfolio, market);
  const currentPos = symbol ? getPosition(portfolio, symbol, market) : undefined;
  const currentPrice = liveQuote?.lastPrice ?? 0;
  const sym = market === 'US' ? '$' : '₹';

  const doTrade = useCallback((action: 'BUY' | 'SELL', mode: 'algo' | 'self') => {
    if (!currentPrice || currentPrice <= 0) {
      setFeedback({ ok: false, msg: 'No live price available. Analyze the stock first.' });
      return;
    }
    const result = executeTrade(action, symbol, quantity, currentPrice, market, mode, signal?.signal);
    setPortfolio(result.portfolio);
    setFeedback({ ok: result.success, msg: result.message });
    setTimeout(() => setFeedback(null), 4000);
  }, [symbol, quantity, currentPrice, market, signal]);

  const handleAlgoBuy = useCallback(() => {
    if (!signal) { setFeedback({ ok: false, msg: 'Analyze a stock first to get an algo signal.' }); return; }
    // Algo determines quantity based on position sizing
    const algoQty = Math.max(1, Math.floor((pv.cash * (signal.positionSizePct / 100)) / currentPrice));
    if (!currentPrice) { setFeedback({ ok: false, msg: 'No live price.' }); return; }
    const result = executeTrade('BUY', symbol, algoQty, currentPrice, market, 'algo', signal.signal);
    setPortfolio(result.portfolio);
    setFeedback({ ok: result.success, msg: `[Algo ${signal.signal}] ${result.message} (${algoQty} shares, ${signal.positionSizePct.toFixed(1)}% of portfolio)` });
    setTimeout(() => setFeedback(null), 5000);
  }, [signal, symbol, currentPrice, market, pv.cash]);

  const handleAlgoSell = useCallback(() => {
    if (!currentPos) { setFeedback({ ok: false, msg: `No ${symbol} shares to sell.` }); return; }
    if (!currentPrice) { setFeedback({ ok: false, msg: 'No live price.' }); return; }
    const result = executeTrade('SELL', symbol, currentPos.quantity, currentPrice, market, 'algo', signal?.signal);
    setPortfolio(result.portfolio);
    setFeedback({ ok: result.success, msg: `[Algo] ${result.message}` });
    setTimeout(() => setFeedback(null), 5000);
  }, [currentPos, symbol, currentPrice, market, signal]);

  const handleReset = useCallback(() => {
    if (confirm('Reset paper portfolio? All positions and history will be cleared.')) {
      setPortfolio(resetPortfolio());
      setFeedback({ ok: true, msg: 'Portfolio reset to starting balance.' });
      setTimeout(() => setFeedback(null), 3000);
    }
  }, []);

  return (
    <div className="card pt-card">
      <h3 className="card-title">💰 Paper Trading</h3>

      {/* ── Portfolio Summary ── */}
      <div className="pt-summary">
        <div className="pt-summary-row main">
          <span>Total Value</span>
          <span className="pt-value">{sym}{pv.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="pt-summary-row">
          <span>Cash Available</span>
          <span>{sym}{pv.cash.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="pt-summary-row">
          <span>Holdings Value</span>
          <span>{sym}{pv.holdings.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="pt-summary-row">
          <span>P&L</span>
          <span style={{ color: pctColor(pv.pnl), fontWeight: 700 }}>
            {pv.pnl >= 0 ? '+' : ''}{sym}{pv.pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            {' '}({pv.pnlPct >= 0 ? '+' : ''}{pv.pnlPct.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* ── Trade Panel ── */}
      {currentPrice > 0 && (
        <div className="pt-trade-section">
          <div className="pt-trade-header">
            <span className="pt-trade-symbol">{symbol}</span>
            <span className="pt-trade-price">{sym}{currentPrice.toFixed(2)}</span>
            {currentPos && (
              <span className="pt-holding-badge">
                Holding: {currentPos.quantity} @ {sym}{currentPos.avgCost.toFixed(2)}
              </span>
            )}
          </div>

          {/* Self-directed trading */}
          <div className="pt-mode-section">
            <div className="pt-mode-label">👤 Self-Directed</div>
            <div className="pt-trade-controls">
              <label className="pt-qty-label">
                Qty
                <input
                  type="number"
                  className="pt-qty-input"
                  value={quantity}
                  min={1}
                  onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </label>
              <span className="pt-cost-preview">
                = {sym}{(quantity * currentPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              <button className="pt-btn buy" onClick={() => doTrade('BUY', 'self')}>Buy</button>
              <button className="pt-btn sell" onClick={() => doTrade('SELL', 'self')}
                disabled={!currentPos || currentPos.quantity < quantity}>
                Sell
              </button>
            </div>
          </div>

          {/* Algo-driven trading */}
          <div className="pt-mode-section">
            <div className="pt-mode-label">🤖 Algo-Driven</div>
            {signal ? (
              <div className="pt-algo-info">
                <span className="pt-algo-signal" style={{
                  color: signal.signal.includes('Buy') ? '#22c55e' : signal.signal.includes('Sell') ? '#ef4444' : '#eab308'
                }}>
                  Signal: {signal.signal} ({(signal.modelScore * 100).toFixed(1)}%)
                </span>
                <span className="pt-algo-detail">
                  Size: {signal.positionSizePct.toFixed(1)}% • SL: {sym}{signal.stopLoss.toFixed(2)} • TP: {sym}{signal.takeProfit.toFixed(2)}
                </span>
                <div className="pt-algo-buttons">
                  <button className="pt-btn algo-buy" onClick={handleAlgoBuy}
                    disabled={signal.signal === 'Sell' || signal.signal === 'StrongSell'}>
                    🤖 Algo Buy
                  </button>
                  <button className="pt-btn algo-sell" onClick={handleAlgoSell}
                    disabled={!currentPos}>
                    🤖 Algo Sell All
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-algo-info">
                <span className="pt-empty-text">Analyze a stock to get algo signals</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Feedback ── */}
      {feedback && (
        <div className={`pt-feedback ${feedback.ok ? 'success' : 'error'}`}>
          {feedback.msg}
        </div>
      )}

      {/* ── Open Positions ── */}
      {positions.length > 0 && (
        <div className="pt-section">
          <h4 className="pt-section-title">📂 Open Positions ({market})</h4>
          <div className="pt-positions">
            {positions.map(pos => {
              const curPrice = priceMap[pos.symbol] ?? pos.avgCost;
              const posValue = pos.quantity * curPrice;
              const posProfit = posValue - pos.totalCost;
              const posPct = pos.totalCost > 0 ? (posProfit / pos.totalCost) * 100 : 0;
              return (
                <div key={pos.symbol} className="pt-pos-row" onClick={() => onSelectSymbol(pos.symbol)}>
                  <div className="pt-pos-left">
                    <span className="pt-pos-symbol">{pos.symbol}</span>
                    <span className="pt-pos-detail">{pos.quantity} shares @ {sym}{pos.avgCost.toFixed(2)}</span>
                  </div>
                  <div className="pt-pos-right">
                    <span className="pt-pos-value">{sym}{posValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    <span className="pt-pos-pnl" style={{ color: pctColor(posProfit) }}>
                      {posProfit >= 0 ? '+' : ''}{sym}{posProfit.toFixed(2)} ({posPct >= 0 ? '+' : ''}{posPct.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Trade History ── */}
      <div className="pt-section">
        <div className="pt-history-header" onClick={() => setShowHistory(!showHistory)}>
          <h4 className="pt-section-title">📜 Trade History ({trades.length})</h4>
          <span className="pt-toggle">{showHistory ? '▲' : '▼'}</span>
        </div>
        {showHistory && trades.length > 0 && (
          <div className="pt-trades-list">
            {trades.slice(0, 50).map(t => (
              <div key={t.id} className="pt-trade-row">
                <div className="pt-trade-left">
                  <span style={{ color: actionColor(t.action), fontWeight: 700 }}>{t.action}</span>
                  <span className="pt-trade-sym">{t.symbol}</span>
                  <span className="pt-trade-mode">{modeLabel(t.mode)}</span>
                </div>
                <div className="pt-trade-mid">
                  {t.quantity} × {sym}{t.price.toFixed(2)}
                </div>
                <div className="pt-trade-right">
                  <span>{sym}{t.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  <span className="pt-trade-time">{new Date(t.timestamp).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {showHistory && trades.length === 0 && (
          <p className="pt-empty-text">No trades yet. Start trading!</p>
        )}
      </div>

      {/* ── Reset ── */}
      <button className="pt-reset-btn" onClick={handleReset}>
        🔄 Reset Portfolio
      </button>
    </div>
  );
}
