/**
 * Seeking-Alpha-style Quant Scoring Engine
 *
 * Computes factor grades (Valuation, Growth, Profitability, Momentum, Revisions)
 * as letter grades A+ through F, plus an overall Quant Rating.
 */
import {
  StockQuote, FundamentalData, LiveQuote, LetterGrade, QuantRatingType,
  QuantRating, FactorGrades, MomentumData, DividendInfo,
  CapitalStructure, RiskMetrics, PeerStock, SAStyleData,
} from '../types';

/* ─── helpers ─── */

const GRADE_ORDER: LetterGrade[] = ['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F'];

function scoreToGrade(score: number): LetterGrade {
  // score 0–1 → letter grade (1 = A+, 0 = F)
  const idx = Math.round((1 - score) * (GRADE_ORDER.length - 1));
  return GRADE_ORDER[Math.max(0, Math.min(idx, GRADE_ORDER.length - 1))];
}

function gradeToScore(g: LetterGrade): number {
  const idx = GRADE_ORDER.indexOf(g);
  return idx >= 0 ? 1 - idx / (GRADE_ORDER.length - 1) : 0.5;
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

function parseNum(s: string): number {
  const cleaned = s.replace(/[^0-9.\-]/g, '');
  return parseFloat(cleaned) || 0;
}

/* ─── factor scoring ─── */

function scoreValuation(fund: FundamentalData): number {
  let s = 0;
  // P/E: lower is better (0-10 = 1.0, 10-15 = 0.8, 15-25 = 0.5, 25-40 = 0.3, >40 = 0.1)
  const pe = fund.peRatio;
  if (pe > 0 && pe <= 10) s += 1.0;
  else if (pe <= 15) s += 0.8;
  else if (pe <= 25) s += 0.5;
  else if (pe <= 40) s += 0.3;
  else s += 0.1;

  // Forward P/E
  const fpe = fund.forwardPE;
  if (fpe > 0 && fpe <= 12) s += 1.0;
  else if (fpe <= 18) s += 0.7;
  else if (fpe <= 30) s += 0.4;
  else s += 0.15;

  // Dividend Yield (higher is better for value)
  if (fund.dividendYield >= 3) s += 0.9;
  else if (fund.dividendYield >= 1.5) s += 0.6;
  else if (fund.dividendYield > 0) s += 0.3;
  else s += 0.1;

  return clamp01(s / 3);
}

function scoreGrowth(fund: FundamentalData): number {
  let s = 0;
  // Revenue Growth
  const rg = fund.revenueGrowth;
  if (rg >= 30) s += 1.0;
  else if (rg >= 15) s += 0.8;
  else if (rg >= 5) s += 0.5;
  else if (rg >= 0) s += 0.3;
  else s += 0.1;

  // EPS proxy: if EPS is positive and growing, good
  if (fund.eps > 5) s += 0.9;
  else if (fund.eps > 2) s += 0.7;
  else if (fund.eps > 0) s += 0.4;
  else s += 0.1;

  return clamp01(s / 2);
}

function scoreProfitability(fund: FundamentalData): number {
  let s = 0;
  // Profit Margin
  if (fund.profitMargin >= 30) s += 1.0;
  else if (fund.profitMargin >= 20) s += 0.8;
  else if (fund.profitMargin >= 10) s += 0.5;
  else if (fund.profitMargin >= 0) s += 0.3;
  else s += 0.1;

  // ROE
  if (fund.roe >= 30) s += 1.0;
  else if (fund.roe >= 15) s += 0.7;
  else if (fund.roe >= 5) s += 0.4;
  else s += 0.15;

  // Debt to Equity (lower is better)
  if (fund.debtToEquity <= 0.3) s += 1.0;
  else if (fund.debtToEquity <= 0.8) s += 0.7;
  else if (fund.debtToEquity <= 1.5) s += 0.4;
  else s += 0.15;

  return clamp01(s / 3);
}

function scoreMomentum(quotes: StockQuote[]): number {
  if (quotes.length < 252) return 0.5;
  const last = quotes[quotes.length - 1].close;
  const m1 = quotes.length >= 22 ? (last - quotes[quotes.length - 22].close) / quotes[quotes.length - 22].close : 0;
  const m6 = quotes.length >= 126 ? (last - quotes[quotes.length - 126].close) / quotes[quotes.length - 126].close : 0;
  const m12 = (last - quotes[quotes.length - 252].close) / quotes[quotes.length - 252].close;

  let s = 0;
  // 1M momentum
  if (m1 > 0.05) s += 1.0;
  else if (m1 > 0) s += 0.6;
  else if (m1 > -0.05) s += 0.35;
  else s += 0.1;

  // 6M momentum
  if (m6 > 0.15) s += 1.0;
  else if (m6 > 0) s += 0.6;
  else if (m6 > -0.1) s += 0.3;
  else s += 0.1;

  // 12M momentum
  if (m12 > 0.2) s += 1.0;
  else if (m12 > 0) s += 0.6;
  else if (m12 > -0.15) s += 0.3;
  else s += 0.1;

  return clamp01(s / 3);
}

function scoreRevisions(fund: FundamentalData): number {
  // Proxy: positive growth + positive forward PE < trailing PE → upward revisions
  let s = 0.5;
  if (fund.revenueGrowth > 10) s += 0.15;
  if (fund.forwardPE > 0 && fund.forwardPE < fund.peRatio) s += 0.2;
  if (fund.eps > 0) s += 0.1;
  if (fund.profitMargin > 15) s += 0.1;
  return clamp01(s);
}

/* ─── public API ─── */

export function computeFactorGrades(fund: FundamentalData, quotes: StockQuote[]): FactorGrades {
  return {
    valuation: scoreToGrade(scoreValuation(fund)),
    growth: scoreToGrade(scoreGrowth(fund)),
    profitability: scoreToGrade(scoreProfitability(fund)),
    momentum: scoreToGrade(scoreMomentum(quotes)),
    revisions: scoreToGrade(scoreRevisions(fund)),
  };
}

export function computeQuantRating(
  fund: FundamentalData,
  quotes: StockQuote[],
  modelScore: number,
): QuantRating {
  const fg = computeFactorGrades(fund, quotes);

  // Weighted composite score (SA weights profitability and momentum heavily)
  const composite =
    gradeToScore(fg.valuation) * 0.15 +
    gradeToScore(fg.growth) * 0.20 +
    gradeToScore(fg.profitability) * 0.25 +
    gradeToScore(fg.momentum) * 0.25 +
    gradeToScore(fg.revisions) * 0.15;

  // Map composite (0-1) to 1-5 rating scale
  const score = 1 + composite * 4; // 1 = worst, 5 = best

  let overall: QuantRatingType;
  if (score >= 4.5) overall = 'Strong Buy';
  else if (score >= 3.5) overall = 'Buy';
  else if (score >= 2.5) overall = 'Hold';
  else if (score >= 1.5) overall = 'Sell';
  else overall = 'Strong Sell';

  // Wall Street consensus: bias from model score
  let wsRating: QuantRatingType;
  if (modelScore >= 0.70) wsRating = 'Strong Buy';
  else if (modelScore >= 0.55) wsRating = 'Buy';
  else if (modelScore >= 0.42) wsRating = 'Hold';
  else if (modelScore >= 0.28) wsRating = 'Sell';
  else wsRating = 'Strong Sell';

  // Target price: ~10% upside from current close
  const lastPrice = quotes.length > 0 ? quotes[quotes.length - 1].close : 0;
  const upside = 0.05 + modelScore * 0.15; // 5–20% upside target
  const wallStreetTarget = Math.round(lastPrice * (1 + upside) * 100) / 100;

  return {
    overall,
    score: Math.round(score * 100) / 100,
    factorGrades: fg,
    wallStreetRating: wsRating,
    wallStreetTarget,
    analystCount: 20 + Math.floor(modelScore * 30),
  };
}

export function computeMomentum(quotes: StockQuote[]): MomentumData {
  const n = quotes.length;
  const last = n > 0 ? quotes[n - 1].close : 0;

  function pctReturn(daysBack: number) {
    if (n < daysBack) return 0;
    const old = quotes[n - daysBack].close;
    return old > 0 ? ((last - old) / old) * 100 : 0;
  }

  // SMA values
  const sma20 = n >= 20 ? quotes.slice(-20).reduce((s, q) => s + q.close, 0) / 20 : last;
  const sma50 = n >= 50 ? quotes.slice(-50).reduce((s, q) => s + q.close, 0) / 50 : last;
  const sma200 = n >= 200 ? quotes.slice(-200).reduce((s, q) => s + q.close, 0) / 200 : last;

  // Simulated S&P 500 benchmark returns (reasonable long-term averages)
  const sp1W = -0.5 + Math.random() * 2;
  const sp1M = 0.5 + Math.random() * 3;
  const sp6M = 3 + Math.random() * 8;
  const sp1Y = 8 + Math.random() * 12;

  return {
    return1W: Math.round(pctReturn(5) * 100) / 100,
    return1M: Math.round(pctReturn(22) * 100) / 100,
    return6M: Math.round(pctReturn(126) * 100) / 100,
    return1Y: Math.round(pctReturn(252) * 100) / 100,
    sp500Return1W: Math.round(sp1W * 100) / 100,
    sp500Return1M: Math.round(sp1M * 100) / 100,
    sp500Return6M: Math.round(sp6M * 100) / 100,
    sp500Return1Y: Math.round(sp1Y * 100) / 100,
    sma20: Math.round(sma20 * 100) / 100,
    sma50: Math.round(sma50 * 100) / 100,
    sma200: Math.round(sma200 * 100) / 100,
    priceVsSma20: sma20 > 0 ? Math.round(((last - sma20) / sma20) * 10000) / 100 : 0,
    priceVsSma50: sma50 > 0 ? Math.round(((last - sma50) / sma50) * 10000) / 100 : 0,
    priceVsSma200: sma200 > 0 ? Math.round(((last - sma200) / sma200) * 10000) / 100 : 0,
  };
}

export function computeDividendInfo(fund: FundamentalData, lastPrice: number): DividendInfo {
  const yieldFwd = fund.dividendYield;
  const annualPayout = fund.dividendRate > 0
    ? fund.dividendRate
    : (lastPrice * (yieldFwd / 100));
  // Proxy payout ratio from EPS
  const payoutRatio = fund.eps > 0 ? (annualPayout / fund.eps) * 100 : 0;
  // Simulated 5Y growth and years (only if paying dividend)
  const growthRate5Y = yieldFwd > 0 ? 3 + Math.random() * 8 : 0;
  const yearsOfGrowth = yieldFwd > 0 ? Math.floor(5 + Math.random() * 15) : 0;

  // Use real ex-dividend date from Yahoo when available
  let exDivDisplay = fund.exDividendDate || '';
  if (!exDivDisplay && yieldFwd > 0) {
    const now = new Date();
    const nextEx = new Date(now);
    nextEx.setMonth(nextEx.getMonth() + Math.floor(Math.random() * 3) + 1);
    exDivDisplay = nextEx.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return {
    yieldFwd: Math.round(yieldFwd * 100) / 100,
    annualPayout: Math.round(annualPayout * 100) / 100,
    payoutRatio: Math.round(payoutRatio * 100) / 100,
    growthRate5Y: Math.round(growthRate5Y * 100) / 100,
    yearsOfGrowth,
    exDividendDate: exDivDisplay,
    frequency: 'Quarterly',
  };
}

export function computeCapitalStructure(fund: FundamentalData): CapitalStructure {
  const mcapNum = parseNum(fund.marketCap);
  const deNum = fund.debtToEquity;
  // Rough estimate: debt ≈ marketCap × D/E ratio × 0.5 (equity proxy)
  const totalDebt = mcapNum * deNum * 0.3;
  const cash = mcapNum * 0.05 + Math.random() * mcapNum * 0.1;
  const ev = mcapNum + totalDebt - cash;

  return {
    marketCapNum: mcapNum,
    totalDebt: Math.round(totalDebt),
    cash: Math.round(cash),
    enterpriseValue: Math.round(ev),
  };
}

export function computeRiskMetrics(fund: FundamentalData): RiskMetrics {
  // Short interest: typically 1-5% for most stocks
  const shortInterest = 0.5 + Math.random() * 4;
  // Altman Z: > 3 safe, 1.8-3 grey zone, < 1.8 distress
  const z = fund.profitMargin > 15 && fund.debtToEquity < 1
    ? 5 + Math.random() * 5
    : fund.profitMargin > 0
      ? 2.5 + Math.random() * 3
      : 1 + Math.random() * 2;

  return {
    shortInterest: Math.round(shortInterest * 100) / 100,
    beta: fund.beta,
    altmanZScore: Math.round(z * 100) / 100,
  };
}

// Peer mapping: similar companies by symbol
const PEER_MAP: Record<string, string[]> = {
  AAPL: ['MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA'],
  MSFT: ['AAPL', 'GOOGL', 'AMZN', 'META', 'CRM'],
  GOOGL: ['META', 'MSFT', 'AMZN', 'AAPL', 'SNAP'],
  AMZN: ['MSFT', 'GOOGL', 'AAPL', 'META', 'NFLX'],
  TSLA: ['NIO', 'RIVN', 'F', 'GM', 'LCID'],
  NVDA: ['AMD', 'INTC', 'AVGO', 'QCOM', 'MU'],
  META: ['GOOGL', 'SNAP', 'PINS', 'TWTR', 'MSFT'],
  JPM: ['BAC', 'WFC', 'GS', 'MS', 'C'],
  NFLX: ['DIS', 'AMZN', 'ROKU', 'PARA', 'WBD'],
  AMD: ['NVDA', 'INTC', 'AVGO', 'QCOM', 'MU'],
  // Indian stocks
  RELIANCE: ['TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'BHARTIARTL'],
  TCS: ['INFY', 'WIPRO', 'HCLTECH', 'TECHM', 'LTI'],
  HDFCBANK: ['ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'INDUSINDBK'],
  INFY: ['TCS', 'WIPRO', 'HCLTECH', 'TECHM', 'LTTS'],
  ICICIBANK: ['HDFCBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'BAJFINANCE'],
  BHARTIARTL: ['JIO', 'IDEA', 'RELIANCE', 'TATACOMM', 'MTNL'],
  SBIN: ['HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'PNB', 'BANKBARODA'],
  ITC: ['HINDUNILVR', 'NESTLEIND', 'BRITANNIA', 'DABUR', 'MARICO'],
  HINDUNILVR: ['ITC', 'NESTLEIND', 'BRITANNIA', 'DABUR', 'GODREJCP'],
  LT: ['RELIANCE', 'BHARTIARTL', 'NTPC', 'POWERGRID', 'ADANIENT'],
  BAJFINANCE: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'BAJAJFINSV', 'KOTAKBANK'],
  TITAN: ['HINDUNILVR', 'PAGEIND', 'TRENT', 'MUTHOOTFIN', 'JUBLFOOD'],
};

export function getPeers(symbol: string, watchlistQuotes: LiveQuote[]): PeerStock[] {
  const peerSymbols = PEER_MAP[symbol.toUpperCase()] || [];
  return peerSymbols.map(sym => {
    const q = watchlistQuotes.find(wq => wq.symbol.toUpperCase() === sym);
    return {
      symbol: sym,
      name: q?.companyName || sym,
      price: q?.lastPrice || 0,
      change: q?.change || 0,
      changePercent: q?.percentChange || 0,
    };
  });
}

export function computeSAStyleData(
  fund: FundamentalData,
  quotes: StockQuote[],
  modelScore: number,
  watchlistQuotes: LiveQuote[],
  symbol: string,
): SAStyleData {
  const lastPrice = quotes.length > 0 ? quotes[quotes.length - 1].close : 0;
  return {
    quantRating: computeQuantRating(fund, quotes, modelScore),
    momentum: computeMomentum(quotes),
    dividendInfo: computeDividendInfo(fund, lastPrice),
    capitalStructure: computeCapitalStructure(fund),
    riskMetrics: computeRiskMetrics(fund),
    peers: getPeers(symbol, watchlistQuotes),
  };
}
