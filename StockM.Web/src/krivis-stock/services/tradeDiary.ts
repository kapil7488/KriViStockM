/**
 * Trade Diary — append-only JSONL log in localStorage.
 * Records every signal decision (including risk-blocked ones) for audit.
 */
import type { KrivisSignal, DiaryEntry } from '../types';

const DIARY_KEY = 'krivis-diary';
const MAX_ENTRIES = 500;

/** Generate a short unique ID */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Append a signal to the diary */
export function logToDiary(signal: KrivisSignal): DiaryEntry {
  const entry: DiaryEntry = {
    id: uid(),
    symbol: signal.symbol,
    action: signal.action,
    confidence: signal.confidence,
    entryPrice: signal.entryPrice,
    entryLow: signal.entryLow,
    entryHigh: signal.entryHigh,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
    exitPlan: signal.exitPlan,
    reasoning: signal.reasoning,
    riskBlocked: signal.riskBlocked,
    riskChecks: signal.riskChecks,
    structure: signal.structure,
    timestamp: signal.timestamp,
  };

  const existing = loadDiary();
  existing.push(entry);

  // Keep only last MAX_ENTRIES
  const trimmed = existing.length > MAX_ENTRIES
    ? existing.slice(existing.length - MAX_ENTRIES)
    : existing;

  localStorage.setItem(DIARY_KEY, JSON.stringify(trimmed));
  return entry;
}

/** Load all diary entries */
export function loadDiary(): DiaryEntry[] {
  try {
    const raw = localStorage.getItem(DIARY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}

/** Clear all diary entries */
export function clearDiary(): void {
  localStorage.removeItem(DIARY_KEY);
}

/** Export diary as downloadable JSON */
export function exportDiary(): string {
  const entries = loadDiary();
  return entries.map(e => JSON.stringify(e)).join('\n');
}

/** Get recent diary entries for a specific symbol */
export function getDiaryForSymbol(symbol: string, limit = 20): DiaryEntry[] {
  return loadDiary()
    .filter(e => e.symbol === symbol)
    .slice(-limit);
}

/** Get diary stats */
export function getDiaryStats(): {
  total: number;
  buys: number;
  sells: number;
  holds: number;
  blocked: number;
  symbols: number;
} {
  const entries = loadDiary();
  return {
    total: entries.length,
    buys: entries.filter(e => e.action === 'buy' && !e.riskBlocked).length,
    sells: entries.filter(e => e.action === 'sell' && !e.riskBlocked).length,
    holds: entries.filter(e => e.action === 'hold').length,
    blocked: entries.filter(e => e.riskBlocked).length,
    symbols: new Set(entries.map(e => e.symbol)).size,
  };
}
