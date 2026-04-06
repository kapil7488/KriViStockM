import { useMemo, useState, useEffect, useRef } from 'react';
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Brush, Cell,
} from 'recharts';
import {
  StockBar, StockSignal, StockQuote, ChartSettings, TimeRange, ChartType, ChartInterval,
  OverlayIndicator, SubchartIndicator, TIME_RANGE_DAYS, DEFAULT_CHART_SETTINGS,
  Market,
} from '../types';
import { computeFullIndicators } from '../services/indicators';
import { fetchYahooIntraday } from '../services/stockApi';
import { DataSource } from '../hooks/useStockData';
import { LiveQuote } from '../types';

interface StockChartProps {
  data: StockBar;
  signal: StockSignal | null;
  dataSource: DataSource;
  liveQuote: LiveQuote | null;
  currency: string;
  market: Market;
}

const TIME_RANGES: TimeRange[] = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y', 'ALL'];
const INTERVALS: { value: ChartInterval; label: string }[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1H', label: '1H' },
  { value: '4H', label: '4H' },
  { value: 'D', label: '1D' },
];
const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'candlestick', label: '🕯️' },
  { value: 'line', label: '📈' },
  { value: 'area', label: '📊' },
];
const OVERLAY_OPTIONS: { key: OverlayIndicator; label: string; color: string }[] = [
  { key: 'sma20', label: 'SMA 20', color: '#f59e0b' },
  { key: 'sma50', label: 'SMA 50', color: '#3b82f6' },
  { key: 'sma200', label: 'SMA 200', color: '#ef4444' },
  { key: 'ema12', label: 'EMA 12', color: '#8b5cf6' },
  { key: 'ema26', label: 'EMA 26', color: '#ec4899' },
  { key: 'bollinger', label: 'BB', color: '#6366f1' },
  { key: 'vwap', label: 'VWAP', color: '#14b8a6' },
];
const SUBCHART_OPTIONS: { key: SubchartIndicator; label: string }[] = [
  { key: 'volume', label: 'Volume' },
  { key: 'rsi', label: 'RSI' },
  { key: 'macd', label: 'MACD' },
  { key: 'stochastic', label: 'Stoch' },
  { key: 'atr', label: 'ATR' },
];

export function StockChart({ data, signal, dataSource, liveQuote, currency, market }: StockChartProps) {
  const [settings, setSettings] = useState<ChartSettings>(DEFAULT_CHART_SETTINGS);
  const [intradayQuotes, setIntradayQuotes] = useState<StockQuote[] | null>(null);
  const [intradayLoading, setIntradayLoading] = useState(false);
  const fetchIdRef = useRef(0); // prevent stale fetch overwrites

  // Fetch real intraday data when interval or timeRange changes
  const isIntraday = settings.interval !== 'D';
  useEffect(() => {
    if (!isIntraday) {
      setIntradayQuotes(null);
      return;
    }
    const id = ++fetchIdRef.current;
    const days = TIME_RANGE_DAYS[settings.timeRange];
    setIntradayLoading(true);
    fetchYahooIntraday(data.symbol, settings.interval, days, market)
      .then(quotes => {
        if (fetchIdRef.current === id) {
          setIntradayQuotes(quotes);
        }
      })
      .catch(() => {
        if (fetchIdRef.current === id) setIntradayQuotes(null);
      })
      .finally(() => {
        if (fetchIdRef.current === id) setIntradayLoading(false);
      });
  }, [data.symbol, settings.interval, settings.timeRange, market, isIntraday]);

  const { chartData } = useMemo(() => {
    const days = TIME_RANGE_DAYS[settings.timeRange];

    // Use real intraday data if available, otherwise daily
    const displayQuotes = (isIntraday && intradayQuotes && intradayQuotes.length > 0)
      ? intradayQuotes
      : (days >= data.quotes.length ? data.quotes : data.quotes.slice(-days));

    // Indicators always computed on full daily data
    const ind = computeFullIndicators(data.quotes);
    const dailyCount = data.quotes.length;
    const usedDays = Math.min(days, dailyCount);

    const cd = displayQuotes.map((q, i) => {
      // For intraday, map back to the nearest daily bar index for indicators
      const dailyIdx = (isIntraday && intradayQuotes)
        ? Math.min(dailyCount - 1, dailyCount - usedDays + Math.floor(i / Math.max(1, displayQuotes.length / usedDays)))
        : (dailyCount - displayQuotes.length + i);
      const idx = Math.max(0, Math.min(dailyIdx, ind.sma20.length - 1));

      const isUp = q.close >= q.open;
      return {
        date: isIntraday ? q.timestamp.slice(11) || q.timestamp.slice(5) : q.timestamp.slice(5),
        fullDate: q.timestamp,
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume,
        candleBody: isUp ? [q.open, q.close] : [q.close, q.open],
        candleWick: [q.low, q.high],
        isUp,
        sma20: ind.sma20[idx] || undefined,
        sma50: ind.sma50[idx] || undefined,
        sma200: ind.sma200[idx] || undefined,
        ema12: ind.ema12[idx] || undefined,
        ema26: ind.ema26[idx] || undefined,
        bbUpper: ind.bollingerUpper[idx] || undefined,
        bbMiddle: ind.bollingerMiddle[idx] || undefined,
        bbLower: ind.bollingerLower[idx] || undefined,
        vwap: ind.vwap[idx] || undefined,
        rsi: ind.rsi[idx] || undefined,
        macdLine: ind.macdLine[idx] || undefined,
        macdSignal: ind.macdSignal[idx] || undefined,
        macdHist: ind.macdHistogram[idx] || undefined,
        stochK: ind.stochK[idx] || undefined,
        stochD: ind.stochD[idx] || undefined,
        atr: ind.atr[idx] || undefined,
      };
    });
    return { chartData: cd };
  }, [data, settings.timeRange, settings.interval, isIntraday, intradayQuotes]);

  const toggleOverlay = (key: OverlayIndicator) => {
    setSettings(prev => ({
      ...prev,
      overlays: prev.overlays.includes(key)
        ? prev.overlays.filter(o => o !== key)
        : [...prev.overlays, key],
    }));
  };

  const toggleSubchart = (key: SubchartIndicator) => {
    setSettings(prev => ({
      ...prev,
      subcharts: prev.subcharts.includes(key)
        ? prev.subcharts.filter(s => s !== key)
        : [...prev.subcharts, key],
    }));
  };

  const last = data.quotes[data.quotes.length - 1];
  const prev = data.quotes.length > 1 ? data.quotes[data.quotes.length - 2] : last;
  const change = last.close - prev.close;
  const changePct = prev.close > 0 ? (change / prev.close) * 100 : 0;
  const isUp = change >= 0;

  return (
    <div className="chart-container">
      {/* Data Source Banner */}
      <div className={`data-source-banner ${dataSource}`}>
        {dataSource === 'simulated' && (
          <>
            <span className="ds-badge simulated">⚠️ SIMULATED</span>
            <span className="ds-text">
              Chart data is simulated — Yahoo Finance historical data was unavailable.
              For Indian markets, login with <b>Upstox</b> for real history.
            </span>
          </>
        )}
        {dataSource === 'live-patched' && (
          <>
            <span className="ds-badge patched">📡 LIVE + SIMULATED</span>
            <span className="ds-text">
              Today's price is <b>LIVE</b> ({currency}{liveQuote?.lastPrice.toFixed(2)}),
              historical chart is simulated.
            </span>
          </>
        )}
        {dataSource === 'live-api' && (
          <>
            <span className="ds-badge live">🟢 LIVE DATA</span>
            <span className="ds-text">
              Real OHLC data from Yahoo Finance / Upstox — reflects actual market prices.
            </span>
          </>
        )}
      </div>

      {/* Live vs Chart Comparison (when live quote exists) */}
      {liveQuote && dataSource !== 'live-api' && (
        <div className="live-comparison">
          <div className="lc-row">
            <span className="lc-label">Live Market Price</span>
            <span className="lc-value live">{currency}{liveQuote.lastPrice.toFixed(2)}</span>
            <span className={`lc-change ${liveQuote.percentChange >= 0 ? 'up' : 'down'}`}>
              {liveQuote.percentChange >= 0 ? '▲' : '▼'} {Math.abs(liveQuote.change).toFixed(2)} ({Math.abs(liveQuote.percentChange).toFixed(2)}%)
            </span>
          </div>
          <div className="lc-row">
            <span className="lc-label">Chart Price (simulated)</span>
            <span className="lc-value sim">{currency}{last.close.toFixed(2)}</span>
          </div>
          <div className="lc-row">
            <span className="lc-label">Day Range</span>
            <span className="lc-value">{currency}{liveQuote.dayLow.toFixed(2)} – {currency}{liveQuote.dayHigh.toFixed(2)}</span>
          </div>
          <div className="lc-row">
            <span className="lc-label">52W Range</span>
            <span className="lc-value">{currency}{liveQuote.yearLow.toFixed(2)} – {currency}{liveQuote.yearHigh.toFixed(2)}</span>
          </div>
          {liveQuote.volume > 0 && (
            <div className="lc-row">
              <span className="lc-label">Volume</span>
              <span className="lc-value">{(liveQuote.volume / 1e6).toFixed(2)}M</span>
            </div>
          )}
        </div>
      )}

      {/* Price Header */}
      <div className="chart-price-header">
        <div className="chart-symbol-info">
          <span className="chart-symbol">{data.symbol}</span>
          <span className="chart-price">{currency}{last.close.toFixed(2)}</span>
          <span className={`chart-change ${isUp ? 'up' : 'down'}`}>
            {isUp ? '+' : ''}{change.toFixed(2)} ({isUp ? '+' : ''}{changePct.toFixed(2)}%)
          </span>
        </div>
        <div className="chart-ohlc">
          <span>O <b>{last.open.toFixed(2)}</b></span>
          <span>H <b>{last.high.toFixed(2)}</b></span>
          <span>L <b>{last.low.toFixed(2)}</b></span>
          <span>C <b>{last.close.toFixed(2)}</b></span>
          <span>Vol <b>{(last.volume / 1e6).toFixed(1)}M</b></span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="chart-toolbar">
        <div className="toolbar-group">
          {TIME_RANGES.map(tr => (
            <button key={tr}
              className={`toolbar-btn ${settings.timeRange === tr ? 'active' : ''}`}
              onClick={() => setSettings(s => ({ ...s, timeRange: tr }))}>
              {tr}
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        {/* Interval / Resolution selector */}
        <div className="toolbar-group">
          {INTERVALS.map(iv => (
            <button key={iv.value}
              className={`toolbar-btn ${settings.interval === iv.value ? 'active' : ''}`}
              onClick={() => setSettings(s => ({ ...s, interval: iv.value }))}
              title={`${iv.label} candles`}>
              {iv.label}
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          {CHART_TYPES.map(ct => (
            <button key={ct.value}
              className={`toolbar-btn ${settings.chartType === ct.value ? 'active' : ''}`}
              onClick={() => setSettings(s => ({ ...s, chartType: ct.value }))}
              title={ct.value}>
              {ct.label}
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          {OVERLAY_OPTIONS.map(o => (
            <button key={o.key}
              className={`toolbar-btn indicator-toggle ${settings.overlays.includes(o.key) ? 'active' : ''}`}
              onClick={() => toggleOverlay(o.key)}
              style={settings.overlays.includes(o.key) ? { borderColor: o.color, color: o.color } : {}}>
              {o.label}
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          {SUBCHART_OPTIONS.map(s => (
            <button key={s.key}
              className={`toolbar-btn indicator-toggle ${settings.subcharts.includes(s.key) ? 'active' : ''}`}
              onClick={() => toggleSubchart(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Price Chart */}
      <div className="chart-main" style={{ position: 'relative' }}>
        {intradayLoading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(15,23,42,0.7)', zIndex: 10, borderRadius: 8,
          }}>
            <span style={{ color: '#94a3b8', fontSize: 14 }}>Loading intraday data…</span>
          </div>
        )}
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 60, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" stroke="#64748b" fontSize={10} tickLine={false}
              interval={Math.max(0, Math.floor(chartData.length / 12))} />
            <YAxis stroke="#64748b" fontSize={10} tickLine={false} domain={['auto', 'auto']}
              orientation="right" tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
            <Tooltip content={<PriceTooltip />} />

            {/* Main price display */}
            {settings.chartType === 'candlestick' && (
              <>
                {/* Wick (high-low range) */}
                <Bar dataKey="candleWick" fill="transparent" barSize={1}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.isUp ? '#22c55e' : '#ef4444'} />
                  ))}
                </Bar>
                {/* Body (open-close range) */}
                <Bar dataKey="candleBody" barSize={Math.max(1, Math.min(8, 500 / chartData.length))}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.isUp ? '#22c55e' : '#ef4444'} />
                  ))}
                </Bar>
              </>
            )}
            {settings.chartType === 'line' && (
              <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} dot={false} />
            )}
            {settings.chartType === 'area' && (
              <Area type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2}
                fill="url(#areaFill)" />
            )}

            {/* Overlay indicators */}
            {settings.overlays.includes('sma20') && (
              <Line type="monotone" dataKey="sma20" stroke="#f59e0b" strokeWidth={1} dot={false} />
            )}
            {settings.overlays.includes('sma50') && (
              <Line type="monotone" dataKey="sma50" stroke="#3b82f6" strokeWidth={1} dot={false} />
            )}
            {settings.overlays.includes('sma200') && (
              <Line type="monotone" dataKey="sma200" stroke="#ef4444" strokeWidth={1} dot={false} />
            )}
            {settings.overlays.includes('ema12') && (
              <Line type="monotone" dataKey="ema12" stroke="#8b5cf6" strokeWidth={1} dot={false} />
            )}
            {settings.overlays.includes('ema26') && (
              <Line type="monotone" dataKey="ema26" stroke="#ec4899" strokeWidth={1} dot={false} />
            )}
            {settings.overlays.includes('bollinger') && (
              <>
                <Line type="monotone" dataKey="bbUpper" stroke="#6366f1" strokeWidth={1} dot={false} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="bbMiddle" stroke="#6366f1" strokeWidth={1} dot={false} strokeOpacity={0.5} />
                <Line type="monotone" dataKey="bbLower" stroke="#6366f1" strokeWidth={1} dot={false} strokeDasharray="4 2" />
              </>
            )}
            {settings.overlays.includes('vwap') && (
              <Line type="monotone" dataKey="vwap" stroke="#14b8a6" strokeWidth={1.5} dot={false} strokeDasharray="6 3" />
            )}

            {/* Signal reference lines */}
            {signal && (
              <>
                <ReferenceLine y={signal.entryPrice} stroke="#eab308" strokeDasharray="6 3"
                  label={{ value: `Entry $${signal.entryPrice.toFixed(2)}`, fill: '#eab308', fontSize: 10, position: 'right' }} />
                <ReferenceLine y={signal.stopLoss} stroke="#ef4444" strokeDasharray="6 3"
                  label={{ value: `SL $${signal.stopLoss.toFixed(2)}`, fill: '#ef4444', fontSize: 10, position: 'right' }} />
                <ReferenceLine y={signal.takeProfit} stroke="#22c55e" strokeDasharray="6 3"
                  label={{ value: `TP $${signal.takeProfit.toFixed(2)}`, fill: '#22c55e', fontSize: 10, position: 'right' }} />
              </>
            )}

            <Brush dataKey="date" height={20} stroke="#475569" fill="#0f172a"
              travellerWidth={8} startIndex={Math.max(0, chartData.length - Math.min(chartData.length, 120))} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Sub-charts */}
      {settings.subcharts.includes('volume') && (
        <div className="subchart">
          <div className="subchart-label">Volume</div>
          <ResponsiveContainer width="100%" height={80}>
            <ComposedChart data={chartData} margin={{ top: 2, right: 60, left: 0, bottom: 0 }}>
              <YAxis stroke="#64748b" fontSize={9} tickLine={false} orientation="right"
                tickFormatter={(v: number) => `${(v / 1e6).toFixed(0)}M`} />
              <Bar dataKey="volume" barSize={Math.max(1, Math.min(6, 400 / chartData.length))}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.isUp ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)'} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {settings.subcharts.includes('rsi') && (
        <div className="subchart">
          <div className="subchart-label">RSI (14)</div>
          <ResponsiveContainer width="100%" height={80}>
            <ComposedChart data={chartData} margin={{ top: 2, right: 60, left: 0, bottom: 0 }}>
              <YAxis stroke="#64748b" fontSize={9} tickLine={false} orientation="right"
                domain={[0, 100]} ticks={[30, 50, 70]} />
              <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.4} />
              <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.4} />
              <Area type="monotone" dataKey="rsi" stroke="#a855f7" strokeWidth={1.5}
                fill="rgba(168,85,247,0.1)" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {settings.subcharts.includes('macd') && (
        <div className="subchart">
          <div className="subchart-label">MACD</div>
          <ResponsiveContainer width="100%" height={90}>
            <ComposedChart data={chartData} margin={{ top: 2, right: 60, left: 0, bottom: 0 }}>
              <YAxis stroke="#64748b" fontSize={9} tickLine={false} orientation="right" />
              <ReferenceLine y={0} stroke="#475569" />
              <Bar dataKey="macdHist" barSize={Math.max(1, Math.min(4, 300 / chartData.length))}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={(entry.macdHist ?? 0) >= 0 ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)'} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="macdLine" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="macdSignal" stroke="#f97316" strokeWidth={1} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {settings.subcharts.includes('stochastic') && (
        <div className="subchart">
          <div className="subchart-label">Stochastic</div>
          <ResponsiveContainer width="100%" height={80}>
            <ComposedChart data={chartData} margin={{ top: 2, right: 60, left: 0, bottom: 0 }}>
              <YAxis stroke="#64748b" fontSize={9} tickLine={false} orientation="right"
                domain={[0, 100]} ticks={[20, 50, 80]} />
              <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.4} />
              <ReferenceLine y={20} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.4} />
              <Line type="monotone" dataKey="stochK" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="stochD" stroke="#f97316" strokeWidth={1} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {settings.subcharts.includes('atr') && (
        <div className="subchart">
          <div className="subchart-label">ATR (14)</div>
          <ResponsiveContainer width="100%" height={70}>
            <ComposedChart data={chartData} margin={{ top: 2, right: 60, left: 0, bottom: 0 }}>
              <YAxis stroke="#64748b" fontSize={9} tickLine={false} orientation="right" />
              <Area type="monotone" dataKey="atr" stroke="#14b8a6" strokeWidth={1.5}
                fill="rgba(20,184,166,0.1)" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function PriceTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="chart-tooltip">
      <div className="tooltip-date">{d.fullDate}</div>
      <div className="tooltip-row">
        <span>O</span><span style={{ color: d.isUp ? '#22c55e' : '#ef4444' }}>{d.open?.toFixed(2)}</span>
      </div>
      <div className="tooltip-row">
        <span>H</span><span>{d.high?.toFixed(2)}</span>
      </div>
      <div className="tooltip-row">
        <span>L</span><span>{d.low?.toFixed(2)}</span>
      </div>
      <div className="tooltip-row">
        <span>C</span><span style={{ color: d.isUp ? '#22c55e' : '#ef4444' }}>{d.close?.toFixed(2)}</span>
      </div>
      <div className="tooltip-row">
        <span>Vol</span><span>{((d.volume || 0) / 1e6).toFixed(1)}M</span>
      </div>
      {d.rsi > 0 && <div className="tooltip-row"><span>RSI</span><span>{d.rsi.toFixed(1)}</span></div>}
    </div>
  );
}
