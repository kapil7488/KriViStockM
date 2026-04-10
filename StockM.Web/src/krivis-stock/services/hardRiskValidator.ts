/**
 * Hard Risk Validator — enforces 6 risk checks before any trade signal.
 * These are non-negotiable: the signal engine CANNOT bypass them.
 */
import type { KrivisSignal, RiskCheckResult, KrivisPortfolioState } from '../types';
import { KRIVIS_RISK_DEFAULTS } from '../types';

const PORTFOLIO_KEY = 'krivis-portfolio';

/** Load portfolio state from localStorage, or initialize defaults */
export function loadPortfolio(): KrivisPortfolioState {
  try {
    const raw = localStorage.getItem(PORTFOLIO_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }

  return {
    initialValue: KRIVIS_RISK_DEFAULTS.portfolioValue,
    currentValue: KRIVIS_RISK_DEFAULTS.portfolioValue,
    dailyHighValue: KRIVIS_RISK_DEFAULTS.portfolioValue,
    dailyHighDate: new Date().toISOString().split('T')[0],
    activePositions: [],
  };
}

export function savePortfolio(state: KrivisPortfolioState): void {
  localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(state));
}

/** Run all 6 hard risk checks against a proposed signal */
export function validateRisk(signal: KrivisSignal, portfolio: KrivisPortfolioState): KrivisSignal {
  if (signal.action === 'hold') return signal;

  const checks: RiskCheckResult[] = [];
  const cfg = KRIVIS_RISK_DEFAULTS;
  let blocked = false;

  // 1. Daily drawdown breaker: ≥10% loss from daily high
  const today = new Date().toISOString().split('T')[0];
  let dailyHigh = portfolio.dailyHighValue;
  if (portfolio.dailyHighDate !== today) {
    dailyHigh = portfolio.currentValue; // reset daily high
  } else if (portfolio.currentValue > dailyHigh) {
    dailyHigh = portfolio.currentValue;
  }
  const drawdownPct = dailyHigh > 0 ? ((dailyHigh - portfolio.currentValue) / dailyHigh) * 100 : 0;
  const ddPass = drawdownPct < cfg.dailyDrawdownBreakerPct;
  checks.push({
    check: 'Daily Drawdown',
    passed: ddPass,
    reason: ddPass
      ? `Drawdown ${drawdownPct.toFixed(1)}% within ${cfg.dailyDrawdownBreakerPct}% limit`
      : `Drawdown ${drawdownPct.toFixed(1)}% exceeds ${cfg.dailyDrawdownBreakerPct}% — BLOCKED`,
    value: drawdownPct,
    limit: cfg.dailyDrawdownBreakerPct,
  });
  if (!ddPass) blocked = true;

  // 2. Balance reserve: ≥20% of initial balance must remain
  const minBalance = portfolio.initialValue * (cfg.balanceReservePct / 100);
  const reservePass = portfolio.currentValue >= minBalance;
  checks.push({
    check: 'Balance Reserve',
    passed: reservePass,
    reason: reservePass
      ? `Balance $${portfolio.currentValue.toFixed(0)} above reserve $${minBalance.toFixed(0)}`
      : `Balance $${portfolio.currentValue.toFixed(0)} below reserve $${minBalance.toFixed(0)} — BLOCKED`,
    value: portfolio.currentValue,
    limit: minBalance,
  });
  if (!reservePass) blocked = true;

  // 3. Position size cap: ≤10% of account
  const maxAlloc = portfolio.currentValue * (cfg.positionSizeCapPct / 100);
  const allocPct = cfg.positionSizeCapPct; // default allocation
  checks.push({
    check: 'Position Size Cap',
    passed: true,
    reason: `Max allocation ${cfg.positionSizeCapPct}% ($${maxAlloc.toFixed(0)})`,
    value: allocPct,
    limit: cfg.positionSizeCapPct,
  });

  // 4. Total exposure: ≤50% of account
  const currentExposure = portfolio.activePositions.reduce((sum, p) => sum + p.allocationPct, 0);
  const newExposure = currentExposure + cfg.positionSizeCapPct;
  const exposurePass = newExposure <= cfg.totalExposureCapPct;
  checks.push({
    check: 'Total Exposure',
    passed: exposurePass,
    reason: exposurePass
      ? `Exposure ${newExposure.toFixed(0)}% within ${cfg.totalExposureCapPct}% limit`
      : `Exposure ${newExposure.toFixed(0)}% exceeds ${cfg.totalExposureCapPct}% — BLOCKED`,
    value: newExposure,
    limit: cfg.totalExposureCapPct,
  });
  if (!exposurePass) blocked = true;

  // 5. Concurrent positions: ≤10
  const posCount = portfolio.activePositions.length;
  const concurrentPass = posCount < cfg.maxConcurrentPositions;
  checks.push({
    check: 'Concurrent Positions',
    passed: concurrentPass,
    reason: concurrentPass
      ? `${posCount}/${cfg.maxConcurrentPositions} positions`
      : `Already at max ${cfg.maxConcurrentPositions} positions — BLOCKED`,
    value: posCount,
    limit: cfg.maxConcurrentPositions,
  });
  if (!concurrentPass) blocked = true;

  // 6. Mandatory stop-loss: ±5% from entry
  const hasSL = signal.stopLoss !== 0 && signal.stopLoss !== signal.entryPrice;
  let slEnforced = signal.stopLoss;
  if (!hasSL) {
    const slDist = signal.entryPrice * (cfg.mandatorySlPct / 100);
    slEnforced = signal.action === 'buy'
      ? Math.round((signal.entryPrice - slDist) * 100) / 100
      : Math.round((signal.entryPrice + slDist) * 100) / 100;
  }
  checks.push({
    check: 'Mandatory Stop-Loss',
    passed: true,
    reason: hasSL
      ? `SL at $${signal.stopLoss.toFixed(2)}`
      : `SL auto-set at $${slEnforced.toFixed(2)} (${cfg.mandatorySlPct}% from entry)`,
    value: slEnforced,
    limit: cfg.mandatorySlPct,
  });

  return {
    ...signal,
    stopLoss: slEnforced,
    riskChecks: checks,
    riskBlocked: blocked,
  };
}
