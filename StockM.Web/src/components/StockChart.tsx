import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  createChart, IChartApi, ISeriesApi, CandlestickData, LineData, HistogramData,
  ColorType, CrosshairMode, LineStyle, UTCTimestamp, Time,
} from 'lightweight-charts';
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
  { value: 'W', label: '1W' },
  { value: 'M', label: '1M' },
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

function toUTC(ts: string): UTCTimestamp {
  return (new Date(ts).getTime() / 1000) as UTCTimestamp;
}

const CHART_COLORS = {
  bg: '#0f172a',
  grid: '#1e293b',
  text: '#64748b',
  crosshair: '#475569',
  upColor: '#22c55e',
  downColor: '#ef4444',
};

function createBaseChart(container: HTMLElement, height: number): IChartApi {
  return createChart(container, {
    width: container.clientWidth,
    height,
    layout: {
      background: { type: ColorType.Solid, color: CHART_COLORS.bg },
      textColor: CHART_COLORS.text,
      fontSize: 11,
    },
    grid: {
      vertLines: { color: CHART_COLORS.grid },
      horzLines: { color: CHART_COLORS.grid },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: CHART_COLORS.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1e293b' },
      horzLine: { color: CHART_COLORS.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1e293b' },
    },
    rightPriceScale: {
      borderColor: CHART_COLORS.grid,
      scaleMargins: { top: 0.1, bottom: 0.1 },
    },
    timeScale: {
      borderColor: CHART_COLORS.grid,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 5,
      minBarSpacing: 3,
    },
    handleScroll: { vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: true },
  });
}

/** Remove TradingView attribution watermark from chart container */
function removeTVWatermark(container: HTMLElement) {
  const hide = () => {
    // Hide all anchors inside the chart container (TV logo is always an <a>)
    container.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (href.includes('tradingview') || a.target === '_blank' || a.textContent?.includes('TradingView')) {
        a.style.cssText = 'display:none!important;visibility:hidden!important;width:0!important;height:0!important;overflow:hidden!important;position:absolute!important;';
      }
    });
    // Also target the table row that wraps the logo
    container.querySelectorAll('tr').forEach(tr => {
      if (tr.querySelector('a[href*="tradingview"]') || tr.innerHTML?.includes('tradingview')) {
        (tr as HTMLElement).style.cssText = 'display:none!important;';
      }
    });
  };
  hide();
  // MutationObserver to catch dynamically added elements
  const mo = new MutationObserver(hide);
  mo.observe(container, { childList: true, subtree: true });
  // Auto-disconnect after 2s to avoid perf overhead
  setTimeout(() => mo.disconnect(), 2000);
}

/** Aggregate daily candles into weekly or monthly candles */
function aggregateCandles(dailyQuotes: StockQuote[], period: 'week' | 'month'): StockQuote[] {
  if (dailyQuotes.length === 0) return [];
  const buckets: Map<string, StockQuote> = new Map();

  for (const q of dailyQuotes) {
    const d = new Date(q.timestamp);
    let key: string;
    if (period === 'week') {
      // ISO week: get Monday of the week
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
      const monday = new Date(d);
      monday.setDate(diff);
      key = monday.toISOString().split('T')[0];
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    }

    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { ...q, timestamp: key });
    } else {
      existing.high = Math.max(existing.high, q.high);
      existing.low = Math.min(existing.low, q.low);
      existing.close = q.close; // last close in period
      existing.volume += q.volume;
    }
  }
  return Array.from(buckets.values());
}

export function StockChart({ data, signal, dataSource, liveQuote, currency, market }: StockChartProps) {
  const [settings, setSettings] = useState<ChartSettings>(DEFAULT_CHART_SETTINGS);
  const [intradayQuotes, setIntradayQuotes] = useState<StockQuote[] | null>(null);
  const [intradayLoading, setIntradayLoading] = useState(false);
  const fetchIdRef = useRef(0);

  // Chart refs
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const mainChartRef = useRef<IChartApi | null>(null);
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const stochContainerRef = useRef<HTMLDivElement>(null);
  const stochChartRef = useRef<IChartApi | null>(null);
  const atrContainerRef = useRef<HTMLDivElement>(null);
  const atrChartRef = useRef<IChartApi | null>(null);

  // Legend state for crosshair
  const [legend, setLegend] = useState<{ o: number; h: number; l: number; c: number; v: number; time: string } | null>(null);

  const isIntraday = !['D', 'W', 'M'].includes(settings.interval);

  // Fetch intraday data
  useEffect(() => {
    if (!isIntraday) { setIntradayQuotes(null); return; }
    const id = ++fetchIdRef.current;
    const days = TIME_RANGE_DAYS[settings.timeRange];
    setIntradayLoading(true);
    fetchYahooIntraday(data.symbol, settings.interval, days, market)
      .then(quotes => { if (fetchIdRef.current === id) setIntradayQuotes(quotes); })
      .catch(() => { if (fetchIdRef.current === id) setIntradayQuotes(null); })
      .finally(() => { if (fetchIdRef.current === id) setIntradayLoading(false); });
  }, [data.symbol, settings.interval, settings.timeRange, market, isIntraday]);

  // Prepare data
  const { quotes, indicators } = useMemo(() => {
    const days = TIME_RANGE_DAYS[settings.timeRange];
    let displayQuotes: StockQuote[];
    if (isIntraday && intradayQuotes && intradayQuotes.length > 0) {
      displayQuotes = intradayQuotes;
    } else {
      const sliced = days >= data.quotes.length ? data.quotes : data.quotes.slice(-days);
      // Aggregate into weekly or monthly candles if needed
      if (settings.interval === 'W') {
        displayQuotes = aggregateCandles(sliced, 'week');
      } else if (settings.interval === 'M') {
        displayQuotes = aggregateCandles(sliced, 'month');
      } else {
        displayQuotes = sliced;
      }
    }
    const ind = computeFullIndicators(data.quotes);
    return { quotes: displayQuotes, indicators: ind };
  }, [data, settings.timeRange, settings.interval, isIntraday, intradayQuotes]);

  // Period high/low based on displayed data
  const periodStats = useMemo(() => {
    const src = quotes.length > 0 ? quotes : data.quotes;
    let high = -Infinity, low = Infinity, highDate = '', lowDate = '';
    for (const q of src) {
      if (q.high > high) { high = q.high; highDate = q.timestamp; }
      if (q.low < low) { low = q.low; lowDate = q.timestamp; }
    }
    const rangeLabel = settings.timeRange === 'ALL' ? 'All-Time'
      : settings.timeRange === '5Y' ? '5Y'
      : settings.timeRange === '1Y' ? '1Y'
      : settings.timeRange === '6M' ? '6M'
      : settings.timeRange === '3M' ? '3M'
      : settings.timeRange === '1M' ? '1M'
      : settings.timeRange === '1W' ? '1W' : '1D';
    return { high, low, highDate, lowDate, rangeLabel };
  }, [quotes, data.quotes, settings.timeRange]);

  // Map index from display quotes into daily indicator arrays
  const getIndicatorIdx = useCallback((i: number) => {
    const dailyCount = data.quotes.length;
    const days = TIME_RANGE_DAYS[settings.timeRange];
    const usedDays = Math.min(days, dailyCount);
    if (isIntraday && intradayQuotes) {
      return Math.min(dailyCount - 1, dailyCount - usedDays + Math.floor(i / Math.max(1, quotes.length / usedDays)));
    }
    return dailyCount - quotes.length + i;
  }, [data.quotes.length, settings.timeRange, isIntraday, intradayQuotes, quotes.length]);

  // ── Main chart ──
  useEffect(() => {
    if (!mainContainerRef.current || quotes.length === 0) return;
    const container = mainContainerRef.current;
    container.innerHTML = '';

    const chart = createBaseChart(container, 380);
    mainChartRef.current = chart;

    // Price series
    let priceSeries: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'>;

    if (settings.chartType === 'candlestick') {
      const s = chart.addCandlestickSeries({
        upColor: CHART_COLORS.upColor,
        downColor: CHART_COLORS.downColor,
        borderUpColor: CHART_COLORS.upColor,
        borderDownColor: CHART_COLORS.downColor,
        wickUpColor: CHART_COLORS.upColor,
        wickDownColor: CHART_COLORS.downColor,
      });
      s.setData(quotes.map(q => ({
        time: toUTC(q.timestamp),
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
      } as CandlestickData)));
      priceSeries = s;
    } else if (settings.chartType === 'line') {
      const s = chart.addLineSeries({ color: '#3b82f6', lineWidth: 2 });
      s.setData(quotes.map(q => ({ time: toUTC(q.timestamp), value: q.close } as LineData)));
      priceSeries = s as any;
    } else {
      const s = chart.addAreaSeries({
        lineColor: '#3b82f6',
        topColor: 'rgba(59,130,246,0.25)',
        bottomColor: 'rgba(59,130,246,0.02)',
        lineWidth: 2,
      });
      s.setData(quotes.map(q => ({ time: toUTC(q.timestamp), value: q.close } as LineData)));
      priceSeries = s as any;
    }

    // Volume as histogram on main chart (subtle background)
    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volSeries.setData(quotes.map(q => ({
      time: toUTC(q.timestamp),
      value: q.volume,
      color: q.close >= q.open ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
    } as HistogramData)));

    // Overlay indicators
    const ind = indicators;
    const overlayLine = (key: string, color: string, dataArr: number[], dash?: boolean) => {
      if (!settings.overlays.includes(key as OverlayIndicator)) return;
      const s = chart.addLineSeries({
        color,
        lineWidth: 1,
        ...(dash ? { lineStyle: LineStyle.Dashed } : {}),
        lastValueVisible: false,
        priceLineVisible: false,
      });
      const lineData: LineData[] = [];
      quotes.forEach((q, i) => {
        const idx = Math.max(0, Math.min(getIndicatorIdx(i), dataArr.length - 1));
        const v = dataArr[idx];
        if (v && v > 0) lineData.push({ time: toUTC(q.timestamp), value: v } as LineData);
      });
      s.setData(lineData);
    };

    overlayLine('sma20', '#f59e0b', ind.sma20);
    overlayLine('sma50', '#3b82f6', ind.sma50);
    overlayLine('sma200', '#ef4444', ind.sma200);
    overlayLine('ema12', '#8b5cf6', ind.ema12);
    overlayLine('ema26', '#ec4899', ind.ema26);
    overlayLine('vwap', '#14b8a6', ind.vwap, true);

    if (settings.overlays.includes('bollinger')) {
      overlayLine('bollinger', '#6366f1', ind.bollingerUpper, true);
      // Also middle & lower (force them even though key won't re-check)
      const addBB = (arr: number[], dash: boolean) => {
        const s = chart.addLineSeries({
          color: '#6366f1',
          lineWidth: 1,
          lineStyle: dash ? LineStyle.Dashed : LineStyle.Solid,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        const ld: LineData[] = [];
        quotes.forEach((q, i) => {
          const idx = Math.max(0, Math.min(getIndicatorIdx(i), arr.length - 1));
          const v = arr[idx];
          if (v && v > 0) ld.push({ time: toUTC(q.timestamp), value: v } as LineData);
        });
        s.setData(ld);
      };
      addBB(ind.bollingerMiddle, false);
      addBB(ind.bollingerLower, true);
    }

    // Signal price lines
    if (signal) {
      const addPriceLine = (price: number, color: string, title: string) => {
        (priceSeries as any).createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title,
        });
      };
      addPriceLine(signal.entryPrice, '#eab308', `Entry ${currency}${signal.entryPrice.toFixed(2)}`);
      addPriceLine(signal.stopLoss, '#ef4444', `SL ${currency}${signal.stopLoss.toFixed(2)}`);
      addPriceLine(signal.takeProfit, '#22c55e', `TP ${currency}${signal.takeProfit.toFixed(2)}`);
    }

    // Period High / Low price lines
    if (periodStats.high > 0 && periodStats.low < Infinity) {
      (priceSeries as any).createPriceLine({
        price: periodStats.high,
        color: '#22d3ee',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `${periodStats.rangeLabel} H`,
      });
      (priceSeries as any).createPriceLine({
        price: periodStats.low,
        color: '#f472b6',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `${periodStats.rangeLabel} L`,
      });
    }

    // Crosshair legend
    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.seriesData?.size) {
        setLegend(null);
        return;
      }
      const priceData: any = param.seriesData.get(priceSeries);
      if (!priceData) { setLegend(null); return; }
      const t = param.time as number;
      const d = new Date(t * 1000);
      const timeStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
      if ('open' in priceData) {
        setLegend({ o: priceData.open, h: priceData.high, l: priceData.low, c: priceData.close, v: 0, time: timeStr });
      } else {
        setLegend({ o: 0, h: 0, l: 0, c: priceData.value, v: 0, time: timeStr });
      }
    });

    // Auto-fit
    chart.timeScale().fitContent();
    removeTVWatermark(container);

    // Resize handler
    const handleResize = () => {
      if (container.clientWidth > 0) chart.applyOptions({ width: container.clientWidth });
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      mainChartRef.current = null;
    };
  }, [quotes, indicators, settings.chartType, settings.overlays, signal, currency, getIndicatorIdx, periodStats]);

  // ── Sub-chart: RSI ──
  useEffect(() => {
    if (!settings.subcharts.includes('rsi') || !rsiContainerRef.current || quotes.length === 0) return;
    const container = rsiContainerRef.current;
    container.innerHTML = '';
    const chart = createBaseChart(container, 100);
    rsiChartRef.current = chart;
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.05 } });

    const rsiSeries = chart.addLineSeries({ color: '#a855f7', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true });
    const rsiData: LineData[] = [];
    quotes.forEach((q, i) => {
      const idx = Math.max(0, Math.min(getIndicatorIdx(i), indicators.rsi.length - 1));
      const v = indicators.rsi[idx];
      if (v > 0) rsiData.push({ time: toUTC(q.timestamp), value: v } as LineData);
    });
    rsiSeries.setData(rsiData);

    // Overbought/oversold lines
    const addLevel = (price: number, color: string) => {
      rsiSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: '' });
    };
    addLevel(70, '#ef4444');
    addLevel(30, '#22c55e');
    addLevel(50, '#475569');

    chart.timeScale().fitContent();
    removeTVWatermark(container);
    const ro = new ResizeObserver(() => { if (container.clientWidth > 0) chart.applyOptions({ width: container.clientWidth }); });
    ro.observe(container);

    // Sync time scale with main chart
    if (mainChartRef.current) {
      const mainTs = mainChartRef.current.timeScale();
      const subTs = chart.timeScale();
      mainTs.subscribeVisibleLogicalRangeChange(range => { if (range) subTs.setVisibleLogicalRange(range); });
      subTs.subscribeVisibleLogicalRangeChange(range => { if (range) mainTs.setVisibleLogicalRange(range); });
    }

    return () => { ro.disconnect(); chart.remove(); rsiChartRef.current = null; };
  }, [quotes, indicators, settings.subcharts, getIndicatorIdx]);

  // ── Sub-chart: MACD ──
  useEffect(() => {
    if (!settings.subcharts.includes('macd') || !macdContainerRef.current || quotes.length === 0) return;
    const container = macdContainerRef.current;
    container.innerHTML = '';
    const chart = createBaseChart(container, 110);
    macdChartRef.current = chart;

    const macdLine = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
    const signalLine = chart.addLineSeries({ color: '#f97316', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed });
    const histSeries = chart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });

    const macdData: LineData[] = [], sigData: LineData[] = [], histData: HistogramData[] = [];
    quotes.forEach((q, i) => {
      const idx = Math.max(0, Math.min(getIndicatorIdx(i), indicators.macdLine.length - 1));
      const ml = indicators.macdLine[idx], ms = indicators.macdSignal[idx], mh = indicators.macdHistogram[idx];
      const t = toUTC(q.timestamp);
      if (ml !== 0 || ms !== 0) {
        macdData.push({ time: t, value: ml } as LineData);
        sigData.push({ time: t, value: ms } as LineData);
        histData.push({ time: t, value: mh, color: mh >= 0 ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)' } as HistogramData);
      }
    });
    macdLine.setData(macdData);
    signalLine.setData(sigData);
    histSeries.setData(histData);

    chart.timeScale().fitContent();
    removeTVWatermark(container);
    const ro = new ResizeObserver(() => { if (container.clientWidth > 0) chart.applyOptions({ width: container.clientWidth }); });
    ro.observe(container);

    if (mainChartRef.current) {
      const mainTs = mainChartRef.current.timeScale();
      const subTs = chart.timeScale();
      mainTs.subscribeVisibleLogicalRangeChange(range => { if (range) subTs.setVisibleLogicalRange(range); });
      subTs.subscribeVisibleLogicalRangeChange(range => { if (range) mainTs.setVisibleLogicalRange(range); });
    }

    return () => { ro.disconnect(); chart.remove(); macdChartRef.current = null; };
  }, [quotes, indicators, settings.subcharts, getIndicatorIdx]);

  // ── Sub-chart: Stochastic ──
  useEffect(() => {
    if (!settings.subcharts.includes('stochastic') || !stochContainerRef.current || quotes.length === 0) return;
    const container = stochContainerRef.current;
    container.innerHTML = '';
    const chart = createBaseChart(container, 100);
    stochChartRef.current = chart;

    const kLine = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
    const dLine = chart.addLineSeries({ color: '#f97316', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed });

    const kData: LineData[] = [], dData: LineData[] = [];
    quotes.forEach((q, i) => {
      const idx = Math.max(0, Math.min(getIndicatorIdx(i), indicators.stochK.length - 1));
      const k = indicators.stochK[idx], d = indicators.stochD[idx];
      const t = toUTC(q.timestamp);
      if (k > 0 || d > 0) {
        kData.push({ time: t, value: k } as LineData);
        dData.push({ time: t, value: d } as LineData);
      }
    });
    kLine.setData(kData);
    dLine.setData(dData);

    kLine.createPriceLine({ price: 80, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: '' });
    kLine.createPriceLine({ price: 20, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: '' });

    chart.timeScale().fitContent();
    removeTVWatermark(container);
    const ro = new ResizeObserver(() => { if (container.clientWidth > 0) chart.applyOptions({ width: container.clientWidth }); });
    ro.observe(container);

    if (mainChartRef.current) {
      const mainTs = mainChartRef.current.timeScale();
      const subTs = chart.timeScale();
      mainTs.subscribeVisibleLogicalRangeChange(range => { if (range) subTs.setVisibleLogicalRange(range); });
      subTs.subscribeVisibleLogicalRangeChange(range => { if (range) mainTs.setVisibleLogicalRange(range); });
    }

    return () => { ro.disconnect(); chart.remove(); stochChartRef.current = null; };
  }, [quotes, indicators, settings.subcharts, getIndicatorIdx]);

  // ── Sub-chart: ATR ──
  useEffect(() => {
    if (!settings.subcharts.includes('atr') || !atrContainerRef.current || quotes.length === 0) return;
    const container = atrContainerRef.current;
    container.innerHTML = '';
    const chart = createBaseChart(container, 80);
    atrChartRef.current = chart;

    const atrSeries = chart.addAreaSeries({
      lineColor: '#14b8a6',
      topColor: 'rgba(20,184,166,0.15)',
      bottomColor: 'rgba(20,184,166,0.02)',
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: true,
    });

    const atrData: LineData[] = [];
    quotes.forEach((q, i) => {
      const idx = Math.max(0, Math.min(getIndicatorIdx(i), indicators.atr.length - 1));
      const v = indicators.atr[idx];
      if (v > 0) atrData.push({ time: toUTC(q.timestamp), value: v } as LineData);
    });
    atrSeries.setData(atrData);

    chart.timeScale().fitContent();
    removeTVWatermark(container);
    const ro = new ResizeObserver(() => { if (container.clientWidth > 0) chart.applyOptions({ width: container.clientWidth }); });
    ro.observe(container);

    if (mainChartRef.current) {
      const mainTs = mainChartRef.current.timeScale();
      const subTs = chart.timeScale();
      mainTs.subscribeVisibleLogicalRangeChange(range => { if (range) subTs.setVisibleLogicalRange(range); });
      subTs.subscribeVisibleLogicalRangeChange(range => { if (range) mainTs.setVisibleLogicalRange(range); });
    }

    return () => { ro.disconnect(); chart.remove(); atrChartRef.current = null; };
  }, [quotes, indicators, settings.subcharts, getIndicatorIdx]);

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
          <><span className="ds-badge simulated">⚠️ SIMULATED</span>
            <span className="ds-text">Chart data is simulated — Yahoo Finance historical data was unavailable.</span></>
        )}
        {dataSource === 'live-patched' && (
          <><span className="ds-badge patched">📡 LIVE + SIM</span>
            <span className="ds-text">Today's price is <b>LIVE</b> ({currency}{liveQuote?.lastPrice.toFixed(2)}), historical chart is simulated.</span></>
        )}
        {dataSource === 'live-api' && (
          <><span className="ds-badge live">🟢 LIVE</span>
            <span className="ds-text">Real OHLC data from Yahoo Finance.</span></>
        )}
      </div>

      {/* Price Header */}
      <div className="chart-price-header">
        <div className="chart-symbol-info">
          <span className="chart-symbol">{data.symbol}</span>
          <span className="chart-price">{currency}{last.close.toFixed(2)}</span>
          <span className={`chart-change ${isUp ? 'up' : 'down'}`}>
            {isUp ? '+' : ''}{change.toFixed(2)} ({isUp ? '+' : ''}{changePct.toFixed(2)}%)
          </span>
        </div>
        {legend ? (
          <div className="chart-ohlc">
            <span>{legend.time}</span>
            <span>O <b>{legend.o.toFixed(2)}</b></span>
            <span>H <b>{legend.h.toFixed(2)}</b></span>
            <span>L <b>{legend.l.toFixed(2)}</b></span>
            <span>C <b style={{ color: legend.c >= legend.o ? '#22c55e' : '#ef4444' }}>{legend.c.toFixed(2)}</b></span>
          </div>
        ) : (
          <div className="chart-ohlc">
            <span>O <b>{last.open.toFixed(2)}</b></span>
            <span>H <b>{last.high.toFixed(2)}</b></span>
            <span>L <b>{last.low.toFixed(2)}</b></span>
            <span>C <b>{last.close.toFixed(2)}</b></span>
            <span>Vol <b>{(last.volume / 1e6).toFixed(1)}M</b></span>
          </div>
        )}
        <div className="chart-period-hl">
          <span className="period-label">{periodStats.rangeLabel}</span>
          <span className="period-high">H <b>{currency}{periodStats.high.toFixed(2)}</b>
            <small>{new Date(periodStats.highDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</small>
          </span>
          <span className="period-low">L <b>{currency}{periodStats.low.toFixed(2)}</b>
            <small>{new Date(periodStats.lowDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</small>
          </span>
          <span className="period-range-bar">
            <span className="range-track">
              <span className="range-fill" style={{ left: `${Math.max(0, Math.min(100, ((last.close - periodStats.low) / Math.max(0.01, periodStats.high - periodStats.low)) * 100))}%` }} />
            </span>
          </span>
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
        <div className="toolbar-group">
          {INTERVALS.map(iv => (
            <button key={iv.value}
              className={`toolbar-btn ${settings.interval === iv.value ? 'active' : ''}`}
              onClick={() => setSettings(s => ({ ...s, interval: iv.value }))}>
              {iv.label}
            </button>
          ))}
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group">
          {CHART_TYPES.map(ct => (
            <button key={ct.value}
              className={`toolbar-btn ${settings.chartType === ct.value ? 'active' : ''}`}
              onClick={() => setSettings(s => ({ ...s, chartType: ct.value }))}>
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

      {/* Main Chart */}
      <div className="chart-main" style={{ position: 'relative' }}>
        {intradayLoading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(15,23,42,0.7)', zIndex: 10, borderRadius: 8,
          }}>
            <span style={{ color: '#94a3b8', fontSize: 14 }}>Loading…</span>
          </div>
        )}
        <div ref={mainContainerRef} style={{ width: '100%' }} />
      </div>

      {/* Sub-charts */}
      {settings.subcharts.includes('rsi') && (
        <div className="subchart">
          <div className="subchart-label">RSI (14)</div>
          <div ref={rsiContainerRef} style={{ width: '100%' }} />
        </div>
      )}
      {settings.subcharts.includes('macd') && (
        <div className="subchart">
          <div className="subchart-label">MACD</div>
          <div ref={macdContainerRef} style={{ width: '100%' }} />
        </div>
      )}
      {settings.subcharts.includes('stochastic') && (
        <div className="subchart">
          <div className="subchart-label">Stochastic</div>
          <div ref={stochContainerRef} style={{ width: '100%' }} />
        </div>
      )}
      {settings.subcharts.includes('atr') && (
        <div className="subchart">
          <div className="subchart-label">ATR (14)</div>
          <div ref={atrContainerRef} style={{ width: '100%' }} />
        </div>
      )}
    </div>
  );
}
