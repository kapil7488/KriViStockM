export interface StockQuote {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockBar {
  symbol: string;
  quotes: StockQuote[];
}

export type SignalType = 'StrongBuy' | 'Buy' | 'Hold' | 'Sell' | 'StrongSell';
export type TradingMode = 'Normal' | 'RiskControl';
export type TimeRange = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL';
export type ChartInterval = '1m' | '5m' | '15m' | '1H' | '4H' | 'D';
export type ChartType = 'candlestick' | 'line' | 'area';
export type OverlayIndicator = 'sma20' | 'sma50' | 'sma200' | 'ema12' | 'ema26' | 'bollinger' | 'vwap';
export type SubchartIndicator = 'volume' | 'rsi' | 'macd' | 'stochastic' | 'atr';
export type Market = 'US' | 'NSE' | 'BSE';

export interface LiveQuote {
  symbol: string;
  companyName: string;
  lastPrice: number;
  change: number;
  percentChange: number;
  previousClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  yearHigh: number;
  yearLow: number;
  volume: number;
  marketCap: number;
  peRatio: number;
  dividendYield: number;
  bookValue: number;
  eps: number;
  sector: string;
  industry: string;
  currency: string;
  exchange: string;
  lastUpdate: string;
}

export interface MarketConfig {
  id: Market;
  label: string;
  flag: string;
  currency: string;
  watchlist: string[];
}

export interface IndicatorSnapshot {
  ma30: number;
  ma120: number;
  rsi: number;
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  atr: number;
  maCrossoverBullish: boolean;
  isOversold: boolean;
  isOverbought: boolean;
  ema12: number;
  ema26: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  stochK: number;
  stochD: number;
  vwap: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
}

export interface FullIndicatorData {
  sma20: number[];
  sma50: number[];
  sma200: number[];
  ema12: number[];
  ema26: number[];
  rsi: number[];
  bollingerUpper: number[];
  bollingerMiddle: number[];
  bollingerLower: number[];
  macdLine: number[];
  macdSignal: number[];
  macdHistogram: number[];
  stochK: number[];
  stochD: number[];
  vwap: number[];
  atr: number[];
}

export interface ChartSettings {
  overlays: OverlayIndicator[];
  subcharts: SubchartIndicator[];
  chartType: ChartType;
  timeRange: TimeRange;
  interval: ChartInterval;
}

export interface FundamentalData {
  marketCap: string;
  peRatio: number;
  forwardPE: number;
  eps: number;
  dividendYield: number;
  dividendRate: number;
  exDividendDate: string;
  beta: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  avgVolume: number;
  revenue: string;
  netIncome: string;
  profitMargin: number;
  revenueGrowth: number;
  debtToEquity: number;
  roe: number;
  freeCashFlow: string;
  sector: string;
  industry: string;
  description: string;
  nextEarnings: string;
}

/* ===================== Seeking-Alpha-style types ===================== */

export type LetterGrade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F';
export type QuantRatingType = 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell';

export interface FactorGrades {
  valuation: LetterGrade;
  growth: LetterGrade;
  profitability: LetterGrade;
  momentum: LetterGrade;
  revisions: LetterGrade;
}

export interface QuantRating {
  overall: QuantRatingType;
  score: number; // 1–5 (5 = Strong Buy)
  factorGrades: FactorGrades;
  wallStreetRating: QuantRatingType;
  wallStreetTarget: number;
  analystCount: number;
}

export interface MomentumData {
  return1W: number;
  return1M: number;
  return6M: number;
  return1Y: number;
  sp500Return1W: number;
  sp500Return1M: number;
  sp500Return6M: number;
  sp500Return1Y: number;
  sma20: number;
  sma50: number;
  sma200: number;
  priceVsSma20: number;
  priceVsSma50: number;
  priceVsSma200: number;
}

export interface DividendInfo {
  yieldFwd: number;
  annualPayout: number;
  payoutRatio: number;
  growthRate5Y: number;
  yearsOfGrowth: number;
  exDividendDate: string;
  frequency: string;
}

export interface CapitalStructure {
  marketCapNum: number;
  totalDebt: number;
  cash: number;
  enterpriseValue: number;
}

export interface RiskMetrics {
  shortInterest: number;
  beta: number;
  altmanZScore: number;
}

export interface PeerStock {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

export interface SAStyleData {
  quantRating: QuantRating;
  momentum: MomentumData;
  dividendInfo: DividendInfo;
  capitalStructure: CapitalStructure;
  riskMetrics: RiskMetrics;
  peers: PeerStock[];
}

export interface ModelBreakdown {
  name: string;
  score: number;
  weight: number;
  signal: SignalType;
  confidence: number;
}

export interface StockSignal {
  symbol: string;
  signal: SignalType;
  modelScore: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSizePct: number;
  reasoning: string;
  generatedAt: string;
  mode: TradingMode;
  indicators: IndicatorSnapshot;
  models: ModelBreakdown[];
}

export interface RiskParameters {
  stopLossPercent: number;
  takeProfitPercent: number;
  maxPositionSizePct: number;
  volatilityReductionPct: number;
  normalModeThreshold: number;
  riskControlThreshold: number;
  portfolioValue: number;
}

export interface RiskAssessment {
  stopLossPrice: number;
  takeProfitPrice: number;
  recommendedPositionPct: number;
  shareCount: number;
  maxLoss: number;
  maxGain: number;
  riskRewardRatio: number;
  volatilityAdjusted: boolean;
}

export const DEFAULT_RISK_PARAMS: RiskParameters = {
  stopLossPercent: 0.05,
  takeProfitPercent: 0.15,
  maxPositionSizePct: 10,
  volatilityReductionPct: 30,
  normalModeThreshold: 0.55,
  riskControlThreshold: 0.65,
  portfolioValue: 100_000,
};

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  overlays: ['sma20', 'sma50'],
  subcharts: ['volume', 'rsi'],
  chartType: 'candlestick',
  timeRange: '6M',
  interval: 'D',
};

export const TIME_RANGE_DAYS: Record<TimeRange, number> = {
  '1D': 1,
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '5Y': 1825,
  'ALL': 99999,
};

/** How many minutes one candle represents for each interval */
export const INTERVAL_MINUTES: Record<ChartInterval, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1H': 60,
  '4H': 240,
  'D': 1440,
};

export const MARKETS: MarketConfig[] = [
  {
    id: 'US', label: 'US Market', flag: '🇺🇸', currency: 'USD',
    watchlist: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'JPM', 'NFLX', 'AMD'],
  },
  {
    id: 'NSE', label: 'NSE India', flag: '🇮🇳', currency: 'INR',
    watchlist: ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'BHARTIARTL', 'SBIN', 'ITC', 'HINDUNILVR', 'LT'],
  },
  {
    id: 'BSE', label: 'BSE India', flag: '🇮🇳', currency: 'INR',
    watchlist: ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'BHARTIARTL', 'SBIN', 'ITC', 'BAJFINANCE', 'TITAN'],
  },
];

/* ===================== Paper Trading types ===================== */

export type TradeAction = 'BUY' | 'SELL';
export type TradeMode = 'algo' | 'self';

export interface PaperTrade {
  id: string;
  symbol: string;
  action: TradeAction;
  mode: TradeMode;
  quantity: number;
  price: number;
  total: number;
  timestamp: string;
  signal?: SignalType;
  market: Market;
}

export interface PaperPosition {
  symbol: string;
  quantity: number;
  avgCost: number;
  totalCost: number;
  market: Market;
}

export interface PaperPortfolio {
  cashUS: number;
  cashINR: number;
  positions: PaperPosition[];
  trades: PaperTrade[];
}

/* ===================== Insights / News types ===================== */

export interface StockNewsItem {
  uuid: string;
  title: string;
  publisher: string;
  link: string;
  publishTime: number;
  thumbnail?: string;
  relatedTickers: string[];
}

export interface KeyStats {
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
  open: number;
  volume: number;
  avgVolume: number;
  marketCap: string;
  peRatio: number;
  forwardPE: number;
  eps: number;
  dividendYield: number;
  dividendRate: number;
  beta: number;
  shortInterest: number;
  profitMargin: number;
  roe: number;
  debtToEquity: number;
  revenueGrowth: number;
  sector: string;
  industry: string;
  exchange: string;
  analystTarget: number;
  analystCount: number;
  recommendation: string;
}
