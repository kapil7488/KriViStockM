/**
 * Structure Analyzer — detects 4H/5m alignment, support/resistance,
 * breakouts, and trend structure.
 */
import type { MultiTFData, StructureResult } from '../types';
import { lastValid } from './multiTimeframeEngine';

/** Detect trend from EMA-20/50 relationship + ADX strength */
function detectTrend(
  ema20: number[],
  ema50: number[],
  adxArr: number[],
  plusDI: number[],
  minusDI: number[],
): { trend: 'bullish' | 'bearish' | 'neutral'; strength: number } {
  const e20 = lastValid(ema20);
  const e50 = lastValid(ema50);
  const adxVal = lastValid(adxArr);
  const pdi = lastValid(plusDI);
  const mdi = lastValid(minusDI);

  if (adxVal < 20) return { trend: 'neutral', strength: adxVal };

  // EMA cross + DI confirmation
  if (e20 > e50 && pdi > mdi) return { trend: 'bullish', strength: adxVal };
  if (e20 < e50 && mdi > pdi) return { trend: 'bearish', strength: adxVal };

  // Weak trend — EMA and DI disagree
  if (e20 > e50) return { trend: 'bullish', strength: adxVal * 0.6 };
  if (e20 < e50) return { trend: 'bearish', strength: adxVal * 0.6 };

  return { trend: 'neutral', strength: adxVal };
}

/** Find simple support/resistance from recent swing highs/lows */
function findSupportResistance(
  bbUpper: number[],
  bbLower: number[],
  ema50: number[],
  close: number,
): { support: number; resistance: number } {
  const bbUp = lastValid(bbUpper);
  const bbLow = lastValid(bbLower);
  const e50 = lastValid(ema50);

  // Use Bollinger Bands edges + EMA-50 as dynamic S/R
  const support = Math.min(bbLow, e50 < close ? e50 : bbLow);
  const resistance = Math.max(bbUp, e50 > close ? e50 : bbUp);

  return { support, resistance };
}

/** Detect breakout: price beyond BB + strong ADX + volume confirmation (OBV slope) */
function detectBreakout(
  close: number,
  bbUpper: number[],
  bbLower: number[],
  adxArr: number[],
  obvArr: number[],
): boolean {
  const bbUp = lastValid(bbUpper);
  const bbLow = lastValid(bbLower);
  const adxVal = lastValid(adxArr);

  if (adxVal < 25) return false; // need strong trend for breakout

  // OBV slope — check last 5 bars
  const len = obvArr.length;
  if (len < 6) return false;
  const obvSlope = obvArr[len - 1] - obvArr[len - 5];

  // Bullish breakout: price above BB upper + rising OBV
  if (close > bbUp && obvSlope > 0) return true;
  // Bearish breakout: price below BB lower + falling OBV
  if (close < bbLow && obvSlope < 0) return true;

  return false;
}

export function analyzeStructure(data: MultiTFData): StructureResult {
  const { tf4h, tf5m, last5mClose, last4hClose } = data;

  const trend4hResult = detectTrend(tf4h.ema20, tf4h.ema50, tf4h.adx, tf4h.plusDI, tf4h.minusDI);
  const trend5mResult = detectTrend(tf5m.ema20, tf5m.ema50, tf5m.adx, tf5m.plusDI, tf5m.minusDI);

  // Aligned = both timeframes agree on direction (or 5m neutral is OK)
  const aligned = trend4hResult.trend === trend5mResult.trend
    || trend5mResult.trend === 'neutral';

  const sr = findSupportResistance(tf4h.bbUpper, tf4h.bbLower, tf4h.ema50, last4hClose);
  const isBreakout = detectBreakout(last5mClose, tf5m.bbUpper, tf5m.bbLower, tf5m.adx, tf5m.obv);

  return {
    trend4h: trend4hResult.trend,
    trend5m: trend5mResult.trend,
    aligned,
    trendStrength: trend4hResult.strength,
    supportLevel: sr.support,
    resistanceLevel: sr.resistance,
    isBreakout,
  };
}
