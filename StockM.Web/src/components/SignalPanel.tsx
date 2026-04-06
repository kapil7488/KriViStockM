import { StockSignal } from '../types';
import { getSignalColor, getScoreColor } from './Header';

interface SignalPanelProps {
  signal: StockSignal;
  currency: string;
}

export function SignalPanel({ signal, currency }: SignalPanelProps) {
  return (
    <div className="signal-bar">
      <div className="algo-badge-row">
        <span className="algo-badge">Stacking Ensemble</span>
        <span className="algo-sep">×</span>
        <span className="algo-badge secondary">4-Model Meta-Learner</span>
      </div>

      {/* Model breakdown grid */}
      {signal.models && signal.models.length > 0 && (
        <div className="model-breakdown">
          {signal.models.map(m => (
            <div className="model-card" key={m.name}>
              <div className="model-card-header">
                <span className="model-card-name">{m.name}</span>
                <span className="model-card-signal" style={{ color: getSignalColor(m.signal) }}>{m.signal}</span>
              </div>
              <div className="model-card-score-row">
                <div className="model-card-bar-bg">
                  <div className="model-card-bar-fill" style={{ width: `${m.score * 100}%`, background: getScoreColor(m.score) }} />
                </div>
                <span className="model-card-pct" style={{ color: getScoreColor(m.score) }}>{(m.score * 100).toFixed(1)}%</span>
              </div>
              <div className="model-card-meta">
                <span>Weight: {(m.weight * 100).toFixed(0)}%</span>
                <span>Conf: {m.confidence}%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="signal-items-row">
        <div className="signal-item">
          <span className="signal-label">SIGNAL</span>
          <span className="signal-value" style={{ color: getSignalColor(signal.signal) }}>
            {signal.signal}
          </span>
        </div>
        <div className="signal-item">
          <span className="signal-label">MODEL SCORE</span>
          <span className="signal-value" style={{ color: getScoreColor(signal.modelScore) }}>
            {(signal.modelScore * 100).toFixed(1)}%
          </span>
        </div>
        <div className="signal-item">
          <span className="signal-label">ENTRY</span>
          <span className="signal-value">{currency}{signal.entryPrice.toFixed(2)}</span>
        </div>
        <div className="signal-item">
          <span className="signal-label">STOP LOSS</span>
          <span className="signal-value" style={{ color: '#ef4444' }}>{currency}{signal.stopLoss.toFixed(2)}</span>
        </div>
        <div className="signal-item">
          <span className="signal-label">TAKE PROFIT</span>
          <span className="signal-value" style={{ color: '#22c55e' }}>{currency}{signal.takeProfit.toFixed(2)}</span>
        </div>
        <div className="signal-item">
          <span className="signal-label">MODE</span>
          <span className="signal-value mode-badge">
            {signal.mode === 'RiskControl' ? '🛡️ Risk Control' : '📊 Normal'}
          </span>
        </div>
      </div>
    </div>
  );
}

interface IndicatorsPanelProps {
  signal: StockSignal;
  currency: string;
}

export function IndicatorsPanel({ signal, currency }: IndicatorsPanelProps) {
  const ind = signal.indicators;
  return (
    <div className="card">
      <h3 className="card-title">📊 Technical Summary</h3>
      <div className="algo-name-bar">
        <span className="algo-name-label">Algorithms Used:</span>
        <span className="algo-name-tag">SMA Crossover</span>
        <span className="algo-name-tag">RSI (Wilder)</span>
        <span className="algo-name-tag">Bollinger Bands</span>
        <span className="algo-name-tag">MACD (12/26/9)</span>
        <span className="algo-name-tag">Stochastic (14,3)</span>
        <span className="algo-name-tag">ATR (14)</span>
        <span className="algo-name-tag">VWAP</span>
      </div>

      {/* Gauge-style indicator */}
      <div className="tech-gauge">
        <div className="gauge-labels">
          <span className="gauge-sell">Strong Sell</span>
          <span className="gauge-neutral">Neutral</span>
          <span className="gauge-buy">Strong Buy</span>
        </div>
        <div className="gauge-bar">
          <div className="gauge-fill" style={{
            width: `${signal.modelScore * 100}%`,
            background: getScoreColor(signal.modelScore),
          }} />
          <div className="gauge-marker" style={{ left: `${signal.modelScore * 100}%` }} />
        </div>
      </div>

      {/* Moving Averages */}
      <div className="indicator-section">
        <h4 className="indicator-section-title">Moving Averages</h4>
        <div className="indicator-grid">
          <IndRow label="MA 30" value={`${currency}${ind.ma30.toFixed(2)}`} signal={ind.ma30 < signal.entryPrice ? 'buy' : 'sell'} />
          <IndRow label="MA 120" value={`${currency}${ind.ma120.toFixed(2)}`} signal={ind.ma120 < signal.entryPrice ? 'buy' : 'sell'} />
          <IndRow label="EMA 12" value={`${currency}${ind.ema12.toFixed(2)}`} signal={ind.ema12 < signal.entryPrice ? 'buy' : 'sell'} />
          <IndRow label="EMA 26" value={`${currency}${ind.ema26.toFixed(2)}`} signal={ind.ema26 < signal.entryPrice ? 'buy' : 'sell'} />
          <IndRow label="VWAP" value={`${currency}${ind.vwap.toFixed(2)}`} signal={ind.vwap < signal.entryPrice ? 'buy' : 'sell'} />
        </div>
      </div>

      {/* Oscillators */}
      <div className="indicator-section">
        <h4 className="indicator-section-title">Oscillators</h4>
        <div className="indicator-grid">
          <IndRow label="RSI (14)" value={ind.rsi.toFixed(1)}
            signal={ind.rsi < 30 ? 'buy' : ind.rsi > 70 ? 'sell' : 'neutral'} />
          <IndRow label="Stoch %K" value={ind.stochK.toFixed(1)}
            signal={ind.stochK < 20 ? 'buy' : ind.stochK > 80 ? 'sell' : 'neutral'} />
          <IndRow label="Stoch %D" value={ind.stochD.toFixed(1)}
            signal={ind.stochD < 20 ? 'buy' : ind.stochD > 80 ? 'sell' : 'neutral'} />
          <IndRow label="MACD" value={ind.macdLine.toFixed(3)}
            signal={ind.macdHistogram > 0 ? 'buy' : 'sell'} />
          <IndRow label="MACD Signal" value={ind.macdSignal.toFixed(3)}
            signal={ind.macdLine > ind.macdSignal ? 'buy' : 'sell'} />
        </div>
      </div>

      {/* Bands & Volatility */}
      <div className="indicator-section">
        <h4 className="indicator-section-title">Volatility & Bands</h4>
        <div className="indicator-grid">
          <IndRow label="BB Upper" value={`${currency}${ind.bollingerUpper.toFixed(2)}`} />
          <IndRow label="BB Middle" value={`${currency}${ind.bollingerMiddle.toFixed(2)}`} />
          <IndRow label="BB Lower" value={`${currency}${ind.bollingerLower.toFixed(2)}`} />
          <IndRow label="ATR (14)" value={`${currency}${ind.atr.toFixed(2)}`} />
          <IndRow label="52W High" value={`${currency}${ind.fiftyTwoWeekHigh.toFixed(2)}`} />
          <IndRow label="52W Low" value={`${currency}${ind.fiftyTwoWeekLow.toFixed(2)}`} />
        </div>
      </div>

      {/* MA Crossover Status */}
      <div className="crossover-badge" data-bullish={String(ind.maCrossoverBullish)}>
        MA Crossover: {ind.maCrossoverBullish ? '✅ Bullish (30 > 120)' : '❌ Bearish (30 < 120)'}
      </div>
    </div>
  );
}

function IndRow({ label, value, signal, color }: {
  label: string; value: string; signal?: 'buy' | 'sell' | 'neutral'; color?: string;
}) {
  const sigColor = signal === 'buy' ? '#22c55e' : signal === 'sell' ? '#ef4444' : '#94a3b8';
  const sigText = signal === 'buy' ? 'Buy' : signal === 'sell' ? 'Sell' : signal === 'neutral' ? 'Neutral' : '';

  return (
    <div className="indicator-row">
      <span className="indicator-label">{label}</span>
      <span className="indicator-value" style={color ? { color } : {}}>{value}</span>
      {sigText && <span className="indicator-signal" style={{ color: sigColor }}>{sigText}</span>}
    </div>
  );
}
