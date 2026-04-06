import { RiskAssessment, StockSignal, SignalType } from '../types';

interface RiskPanelProps {
  risk: RiskAssessment;
  signal: StockSignal;
  currency: string;
}

export function RiskPanel({ risk, signal, currency }: RiskPanelProps) {
  return (
    <div className="card">
      <h3 className="card-title">🛡️ Risk Management</h3>
      <div className="indicator-grid">
        <div className="indicator-row">
          <span className="indicator-label">Shares</span>
          <span className="indicator-value">{risk.shareCount}</span>
        </div>
        <div className="indicator-row">
          <span className="indicator-label">Max Loss</span>
          <span className="indicator-value" style={{ color: '#ef4444' }}>-{currency}{risk.maxLoss.toFixed(2)}</span>
        </div>
        <div className="indicator-row">
          <span className="indicator-label">Max Gain</span>
          <span className="indicator-value" style={{ color: '#22c55e' }}>+{currency}{risk.maxGain.toFixed(2)}</span>
        </div>
        <div className="indicator-row">
          <span className="indicator-label">Risk/Reward</span>
          <span className="indicator-value" style={{ fontWeight: 700 }}>1:{risk.riskRewardRatio.toFixed(1)}</span>
        </div>
        {risk.volatilityAdjusted && (
          <div className="vol-warning">⚠️ Position reduced — high volatility detected</div>
        )}
      </div>
      <div className="reasoning">{signal.reasoning}</div>
    </div>
  );
}

interface HistoryPanelProps {
  signals: StockSignal[];
}

export function HistoryPanel({ signals }: HistoryPanelProps) {
  if (signals.length === 0) {
    return (
      <div className="card">
        <h3 className="card-title">📋 Signal History</h3>
        <p className="empty-text">No signals yet. Analyze a stock to begin.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="card-title">📋 Signal History</h3>
      <div className="history-list">
        {signals.map((s, i) => (
          <div key={i} className="history-item">
            <span className="history-symbol">{s.symbol}</span>
            <span className="history-signal" style={{ color: getSignalColor(s.signal) }}>{s.signal}</span>
            <span className="history-score" style={{ color: getScoreColor(s.modelScore) }}>
              {(s.modelScore * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getSignalColor(signal: SignalType): string {
  switch (signal) {
    case 'StrongBuy': return '#22c55e';
    case 'Buy': return '#84cc16';
    case 'Hold': return '#eab308';
    case 'Sell': return '#f97316';
    case 'StrongSell': return '#ef4444';
  }
}

function getScoreColor(score: number): string {
  if (score >= 0.65) return '#22c55e';
  if (score >= 0.55) return '#84cc16';
  if (score >= 0.45) return '#eab308';
  if (score >= 0.30) return '#f97316';
  return '#ef4444';
}
