import { useState, useMemo } from 'react';
import {
  MomentumData, DividendInfo, CapitalStructure, RiskMetrics, PeerStock,
  LetterGrade, QuantRatingType, SAStyleData, StockSignal, MasterSignalData, TradePlan,
} from '../types';
import { generateMasterSignal, generateTradePlan } from '../services/scoringEngine';
import type { MLPrediction } from '../services/scoringEngine';

/* ===================== helpers ===================== */

function ratingColor(r: QuantRatingType): string {
  switch (r) {
    case 'Strong Buy': return '#22c55e';
    case 'Buy': return '#4ade80';
    case 'Hold': return '#eab308';
    case 'Sell': return '#f97316';
    case 'Strong Sell': return '#ef4444';
  }
}

function gradeColor(g: LetterGrade): string {
  if (g.startsWith('A')) return '#22c55e';
  if (g.startsWith('B')) return '#4ade80';
  if (g.startsWith('C')) return '#eab308';
  if (g.startsWith('D')) return '#f97316';
  return '#ef4444';
}

function gradeBg(g: LetterGrade): string {
  if (g.startsWith('A')) return 'rgba(34,197,94,0.15)';
  if (g.startsWith('B')) return 'rgba(74,222,128,0.12)';
  if (g.startsWith('C')) return 'rgba(234,179,8,0.12)';
  if (g.startsWith('D')) return 'rgba(249,115,22,0.12)';
  return 'rgba(239,68,68,0.12)';
}

function pctColor(v: number): string {
  return v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#94a3b8';
}

function fmt(n: number, prefix = ''): string {
  if (Math.abs(n) >= 1e12) return `${prefix}${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `${prefix}${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${prefix}${(n / 1e6).toFixed(2)}M`;
  return `${prefix}${n.toLocaleString()}`;
}

/* ===================== Ratings Summary ===================== */

function RatingsBar({ label, rating }: { label: string; rating: QuantRatingType }) {
  const positions: Record<QuantRatingType, number> = {
    'Strong Sell': 0, 'Sell': 1, 'Hold': 2, 'Buy': 3, 'Strong Buy': 4,
  };
  const pos = positions[rating];
  return (
    <div className="sa-ratings-row">
      <span className="sa-ratings-label">{label}</span>
      <div className="sa-ratings-bar">
        {['Strong\nSell', 'Sell', 'Hold', 'Buy', 'Strong\nBuy'].map((t, i) => (
          <div key={i}
            className={`sa-bar-segment ${i === pos ? 'active' : ''}`}
            style={i === pos ? {
              background: ratingColor(rating),
              color: '#000',
              fontWeight: 700,
            } : {}}
          >
            {t.split('\n').map((line, j) => <span key={j}>{line}</span>)}
          </div>
        ))}
      </div>
      <span className="sa-ratings-value" style={{ color: ratingColor(rating) }}>{rating}</span>
    </div>
  );
}

/* ===================== Factor Grade Badge ===================== */

function GradeBadge({ label, grade, detail }: { label: string; grade: LetterGrade; detail?: string }) {
  return (
    <div className="sa-grade-row">
      <span className="sa-grade-label">{label}</span>
      {detail && <span className="sa-grade-detail">{detail}</span>}
      <span className="sa-grade-badge" style={{ background: gradeBg(grade), color: gradeColor(grade), borderColor: gradeColor(grade) }}>
        {grade}
      </span>
    </div>
  );
}

/* ===================== Momentum ===================== */

function MomentumSection({ data, currency }: { data: MomentumData; currency: string }) {
  return (
    <div className="sa-section">
      <h4 className="sa-section-title">📈 Momentum</h4>
      <div className="sa-momentum-table">
        <div className="sa-mt-header">
          <span />
          <span>1W</span><span>1M</span><span>6M</span><span>1Y</span>
        </div>
        <div className="sa-mt-row">
          <span className="sa-mt-label">Stock</span>
          <span style={{ color: pctColor(data.return1W) }}>{data.return1W.toFixed(2)}%</span>
          <span style={{ color: pctColor(data.return1M) }}>{data.return1M.toFixed(2)}%</span>
          <span style={{ color: pctColor(data.return6M) }}>{data.return6M.toFixed(2)}%</span>
          <span style={{ color: pctColor(data.return1Y) }}>{data.return1Y.toFixed(2)}%</span>
        </div>
        <div className="sa-mt-row muted">
          <span className="sa-mt-label">S&P 500</span>
          <span>{data.sp500Return1W.toFixed(2)}%</span>
          <span>{data.sp500Return1M.toFixed(2)}%</span>
          <span>{data.sp500Return6M.toFixed(2)}%</span>
          <span>{data.sp500Return1Y.toFixed(2)}%</span>
        </div>
      </div>
      <div className="sa-technicals-grid">
        <div className="sa-tech-row">
          <span>SMA 20</span>
          <span>{currency}{data.sma20.toFixed(2)}</span>
          <span style={{ color: pctColor(data.priceVsSma20) }}>{data.priceVsSma20 > 0 ? '+' : ''}{data.priceVsSma20.toFixed(2)}%</span>
        </div>
        <div className="sa-tech-row">
          <span>SMA 50</span>
          <span>{currency}{data.sma50.toFixed(2)}</span>
          <span style={{ color: pctColor(data.priceVsSma50) }}>{data.priceVsSma50 > 0 ? '+' : ''}{data.priceVsSma50.toFixed(2)}%</span>
        </div>
        <div className="sa-tech-row">
          <span>SMA 200</span>
          <span>{currency}{data.sma200.toFixed(2)}</span>
          <span style={{ color: pctColor(data.priceVsSma200) }}>{data.priceVsSma200 > 0 ? '+' : ''}{data.priceVsSma200.toFixed(2)}%</span>
        </div>
      </div>
    </div>
  );
}

/* ===================== Dividends ===================== */

function DividendSection({ data, currency }: { data: DividendInfo; currency: string }) {
  if (data.yieldFwd <= 0) {
    return (
      <div className="sa-section">
        <h4 className="sa-section-title">💰 Dividends</h4>
        <p className="sa-empty-text">This stock does not currently pay a dividend.</p>
      </div>
    );
  }
  return (
    <div className="sa-section">
      <h4 className="sa-section-title">💰 Dividends</h4>
      <div className="sa-kv-grid">
        <div className="sa-kv"><span>Yield (FWD)</span><span>{data.yieldFwd.toFixed(2)}%</span></div>
        <div className="sa-kv"><span>Annual Payout</span><span>{currency}{data.annualPayout.toFixed(2)}</span></div>
        <div className="sa-kv"><span>Payout Ratio</span><span>{data.payoutRatio.toFixed(1)}%</span></div>
        <div className="sa-kv"><span>5Y Growth (CAGR)</span><span>{data.growthRate5Y.toFixed(2)}%</span></div>
        <div className="sa-kv"><span>Years of Growth</span><span>{data.yearsOfGrowth}</span></div>
        <div className="sa-kv"><span>Ex-Div Date</span><span>{data.exDividendDate}</span></div>
        <div className="sa-kv"><span>Frequency</span><span>{data.frequency}</span></div>
      </div>
    </div>
  );
}

/* ===================== Capital Structure ===================== */

function CapitalStructureSection({ data, currency }: { data: CapitalStructure; currency: string }) {
  return (
    <div className="sa-section">
      <h4 className="sa-section-title">🏛️ Capital Structure</h4>
      <div className="sa-kv-grid">
        <div className="sa-kv"><span>Market Cap</span><span>{fmt(data.marketCapNum, currency === 'INR' ? '₹' : '$')}</span></div>
        <div className="sa-kv"><span>Total Debt</span><span>{fmt(data.totalDebt, currency === 'INR' ? '₹' : '$')}</span></div>
        <div className="sa-kv"><span>Cash</span><span>{fmt(data.cash, currency === 'INR' ? '₹' : '$')}</span></div>
        <div className="sa-kv"><span>Enterprise Value</span><span>{fmt(data.enterpriseValue, currency === 'INR' ? '₹' : '$')}</span></div>
      </div>
    </div>
  );
}

/* ===================== Risk ===================== */

function RiskSection({ data }: { data: RiskMetrics }) {
  const zColor = data.altmanZScore > 3 ? '#22c55e' : data.altmanZScore > 1.8 ? '#eab308' : '#ef4444';
  const zLabel = data.altmanZScore > 3 ? 'Safe' : data.altmanZScore > 1.8 ? 'Grey Zone' : 'Distress';
  return (
    <div className="sa-section">
      <h4 className="sa-section-title">⚠️ Risk</h4>
      <div className="sa-kv-grid">
        <div className="sa-kv"><span>Short Interest</span><span>{data.shortInterest.toFixed(2)}%</span></div>
        <div className="sa-kv"><span>24M Beta</span><span>{data.beta.toFixed(2)}</span></div>
        <div className="sa-kv">
          <span>Altman Z Score</span>
          <span style={{ color: zColor }}>{data.altmanZScore.toFixed(2)} ({zLabel})</span>
        </div>
      </div>
    </div>
  );
}

/* ===================== Peers ===================== */

function PeersSection({ peers, onSelect }: { peers: PeerStock[]; onSelect?: (sym: string) => void }) {
  if (peers.length === 0) return null;
  return (
    <div className="sa-section">
      <h4 className="sa-section-title">👥 People Also Follow</h4>
      <div className="sa-peers-list">
        {peers.map(p => (
          <div key={p.symbol} className="sa-peer-row" onClick={() => onSelect?.(p.symbol)}>
            <div className="sa-peer-info">
              <span className="sa-peer-symbol">{p.symbol}</span>
              <span className="sa-peer-name">{p.name}</span>
            </div>
            <div className="sa-peer-price">
              <span>{p.price > 0 ? `$${p.price.toFixed(2)}` : '—'}</span>
              {p.changePercent !== 0 && (
                <span className={`sa-peer-change ${p.changePercent >= 0 ? 'up' : 'down'}`}>
                  {p.changePercent >= 0 ? '+' : ''}{p.changePercent.toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===================== Algo Trading Master Signal ===================== */

function AlgoTradingSection({ master, signal, currency }: { master: MasterSignalData; signal: StockSignal; currency: string }) {
  const cs = currency === 'INR' ? '₹' : '$';

  const convictionColors: Record<string, string> = {
    'Very Strong': '#22c55e', 'Strong': '#4ade80', 'Moderate': '#eab308', 'Weak': '#94a3b8',
  };
  const riskColors: Record<string, string> = {
    'Low': '#22c55e', 'Medium': '#eab308', 'High': '#ef4444',
  };

  return (
    <div className="sa-section algo-master-section">
      <h4 className="sa-section-title">🤖 Algo Trading — Master Signal</h4>

      {/* ── Big Decision Badge ── */}
      <div className="algo-decision-card" style={{ borderColor: master.color }}>
        <div className="algo-decision-row">
          <span className="algo-decision-emoji">{master.emoji}</span>
          <div className="algo-decision-text">
            <span className="algo-decision-label" style={{ color: master.color }}>{master.recommendation}</span>
            <span className="algo-decision-conf">System Confidence: <b>{master.confidence}%</b></span>
          </div>
          <div className="algo-decision-meter">
            <div className="algo-meter-track">
              <div className="algo-meter-fill" style={{
                width: `${Math.min(100, Math.abs(master.totalScore) * 100 / 0.6)}%`,
                background: master.color,
              }} />
              <div className="algo-meter-center" />
            </div>
            <div className="algo-meter-labels">
              <span>Strong Sell</span><span>Neutral</span><span>Strong Buy</span>
            </div>
          </div>
        </div>
        <div className="algo-action-row">
          <span className="algo-action-label">📋 Action:</span>
          <span className="algo-action-text">{master.action}</span>
        </div>
      </div>

      {/* ── Model Contributions Grid ── */}
      <div className="algo-models-card">
        <div className="algo-models-header">
          <span>Model</span><span>Signal</span><span>Conf.</span><span>Weight</span><span>Contribution</span>
        </div>
        {master.modelContributions.map(mc => {
          const sigColor = mc.signal === 'StrongBuy' || mc.signal === 'Buy'
            ? '#22c55e' : mc.signal === 'Hold' ? '#eab308' : '#ef4444';
          const contribColor = mc.weightedContribution > 0 ? '#22c55e' : mc.weightedContribution < 0 ? '#ef4444' : '#94a3b8';
          const barWidth = Math.min(100, Math.abs(mc.weightedContribution) * 3);
          return (
            <div key={mc.name} className="algo-model-row">
              <div className="algo-model-name">
                <span className="algo-model-title">{mc.name}</span>
                <span className="algo-model-weight">{mc.weight}% weight</span>
              </div>
              <span className="algo-model-signal" style={{ color: sigColor }}>
                {mc.signal === 'StrongBuy' ? '🟢🟢' : mc.signal === 'Buy' ? '🟢' : mc.signal === 'Hold' ? '🟡' : mc.signal === 'Sell' ? '🔴' : '🔴🔴'} {mc.signal}
              </span>
              <div className="algo-model-conf">
                <div className="algo-conf-bar-track">
                  <div className="algo-conf-bar-fill" style={{ width: `${mc.confidence}%`, background: sigColor }} />
                </div>
                <span>{mc.confidence}%</span>
              </div>
              <span className="algo-model-wt">{mc.weight}%</span>
              <div className="algo-model-contrib">
                <div className="algo-contrib-bar">
                  <div className="algo-contrib-fill" style={{
                    width: `${barWidth}%`,
                    background: contribColor,
                    marginLeft: mc.weightedContribution < 0 ? 'auto' : undefined,
                  }} />
                </div>
                <span style={{ color: contribColor }}>
                  {mc.weightedContribution > 0 ? '+' : ''}{mc.weightedContribution.toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
        <div className="algo-total-row">
          <span>Total Weighted Score</span>
          <span className="algo-total-score" style={{ color: master.color }}>
            {master.totalScore > 0 ? '+' : ''}{master.totalScore.toFixed(3)}
          </span>
        </div>
      </div>

      {/* ── Analysis Indicators ── */}
      <div className="algo-indicators-grid">
        <div className="algo-ind-card">
          <span className="algo-ind-label">📊 Agreement</span>
          <div className="algo-ind-bar-track">
            <div className="algo-ind-bar-fill" style={{
              width: `${master.agreement}%`,
              background: master.agreement >= 70 ? '#22c55e' : master.agreement >= 50 ? '#eab308' : '#ef4444',
            }} />
          </div>
          <span className="algo-ind-value">{master.agreement}%</span>
        </div>
        <div className="algo-ind-card">
          <span className="algo-ind-label">💪 Conviction</span>
          <span className="algo-ind-value" style={{ color: convictionColors[master.conviction] || '#94a3b8' }}>
            {master.conviction}
          </span>
        </div>
        <div className="algo-ind-card">
          <span className="algo-ind-label">⚠️ Risk Level</span>
          <span className="algo-ind-value" style={{ color: riskColors[master.riskLevel] }}>
            {master.riskLevel}
          </span>
        </div>
        <div className="algo-ind-card">
          <span className="algo-ind-label">🌐 Regime</span>
          <span className="algo-ind-value">{master.regime}</span>
        </div>
        <div className="algo-ind-card">
          <span className="algo-ind-label">⏱️ Best Timeframe</span>
          <span className="algo-ind-value">{master.bestTimeframe}</span>
        </div>
        <div className="algo-ind-card">
          <span className="algo-ind-label">🎯 Entry / SL / TP</span>
          <span className="algo-ind-value">
            {cs}{signal.entryPrice.toFixed(2)} / {cs}{signal.stopLoss.toFixed(2)} / {cs}{signal.takeProfit.toFixed(2)}
          </span>
        </div>
      </div>

      {/* ── Weighted Formula Explanation ── */}
      <div className="algo-formula-card">
        <span className="algo-formula-title">⚙️ Signal Formula</span>
        <span className="algo-formula-text">
          Score = Σ (Signal × Confidence × Weight) — XGBoost 40% · LSTM-Transformer 35% · GA-LSTM 15% · H-BLSTM 10%
        </span>
        <span className="algo-formula-text">
          Thresholds: {'>'} +0.40 Strong Buy · {'>'} +0.15 Buy · ±0.15 Hold · {'<'} −0.15 Sell · {'<'} −0.40 Strong Sell
        </span>
      </div>
    </div>
  );
}

/* ===================== Trade Plan / Position Sizing ===================== */

function TradePlanSection({ plan, signal, currency, master, accountBalance, riskPct, onBalanceChange, onRiskChange }: {
  plan: TradePlan;
  signal: StockSignal;
  currency: string;
  master: MasterSignalData;
  accountBalance: number;
  riskPct: number;
  onBalanceChange: (v: number) => void;
  onRiskChange: (v: number) => void;
}) {
  const cs = currency === 'INR' ? '₹' : '$';
  const useAdjusted = plan.volatilityAdjusted;
  const units = useAdjusted ? plan.adjustedUnits : plan.suggestedUnits;
  const cost = useAdjusted ? plan.adjustedCost : plan.totalCost;
  const pctUsed = accountBalance > 0 ? (cost / accountBalance) * 100 : 0;

  return (
    <div className="sa-section tp-section">
      <h4 className="sa-section-title">💼 Position Sizing & Trade Plan</h4>

      {/* ── Account Inputs ── */}
      <div className="tp-inputs-row">
        <div className="tp-input-group">
          <label>Portfolio ({cs})</label>
          <input type="number" value={accountBalance} min={100} step={1000}
            onChange={e => onBalanceChange(Math.max(100, Number(e.target.value)))} />
        </div>
        <div className="tp-input-group">
          <label>Risk / Trade (%)</label>
          <input type="number" value={riskPct} min={0.1} max={10} step={0.1}
            onChange={e => onRiskChange(Math.max(0.1, Math.min(10, Number(e.target.value))))} />
        </div>
        <div className="tp-input-group">
          <label>Amount at Risk</label>
          <span className="tp-risk-amount">{cs}{(accountBalance * riskPct / 100).toFixed(2)}</span>
        </div>
      </div>

      {/* ── Position Card ── */}
      <div className="tp-position-card" style={{ borderColor: master.color }}>
        <div className="tp-pos-header">
          <div className="tp-pos-main">
            <span className="tp-pos-units">{units}</span>
            <span className="tp-pos-label">shares to {signal.signal.includes('Sell') ? 'sell' : 'buy'}</span>
          </div>
          <div className="tp-pos-cost">
            <span className="tp-pos-cost-value">{cs}{cost.toLocaleString()}</span>
            <span className="tp-pos-cost-pct">{pctUsed.toFixed(1)}% of portfolio</span>
          </div>
        </div>

        {/* Portfolio allocation bar */}
        <div className="tp-alloc-bar">
          <div className="tp-alloc-fill" style={{
            width: `${Math.min(100, pctUsed)}%`,
            background: pctUsed > 30 ? '#ef4444' : pctUsed > 15 ? '#eab308' : '#22c55e',
          }} />
          <div className="tp-alloc-markers">
            <span style={{ left: '10%' }}>10%</span>
            <span style={{ left: '25%' }}>25%</span>
            <span style={{ left: '50%' }}>50%</span>
          </div>
        </div>

        {plan.volatilityAdjusted && (
          <div className="tp-vol-warning">
            ⚠️ Position reduced by 30% due to high volatility (ATR {'>'} 3% of price).
            Original: {plan.suggestedUnits} shares ({cs}{plan.totalCost.toLocaleString()})
          </div>
        )}
      </div>

      {/* ── Risk/Reward Grid ── */}
      <div className="tp-rr-grid">
        <div className="tp-rr-card tp-rr-risk">
          <span className="tp-rr-icon">🔴</span>
          <div className="tp-rr-content">
            <span className="tp-rr-label">Max Risk</span>
            <span className="tp-rr-value">{cs}{plan.riskAmount.toFixed(2)}</span>
            <span className="tp-rr-detail">{plan.riskPct.toFixed(2)}% of portfolio · SL at {plan.stopLossPct.toFixed(1)}%</span>
          </div>
        </div>
        <div className="tp-rr-card tp-rr-reward">
          <span className="tp-rr-icon">🟢</span>
          <div className="tp-rr-content">
            <span className="tp-rr-label">Max Reward</span>
            <span className="tp-rr-value">{cs}{plan.rewardAmount.toFixed(2)}</span>
            <span className="tp-rr-detail">TP at +{plan.takeProfitPct.toFixed(1)}%</span>
          </div>
        </div>
        <div className="tp-rr-card tp-rr-ratio">
          <span className="tp-rr-icon">⚖️</span>
          <div className="tp-rr-content">
            <span className="tp-rr-label">Risk : Reward</span>
            <span className="tp-rr-value" style={{
              color: plan.riskRewardRatio >= 2 ? '#22c55e' : plan.riskRewardRatio >= 1.5 ? '#4ade80' : plan.riskRewardRatio >= 1 ? '#eab308' : '#ef4444',
            }}>1 : {plan.riskRewardRatio.toFixed(2)}</span>
            <span className="tp-rr-detail">{plan.riskRewardRatio >= 2 ? 'Excellent' : plan.riskRewardRatio >= 1.5 ? 'Good' : plan.riskRewardRatio >= 1 ? 'Fair' : 'Poor'}</span>
          </div>
        </div>
      </div>

      {/* ── Advanced Metrics ── */}
      <div className="tp-advanced-grid">
        <div className="tp-adv-item">
          <span className="tp-adv-label">Break-Even Wins</span>
          <span className="tp-adv-value">{plan.breakEvenTrades} / 10 trades</span>
          <span className="tp-adv-detail">Minimum wins needed per 10 trades to be profitable</span>
        </div>
        <div className="tp-adv-item">
          <span className="tp-adv-label">Kelly Criterion</span>
          <span className="tp-adv-value" style={{ color: plan.kellyPct > 0 ? '#22c55e' : '#ef4444' }}>{plan.kellyPct.toFixed(1)}%</span>
          <span className="tp-adv-detail">Optimal portfolio allocation (capped at 25%)</span>
        </div>
        <div className="tp-adv-item">
          <span className="tp-adv-label">Entry</span>
          <span className="tp-adv-value">{cs}{signal.entryPrice.toFixed(2)}</span>
        </div>
        <div className="tp-adv-item">
          <span className="tp-adv-label">Stop Loss</span>
          <span className="tp-adv-value" style={{ color: '#ef4444' }}>{cs}{signal.stopLoss.toFixed(2)} (−{plan.stopLossPct.toFixed(1)}%)</span>
        </div>
        <div className="tp-adv-item">
          <span className="tp-adv-label">Take Profit</span>
          <span className="tp-adv-value" style={{ color: '#22c55e' }}>{cs}{signal.takeProfit.toFixed(2)} (+{plan.takeProfitPct.toFixed(1)}%)</span>
        </div>
        <div className="tp-adv-item">
          <span className="tp-adv-label">Conviction</span>
          <span className="tp-adv-value">{master.conviction} ({master.confidence}%)</span>
        </div>
      </div>

      {/* ── Summary ── */}
      <div className="tp-summary" style={{ borderColor: master.color }}>
        <span className="tp-summary-title">📋 Trade Plan Summary</span>
        <span className="tp-summary-text">
          {master.emoji} <b>{master.recommendation}</b> — {signal.signal.includes('Sell') ? 'Sell' : 'Buy'} <b>{units} shares</b> of {signal.symbol} at {cs}{signal.entryPrice.toFixed(2)} for {cs}{cost.toLocaleString()} ({pctUsed.toFixed(1)}% of {cs}{accountBalance.toLocaleString()} portfolio).
          Risk {cs}{plan.riskAmount.toFixed(2)} ({plan.riskPct.toFixed(2)}%) with SL at {cs}{signal.stopLoss.toFixed(2)}.
          Target {cs}{signal.takeProfit.toFixed(2)} for potential gain of {cs}{plan.rewardAmount.toFixed(2)}.
          R:R = 1:{plan.riskRewardRatio.toFixed(1)}.
        </span>
      </div>
    </div>
  );
}

/* ===================== ML Inference Section ===================== */

function MLInferenceSection({ mlPrediction, mlLoading }: { mlPrediction: MLPrediction | null; mlLoading: boolean }) {
  if (mlLoading) {
    return (
      <div className="sa-section ml-section">
        <h4 className="sa-section-title">🧠 ML Inference Engine</h4>
        <div className="ml-loading">
          <div className="ml-spinner" />
          <span>Running LSTM + RL Agent...</span>
        </div>
      </div>
    );
  }

  if (!mlPrediction) return null;

  const p = mlPrediction;
  const signalColor = (s: number) =>
    s >= 0.72 ? '#22c55e' : s >= 0.58 ? '#4ade80' : s >= 0.42 ? '#eab308' : s >= 0.28 ? '#f97316' : '#ef4444';

  const actionColor = (a: string) =>
    a === 'Buy' ? '#22c55e' : a === 'Sell' ? '#ef4444' : '#eab308';

  return (
    <div className="sa-section ml-section">
      <h4 className="sa-section-title">🧠 ML Inference Engine</h4>
      <div className="ml-badge-row">
        <span className="ml-real-badge">✅ PURE TS</span>
        <span className="ml-real-badge ml-badge-lstm">LSTM + Attention</span>
        <span className="ml-real-badge ml-badge-rl">PPO RL Agent</span>
      </div>

      {/* ── Ensemble Result ── */}
      <div className="ml-ensemble-card" style={{ borderColor: signalColor(p.ensembleScore) }}>
        <div className="ml-ensemble-header">
          <span className="ml-ensemble-signal" style={{ color: signalColor(p.ensembleScore) }}>
            {p.ensembleSignal}
          </span>
          <span className="ml-ensemble-score">
            Score: {(p.ensembleScore * 100).toFixed(1)}%
          </span>
        </div>
        <div className="ml-ensemble-bar">
          <div className="ml-ensemble-fill" style={{
            width: `${p.ensembleScore * 100}%`,
            background: `linear-gradient(90deg, #ef4444, #eab308 40%, #22c55e)`,
          }} />
          <div className="ml-ensemble-marker" style={{ left: `${p.ensembleScore * 100}%` }} />
        </div>
        <div className="ml-ensemble-labels">
          <span>Strong Sell</span><span>Sell</span><span>Hold</span><span>Buy</span><span>Strong Buy</span>
        </div>
      </div>

      {/* ── Model Breakdown ── */}
      <div className="ml-models-grid">
        {/* LSTM */}
        <div className="ml-model-card">
          <div className="ml-model-header">
            <span className="ml-model-icon">📈</span>
            <span className="ml-model-name">LSTM + Attention</span>
          </div>
          <div className="ml-model-score" style={{ color: signalColor(p.lstmScore) }}>
            {(p.lstmScore * 100).toFixed(1)}%
          </div>
          <div className="ml-model-bar">
            <div className="ml-model-fill" style={{ width: `${p.lstmScore * 100}%`, background: signalColor(p.lstmScore) }} />
          </div>
          <div className="ml-model-meta">
            <span>Pred Return: {(p.lstmPredictedReturn * 100).toFixed(3)}%</span>
            <span>Conf: {p.lstmConfidence.toFixed(0)}%</span>
          </div>
          <div className="ml-model-meta">
            <span>Attention: {(p.attentionScore * 100).toFixed(1)}%</span>
            <span>Focus: {p.temporalFocus}</span>
          </div>
        </div>

        {/* RL PPO */}
        <div className="ml-model-card">
          <div className="ml-model-header">
            <span className="ml-model-icon">🤖</span>
            <span className="ml-model-name">PPO RL Agent</span>
          </div>
          <div className="ml-model-action" style={{ color: actionColor(p.rlAction) }}>
            {p.rlAction}
          </div>
          <div className="ml-rl-probs">
            <div className="ml-rl-prob">
              <span className="ml-rl-prob-label">Hold</span>
              <div className="ml-rl-prob-bar">
                <div className="ml-rl-prob-fill" style={{ width: `${p.rlActionProbs[0] * 100}%`, background: '#eab308' }} />
              </div>
              <span className="ml-rl-prob-val">{(p.rlActionProbs[0] * 100).toFixed(0)}%</span>
            </div>
            <div className="ml-rl-prob">
              <span className="ml-rl-prob-label">Buy</span>
              <div className="ml-rl-prob-bar">
                <div className="ml-rl-prob-fill" style={{ width: `${p.rlActionProbs[1] * 100}%`, background: '#22c55e' }} />
              </div>
              <span className="ml-rl-prob-val">{(p.rlActionProbs[1] * 100).toFixed(0)}%</span>
            </div>
            <div className="ml-rl-prob">
              <span className="ml-rl-prob-label">Sell</span>
              <div className="ml-rl-prob-bar">
                <div className="ml-rl-prob-fill" style={{ width: `${p.rlActionProbs[2] * 100}%`, background: '#ef4444' }} />
              </div>
              <span className="ml-rl-prob-val">{(p.rlActionProbs[2] * 100).toFixed(0)}%</span>
            </div>
          </div>
          <div className="ml-model-meta">
            <span>Reward: {p.rlTotalReward.toFixed(2)}</span>
            <span>Conf: {p.rlConfidence}%</span>
          </div>
        </div>
      </div>

      {/* ── Tech Stack ── */}
      <div className="ml-tech-card">
        <span className="ml-tech-title">⚙️ Stack</span>
        <span className="ml-tech-text">
          Pure TypeScript · LSTM 2-layer (8→4 units) · Multi-head Self-Attention ·
          PPO (Actor-Critic, policy gradient) · {FEATURE_COUNT} features × {SEQUENCE_LEN}-bar window
        </span>
      </div>
    </div>
  );
}

const FEATURE_COUNT = 10;
const SEQUENCE_LEN = 30;

/* ===================== Main Panel ===================== */

interface QuantRatingPanelProps {
  data: SAStyleData;
  symbol: string;
  currency: string;
  signal?: StockSignal | null;
  mlPrediction?: MLPrediction | null;
  mlLoading?: boolean;
  onPeerSelect?: (sym: string) => void;
}

export function QuantRatingPanel({ data, symbol, currency, signal, mlPrediction, mlLoading, onPeerSelect }: QuantRatingPanelProps) {
  const { quantRating, momentum, dividendInfo, capitalStructure, riskMetrics, peers } = data;
  const masterSignal = signal ? generateMasterSignal(signal) : null;

  const [accountBalance, setAccountBalance] = useState(10000);
  const [riskPct, setRiskPct] = useState(1);

  const tradePlan = useMemo(() => {
    if (!signal || !masterSignal) return null;
    return generateTradePlan(signal, masterSignal, accountBalance, riskPct);
  }, [signal, masterSignal, accountBalance, riskPct]);

  return (
    <div className="card sa-card">
      {/* ── Quant Rating Header ── */}
      <div className="sa-rating-header">
        <h3 className="card-title">🔬 Quant Rating — {symbol}</h3>
        <div className="sa-overall-badge" style={{ background: ratingColor(quantRating.overall) }}>
          {quantRating.overall}
        </div>
        <span className="sa-score-label">Score: {quantRating.score.toFixed(2)} / 5.00</span>
      </div>

      <div className="algo-name-bar">
        <span className="algo-name-label">Quant Engine:</span>
        <span className="algo-name-tag">SA-Style 5-Factor Model</span>
        <span className="algo-name-tag">Weighted Composite (Val 15% · Grw 20% · Prof 25% · Mom 25% · Rev 15%)</span>
      </div>

      {/* ── Ratings Summary (SA / Wall St / Quant) ── */}
      <div className="sa-section">
        <h4 className="sa-section-title">📊 Ratings Summary</h4>
        <RatingsBar label="Quant" rating={quantRating.overall} />
        <RatingsBar label="Wall Street" rating={quantRating.wallStreetRating} />
        <div className="sa-ws-meta">
          <span>Target: <b>{currency === 'INR' ? '₹' : '$'}{quantRating.wallStreetTarget.toFixed(2)}</b></span>
          <span>{quantRating.analystCount} Analysts</span>
        </div>
      </div>

      {/* ── Factor Grades ── */}
      <div className="sa-section">
        <h4 className="sa-section-title">🏆 Factor Grades</h4>
        <div className="sa-grades-grid">
          <GradeBadge label="Valuation" grade={quantRating.factorGrades.valuation} />
          <GradeBadge label="Growth" grade={quantRating.factorGrades.growth} />
          <GradeBadge label="Profitability" grade={quantRating.factorGrades.profitability} />
          <GradeBadge label="Momentum" grade={quantRating.factorGrades.momentum} />
          <GradeBadge label="EPS Revisions" grade={quantRating.factorGrades.revisions} />
        </div>
      </div>

      {/* ── Algo Trading Master Signal ── */}
      {masterSignal && signal && (
        <AlgoTradingSection master={masterSignal} signal={signal} currency={currency} />
      )}

      {/* ── Position Sizing / Trade Plan ── */}
      {tradePlan && masterSignal && signal && (
        <TradePlanSection plan={tradePlan} signal={signal} currency={currency}
          master={masterSignal} accountBalance={accountBalance} riskPct={riskPct}
          onBalanceChange={setAccountBalance} onRiskChange={setRiskPct} />
      )}

      {/* ── ML Inference Engine ── */}
      <MLInferenceSection mlPrediction={mlPrediction ?? null} mlLoading={mlLoading ?? false} />

      {/* ── Momentum ── */}
      <MomentumSection data={momentum} currency={currency === 'INR' ? '₹' : '$'} />

      {/* ── Capital Structure ── */}
      <CapitalStructureSection data={capitalStructure} currency={currency} />

      {/* ── Dividends ── */}
      <DividendSection data={dividendInfo} currency={currency === 'INR' ? '₹' : '$'} />

      {/* ── Risk ── */}
      <RiskSection data={riskMetrics} />

      {/* ── Peers ── */}
      <PeersSection peers={peers} onSelect={onPeerSelect} />
    </div>
  );
}
