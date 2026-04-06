import {
  MomentumData, DividendInfo, CapitalStructure, RiskMetrics, PeerStock,
  LetterGrade, QuantRatingType, SAStyleData,
} from '../types';

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

/* ===================== Main Panel ===================== */

interface QuantRatingPanelProps {
  data: SAStyleData;
  symbol: string;
  currency: string;
  onPeerSelect?: (sym: string) => void;
}

export function QuantRatingPanel({ data, symbol, currency, onPeerSelect }: QuantRatingPanelProps) {
  const { quantRating, momentum, dividendInfo, capitalStructure, riskMetrics, peers } = data;

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
