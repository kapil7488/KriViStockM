/** Types for KriVi's Stock — advanced multi-timeframe selection engine */

export type KrivisAction = 'buy' | 'sell' | 'hold';

export interface TimeframeIndicators {
  ema20: number[];
  ema50: number[];
  rsi7: number[];
  rsi14: number[];
  macdLine: number[];
  macdSignal: number[];
  macdHistogram: number[];
  atr3: number[];
  atr14: number[];
  bbUpper: number[];
  bbMiddle: number[];
  bbLower: number[];
  adx: number[];
  obv: number[];
  vwap: number[];
  stochRsiK: number[];
  stochRsiD: number[];
  plusDI: number[];
  minusDI: number[];
}

export interface MultiTFData {
  tf5m: TimeframeIndicators;
  tf4h: TimeframeIndicators;
  last5mClose: number;
  last4hClose: number;
  symbol: string;
}

export interface StructureResult {
  trend4h: 'bullish' | 'bearish' | 'neutral';
  trend5m: 'bullish' | 'bearish' | 'neutral';
  aligned: boolean;
  trendStrength: number;       // ADX on 4h
  supportLevel: number;
  resistanceLevel: number;
  isBreakout: boolean;
}

export interface KrivisSignal {
  symbol: string;
  action: KrivisAction;
  confidence: number;          // 0–100
  entryPrice: number;
  entryLow: number;            // entry zone lower bound
  entryHigh: number;           // entry zone upper bound
  stopLoss: number;
  takeProfit: number;
  exitPlan: string;            // human-readable exit strategy
  reasoning: string;
  structure: StructureResult;
  riskChecks: RiskCheckResult[];
  riskBlocked: boolean;
  timestamp: string;
}

export interface RiskCheckResult {
  check: string;
  passed: boolean;
  reason: string;
  value?: number;
  limit?: number;
}

export interface HysteresisState {
  lastSignal: KrivisAction;
  lastSignalBar: number;       // bar index when signal was generated
  flipCount: number;
  lastFlipBar: number;
  symbol: string;
  updatedAt: string;
}

export interface DiaryEntry {
  id: string;
  symbol: string;
  action: KrivisAction;
  confidence: number;
  entryPrice: number;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit: number;
  exitPlan: string;
  reasoning: string;
  riskBlocked: boolean;
  riskChecks: RiskCheckResult[];
  structure: StructureResult;
  timestamp: string;
}

export interface KrivisPortfolioState {
  initialValue: number;
  currentValue: number;
  dailyHighValue: number;
  dailyHighDate: string;
  activePositions: KrivisPosition[];
}

export interface KrivisPosition {
  symbol: string;
  action: 'buy' | 'sell';
  entryPrice: number;
  currentPrice: number;
  allocationPct: number;
  stopLoss: number;
  takeProfit: number;
  timestamp: string;
}

/** Defaults for risk validation */
export const KRIVIS_RISK_DEFAULTS = {
  dailyDrawdownBreakerPct: 10,
  balanceReservePct: 20,
  positionSizeCapPct: 10,
  totalExposureCapPct: 50,
  maxLeverage: 10,
  maxConcurrentPositions: 10,
  mandatorySlPct: 5,
  portfolioValue: 100_000,
};

/** Cooldown bars before allowing direction flip */
export const COOLDOWN_BARS = 3;
