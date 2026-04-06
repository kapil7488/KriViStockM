import { useState } from 'react';

export function GuidePanel() {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="card guide-panel">
      <div className="guide-header" onClick={() => setExpanded(e => !e)}>
        <h3>📖 Quick Analysis Guide</h3>
        <span className="guide-toggle">{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div className="guide-content">
          {/* Step-by-step */}
          <div className="guide-section">
            <h4>🚀 How to Analyze a Stock</h4>
            <ol className="guide-steps">
              <li>
                <b>Pick a Market</b> — Click <code>🇺🇸 US</code>, <code>🇮🇳 NSE</code>, or <code>🇮🇳 BSE</code> in the header.
                Indian markets use a free live API (no key needed).
              </li>
              <li>
                <b>Enter a Symbol</b> — Type a ticker (e.g. <code>AAPL</code>, <code>RELIANCE</code>, <code>TCS</code>)
                or click any watchlist button.
              </li>
              <li>
                <b>Click ⚡ Analyze</b> — The engine runs a 7-feature H-BLSTM + XGBoost hybrid model
                and generates a Buy/Sell/Hold signal with entry, stop-loss, and take-profit levels.
              </li>
              <li>
                <b>Read the Chart</b> — Use the <b>timeline buttons</b> (1D → ALL) to zoom in/out.
                Use the <b>interval buttons</b> (1m, 5m, 15m, 1H, 4H, 1D) to change candle size.
                Toggle overlays (SMA, EMA, Bollinger, VWAP) and sub-charts (RSI, MACD, Stochastic, ATR).
              </li>
              <li>
                <b>Check Sidebar Tabs</b> — Switch between <b>Technical</b> (indicator gauges),
                <b>Fundamental</b> (P/E, EPS, margins, balance sheet), and <b>Risk</b> (position sizing, drawdown).
              </li>
            </ol>
          </div>

          {/* Which stock to pick */}
          <div className="guide-section">
            <h4>🎯 Which Stock to Pick & Why</h4>
            <div className="guide-criteria">
              <div className="criteria-card buy">
                <div className="criteria-title">✅ Strong Buy Signals</div>
                <ul>
                  <li>Model score &gt; 65% with <b>StrongBuy</b> signal</li>
                  <li>RSI between 30–50 (recovering from oversold)</li>
                  <li>MACD histogram turning positive (bullish crossover)</li>
                  <li>Price above SMA 50 &amp; SMA 200 (uptrend)</li>
                  <li>Volume increasing on up candles</li>
                </ul>
              </div>
              <div className="criteria-card caution">
                <div className="criteria-title">⚠️ Hold / Wait Signals</div>
                <ul>
                  <li>Model score 40–55% (neutral zone)</li>
                  <li>RSI 45–55 (no clear direction)</li>
                  <li>Price stuck between SMA 50 &amp; SMA 200</li>
                  <li>Declining volume (no conviction)</li>
                  <li>Bollinger bands tightening (squeeze — big move coming)</li>
                </ul>
              </div>
              <div className="criteria-card sell">
                <div className="criteria-title">🛑 Avoid / Sell Signals</div>
                <ul>
                  <li>Model score &lt; 35% with <b>StrongSell</b></li>
                  <li>RSI &gt; 70 (overbought)</li>
                  <li>MACD histogram turning negative</li>
                  <li>Price below SMA 200 (downtrend)</li>
                  <li>High ATR + falling price (volatile decline)</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Timeframe guide */}
          <div className="guide-section">
            <h4>⏱️ Timeframe Strategy</h4>
            <table className="guide-table">
              <thead>
                <tr><th>Style</th><th>Range</th><th>Interval</th><th>Key Indicators</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>Scalping</b></td>
                  <td>1D</td>
                  <td>1m – 5m</td>
                  <td>Stochastic, VWAP, Volume</td>
                </tr>
                <tr>
                  <td><b>Day Trading</b></td>
                  <td>1D – 1W</td>
                  <td>5m – 15m</td>
                  <td>MACD, RSI, EMA 12/26</td>
                </tr>
                <tr>
                  <td><b>Swing Trading</b></td>
                  <td>1M – 3M</td>
                  <td>1H – 4H</td>
                  <td>SMA 20/50, Bollinger, MACD</td>
                </tr>
                <tr>
                  <td><b>Position Trading</b></td>
                  <td>6M – 1Y</td>
                  <td>1D</td>
                  <td>SMA 50/200, RSI, ATR + Fundamentals</td>
                </tr>
                <tr>
                  <td><b>Long-Term Investing</b></td>
                  <td>1Y – 5Y</td>
                  <td>1D</td>
                  <td>SMA 200, P/E, EPS growth, ROE, Debt/Equity</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Fundamental checklist */}
          <div className="guide-section">
            <h4>📋 Fundamental Checklist</h4>
            <div className="guide-checklist">
              <div className="check-item good">✓ P/E ratio &lt; 25 (reasonably valued)</div>
              <div className="check-item good">✓ EPS growing year-over-year</div>
              <div className="check-item good">✓ Profit margin &gt; 10%</div>
              <div className="check-item good">✓ ROE &gt; 15% (efficient capital use)</div>
              <div className="check-item good">✓ Debt/Equity &lt; 1.0 (manageable leverage)</div>
              <div className="check-item good">✓ Revenue growing &gt; 5% YoY</div>
              <div className="check-item warn">△ Dividend yield &gt; 2% (bonus for income investors)</div>
              <div className="check-item warn">△ Sector in uptrend (Tech, AI, Renewables in 2026)</div>
            </div>
          </div>

          <div className="guide-footer">
            💡 <b>Pro Tip:</b> Always cross-check the Technical tab signal with the Fundamental tab data.
            A strong buy on technicals + solid fundamentals = high-conviction trade. Use the Risk tab
            to size your position (never risk more than 1–2% of portfolio per trade).
          </div>
        </div>
      )}
    </div>
  );
}
