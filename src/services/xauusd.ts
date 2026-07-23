import { getQuote, getHistorical } from "./market";
import { TextChannel, EmbedBuilder } from "discord.js";
import { CONFIG } from "../config";
import Parser from "rss-parser";

// ──────────────────────── Real-time price alerts ────────────────────────

let lastPrice = 0;
let lastPriceTimestamp = 0;
let alertInterval: ReturnType<typeof setInterval> | null = null;

const NEWS_CRITICAL_KEYWORDS = [
  "federal reserve", "fed ", "powell", "fomc", "interest rate", "rate decision",
  "cpi", "ppi", "inflation data", "gdp", "jobs report", "nonfarm", "unemployment",
  "nfp", "payroll", "central bank", "ecb", "boc", "boe", "boj",
  "breaking", "urgent", "alert",
];

function assessTradingConditions(volatility: "low" | "normal" | "high", hasNews: boolean): {
  level: "safe" | "caution" | "risky" | "stay_out";
  emoji: string;
  label: string;
  color: number;
  text: string;
} {
  if (volatility === "high" && hasNews) {
    return { level: "stay_out", emoji: "🔴", label: "STAY OUT", color: 0xFF1744, text: "High volatility + major news" };
  }
  if (volatility === "high") {
    return { level: "risky", emoji: "🟠", label: "RISKY", color: 0xFF6D00, text: "High volatility — wide spreads likely" };
  }
  if (hasNews) {
    return { level: "risky", emoji: "🟠", label: "RISKY", color: 0xFF6D00, text: "News event — unpredictable moves" };
  }
  if (volatility === "normal") {
    return { level: "caution", emoji: "🟡", label: "CAUTION", color: 0xFFAB00, text: "Normal volatility — manage risk" };
  }
  return { level: "safe", emoji: "🟢", label: "SAFE", color: 0x00C853, text: "Low volatility — good conditions" };
}

async function checkPriceAlert(client: any): Promise<void> {
  const channelId = CONFIG.XAUUSD_CHANNEL_ID;
  if (!channelId) return;

  try {
    const quote = await getQuote("GC=F");
    const price = quote.price;
    const now = Date.now();

    if (lastPrice === 0) {
      lastPrice = price;
      lastPriceTimestamp = now;
      return;
    }

    const change = price - lastPrice;
    const changePct = lastPrice > 0 ? (change / lastPrice) * 100 : 0;
    const absPct = Math.abs(changePct);

    if (absPct < 0.15 && Math.abs(change) < 4) return;

    let channel: TextChannel | null = null;
    try {
      const ch = await client.channels.fetch(channelId);
      if (ch && ch.isTextBased()) channel = ch as TextChannel;
    } catch { return; }
    if (!channel) return;

    // Quick volatility check
    const analysis = await analyzeXAUUSD();
    const volatility = analysis?.volatility ?? "normal";

    // Check for breaking gold news
    const goldNews = await fetchGoldNews();
    const hasBreakingNews = goldNews.some((n) =>
      NEWS_CRITICAL_KEYWORDS.some((kw) => n.title.toLowerCase().includes(kw))
    );

    const conditions = assessTradingConditions(volatility, hasBreakingNews);
    const direction = change >= 0 ? "🚀 PUMP" : "📉 DUMP";
    const sign = change >= 0 ? "+" : "";

    const embed = new EmbedBuilder()
      .setColor(conditions.color)
      .setTitle(`${direction} — XAUUSD`)
      .setDescription(`## $${price.toFixed(2)}\n${sign}${change.toFixed(2)} (${sign}${changePct.toFixed(2)}%)`)
      .addFields(
        { name: "Previous", value: `$${lastPrice.toFixed(2)}`, inline: true },
        { name: "Current", value: `$${price.toFixed(2)}`, inline: true },
        {
          name: `${conditions.emoji} Trading Conditions`,
          value: `**${conditions.label}**\n${conditions.text}`,
          inline: true,
        },
      )
      .setFooter({ text: `Real-time · ${volatility.toUpperCase()} volatility · ${hasBreakingNews ? "⚠️ News active" : "No breaking news"}` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    lastPrice = price;
    lastPriceTimestamp = now;
  } catch {}
}

// ──────────────────────── Start / Stop ────────────────────────

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let lastPostTime = 0;
const MIN_POST_INTERVAL = 300_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function round(n: number, d: number = 2): number {
  return parseFloat(n.toFixed(d));
}

function pipDiff(a: number, b: number): number {
  return round(Math.abs(a - b), 2);
}

interface KeyLevel {
  price: number;
  type: string;
  strength: "strong" | "medium" | "weak";
}

interface XAUUSDAnalysis {
  price: number;
  change: number;
  changePercent: number;
  dailyHigh: number;
  dailyLow: number;
  trend: "bullish" | "bearish" | "sideways";
  trendStrength: number;
  support: KeyLevel[];
  resistance: KeyLevel[];
  longEntry: { price: number; stopLoss: number; takeProfit: number; riskReward: string };
  shortEntry: { price: number; stopLoss: number; takeProfit: number; riskReward: string };
  rsi: number | null;
  volatility: "low" | "normal" | "high";
  timestamp: string;
}

export async function analyzeXAUUSD(): Promise<XAUUSDAnalysis | null> {
  try {
    const quote = await getQuote("GC=F");
    const candles = await getHistorical("GC=F", "5d", "commodity");

    if (candles.length < 20) return null;

    const prices = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const current = quote.price;
    const dailyHigh = Math.max(...highs.slice(-24));
    const dailyLow = Math.min(...lows.slice(-24));

    // Moving averages
    const ma20 = round(prices.slice(-20).reduce((a, b) => a + b, 0) / 20);
    const ma50 = candles.length >= 50
      ? round(prices.slice(-50).reduce((a, b) => a + b, 0) / 50)
      : round(prices.slice(-prices.length).reduce((a, b) => a + b, 0) / prices.length);

    // Trend determination
    let trend: "bullish" | "bearish" | "sideways";
    let trendStrength: number;
    const maGap = Math.abs((current - ma20) / ma20) * 100;

    if (current > ma20 && current > ma50) {
      trend = "bullish";
      trendStrength = Math.min(Math.round(maGap * 20), 100);
    } else if (current < ma20 && current < ma50) {
      trend = "bearish";
      trendStrength = Math.min(Math.round(maGap * 20), 100);
    } else {
      trend = "sideways";
      trendStrength = Math.max(0, 100 - Math.round(maGap * 25));
    }

    // RSI (14-period)
    let rsi: number | null = null;
    if (prices.length >= 15) {
      const gains: number[] = [];
      const losses: number[] = [];
      for (let i = prices.length - 14; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
      }
      const avgGain = gains.reduce((a, b) => a + b, 0) / 14;
      const avgLoss = losses.reduce((a, b) => a + b, 0) / 14;
      if (avgLoss === 0) rsi = 100;
      else rsi = round(100 - 100 / (1 + avgGain / avgLoss), 1);
    }

    // Support & resistance (pivot points from recent price action)
    const recentHigh = Math.max(...highs);
    const recentLow = Math.min(...lows);
    const pivot = round((recentHigh + recentLow + current) / 3);
    const r1 = round(2 * pivot - recentLow);
    const r2 = round(pivot + (recentHigh - recentLow));
    const s1 = round(2 * pivot - recentHigh);
    const s2 = round(pivot - (recentHigh - recentLow));

    const support: KeyLevel[] = [
      { price: s1, type: "S1 Pivot", strength: "strong" as const },
      { price: s2, type: "S2 Pivot", strength: "medium" as const },
      { price: round(recentLow), type: "Recent Low", strength: "strong" as const },
    ].sort((a, b) => b.price - a.price);

    const resistance: KeyLevel[] = [
      { price: r1, type: "R1 Pivot", strength: "strong" as const },
      { price: r2, type: "R2 Pivot", strength: "medium" as const },
      { price: round(recentHigh), type: "Recent High", strength: "strong" as const },
    ].sort((a, b) => a.price - b.price);

    // Volatility (ATR-like)
    const trValues: number[] = [];
    for (let i = 1; i < Math.min(candles.length, 15); i++) {
      const h = candles[i].high;
      const l = candles[i].low;
      const prevClose = candles[i - 1].close;
      trValues.push(Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose)));
    }
    const atr = round(trValues.reduce((a, b) => a + b, 0) / trValues.length);
    const atrPct = (atr / current) * 100;
    let volatility: "low" | "normal" | "high";
    if (atrPct > 1.5) volatility = "high";
    else if (atrPct < 0.5) volatility = "low";
    else volatility = "normal";

    // Entry points
    const stopBuffer = round(atr * 1.5);
    const tpMultiplier = 2;

    let longEntry: { price: number; stopLoss: number; takeProfit: number; riskReward: string };
    let shortEntry: { price: number; stopLoss: number; takeProfit: number; riskReward: string };

    const nearestSupport = support[0]?.price ?? s1;
    const nearestResistance = resistance[0]?.price ?? r1;

    // Long entry: buy above nearest support
    longEntry = {
      price: round(nearestSupport + atr * 0.3),
      stopLoss: round(nearestSupport - stopBuffer),
      takeProfit: round(nearestSupport + stopBuffer * tpMultiplier),
      riskReward: "",
    };
    const longRisk = pipDiff(longEntry.price, longEntry.stopLoss);
    const longReward = pipDiff(longEntry.takeProfit, longEntry.price);
    longEntry.riskReward = longRisk > 0 ? `1:${round(longReward / longRisk, 1)}` : "-";

    // Short entry: sell below nearest resistance
    shortEntry = {
      price: round(nearestResistance - atr * 0.3),
      stopLoss: round(nearestResistance + stopBuffer),
      takeProfit: round(nearestResistance - stopBuffer * tpMultiplier),
      riskReward: "",
    };
    const shortRisk = pipDiff(shortEntry.price, shortEntry.stopLoss);
    const shortReward = pipDiff(shortEntry.price, shortEntry.takeProfit);
    shortEntry.riskReward = shortRisk > 0 ? `1:${round(shortReward / shortRisk, 1)}` : "-";

    return {
      price: round(current),
      change: round(quote.change),
      changePercent: round(quote.changePercent),
      dailyHigh: round(dailyHigh),
      dailyLow: round(dailyLow),
      trend,
      trendStrength,
      support,
      resistance,
      longEntry,
      shortEntry,
      rsi,
      volatility,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function buildXAUUSDEmbed(analysis: XAUUSDAnalysis): EmbedBuilder {
  const trendEmoji = analysis.trend === "bullish" ? "📈" : analysis.trend === "bearish" ? "📉" : "↔️";
  const trendColor = analysis.trend === "bullish" ? 0x00E676 : analysis.trend === "bearish" ? 0xFF5252 : 0xFFAB00;
  const trendLabel = analysis.trend.toUpperCase();

  const rsiLabel = analysis.rsi !== null
    ? analysis.rsi > 70 ? `🔴 Overbought` : analysis.rsi < 30 ? `🟢 Oversold` : `🟡 Neutral`
    : "—";

  const volEmoji = analysis.volatility === "high" ? "⚠️" : analysis.volatility === "low" ? "💤" : "✅";

  const supportLines = analysis.support
    .slice(0, 3)
    .map((s) => `${s.strength === "strong" ? "🟢" : "🟡"} **$${s.price}** — ${s.type}`)
    .join("\n");

  const resistanceLines = analysis.resistance
    .slice(0, 3)
    .map((r) => `${r.strength === "strong" ? "🔴" : "🟠"} **$${r.price}** — ${r.type}`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(trendColor)
    .setTitle(`${trendEmoji} XAUUSD — Gold Spot Analysis`)
    .setDescription(`## $${analysis.price}\n${analysis.change >= 0 ? "+" : ""}${analysis.change} (${analysis.change >= 0 ? "+" : ""}${analysis.changePercent}%)`)
    .addFields(
      { name: "📊 Trend", value: `**${trendLabel}** (${analysis.trendStrength}%)\n${volEmoji} Volatility: ${analysis.volatility.toUpperCase()}`, inline: true },
      { name: "📉 RSI (14)", value: analysis.rsi !== null ? `${analysis.rsi} — ${rsiLabel}` : "N/A", inline: true },
      { name: "📅 Daily Range", value: `H: $${analysis.dailyHigh}\nL: $${analysis.dailyLow}`, inline: true },
    )
    .addFields(
      { name: "🛡 Support Levels", value: supportLines || "—", inline: true },
      { name: "🚧 Resistance Levels", value: resistanceLines || "—", inline: true },
    )
    .addFields(
      {
        name: "🟢 Best Long Entry",
        value: `Entry: **$${analysis.longEntry.price}**\nStop: $${analysis.longEntry.stopLoss}\nTarget: $${analysis.longEntry.takeProfit}\nR:R **${analysis.longEntry.riskReward}**`,
        inline: true,
      },
      {
        name: "🔴 Best Short Entry",
        value: `Entry: **$${analysis.shortEntry.price}**\nStop: $${analysis.shortEntry.stopLoss}\nTarget: $${analysis.shortEntry.takeProfit}\nR:R **${analysis.shortEntry.riskReward}**`,
        inline: true,
      },
    )
    .setFooter({ text: "XAUUSD Gold Spot · Auto-analysis · Not financial advice" })
    .setTimestamp();

  return embed;
}

const goldSeenUrls = new Set<string>();
const goldParser = new Parser();

const GOLD_FEEDS = [
  "https://www.investing.com/rss/news_12.rss",
  "https://www.investing.com/rss/news_25.rss",
];

const GOLD_KEYWORDS = [
  "gold", "xau", "silver", "xag", "precious metal", "bullion",
  "metal", "copper", "platinum", "palladium", "mining", "miner",
  "gold price", "goldman", "central bank gold", "gold reserve",
];

async function fetchGoldNews(): Promise<{ title: string; url: string; source: string }[]> {
  const results: { title: string; url: string; source: string }[] = [];

  for (const feedUrl of GOLD_FEEDS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(feedUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;

      const xml = await res.text();
      const parsed = await goldParser.parseString(xml);
      const items = parsed.items?.slice(0, 5) || [];

      for (const item of items) {
        const url = item.link || item.guid || "";
        const title = (item.title || "").toLowerCase();
        if (!url || goldSeenUrls.has(url)) continue;

        if (GOLD_KEYWORDS.some((kw) => title.includes(kw))) {
          goldSeenUrls.add(url);
          results.push({
            title: item.title || "No title",
            url,
            source: "Investing.com",
          });
          if (results.length >= 5) return results;
        }
      }
    } catch {}
  }

  return results;
}

export async function postXAUUSDAnalysis(client: any): Promise<boolean> {
  const channelId = CONFIG.XAUUSD_CHANNEL_ID;
  if (!channelId) return false;

  const now = Date.now();
  if (now - lastPostTime < MIN_POST_INTERVAL) return false;
  lastPostTime = now;

  let channel: TextChannel | null = null;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch && ch.isTextBased()) channel = ch as TextChannel;
  } catch {
    return false;
  }
  if (!channel) return false;

  const analysis = await analyzeXAUUSD();
  if (!analysis) return false;

  const embed = buildXAUUSDEmbed(analysis);

  // Fetch gold news
  const goldNews = await fetchGoldNews();

  if (goldNews.length > 0) {
    const newsLines = goldNews.map((n) => `• [${n.title}](${n.url}) — *${n.source}*`).join("\n");
    embed.addFields({
      name: "📰 Latest Gold News",
      value: newsLines,
      inline: false,
    });
  }

  try {
    await channel.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

export function startXAUUSDPolling(client: any): void {
  if (pollingInterval) clearInterval(pollingInterval);
  if (alertInterval) clearInterval(alertInterval);
  if (!CONFIG.XAUUSD_CHANNEL_ID) return;

  console.log(`  XAUUSD analysis + real-time alerts — channel ${CONFIG.XAUUSD_CHANNEL_ID}`);
  postXAUUSDAnalysis(client);
  pollingInterval = setInterval(() => postXAUUSDAnalysis(client), MIN_POST_INTERVAL);
  alertInterval = setInterval(() => checkPriceAlert(client), 30_000);
}

export function stopXAUUSDPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  if (alertInterval) {
    clearInterval(alertInterval);
    alertInterval = null;
  }
}
