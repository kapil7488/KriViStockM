import { useState, useRef, useEffect, useCallback } from 'react';
import { Market, StockSignal, StockBar, LiveQuote, IndicatorSnapshot, FundamentalData } from '../types';
import { fetchYahooHistorical } from '../services/stockApi';
import { computeSnapshot } from '../services/indicators';
import { generateSignal } from '../services/scoringEngine';
import { getScanUniverse } from '../services/stockScanner';
import { DEFAULT_RISK_PARAMS } from '../types';

// ── Types ──────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

interface ChatPanelProps {
  market: Market;
  currency: string;
  symbol: string;
  signal: StockSignal | null;
  stockData: StockBar | null;
  liveQuote: LiveQuote | null;
  fundamentals: FundamentalData | null;
  onSelectSymbol: (s: string) => void;
}

// ── Knowledge Base ──────────────────────────────────────────────
const INDICATOR_KB: Record<string, string> = {
  rsi: `**RSI (Relative Strength Index)** measures momentum on a 0–100 scale.\n• **Below 30** → Oversold — the stock has been sold heavily and may bounce. Often a **bullish** entry signal.\n• **Above 70** → Overbought — the stock is stretched to the upside and may pull back. Can be **bearish** or a sign of strong trend.\n• **30–70** → Neutral zone.\n• Best used with other indicators for confirmation. RSI divergence (price makes new high but RSI doesn't) is a powerful reversal signal.`,
  macd: `**MACD (Moving Average Convergence Divergence)** tracks trend momentum.\n• **MACD line crosses above Signal line** → Bullish crossover (buy signal).\n• **MACD line crosses below Signal line** → Bearish crossover (sell signal).\n• **Histogram > 0 and growing** → Bullish momentum increasing.\n• **Histogram < 0 and shrinking** → Bearish momentum weakening.\n• Works best in trending markets. In sideways markets it can give false signals.`,
  bollinger: `**Bollinger Bands** measure volatility and identify breakouts.\n• **Price at/below lower band** → Oversold, potential bounce (bullish).\n• **Price at/above upper band** → Overbought, potential pullback (bearish).\n• **Band squeeze (narrow bands)** → Low volatility, breakout imminent. Direction TBD.\n• **%B value**: 0 = at lower band, 1 = at upper band. Below 0 or above 1 = extreme.\n• Squeeze + volume expansion = strong breakout trade setup.`,
  vwap: `**VWAP (Volume-Weighted Average Price)** is the benchmark institutional traders use.\n• **Price above VWAP** → Bullish bias, institutions are net buyers.\n• **Price below VWAP** → Bearish bias, institutions are net sellers.\n• **Price crossing above VWAP** → Bullish signal (buy).\n• **Price crossing below VWAP** → Bearish signal (sell).\n• Best for intraday trading. Resets daily. Not useful on daily charts beyond 1 day.`,
  stochastic: `**Stochastic Oscillator** measures where the close is relative to the recent range.\n• **%K below 20** → Oversold (possible buy).\n• **%K above 80** → Overbought (possible sell).\n• **%K crosses above %D in oversold zone** → Strong buy signal.\n• **%K crosses below %D in overbought zone** → Strong sell signal.\n• Mid-range crossovers are weaker signals.`,
  'sma-cross': `**SMA (Simple Moving Average) Cross** identifies major trend changes.\n• **SMA 50 crosses above SMA 200** → **Golden Cross** — classic bullish signal. Historically marks start of bull runs.\n• **SMA 50 crosses below SMA 200** → **Death Cross** — classic bearish signal.\n• **SMA 50 > SMA 200** → Overall uptrend.\n• This is a slow, lagging indicator — best for swing/positional trades (weeks to months).`,
  'ema-cross': `**EMA (Exponential Moving Average) Cross** is a faster trend indicator.\n• **EMA 12 crosses above EMA 26** → Bullish crossover — good for short-term trades.\n• **EMA 12 crosses below EMA 26** → Bearish crossover.\n• Faster than SMA cross, more responsive to price changes.\n• Best for swing trades (days to weeks) or confirming momentum.`,
  atr: `**ATR (Average True Range)** measures volatility, not direction.\n• **High ATR** → High volatility — wider stop losses needed, bigger moves expected.\n• **Low ATR** → Low volatility — tight range, breakout may be coming.\n• **Expanding ATR** → Volatility increasing (often near breakouts or breakdowns).\n• **Contracting ATR** → Market is compressing, preparing for a move.\n• Use ATR to set stop losses: typically 1.5–2× ATR below entry.`,
  overbought: `**Overbought** means a stock's price has risen too fast relative to its recent average.\n• RSI > 70 or Stochastic %K > 80 signals overbought.\n• It does NOT automatically mean "sell" — strong uptrends stay overbought for weeks.\n• In a **strong trend**: overbought = momentum confirmation, wait for pullback to buy.\n• In a **range-bound market**: overbought = potential reversal point, consider selling.\n• Always confirm with other indicators (volume, MACD, price action).`,
  oversold: `**Oversold** means a stock's price has dropped too fast relative to its recent average.\n• RSI < 30 or Stochastic %K < 20 signals oversold.\n• In a **downtrend**: oversold can get "more oversold" — don't blindly buy.\n• In a **range-bound market**: oversold = potential bounce point, consider buying.\n• Best oversold buy signals: RSI < 30 + bullish MACD crossover + price at support + increasing volume.`,
  'golden-cross': `**Golden Cross** occurs when the 50-day SMA crosses above the 200-day SMA.\n• One of the most watched bullish signals in technical analysis.\n• Historically, stocks gain 10–15% on average in the 6 months following a golden cross.\n• Works best with increasing volume confirmation.\n• It's a **lagging** indicator — by the time it appears, the trend has already started.`,
  'death-cross': `**Death Cross** occurs when the 50-day SMA crosses below the 200-day SMA.\n• Classic bearish signal indicating potential for extended downtrend.\n• Not always reliable — sometimes triggers near market bottoms.\n• Confirm with other indicators (RSI, MACD, volume pattern) before acting.`,
};

const TRADING_KB: Record<string, string> = {
  intraday: `**Intraday Trading** means buying and selling within the same trading day.\n• **Best indicators**: VWAP, RSI (5-period), Stochastic, EMA 9/21 cross.\n• **Timeframe**: 1-minute to 15-minute charts.\n• **Entry signals**: Price crossing VWAP with volume, RSI bouncing from oversold, EMA crossover.\n• **Stop loss**: Tight — typically 0.5–1% or 1× ATR.\n• **Target**: 1–3% or 2× risk.\n• **Best time**: First 1 hour and last 1 hour of market have most volatility.`,
  swing: `**Swing Trading** means holding positions for days to weeks.\n• **Best indicators**: MACD crossover, EMA 12/26 cross, RSI divergence, Bollinger Band squeeze.\n• **Timeframe**: Daily and 4-hour charts.\n• **Entry signals**: MACD bullish crossover + RSI > 50 + price above EMA 26.\n• **Stop loss**: Below recent swing low or 2× ATR.\n• **Target**: 5–15% or next resistance level.\n• **Holding period**: 3–15 trading days typically.`,
  positional: `**Positional Trading** means holding for weeks to months.\n• **Best indicators**: SMA 50/200 cross (Golden/Death Cross), weekly MACD, monthly RSI.\n• **Timeframe**: Daily and weekly charts.\n• **Entry signals**: Golden Cross + fundamentals support + sector strength.\n• **Stop loss**: 8–15% below entry or below 200-day SMA.\n• **Target**: 20–50%+ or based on fundamental valuation.\n• **Holding period**: 1–6 months.`,
  stoploss: `**Stop Loss** protects your capital by automatically exiting a losing trade.\n• **Fixed %**: Set at a fixed percentage below entry (e.g., 2% for intraday, 5% for swing).\n• **ATR-based**: 1.5–2× ATR below entry — adapts to volatility.\n• **Support-based**: Place just below the nearest support level.\n• **Trailing stop**: Moves up as price rises, locks in profits.\n• **Rule of thumb**: Never risk more than 1–2% of your total capital on a single trade.`,
  'risk-reward': `**Risk-Reward Ratio** compares potential loss to potential gain.\n• **1:2 minimum** — risk ₹1 to make ₹2. This means you can be wrong 50% of the time and still profit.\n• **1:3** — excellent. You only need to be right 33% of the time.\n• The app calculates this automatically: (Take Profit - Entry) / (Entry - Stop Loss).\n• Never take a trade with risk-reward below 1:1.5.`,
};

// ── Market-aware symbol validation ─────────────────────────────
const KNOWN_US = ['AAPL','MSFT','GOOGL','AMZN','TSLA','NVDA','META','JPM','NFLX','AMD','V','MA','DIS','PYPL','INTC','CRM','ADBE','CSCO','PEP','KO','WMT','HD','UNH','JNJ','PG','XOM','CVX','BAC','GS','COST','BRK-B','MRK','ABBV','LLY','AVGO','MCD'];
const KNOWN_INDIA = ['RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','BHARTIARTL','SBIN','ITC','HINDUNILVR','LT','KOTAKBANK','AXISBANK','BAJFINANCE','MARUTI','TITAN','SUNPHARMA','HCLTECH','NTPC','POWERGRID','TATAMOTORS','WIPRO','ONGC','ULTRACEMCO','ADANIENT','TECHM','INDUSINDBK','NESTLEIND','JSWSTEEL','TATASTEEL','COALINDIA'];
const KNOWN_CRYPTO = ['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','DOT','MATIC','SHIB','TRX','LINK','UNI','ATOM','LTC','BCH','NEAR','APT','FIL'];

function isSymbolValidForMarket(sym: string, market: Market): boolean {
  const upper = sym.toUpperCase().replace(/-USD$/, '');
  if (market === 'US') return !KNOWN_INDIA.includes(upper) && !KNOWN_CRYPTO.includes(upper);
  if (market === 'NSE' || market === 'BSE') return !KNOWN_US.includes(upper) && !KNOWN_CRYPTO.includes(upper);
  if (market === 'CRYPTO') return !KNOWN_US.includes(upper) && !KNOWN_INDIA.includes(upper);
  return true;
}

function wrongMarketHint(sym: string, market: Market): string {
  const upper = sym.toUpperCase().replace(/-USD$/, '');
  if (KNOWN_US.includes(upper)) return `**${sym}** is a US stock. Switch to the **US Market** to analyze it.`;
  if (KNOWN_INDIA.includes(upper)) return `**${sym}** is an Indian stock (NSE/BSE). Switch to the **NSE** or **BSE** market to analyze it.`;
  if (KNOWN_CRYPTO.includes(upper)) return `**${sym}** is a cryptocurrency. Switch to the **Crypto** market to analyze it.`;
  return `**${sym}** doesn't appear to be a valid ${market} symbol.`;
}

// ── Quick-analysis runner ──────────────────────────────────────
async function quickAnalyze(sym: string, market: Market): Promise<{ signal: StockSignal; snap: IndicatorSnapshot } | null> {
  try {
    const data = await fetchYahooHistorical(sym, market);
    if (data.quotes.length < 121) return null;
    const signal = generateSignal(sym, data.quotes, DEFAULT_RISK_PARAMS);
    const snap = computeSnapshot(data.quotes);
    return { signal, snap };
  } catch { return null; }
}

// ── Company name → ticker mapping ──────────────────────────────
const NAME_TO_TICKER: Record<string, string> = {
  // US
  apple: 'AAPL', microsoft: 'MSFT', google: 'GOOGL', alphabet: 'GOOGL', amazon: 'AMZN',
  tesla: 'TSLA', nvidia: 'NVDA', meta: 'META', facebook: 'META', netflix: 'NFLX',
  jpmorgan: 'JPM', 'jp morgan': 'JPM', amd: 'AMD', visa: 'V', mastercard: 'MA',
  disney: 'DIS', paypal: 'PYPL', intel: 'INTC', cisco: 'CSCO', pepsi: 'PEP',
  'coca cola': 'KO', coke: 'KO', walmart: 'WMT', 'home depot': 'HD',
  boeing: 'BA', goldman: 'GS', 'goldman sachs': 'GS', costco: 'COST',
  salesforce: 'CRM', adobe: 'ADBE', oracle: 'ORCL', qualcomm: 'QCOM',
  starbucks: 'SBUX', caterpillar: 'CAT', deere: 'DE', 'john deere': 'DE',
  // India
  reliance: 'RELIANCE', tcs: 'TCS', 'tata consultancy': 'TCS', infosys: 'INFY', infy: 'INFY',
  hdfc: 'HDFCBANK', 'hdfc bank': 'HDFCBANK', icici: 'ICICIBANK', 'icici bank': 'ICICIBANK',
  sbi: 'SBIN', 'state bank': 'SBIN', bharti: 'BHARTIARTL', airtel: 'BHARTIARTL',
  itc: 'ITC', hindustan: 'HINDUNILVR', hul: 'HINDUNILVR', 'l&t': 'LT', 'larsen': 'LT',
  kotak: 'KOTAKBANK', 'kotak bank': 'KOTAKBANK', axis: 'AXISBANK', 'axis bank': 'AXISBANK',
  bajaj: 'BAJFINANCE', 'bajaj finance': 'BAJFINANCE', maruti: 'MARUTI', titan: 'TITAN',
  'sun pharma': 'SUNPHARMA', sunpharma: 'SUNPHARMA', hcl: 'HCLTECH', 'hcl tech': 'HCLTECH',
  ntpc: 'NTPC', 'power grid': 'POWERGRID', powergrid: 'POWERGRID',
  'tata motors': 'TATAMOTORS', tatamotors: 'TATAMOTORS', wipro: 'WIPRO', ongc: 'ONGC',
  adani: 'ADANIENT', 'tech mahindra': 'TECHM', techm: 'TECHM',
  'tata steel': 'TATASTEEL', tatasteel: 'TATASTEEL', 'coal india': 'COALINDIA',
  'asian paints': 'ASIANPAINT', asianpaint: 'ASIANPAINT', nestle: 'NESTLEIND',
  // Crypto
  bitcoin: 'BTC-USD', btc: 'BTC-USD', ethereum: 'ETH-USD', eth: 'ETH-USD',
  solana: 'SOL-USD', sol: 'SOL-USD', ripple: 'XRP-USD', xrp: 'XRP-USD',
  cardano: 'ADA-USD', ada: 'ADA-USD', dogecoin: 'DOGE-USD', doge: 'DOGE-USD',
  bnb: 'BNB-USD', binance: 'BNB-USD', avalanche: 'AVAX-USD', avax: 'AVAX-USD',
  polkadot: 'DOT-USD', dot: 'DOT-USD', polygon: 'MATIC-USD', matic: 'MATIC-USD',
  litecoin: 'LTC-USD', ltc: 'LTC-USD', chainlink: 'LINK-USD', link: 'LINK-USD',
};

/** Try to resolve a natural language name or partial ticker to a valid symbol */
function resolveSymbol(text: string): string | null {
  const lower = text.toLowerCase().trim();
  // Direct match in name map (try multi-word first, then single)
  for (const [name, ticker] of Object.entries(NAME_TO_TICKER)) {
    if (lower === name || lower.includes(name)) return ticker;
  }
  // If it looks like a ticker already (all caps, 1-10 chars)
  const upper = text.toUpperCase().trim();
  if (/^[A-Z]{1,10}(-USD)?$/.test(upper)) return upper;
  return null;
}

// ── Intent parser ──────────────────────────────────────────────
type Intent =
  | { type: 'explain_indicator'; indicator: string }
  | { type: 'explain_trading'; topic: string }
  | { type: 'analyze_stock'; symbol: string }
  | { type: 'compare_stocks'; symbols: string[] }
  | { type: 'current_signal' }
  | { type: 'best_intraday' }
  | { type: 'best_swing' }
  | { type: 'general_question'; query: string };

const STOP_WORDS = new Set(['is','a','the','and','for','how','why','what','can','does','this','that','with','from','best','top','good','bad','should','i','buy','sell','it','do','to','in','of','on','my','me','will','be','an','or','not','are','was','have','has','been','would','could','any','there','about','stock','share','crypto','coin','token','market']);

function parseIntent(input: string, _currentSymbol: string): Intent {
  const lower = input.toLowerCase().trim();

  // Explain indicators
  for (const key of Object.keys(INDICATOR_KB)) {
    if (lower.includes(key.replace('-', ' ')) || lower.includes(key)) {
      if (lower.includes('what') || lower.includes('explain') || lower.includes('mean') || lower.includes('how') || lower.includes('tell') || lower.includes('about')) {
        return { type: 'explain_indicator', indicator: key };
      }
    }
  }
  if (/\b(overbought)\b/.test(lower)) return { type: 'explain_indicator', indicator: 'overbought' };
  if (/\b(oversold)\b/.test(lower)) return { type: 'explain_indicator', indicator: 'oversold' };
  if (/\b(golden cross)\b/.test(lower)) return { type: 'explain_indicator', indicator: 'golden-cross' };
  if (/\b(death cross)\b/.test(lower)) return { type: 'explain_indicator', indicator: 'death-cross' };

  // Trading topics
  for (const key of Object.keys(TRADING_KB)) {
    if (lower.includes(key.replace('-', ' ')) || lower.includes(key)) {
      return { type: 'explain_trading', topic: key };
    }
  }
  if (lower.includes('stop loss') || lower.includes('stoploss')) return { type: 'explain_trading', topic: 'stoploss' };
  if (lower.includes('risk reward') || lower.includes('risk-reward') || lower.includes('r:r')) return { type: 'explain_trading', topic: 'risk-reward' };

  // Best for intraday / swing
  if ((lower.includes('best') || lower.includes('top') || lower.includes('recommend')) && lower.includes('intraday')) {
    return { type: 'best_intraday' };
  }
  if ((lower.includes('best') || lower.includes('top') || lower.includes('recommend')) && (lower.includes('swing') || lower.includes('short term'))) {
    return { type: 'best_swing' };
  }

  // Compare stocks (try name resolution)
  const compareMatch = lower.match(/(?:compare|vs|versus)\s+(.+?)\s+(?:and|vs|versus|with|,)\s+(.+?)(?:\s|$)/i);
  if (compareMatch) {
    const s1 = resolveSymbol(compareMatch[1]);
    const s2 = resolveSymbol(compareMatch[2]);
    if (s1 && s2) return { type: 'compare_stocks', symbols: [s1, s2] };
  }

  // Current signal question
  if (lower.includes('current signal') || lower.includes('my signal') ||
      (lower.includes('should') && lower.includes('buy') && !resolveSymbol(lower.replace(/should\s+i\s+buy\s+/i, '').trim()))) {
    return { type: 'current_signal' };
  }

  // Explicit analyze command with name resolution
  const analyzeMatch = lower.match(/(?:analyze|analysis|check|look at|scan|review|tell me about)\s+(.+)/i);
  if (analyzeMatch) {
    const sym = resolveSymbol(analyzeMatch[1]);
    if (sym) return { type: 'analyze_stock', symbol: sym };
  }

  // "is X good buy", "should I buy X", "X is good?", "buy X?", "sell X?"
  // Try to find a company/ticker name in the sentence
  const resolved = tryExtractStockFromSentence(lower);
  if (resolved) {
    return { type: 'analyze_stock', symbol: resolved };
  }

  // Bare "buy or sell" without a stock
  if (lower.includes('buy or sell') || (lower.includes('should') && (lower.includes('buy') || lower.includes('sell')))) {
    return { type: 'current_signal' };
  }

  return { type: 'general_question', query: input };
}

/** Extract a stock/crypto name from a natural language sentence */
function tryExtractStockFromSentence(sentence: string): string | null {
  // First try multi-word company names (longest match first)
  const sortedNames = Object.keys(NAME_TO_TICKER).sort((a, b) => b.length - a.length);
  for (const name of sortedNames) {
    if (sentence.includes(name)) return NAME_TO_TICKER[name];
  }
  // Then try remaining non-stop-words as potential tickers
  const words = sentence.split(/\s+/).filter(w => !STOP_WORDS.has(w) && w.length >= 2);
  for (const word of words) {
    const cleaned = word.replace(/[?!.,]/g, '');
    const sym = resolveSymbol(cleaned);
    if (sym && sym.length >= 2) return sym;
  }
  return null;
}

// ── Response generators ────────────────────────────────────────
function formatSignalResponse(sym: string, sig: StockSignal, snap: IndicatorSnapshot, currency: string): string {
  const cs = currency === 'INR' ? '₹' : '$';
  const emoji = sig.signal === 'StrongBuy' ? '🟢🟢' : sig.signal === 'Buy' ? '🟢' : sig.signal === 'Hold' ? '🟡' : sig.signal === 'Sell' ? '🔴' : '🔴🔴';

  // Count bullish/bearish models
  const bullish = sig.models.filter(m => m.signal === 'StrongBuy' || m.signal === 'Buy').length;
  const bearish = sig.models.filter(m => m.signal === 'Sell' || m.signal === 'StrongSell').length;

  // Determine trade type
  let tradeType = '';
  if (snap.atr / sig.entryPrice > 0.03) {
    tradeType = 'Swing or Positional (high volatility)';
  } else if (snap.atr / sig.entryPrice > 0.015) {
    tradeType = 'Swing trade (moderate volatility)';
  } else {
    tradeType = 'Intraday or Short Swing (low volatility)';
  }

  const rr = sig.takeProfit && sig.stopLoss && sig.entryPrice
    ? ((sig.takeProfit - sig.entryPrice) / (sig.entryPrice - sig.stopLoss)).toFixed(1)
    : 'N/A';

  let response = `## ${emoji} ${sym} — ${sig.signal} (${(sig.modelScore * 100).toFixed(0)}% confidence)\n\n`;
  response += `**Price:** ${cs}${sig.entryPrice.toFixed(2)}\n`;
  response += `**Stop Loss:** ${cs}${sig.stopLoss.toFixed(2)} | **Target:** ${cs}${sig.takeProfit.toFixed(2)}\n`;
  response += `**Risk-Reward:** 1:${rr}\n`;
  response += `**Suggested Trade Type:** ${tradeType}\n\n`;

  response += `### Algo Model Scores\n`;
  response += `${bullish} of ${sig.models.length} models say **Buy**, ${bearish} say **Sell**\n\n`;
  sig.models.forEach(m => {
    const me = m.signal === 'StrongBuy' || m.signal === 'Buy' ? '🟢' : m.signal === 'Hold' ? '🟡' : '🔴';
    response += `• ${me} **${m.name}**: ${(m.score * 100).toFixed(0)}% → ${m.signal} (conf: ${(m.confidence * 100).toFixed(0)}%)\n`;
  });

  response += `\n### Key Indicators\n`;
  response += `• RSI: **${snap.rsi.toFixed(1)}** ${snap.isOversold ? '(Oversold 🟢)' : snap.isOverbought ? '(Overbought 🔴)' : '(Neutral)'}\n`;
  response += `• MACD: Line ${snap.macdLine.toFixed(3)} vs Signal ${snap.macdSignal.toFixed(3)} ${snap.macdLine > snap.macdSignal ? '(Bullish ↑)' : '(Bearish ↓)'}\n`;
  response += `• Stochastic: %K=${snap.stochK.toFixed(1)}, %D=${snap.stochD.toFixed(1)} ${snap.stochK < 20 ? '(Oversold)' : snap.stochK > 80 ? '(Overbought)' : ''}\n`;
  response += `• SMA Cross: ${snap.maCrossoverBullish ? '🟢 Bullish (SMA50 > SMA200)' : '🔴 Bearish (SMA50 < SMA200)'}\n`;
  response += `• ATR: ${snap.atr.toFixed(2)} (${((snap.atr / sig.entryPrice) * 100).toFixed(1)}% of price)\n`;
  response += `• VWAP: ${cs}${snap.vwap.toFixed(2)} ${sig.entryPrice > snap.vwap ? '(Price above VWAP ↑)' : '(Price below VWAP ↓)'}\n`;
  response += `• Bollinger: Upper ${cs}${snap.bollingerUpper.toFixed(2)} | Mid ${cs}${snap.bollingerMiddle.toFixed(2)} | Lower ${cs}${snap.bollingerLower.toFixed(2)}\n`;

  response += `\n### Trading Recommendation\n`;
  if (sig.signal === 'StrongBuy' || sig.signal === 'Buy') {
    response += `✅ **${sig.signal}** signal. `;
    if (snap.isOversold) response += `RSI is oversold which adds confidence. `;
    if (snap.maCrossoverBullish && snap.macdLine > snap.macdSignal) response += `Both SMA cross and MACD confirm the uptrend. `;
    response += `Entry at ${cs}${sig.entryPrice.toFixed(2)}, target ${cs}${sig.takeProfit.toFixed(2)} (${((sig.takeProfit / sig.entryPrice - 1) * 100).toFixed(1)}% upside).\n`;
    response += `\n**Duration:** ${tradeType}. ${snap.atr / sig.entryPrice > 0.02 ? 'Higher volatility suggests this is better for swing trading (hold 3–10 days).' : 'Low volatility suggests this could work for intraday or 1–3 day holding.'}`;
  } else if (sig.signal === 'Hold') {
    response += `⏸️ **Hold** signal. Mixed indicators — no strong edge either way. Wait for a clearer setup.`;
  } else {
    response += `⚠️ **${sig.signal}** signal. `;
    if (snap.isOverbought) response += `RSI is overbought, confirming weakness. `;
    response += `Avoid new long positions. If already holding, consider trailing stop at ${cs}${sig.stopLoss.toFixed(2)}.`;
  }

  return response;
}

function formatCurrentSignalResponse(symbol: string, signal: StockSignal | null, liveQuote: LiveQuote | null, currency: string): string {
  if (!signal) return `No signal available yet. Type a stock symbol or click Analyze first.`;

  const cs = currency === 'INR' ? '₹' : '$';
  const bullish = signal.models.filter(m => m.signal === 'StrongBuy' || m.signal === 'Buy').length;
  const total = signal.models.length;

  let text = `## Current Signal for ${symbol}\n\n`;
  text += `**Signal:** ${signal.signal} | **Score:** ${(signal.modelScore * 100).toFixed(0)}%\n`;
  text += `**${bullish}/${total} models** are bullish.\n\n`;

  if (liveQuote) {
    text += `**Live Price:** ${cs}${liveQuote.lastPrice.toFixed(2)} (${liveQuote.percentChange >= 0 ? '+' : ''}${liveQuote.percentChange.toFixed(2)}%)\n`;
  }

  text += `**Entry:** ${cs}${signal.entryPrice.toFixed(2)} | **SL:** ${cs}${signal.stopLoss.toFixed(2)} | **TP:** ${cs}${signal.takeProfit.toFixed(2)}\n\n`;
  text += `💡 *Ask me "analyze ${symbol}" for a detailed breakdown, or ask about specific indicators like "what does RSI mean?"*`;

  return text;
}

// ── Suggested prompts ──────────────────────────────────────────
const US_SUGGESTIONS = [
  '🔍 Analyze AAPL',
  '📊 What does RSI mean?',
  '💡 Best stock for intraday?',
  '📈 What is Overbought?',
  '🎯 What is swing trading?',
  '⚡ Current signal',
];

const INDIA_SUGGESTIONS = [
  '🔍 Analyze RELIANCE',
  '📊 What does MACD mean?',
  '💡 Best stock for intraday?',
  '📈 What is Golden Cross?',
  '🎯 Compare TCS and INFY',
  '⚡ Current signal',
];

const CRYPTO_SUGGESTIONS = [
  '🔍 Analyze BTC',
  '📊 What does MACD mean?',
  '💡 Best crypto for swing?',
  '📈 What is Bollinger Bands?',
  '🎯 What is risk reward?',
  '⚡ Current signal',
];

function getMarketLabel(market: Market): string {
  if (market === 'NSE') return 'NSE (India)';
  if (market === 'BSE') return 'BSE (India)';
  if (market === 'CRYPTO') return 'Crypto';
  return 'US Market';
}

function getMarketExamples(market: Market): string {
  if (market === 'NSE' || market === 'BSE') return 'e.g. RELIANCE, TCS, INFY, HDFCBANK';
  if (market === 'CRYPTO') return 'e.g. BTC, ETH, SOL, XRP';
  return 'e.g. AAPL, MSFT, TSLA, NVDA';
}

// ── Component ──────────────────────────────────────────────────
export function ChatPanel({ market, currency, symbol, signal, stockData: _stockData, liveQuote, fundamentals: _fundamentals, onSelectSymbol }: ChatPanelProps) {
  const mktLabel = getMarketLabel(market);
  const mktExamples = getMarketExamples(market);
  const isIndian = market === 'NSE' || market === 'BSE';
  const isCrypto = market === 'CRYPTO';
  const assetWord = isCrypto ? 'crypto' : 'stock';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevMarketRef = useRef(market);

  const suggestions = isCrypto ? CRYPTO_SUGGESTIONS : isIndian ? INDIA_SUGGESTIONS : US_SUGGESTIONS;

  // Reset chat with market-aware welcome when market changes
  useEffect(() => {
    const welcome: ChatMessage = {
      id: `welcome-${market}-${Date.now()}`,
      role: 'assistant',
      text: `👋 Hey! I'm your **${mktLabel} Trading Assistant**.\n\nYou're on the **${mktLabel}** market. I'll only analyze ${assetWord}s available here (${mktExamples}).\n\n• 🔍 **Analyze** — "Analyze ${isIndian ? 'RELIANCE' : isCrypto ? 'BTC' : 'AAPL'}"\n• 📊 **Indicators** — "What does RSI mean?"\n• 🏆 **Top picks** — "Best ${assetWord} for intraday?"\n• ⚡ **Current signal** — breakdown of ${symbol}\n\nTry the suggestions below!`,
      timestamp: Date.now(),
    };
    setMessages([welcome]);
    prevMarketRef.current = market;
  }, [market]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const addMessage = (role: 'user' | 'assistant', text: string) => {
    setMessages(prev => [...prev, {
      id: `${Date.now()}-${Math.random()}`,
      role,
      text,
      timestamp: Date.now(),
    }]);
  };

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || thinking) return;
    setInput('');
    addMessage('user', msg);
    setThinking(true);

    try {
      const intent = parseIntent(msg, symbol);
      let response = '';

      switch (intent.type) {
        case 'explain_indicator':
          response = INDICATOR_KB[intent.indicator] || `I don't have detailed info on "${intent.indicator}" yet. Try asking about RSI, MACD, Bollinger Bands, VWAP, Stochastic, SMA Cross, EMA Cross, or ATR.`;
          break;

        case 'explain_trading':
          response = TRADING_KB[intent.topic] || `I don't have detailed info on "${intent.topic}" yet. Try asking about intraday trading, swing trading, positional trading, stop loss, or risk-reward ratio.`;
          break;

        case 'current_signal':
          response = formatCurrentSignalResponse(symbol, signal, liveQuote, currency);
          break;

        case 'analyze_stock': {
          const sym = intent.symbol;
          if (!isSymbolValidForMarket(sym, market)) {
            response = `⚠️ ${wrongMarketHint(sym, market)}\n\nI'm currently set to **${mktLabel}**. I can analyze: ${mktExamples}.`;
            break;
          }
          addMessage('assistant', `🔄 Analyzing **${sym}** on ${mktLabel}... Fetching data from Yahoo Finance.`);
          const result = await quickAnalyze(sym, market);
          if (result) {
            response = formatSignalResponse(sym, result.signal, result.snap, currency);
            onSelectSymbol(sym);
          } else {
            response = `❌ Could not analyze **${sym}**. Make sure the symbol is valid for the ${mktLabel}. Try: ${mktExamples}.`;
          }
          break;
        }

        case 'compare_stocks': {
          const syms = intent.symbols;
          const invalid = syms.filter(s => !isSymbolValidForMarket(s, market));
          if (invalid.length > 0) {
            response = `⚠️ ${invalid.map(s => wrongMarketHint(s, market)).join('\n')}\n\nSwitch markets or use ${assetWord}s available on **${mktLabel}** (${mktExamples}).`;
            break;
          }
          addMessage('assistant', `🔄 Comparing **${syms.join(' vs ')}** on ${mktLabel}... Fetching data.`);
          const results = await Promise.all(syms.map(s => quickAnalyze(s, market)));

          response = `## 📊 ${syms.join(' vs ')} Comparison\n\n`;
          const cs = currency === 'INR' ? '₹' : '$';

          for (let i = 0; i < syms.length; i++) {
            const r = results[i];
            if (r) {
              const bullish = r.signal.models.filter(m => m.signal === 'StrongBuy' || m.signal === 'Buy').length;
              response += `### ${syms[i]}: ${r.signal.signal} (${(r.signal.modelScore * 100).toFixed(0)}%)\n`;
              response += `• Price: ${cs}${r.signal.entryPrice.toFixed(2)} | RSI: ${r.snap.rsi.toFixed(1)} | ${bullish}/${r.signal.models.length} models bullish\n`;
              response += `• Target: ${cs}${r.signal.takeProfit.toFixed(2)} (${((r.signal.takeProfit / r.signal.entryPrice - 1) * 100).toFixed(1)}% upside)\n\n`;
            } else {
              response += `### ${syms[i]}: ❌ Data unavailable\n\n`;
            }
          }

          const valid = results.filter(Boolean) as { signal: StockSignal; snap: IndicatorSnapshot }[];
          if (valid.length >= 2) {
            const best = valid.reduce((a, b) => a.signal.modelScore > b.signal.modelScore ? a : b);
            const bestIdx = results.indexOf(best);
            response += `**Winner:** ${syms[bestIdx]} with ${(best.signal.modelScore * 100).toFixed(0)}% score.`;
          }
          break;
        }

        case 'best_intraday':
        case 'best_swing': {
          const isIntraday = intent.type === 'best_intraday';
          addMessage('assistant', `🔄 Scanning top ${assetWord}s on **${mktLabel}** for **${isIntraday ? 'intraday' : 'swing'}** trading... This may take a moment.`);

          const stocks = getScanUniverse(market, 'default').slice(0, 10);
          const results: { sym: string; signal: StockSignal; snap: IndicatorSnapshot }[] = [];

          for (const sym of stocks) {
            const r = await quickAnalyze(sym, market);
            if (r) results.push({ sym, ...r });
          }

          // Sort by model score
          results.sort((a, b) => b.signal.modelScore - a.signal.modelScore);
          const top5 = results.slice(0, 5);
          const cs = currency === 'INR' ? '₹' : '$';

          response = `## 🏆 Top ${Math.min(5, top5.length)} for ${isIntraday ? 'Intraday' : 'Swing'} Trading (${market})\n\n`;

          top5.forEach((r, i) => {
            const emoji = r.signal.signal === 'StrongBuy' ? '🟢🟢' : r.signal.signal === 'Buy' ? '🟢' : r.signal.signal === 'Hold' ? '🟡' : '🔴';
            const bullish = r.signal.models.filter(m => m.signal === 'StrongBuy' || m.signal === 'Buy').length;
            const atrPct = ((r.snap.atr / r.signal.entryPrice) * 100).toFixed(1);
            response += `**${i + 1}. ${emoji} ${r.sym}** — ${r.signal.signal} (${(r.signal.modelScore * 100).toFixed(0)}%)\n`;
            response += `   Price: ${cs}${r.signal.entryPrice.toFixed(2)} | ${bullish}/${r.signal.models.length} algos bullish | ATR: ${atrPct}%\n`;
            response += `   Target: ${cs}${r.signal.takeProfit.toFixed(2)} | SL: ${cs}${r.signal.stopLoss.toFixed(2)}\n\n`;
          });

          if (top5.length > 0) {
            const best = top5[0];
            response += `\n### 🎯 Top Pick: **${best.sym}**\n`;
            response += `${(best.signal.modelScore * 100).toFixed(0)}% score with ${best.signal.models.filter(m => m.signal === 'StrongBuy' || m.signal === 'Buy').length}/${best.signal.models.length} bullish models.`;
            if (isIntraday) {
              response += `\n\n**Intraday Strategy:** Enter near VWAP (${cs}${best.snap.vwap.toFixed(2)}), SL at ${cs}${best.signal.stopLoss.toFixed(2)}, target ${cs}${best.signal.takeProfit.toFixed(2)}. Watch RSI (${best.snap.rsi.toFixed(1)}) for momentum confirmation.`;
            } else {
              response += `\n\n**Swing Strategy:** Enter at ${cs}${best.signal.entryPrice.toFixed(2)}, hold 3–10 days. SL: ${cs}${best.signal.stopLoss.toFixed(2)}, target: ${cs}${best.signal.takeProfit.toFixed(2)}.`;
            }
            response += `\n\n*Click "${best.sym}" in the watchlist or type "analyze ${best.sym}" for full details.*`;
          }
          break;
        }

        case 'general_question':
        default: {
          const exSym = isIndian ? 'RELIANCE' : isCrypto ? 'BTC' : 'AAPL';
          const exPair = isIndian ? 'TCS and INFY' : isCrypto ? 'BTC and ETH' : 'AAPL and MSFT';
          if (msg.toLowerCase().includes('hello') || msg.toLowerCase().includes('hi') || msg.toLowerCase().includes('hey')) {
            response = `👋 Hello! I'm your **${mktLabel}** trading assistant.\n\nTry asking:\n• "Analyze ${exSym}" — full algo analysis\n• "What is RSI?" — learn indicators\n• "Best ${assetWord} for intraday?" — top picks\n• "Compare ${exPair}" — head-to-head\n• "Current signal" — active ${assetWord} breakdown`;
          } else if (msg.toLowerCase().includes('thank')) {
            response = `You're welcome! 😊 Happy trading on ${mktLabel}. Ask me anything else!`;
          } else if (msg.toLowerCase().includes('help')) {
            response = `## What I Can Do (${mktLabel})\n\n• 🔍 **Analyze ${assetWord}s** — "analyze ${exSym}"\n• 📊 **Explain indicators** — "what is MACD?", "what does overbought mean?"\n• 📈 **Trading concepts** — "what is swing trading?", "explain stop loss"\n• 🏆 **Find best ${assetWord}s** — "best for intraday today", "top swing picks"\n• ⚔️ **Compare** — "compare ${exPair}"\n• ⚡ **Current signal** — "what's the signal?" or "should I buy?"\n\nI use the same ${signal?.models?.length || 4} algo models that power the app's signals!\n\n*Only ${mktLabel} ${assetWord}s are available. Switch markets in the header to analyze others.*`;
          } else {
            response = `I'm not sure I understood that. I'm set to **${mktLabel}** — I can analyze: ${mktExamples}.\n\n• **"Analyze ${exSym}"** — full analysis with all 4 algo models\n• **"What is [indicator]?"** — RSI, MACD, Bollinger, VWAP, etc.\n• **"Best for intraday/swing"** — top ${assetWord} recommendations\n• **"Compare ${exPair}"** — head-to-head comparison\n• **"Current signal"** — breakdown of active ${assetWord}\n\nTry one of these or tap a suggestion below!`;
          }
        }
      }

      if (response) addMessage('assistant', response);
    } catch (err) {
      addMessage('assistant', `❌ Something went wrong. Please try again. Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setThinking(false);
    }
  }, [input, thinking, symbol, signal, liveQuote, currency, market, onSelectSymbol]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Simple markdown renderer
  const renderMarkdown = (text: string) => {
    return text.split('\n').map((line, i) => {
      let html = line
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^## (.+)/, '<h3 class="chat-h3">$1</h3>')
        .replace(/^### (.+)/, '<h4 class="chat-h4">$1</h4>')
        .replace(/^• (.+)/, '<span class="chat-bullet">• $1</span>');
      if (html === line && line.trim() === '') return <br key={i} />;
      return <div key={i} dangerouslySetInnerHTML={{ __html: html }} />;
    });
  };

  return (
    <div className="card chat-panel">
      <h3 className="card-title">💬 Trading Assistant</h3>

      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`chat-msg ${msg.role}`}>
            <div className="chat-bubble">
              {msg.role === 'assistant' && <span className="chat-avatar">🤖</span>}
              <div className="chat-content">
                {renderMarkdown(msg.text)}
              </div>
            </div>
          </div>
        ))}
        {thinking && (
          <div className="chat-msg assistant">
            <div className="chat-bubble">
              <span className="chat-avatar">🤖</span>
              <div className="chat-content chat-thinking">
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion chips */}
      {messages.length <= 2 && (
        <div className="chat-suggestions">
          {suggestions.map((s, i) => (
            <button key={i} className="chat-suggest-btn" onClick={() => handleSend(s.replace(/^[^\s]+\s/, ''))}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="chat-input-row">
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          placeholder={`Ask about ${symbol}, indicators, or trading...`}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={thinking}
          autoComplete="off"
        />
        <button className="chat-send-btn" onClick={() => handleSend()} disabled={!input.trim() || thinking}>
          ➤
        </button>
      </div>
    </div>
  );
}
