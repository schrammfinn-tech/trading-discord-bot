import fetch from "node-fetch";
import { MarketQuote, MarketNews, AssetType, Candlestick } from "../types";
import { CONFIG } from "../config";

let yahooFinance: any = null;
let lastYahooCall = 0;
const YAHOO_COOLDOWN = 250; // ms between calls

async function getYahooFinance(): Promise<any> {
  if (!yahooFinance) {
    const mod = await import("yahoo-finance2");
    yahooFinance = new mod.default();
  }
  return yahooFinance;
}

async function rateLimitedYF(): Promise<any> {
  const now = Date.now();
  const wait = lastYahooCall + YAHOO_COOLDOWN - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastYahooCall = Date.now();
  return getYahooFinance();
}

const cache = new Map<string, { data: MarketQuote; timestamp: number }>();
const newsCache: { data: MarketNews[]; timestamp: number } | null = null;

function getCacheKey(symbol: string, type: AssetType): string {
  return `${type}:${symbol.toUpperCase()}`;
}

function getCached(key: string): MarketQuote | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CONFIG.CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

function setCache(key: string, data: MarketQuote): void {
  cache.set(key, { data, timestamp: Date.now() });
  if (cache.size > 1000) {
    const oldest = [...cache.entries()].sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    )[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

function resolveAssetType(symbol: string): AssetType {
  const upper = symbol.toUpperCase();
  if (CONFIG.CRYPTO_IDS.has(upper)) return "crypto";
  if (CONFIG.FOREX_PAIRS.has(upper)) return "forex";
  if (upper.endsWith("=F")) return "commodity";
  return "stock";
}

async function fetchStockQuote(symbol: string): Promise<MarketQuote> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const data = await res.json() as any;
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error("No data");
    const meta = result.meta;
    const price = meta.regularMarketPrice ?? 0;
    const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? price;
    const change = price - prevClose;
    const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
    const volume = meta.regularMarketVolume ?? 0;

    return {
      symbol: meta.symbol ?? symbol.toUpperCase(),
      name: meta.symbol ?? symbol.toUpperCase(),
      price: Number(price.toFixed(2)),
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
      volume,
      type: "stock",
      currency: meta.currency ?? "USD",
      lastUpdated: new Date().toISOString(),
    };
  } catch {
    throw new Error(`Could not fetch stock data for ${symbol}.`);
  }
}

async function fetchCryptoQuote(
  symbol: string,
  coingeckoId: string
): Promise<MarketQuote> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
    const res = await fetch(url);
    const data = (await res.json()) as Record<string, {
      usd: number;
      usd_24h_change?: number;
      usd_24h_vol?: number;
    }>;

    if (!data[coingeckoId]) {
      throw new Error(`No data for ${symbol}`);
    }

    const coinData = data[coingeckoId];
    const price = coinData.usd;
    const changePercent = coinData.usd_24h_change ?? 0;
    const change = (price * changePercent) / 100;
    const volume = coinData.usd_24h_vol ?? 0;

    return {
      symbol: symbol.toUpperCase(),
      name: coingeckoId
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      price: Number(price.toFixed(6)),
      change: Number(change.toFixed(6)),
      changePercent: Number(changePercent.toFixed(2)),
      volume,
      type: "crypto",
      currency: "USD",
      lastUpdated: new Date().toISOString(),
    };
  } catch {
    throw new Error(`Could not fetch crypto data for ${symbol}.`);
  }
}

async function fetchForexQuote(symbol: string): Promise<MarketQuote> {
  try {
    const yahooSymbol = `${symbol}=X`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const data = await res.json() as any;
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error("No data");
    const price = meta.regularMarketPrice ?? 0;
    const prevClose = meta.previousClose ?? price;
    const change = price - prevClose;
    const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

    const pairName = CONFIG.FOREX_PAIRS.get(symbol.toUpperCase()) ?? symbol;

    return {
      symbol: symbol.toUpperCase(),
      name: pairName,
      price: Number(price.toFixed(5)),
      change: Number(change.toFixed(5)),
      changePercent: Number(changePercent.toFixed(2)),
      volume: meta.regularMarketVolume ?? 0,
      type: "forex",
      currency: "USD",
      lastUpdated: new Date().toISOString(),
    };
  } catch {
    throw new Error(`Could not fetch forex data for ${symbol}.`);
  }
}

async function fetchCommodityQuote(symbol: string): Promise<MarketQuote> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const data = await res.json() as any;
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error("No data");
    const price = meta.regularMarketPrice ?? 0;
    const prevClose = meta.previousClose ?? price;
    const change = price - prevClose;
    const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
    const name = CONFIG.COMMODITIES.find((c: { symbol: string; name: string }) => c.symbol === symbol)?.name ?? symbol;

    return {
      symbol: symbol.toUpperCase(),
      name,
      price: Number(price.toFixed(2)),
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
      volume: meta.regularMarketVolume ?? 0,
      type: "commodity",
      currency: "USD",
      lastUpdated: new Date().toISOString(),
    };
  } catch {
    throw new Error(`Could not fetch commodity data for ${symbol}.`);
  }
}

export async function getQuote(
  symbol: string,
  type?: AssetType
): Promise<MarketQuote> {
  const resolvedType = type ?? resolveAssetType(symbol);
  const key = getCacheKey(symbol, resolvedType);
  const cached = getCached(key);
  if (cached) return cached;

  let quote: MarketQuote;
  switch (resolvedType) {
    case "crypto": {
      const cgId = CONFIG.CRYPTO_IDS.get(symbol.toUpperCase()) ?? symbol.toLowerCase();
      quote = await fetchCryptoQuote(symbol, cgId);
      break;
    }
    case "forex":
      quote = await fetchForexQuote(symbol);
      break;
    case "commodity":
      quote = await fetchCommodityQuote(symbol);
      break;
    default:
      quote = await fetchStockQuote(symbol);
  }

  setCache(key, quote);
  return quote;
}

export async function getMultipleQuotes(
  symbols: string[]
): Promise<MarketQuote[]> {
  const results: MarketQuote[] = [];
  for (const s of symbols) {
    try {
      const q = await getQuote(s);
      results.push(q);
    } catch {}
  }
  return results;
}

export async function getHistorical(
  symbol: string,
  period: "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" = "1mo",
  type?: AssetType
): Promise<Candlestick[]> {
  const resolvedType = type ?? resolveAssetType(symbol);

  if (resolvedType === "crypto") {
    const cgId = CONFIG.CRYPTO_IDS.get(symbol.toUpperCase()) ?? symbol.toLowerCase();
    let days = 30;
    switch (period) {
      case "1d": days = 1; break;
      case "5d": days = 5; break;
      case "1mo": days = 30; break;
      case "3mo": days = 90; break;
      case "6mo": days = 180; break;
      case "1y": days = 365; break;
    }

    try {
      const url = `https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${days}`;
      const res = await fetch(url);
      const data = (await res.json()) as number[][];
      return data.map((candle) => ({
        timestamp: new Date(candle[0]).toISOString(),
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: 0,
      }));
    } catch {
      return [];
    }
  }

  try {
    let interval = "1d";
    let range = "1mo";
    switch (period) {
      case "1d": interval = "5m"; range = "1d"; break;
      case "5d": interval = "15m"; range = "5d"; break;
      case "1mo": interval = "1h"; range = "1mo"; break;
      case "3mo": interval = "1d"; range = "3mo"; break;
      case "6mo": interval = "1d"; range = "6mo"; break;
      case "1y": interval = "1d"; range = "1y"; break;
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const data = await res.json() as any;
    const result = data?.chart?.result?.[0];
    if (!result) return [];

    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0];
    if (!quotes || !timestamps.length) return [];

    return timestamps.map((t: number, i: number) => ({
      timestamp: new Date(t * 1000).toISOString(),
      open: quotes.open?.[i] ?? 0,
      high: quotes.high?.[i] ?? 0,
      low: quotes.low?.[i] ?? 0,
      close: quotes.close?.[i] ?? 0,
      volume: quotes.volume?.[i] ?? 0,
    })).filter((c: Candlestick) => c.close > 0);
  } catch {
    return [];
  }
}

function getStartDate(period: string): Date {
  const now = new Date();
  switch (period) {
    case "1d": return new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    case "5d": return new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    case "1mo": return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "3mo": return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "6mo": return new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    case "1y": return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    default: return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}

export async function getMarketNews(
  count: number = 10
): Promise<MarketNews[]> {
  if (newsCache && Date.now() - newsCache.timestamp < 600_000) {
    return newsCache.data.slice(0, count);
  }

  try {
    const url = "https://news.yahoo.com/rss/finance";
    return [];
  } catch {
    return [];
  }
}

export function getSupportedAssets(): {
  stocks: string[];
  crypto: string[];
  forex: string[];
  commodities: { symbol: string; name: string }[];
} {
  return {
    stocks: ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NVDA", "NFLX", "JPM", "V"],
    crypto: Array.from(CONFIG.CRYPTO_IDS.keys()),
    forex: Array.from(CONFIG.FOREX_PAIRS.keys()),
    commodities: CONFIG.COMMODITIES.map((c: { symbol: string; name: string }) => ({
      symbol: c.symbol,
      name: c.name,
    })),
  };
}

export { resolveAssetType };
