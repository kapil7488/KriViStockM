/**
 * Paper Trading Service
 * 
 * Persists portfolio, positions, and trades in localStorage.
 * US market starts with $1,000,000. Indian market starts with ₹10,00,000.
 */
import {
  PaperPortfolio, PaperPosition, PaperTrade, TradeAction, TradeMode,
  Market, SignalType,
} from '../types';

const STORAGE_KEY = 'stockm_paper_portfolio';

const INITIAL_CASH_US = 1_000_000;
const INITIAL_CASH_INR = 1_000_000; // 10 lakhs

function defaultPortfolio(): PaperPortfolio {
  return {
    cashUS: INITIAL_CASH_US,
    cashINR: INITIAL_CASH_INR,
    positions: [],
    trades: [],
  };
}

export function loadPortfolio(): PaperPortfolio {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPortfolio();
    return JSON.parse(raw) as PaperPortfolio;
  } catch {
    return defaultPortfolio();
  }
}

function savePortfolio(p: PaperPortfolio): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch { /* storage full */ }
}

function getCash(p: PaperPortfolio, market: Market): number {
  return (market === 'US') ? p.cashUS : p.cashINR;
}

function setCash(p: PaperPortfolio, market: Market, value: number): void {
  if (market === 'US') p.cashUS = value;
  else p.cashINR = value;
}

function getInitialCash(market: Market): number {
  return market === 'US' ? INITIAL_CASH_US : INITIAL_CASH_INR;
}

export function getPosition(portfolio: PaperPortfolio, symbol: string, market: Market): PaperPosition | undefined {
  return portfolio.positions.find(p => p.symbol === symbol && p.market === market);
}

export interface TradeResult {
  success: boolean;
  message: string;
  portfolio: PaperPortfolio;
}

export function executeTrade(
  action: TradeAction,
  symbol: string,
  quantity: number,
  price: number,
  market: Market,
  mode: TradeMode,
  signal?: SignalType,
): TradeResult {
  const portfolio = loadPortfolio();
  const cash = getCash(portfolio, market);
  const total = Math.round(quantity * price * 100) / 100;

  if (action === 'BUY') {
    if (total > cash) {
      return { success: false, message: `Insufficient funds. Need ${formatMoney(total, market)} but only ${formatMoney(cash, market)} available.`, portfolio };
    }
    if (quantity <= 0) {
      return { success: false, message: 'Quantity must be greater than 0.', portfolio };
    }

    // Deduct cash
    setCash(portfolio, market, Math.round((cash - total) * 100) / 100);

    // Update or create position
    const existing = portfolio.positions.find(p => p.symbol === symbol && p.market === market);
    if (existing) {
      existing.totalCost = Math.round((existing.totalCost + total) * 100) / 100;
      existing.quantity += quantity;
      existing.avgCost = Math.round((existing.totalCost / existing.quantity) * 100) / 100;
    } else {
      portfolio.positions.push({
        symbol,
        quantity,
        avgCost: Math.round(price * 100) / 100,
        totalCost: total,
        market,
      });
    }
  } else {
    // SELL
    const existing = portfolio.positions.find(p => p.symbol === symbol && p.market === market);
    if (!existing || existing.quantity < quantity) {
      const held = existing?.quantity ?? 0;
      return { success: false, message: `Cannot sell ${quantity} shares. You hold ${held} shares of ${symbol}.`, portfolio };
    }
    if (quantity <= 0) {
      return { success: false, message: 'Quantity must be greater than 0.', portfolio };
    }

    // Add cash from sale
    setCash(portfolio, market, Math.round((cash + total) * 100) / 100);

    // Update position
    existing.quantity -= quantity;
    existing.totalCost = Math.round((existing.quantity * existing.avgCost) * 100) / 100;

    // Remove if fully sold
    if (existing.quantity <= 0) {
      portfolio.positions = portfolio.positions.filter(p => !(p.symbol === symbol && p.market === market));
    }
  }

  // Record trade
  const trade: PaperTrade = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    symbol,
    action,
    mode,
    quantity,
    price: Math.round(price * 100) / 100,
    total,
    timestamp: new Date().toISOString(),
    signal,
    market,
  };
  portfolio.trades.unshift(trade);

  // Keep last 200 trades
  if (portfolio.trades.length > 200) portfolio.trades = portfolio.trades.slice(0, 200);

  savePortfolio(portfolio);
  return { success: true, message: `${action} ${quantity} shares of ${symbol} at ${formatMoney(price, market)}`, portfolio };
}

export function resetPortfolio(): PaperPortfolio {
  const p = defaultPortfolio();
  savePortfolio(p);
  return p;
}

/** Calculate total portfolio value given current market prices */
export function calculatePortfolioValue(
  portfolio: PaperPortfolio,
  market: Market,
  priceMap: Record<string, number>,
): { cash: number; holdings: number; total: number; initialCash: number; pnl: number; pnlPct: number } {
  const cash = getCash(portfolio, market);
  const initial = getInitialCash(market);
  let holdings = 0;

  for (const pos of portfolio.positions) {
    if (pos.market === market) {
      const currentPrice = priceMap[pos.symbol] ?? pos.avgCost;
      holdings += pos.quantity * currentPrice;
    }
  }

  holdings = Math.round(holdings * 100) / 100;
  const total = Math.round((cash + holdings) * 100) / 100;
  const pnl = Math.round((total - initial) * 100) / 100;
  const pnlPct = initial > 0 ? Math.round((pnl / initial) * 10000) / 100 : 0;

  return { cash, holdings, total, initialCash: initial, pnl, pnlPct };
}

export function getMarketPositions(portfolio: PaperPortfolio, market: Market): PaperPosition[] {
  return portfolio.positions.filter(p => p.market === market);
}

export function getMarketTrades(portfolio: PaperPortfolio, market: Market): PaperTrade[] {
  return portfolio.trades.filter(t => t.market === market);
}

export function formatMoney(amount: number, market: Market): string {
  const sym = market === 'US' ? '$' : '₹';
  return `${sym}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
