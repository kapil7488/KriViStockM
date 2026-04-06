/**
 * Stock Scanner — scans a universe of stocks, scores each with the scoring engine,
 * and returns a ranked list of top buy candidates.
 */
import { Market, StockSignal, DEFAULT_RISK_PARAMS } from '../types';
import { fetchYahooHistorical } from './stockApi';
import { generateSignal } from './scoringEngine';

export interface ScanResult {
  symbol: string;
  signal: StockSignal;
  price: number;
  change: number;       // percent change from previous close
  scannedAt: string;
}

export type ScanUniverse = 'default' | 'sp500' | 'nifty50';

// Broader stock universe beyond the 10-stock watchlist
const US_SCAN_UNIVERSE = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'JPM', 'NFLX', 'AMD',
  'V', 'MA', 'DIS', 'PYPL', 'INTC', 'CRM', 'ADBE', 'CSCO', 'PEP', 'KO',
  'WMT', 'HD', 'UNH', 'JNJ', 'PG', 'XOM', 'CVX', 'BAC', 'GS', 'COST',
];

// S&P 500 — top ~100 by market cap (representative cross-section)
const SP500_UNIVERSE = [
  'AAPL', 'MSFT', 'AMZN', 'NVDA', 'GOOGL', 'META', 'TSLA', 'BRK-B', 'UNH', 'JNJ',
  'V', 'XOM', 'JPM', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'ABBV', 'LLY',
  'PEP', 'KO', 'COST', 'AVGO', 'WMT', 'MCD', 'CSCO', 'ACN', 'TMO', 'ABT',
  'DHR', 'NEE', 'LIN', 'PM', 'TXN', 'UNP', 'RTX', 'AMGN', 'BMY', 'HON',
  'LOW', 'ORCL', 'QCOM', 'COP', 'UPS', 'SBUX', 'INTC', 'AMD', 'GS', 'CAT',
  'DE', 'BA', 'AMAT', 'INTU', 'MDLZ', 'ISRG', 'GILD', 'ADI', 'BKNG', 'REGN',
  'VRTX', 'MMC', 'LRCX', 'SYK', 'ADP', 'ZTS', 'PANW', 'TMUS', 'CB', 'ETN',
  'CME', 'CI', 'SO', 'DUK', 'BSX', 'BDX', 'PLD', 'SLB', 'MO', 'ICE',
  'CL', 'GD', 'NFLX', 'PYPL', 'APD', 'CMG', 'FI', 'NOC', 'AON', 'WM',
  'TGT', 'MCK', 'PNC', 'USB', 'DIS', 'CRM', 'ADBE', 'NOW', 'SNPS', 'CDNS',
];

const NSE_SCAN_UNIVERSE = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'BHARTIARTL', 'SBIN', 'ITC',
  'HINDUNILVR', 'LT', 'KOTAKBANK', 'AXISBANK', 'BAJFINANCE', 'MARUTI', 'TITAN',
  'SUNPHARMA', 'HCLTECH', 'NTPC', 'POWERGRID', 'TATAMOTORS', 'WIPRO', 'ONGC',
  'ULTRACEMCO', 'ADANIENT', 'TECHM', 'INDUSINDBK', 'NESTLEIND', 'JSWSTEEL', 'TATASTEEL', 'COALINDIA',
];

// Nifty 50 expanded
const NIFTY50_UNIVERSE = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'BHARTIARTL', 'SBIN', 'ITC',
  'HINDUNILVR', 'LT', 'KOTAKBANK', 'AXISBANK', 'BAJFINANCE', 'MARUTI', 'TITAN',
  'SUNPHARMA', 'HCLTECH', 'NTPC', 'POWERGRID', 'TATAMOTORS', 'WIPRO', 'ONGC',
  'ULTRACEMCO', 'ADANIENT', 'TECHM', 'INDUSINDBK', 'NESTLEIND', 'JSWSTEEL', 'TATASTEEL', 'COALINDIA',
  'EICHERMOT', 'APOLLOHOSP', 'DIVISLAB', 'DRREDDY', 'CIPLA', 'BPCL', 'HEROMOTOCO',
  'BAJAJFINSV', 'BRITANNIA', 'TATACONSUM', 'HINDALCO', 'GRASIM', 'SBILIFE',
  'HDFCLIFE', 'M&M', 'SHRIRAMFIN', 'ASIANPAINT', 'TRENT', 'BEL', 'VEDL',
];

// BSE uses same stocks as NSE

export function getScanUniverse(market: Market, universe: ScanUniverse = 'default'): string[] {
  if (market === 'US') {
    return universe === 'sp500' ? SP500_UNIVERSE : US_SCAN_UNIVERSE;
  }
  if (market === 'NSE' || market === 'BSE') {
    return universe === 'nifty50' ? NIFTY50_UNIVERSE : NSE_SCAN_UNIVERSE;
  }
  return US_SCAN_UNIVERSE;
}

export function getUniverseLabel(market: Market, universe: ScanUniverse): string {
  if (market === 'US') {
    return universe === 'sp500' ? 'S&P 500 (100)' : 'Popular (30)';
  }
  return universe === 'nifty50' ? 'Nifty 50' : 'Popular (30)';
}

/**
 * Scan the stock universe for a given market.
 * Fetches historical data for each stock → runs scoring engine → returns sorted results.
 * Uses concurrency limit to avoid hammering Yahoo Finance.
 */
export async function scanTopStocks(
  market: Market,
  limit: number = 10,
  onProgress?: (done: number, total: number) => void,
  universe: ScanUniverse = 'default',
): Promise<ScanResult[]> {
  const stocks = getScanUniverse(market, universe);
  const results: ScanResult[] = [];
  const CONCURRENCY = 4; // max parallel fetches

  let done = 0;
  const total = stocks.length;

  // Process in batches
  for (let i = 0; i < stocks.length; i += CONCURRENCY) {
    const batch = stocks.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (sym) => {
        const data = await fetchYahooHistorical(sym, market);
        if (data.quotes.length < 121) return null; // need enough data for scoring
        const sig = generateSignal(sym, data.quotes, DEFAULT_RISK_PARAMS);
        const lastQuote = data.quotes[data.quotes.length - 1];
        const prevQuote = data.quotes[data.quotes.length - 2];
        const change = prevQuote ? ((lastQuote.close - prevQuote.close) / prevQuote.close) * 100 : 0;
        return {
          symbol: sym,
          signal: sig,
          price: lastQuote.close,
          change,
          scannedAt: new Date().toISOString(),
        } as ScanResult;
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      }
      done++;
      onProgress?.(done, total);
    }
  }

  // Sort by modelScore descending (highest buy confidence first)
  results.sort((a, b) => b.signal.modelScore - a.signal.modelScore);
  return results.slice(0, limit);
}
