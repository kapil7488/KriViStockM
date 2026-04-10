/**
 * Multi-Timeframe Engine — fetches 5m + 4H candle data and computes
 * the full indicator suite for each timeframe.
 */
import { StockQuote, Market } from '../../types';
import { fetchYahooIntraday } from '../../services/stockApi';
import {
  ema, rsi, macd, atr, bollingerBands, vwap,
  adx, obv, stochasticRSI, directionalIndicators,
} from '../../services/indicators';
import type { TimeframeIndicators, MultiTFData } from '../types';

/** Compute the full indicator suite from an array of quotes */
function computeTFIndicators(quotes: StockQuote[]): TimeframeIndicators {
  const ema20 = ema(quotes, 20);
  const ema50 = ema(quotes, 50);
  const rsi7 = rsi(quotes, 7);
  const rsi14 = rsi(quotes, 14);
  const macdData = macd(quotes);
  const atr3 = atr(quotes, 3);
  const atr14 = atr(quotes, 14);
  const bb = bollingerBands(quotes);
  const adxVals = adx(quotes);
  const obvVals = obv(quotes);
  const vwapVals = vwap(quotes);
  const stochRsi = stochasticRSI(quotes);
  const di = directionalIndicators(quotes);

  return {
    ema20, ema50, rsi7, rsi14,
    macdLine: macdData.line,
    macdSignal: macdData.signal,
    macdHistogram: macdData.histogram,
    atr3, atr14,
    bbUpper: bb.upper, bbMiddle: bb.middle, bbLower: bb.lower,
    adx: adxVals,
    obv: obvVals,
    vwap: vwapVals,
    stochRsiK: stochRsi.k, stochRsiD: stochRsi.d,
    plusDI: di.plusDI, minusDI: di.minusDI,
  };
}

/**
 * Aggregate 1-hour bars into 4-hour OHLCV candles.
 * Groups by 4-hour blocks (bars 0–3, 4–7, etc.)
 */
function aggregate4H(hourlyQuotes: StockQuote[]): StockQuote[] {
  const result: StockQuote[] = [];
  for (let i = 0; i < hourlyQuotes.length; i += 4) {
    const chunk = hourlyQuotes.slice(i, i + 4);
    if (chunk.length === 0) continue;
    result.push({
      timestamp: chunk[0].timestamp,
      open: chunk[0].open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, c) => s + c.volume, 0),
    });
  }
  return result;
}

/**
 * Fetch multi-timeframe data for a symbol:
 * - 5m candles (up to 1 month of data from Yahoo)
 * - 4H candles (aggregate from 1h data, up to 6 months)
 */
export async function fetchMultiTFData(symbol: string, market: Market): Promise<MultiTFData> {
  // Fetch 5m and 1h in parallel
  const [raw5m, raw1h] = await Promise.all([
    fetchYahooIntraday(symbol, '5m', 30, market),    // 5m bars, ~1 month
    fetchYahooIntraday(symbol, '1H', 90, market),    // 1h bars, ~3 months → aggregate to 4h
  ]);

  if (raw5m.length < 50) throw new Error(`Insufficient 5m data for ${symbol} (${raw5m.length} bars)`);
  if (raw1h.length < 20) throw new Error(`Insufficient 1h data for ${symbol} (${raw1h.length} bars)`);

  // Aggregate 1h → 4h
  const raw4h = aggregate4H(raw1h);

  const tf5m = computeTFIndicators(raw5m);
  const tf4h = computeTFIndicators(raw4h);

  return {
    tf5m,
    tf4h,
    last5mClose: raw5m[raw5m.length - 1].close,
    last4hClose: raw4h[raw4h.length - 1].close,
    symbol,
  };
}

/** Get the last valid value from an indicator array */
export function lastValid(arr: number[]): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== 0) return arr[i];
  }
  return 0;
}
