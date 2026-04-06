import { StockQuote, IndicatorSnapshot, FullIndicatorData } from '../types';

export function sma(quotes: StockQuote[], period: number): number[] {
  const result = new Array(quotes.length).fill(0);
  for (let i = period - 1; i < quotes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += quotes[j].close;
    result[i] = sum / period;
  }
  return result;
}

export function ema(quotes: StockQuote[], period: number): number[] {
  const result = new Array(quotes.length).fill(0);
  if (quotes.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += quotes[i].close;
  result[period - 1] = sum / period;

  const k = 2 / (period + 1);
  for (let i = period; i < quotes.length; i++) {
    result[i] = quotes[i].close * k + result[i - 1] * (1 - k);
  }
  return result;
}

export function emaFromArray(data: number[], period: number): number[] {
  const result = new Array(data.length).fill(0);
  let startIdx = 0;
  while (startIdx < data.length && data[startIdx] === 0) startIdx++;
  if (startIdx + period > data.length) return result;

  let sum = 0;
  for (let i = startIdx; i < startIdx + period; i++) sum += data[i];
  result[startIdx + period - 1] = sum / period;

  const k = 2 / (period + 1);
  for (let i = startIdx + period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

export function rsi(quotes: StockQuote[], period = 14): number[] {
  const result = new Array(quotes.length).fill(0);
  if (quotes.length < period + 1) return result;

  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = quotes[i].close - quotes[i - 1].close;
    if (change > 0) gainSum += change;
    else lossSum += Math.abs(change);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < quotes.length; i++) {
    const change = quotes[i].close - quotes[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function bollingerBands(quotes: StockQuote[], period = 20, stdDevMult = 2) {
  const middle = sma(quotes, period);
  const upper = new Array(quotes.length).fill(0);
  const lower = new Array(quotes.length).fill(0);

  for (let i = period - 1; i < quotes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = quotes[j].close - middle[i];
      sum += diff * diff;
    }
    const stdDev = Math.sqrt(sum / period);
    upper[i] = middle[i] + stdDevMult * stdDev;
    lower[i] = middle[i] - stdDevMult * stdDev;
  }
  return { upper, middle, lower };
}

export function atr(quotes: StockQuote[], period = 14): number[] {
  const result = new Array(quotes.length).fill(0);
  if (quotes.length < 2) return result;

  const tr = new Array(quotes.length).fill(0);
  tr[0] = quotes[0].high - quotes[0].low;
  for (let i = 1; i < quotes.length; i++) {
    const hl = quotes[i].high - quotes[i].low;
    const hc = Math.abs(quotes[i].high - quotes[i - 1].close);
    const lc = Math.abs(quotes[i].low - quotes[i - 1].close);
    tr[i] = Math.max(hl, hc, lc);
  }

  if (quotes.length >= period) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += tr[i];
    result[period - 1] = sum / period;
    for (let i = period; i < quotes.length; i++)
      result[i] = (result[i - 1] * (period - 1) + tr[i]) / period;
  }
  return result;
}

export function macd(quotes: StockQuote[]): { line: number[]; signal: number[]; histogram: number[] } {
  const ema12Vals = ema(quotes, 12);
  const ema26Vals = ema(quotes, 26);
  const line = new Array(quotes.length).fill(0);

  for (let i = 25; i < quotes.length; i++) {
    line[i] = ema12Vals[i] - ema26Vals[i];
  }

  const signal = emaFromArray(line, 9);
  const histogram = new Array(quotes.length).fill(0);
  for (let i = 0; i < quotes.length; i++) {
    if (line[i] !== 0 && signal[i] !== 0) {
      histogram[i] = line[i] - signal[i];
    }
  }
  return { line, signal, histogram };
}

export function stochastic(quotes: StockQuote[], kPeriod = 14, dPeriod = 3): { k: number[]; d: number[] } {
  const k = new Array(quotes.length).fill(0);
  const d = new Array(quotes.length).fill(0);

  for (let i = kPeriod - 1; i < quotes.length; i++) {
    let highest = -Infinity, lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (quotes[j].high > highest) highest = quotes[j].high;
      if (quotes[j].low < lowest) lowest = quotes[j].low;
    }
    const range = highest - lowest;
    k[i] = range > 0 ? ((quotes[i].close - lowest) / range) * 100 : 50;
  }

  // %D is SMA of %K
  for (let i = kPeriod - 1 + dPeriod - 1; i < quotes.length; i++) {
    let sum = 0;
    for (let j = i - dPeriod + 1; j <= i; j++) sum += k[j];
    d[i] = sum / dPeriod;
  }
  return { k, d };
}

export function vwap(quotes: StockQuote[]): number[] {
  const result = new Array(quotes.length).fill(0);
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (let i = 0; i < quotes.length; i++) {
    const typicalPrice = (quotes[i].high + quotes[i].low + quotes[i].close) / 3;
    cumulativeTPV += typicalPrice * quotes[i].volume;
    cumulativeVolume += quotes[i].volume;
    result[i] = cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : 0;
  }
  return result;
}

export function computeFullIndicators(quotes: StockQuote[]): FullIndicatorData {
  const sma20 = sma(quotes, 20);
  const sma50 = sma(quotes, 50);
  const sma200 = sma(quotes, 200);
  const ema12Vals = ema(quotes, 12);
  const ema26Vals = ema(quotes, 26);
  const rsiVals = rsi(quotes);
  const bb = bollingerBands(quotes);
  const macdData = macd(quotes);
  const stochData = stochastic(quotes);
  const vwapVals = vwap(quotes);
  const atrVals = atr(quotes);

  return {
    sma20, sma50, sma200,
    ema12: ema12Vals, ema26: ema26Vals,
    rsi: rsiVals,
    bollingerUpper: bb.upper, bollingerMiddle: bb.middle, bollingerLower: bb.lower,
    macdLine: macdData.line, macdSignal: macdData.signal, macdHistogram: macdData.histogram,
    stochK: stochData.k, stochD: stochData.d,
    vwap: vwapVals,
    atr: atrVals,
  };
}

export function computeSnapshot(quotes: StockQuote[]): IndicatorSnapshot {
  const empty: IndicatorSnapshot = {
    ma30: 0, ma120: 0, rsi: 0,
    bollingerUpper: 0, bollingerMiddle: 0, bollingerLower: 0,
    atr: 0, maCrossoverBullish: false, isOversold: false, isOverbought: false,
    ema12: 0, ema26: 0, macdLine: 0, macdSignal: 0, macdHistogram: 0,
    stochK: 0, stochD: 0, vwap: 0, fiftyTwoWeekHigh: 0, fiftyTwoWeekLow: 0,
  };
  if (quotes.length < 121) return empty;

  const ma30 = sma(quotes, 30);
  const ma120 = sma(quotes, 120);
  const rsiVals = rsi(quotes);
  const bb = bollingerBands(quotes);
  const atrVals = atr(quotes);
  const ema12Vals = ema(quotes, 12);
  const ema26Vals = ema(quotes, 26);
  const macdData = macd(quotes);
  const stochData = stochastic(quotes);
  const vwapVals = vwap(quotes);

  const last = quotes.length - 1;
  const prev = last - 1;

  // 52-week high/low
  const yearSlice = quotes.slice(Math.max(0, quotes.length - 252));
  const high52 = Math.max(...yearSlice.map(q => q.high));
  const low52 = Math.min(...yearSlice.map(q => q.low));

  return {
    ma30: ma30[last],
    ma120: ma120[last],
    rsi: rsiVals[last],
    bollingerUpper: bb.upper[last],
    bollingerMiddle: bb.middle[last],
    bollingerLower: bb.lower[last],
    atr: atrVals[last],
    maCrossoverBullish: ma30[last] > ma120[last] && (ma30[prev] <= ma120[prev] || ma30[last] > ma120[last]),
    isOversold: rsiVals[last] < 30,
    isOverbought: rsiVals[last] > 70,
    ema12: ema12Vals[last],
    ema26: ema26Vals[last],
    macdLine: macdData.line[last],
    macdSignal: macdData.signal[last],
    macdHistogram: macdData.histogram[last],
    stochK: stochData.k[last],
    stochD: stochData.d[last],
    vwap: vwapVals[last],
    fiftyTwoWeekHigh: high52,
    fiftyTwoWeekLow: low52,
  };
}
