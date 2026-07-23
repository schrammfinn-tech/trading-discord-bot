import { getQuote, getMultipleQuotes, getHistorical } from "./market";
import { TextChannel, EmbedBuilder } from "discord.js";
import { CONFIG } from "../config";
import { MarketQuote } from "../types";

let interval: ReturnType<typeof setInterval> | null = null;
let lastPostTime = 0;
const MIN_INTERVAL = 900_000; // 15 minutes

const WATCH_SYMBOLS = [
  "GC=F",       // XAUUSD (Gold Futures)
  "ES=F",       // S&P 500 Futures
  "BTC",        // Bitcoin
  "EURUSD",     // EUR/USD
];

interface MoverEntry {
  quote: MarketQuote;
  rating: "strong_buy" | "buy" | "wait" | "avoid";
  ratingText: string;
  reason: string;
}

const RATING_EMOJI: Record<string, string> = {
  strong_buy: "🔥",
  buy: "✅",
  wait: "⏸️",
  avoid: "❌",
};

const RATING_LABEL: Record<string, string> = {
  strong_buy: "STRONG BUY",
  buy: "BUY",
  wait: "WAIT",
  avoid: "AVOID",
};

const RATING_COLOR: Record<string, number> = {
  strong_buy: 0x00E676,
  buy: 0x76FF03,
  wait: 0xFFAB00,
  avoid: 0xFF5252,
};

function round(n: number, d: number = 2): number {
  return parseFloat(n.toFixed(d));
}

async function analyzeEntry(symbol: string, quote: MarketQuote): Promise<MoverEntry | null> {
  const reasonParts: string[] = [];

  try {
    const candles = await getHistorical(symbol, "5d", quote.type);
    if (candles.length >= 20) {
      const prices = candles.map((c) => c.close);
      const ma20 = round(prices.slice(-20).reduce((a, b) => a + b, 0) / 20);

      // RSI
      const gains: number[] = [];
      const losses: number[] = [];
      for (let i = prices.length - 14; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
      }
      const avgG = gains.reduce((a, b) => a + b, 0) / 14;
      const avgL = losses.reduce((a, b) => a + b, 0) / 14;
      const rsi = avgL === 0 ? 100 : round(100 - 100 / (1 + avgG / avgL), 1);

      // Volume trend
      const recentVol = candles.slice(-5).reduce((a, c) => a + (c.volume || 0), 0);
      const prevVol = candles.slice(-10, -5).reduce((a, c) => a + (c.volume || 0), 0);
      const volIncreasing = recentVol > prevVol * 1.1;

      // Determine rating
      let rating: "strong_buy" | "buy" | "wait" | "avoid" = "wait";

      if (quote.changePercent > 0) {
        // Bullish mover
        if (quote.price > ma20 && rsi < 70 && (rsi > 30 || rsi < 30) && volIncreasing) {
          rating = rsi < 50 && quote.changePercent < 5 ? "strong_buy" : "buy";
          if (rsi < 30) reasonParts.push("Oversold bounce");
          else if (rsi < 50) reasonParts.push("Room to run");
          else reasonParts.push("Approaching overbought");
        } else if (quote.price > ma20 && rsi >= 70) {
          rating = "avoid";
          reasonParts.push("Overbought — wait for pullback");
        } else if (rsi > 30 && rsi < 70) {
          rating = "buy";
          reasonParts.push("Trend aligned");
        } else {
          rating = "wait";
          reasonParts.push("Mixed signals");
        }
      } else {
        // Bearish mover
        if (quote.price < ma20 && rsi > 30 && rsi < 70 && volIncreasing) {
          rating = "avoid";
          reasonParts.push("Downtrend with volume");
        } else if (quote.price > ma20 && rsi < 40) {
          rating = "strong_buy";
          reasonParts.push("Dip at support — reversal likely");
        } else if (quote.price < ma20 && rsi < 30) {
          rating = "buy";
          reasonParts.push("Oversold — bounce potential");
        } else if (rsi > 30 && rsi < 50 && quote.price < ma20) {
          rating = "wait";
          reasonParts.push("Still trending down");
        } else {
          rating = "avoid";
          reasonParts.push("Strong downtrend");
        }
      }

      if (volIncreasing) reasonParts.push("Volume surging");
      if (Math.abs(quote.changePercent) > 8) reasonParts.push("Extreme move — caution");

      return {
        quote,
        rating,
        ratingText: RATING_LABEL[rating],
        reason: reasonParts.join(" · ") || "Insufficient data",
      };
    }
  } catch {}

  return null;
}

export async function scanMovers(): Promise<{ gainers: MoverEntry[]; losers: MoverEntry[] }> {
  const quotes = await getMultipleQuotes(WATCH_SYMBOLS);
  if (quotes.length === 0) return { gainers: [], losers: [] };

  // Sort by % change
  const sorted = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
  const topGainers = sorted.slice(0, 8);
  const topLosers = sorted.slice(-8).reverse();

  // Analyze top entries only (limit API calls)
  const gainerEntries = (await Promise.all(
    topGainers.map((q) => analyzeEntry(q.symbol, q))
  )).filter((e): e is MoverEntry => e !== null);
  const loserEntries = (await Promise.all(
    topLosers.map((q) => analyzeEntry(q.symbol, q))
  )).filter((e): e is MoverEntry => e !== null);

  return { gainers: gainerEntries, losers: loserEntries };
}

export function buildMoversEmbed(
  gainers: MoverEntry[],
  losers: MoverEntry[]
): EmbedBuilder[] {
  const embeds: EmbedBuilder[] = [];

  // Gainers embed
  if (gainers.length > 0) {
    const top = gainers.slice(0, 5);
    const lines = top.map((m) => {
      const e = RATING_EMOJI[m.rating];
      return `${e} **${m.quote.symbol}** — ${m.quote.name.slice(0, 30)}\n　　$${m.quote.price.toLocaleString()}  |  📈 **+${m.quote.changePercent.toFixed(2)}%**\n　　${RATING_LABEL[m.rating]} · ${m.reason}`;
    });

    embeds.push(
      new EmbedBuilder()
        .setColor(0x00E676)
        .setTitle("📈 Top Bullish Movers — Entry Analysis")
        .setDescription(lines.join("\n\n"))
        .setFooter({ text: `🔥 Strong Buy  ✅ Buy  ⏸️ Wait  ❌ Avoid · Updates every 15 min` })
        .setTimestamp()
    );
  }

  // Losers embed
  if (losers.length > 0) {
    const top = losers.slice(0, 5);
    const lines = top.map((m) => {
      const e = RATING_EMOJI[m.rating];
      return `${e} **${m.quote.symbol}** — ${m.quote.name.slice(0, 30)}\n　　$${m.quote.price.toLocaleString()}  |  📉 **${m.quote.changePercent.toFixed(2)}%**\n　　${RATING_LABEL[m.rating]} · ${m.reason}`;
    });

    embeds.push(
      new EmbedBuilder()
        .setColor(0xFF5252)
        .setTitle("📉 Top Bearish Movers — Entry Analysis")
        .setDescription(lines.join("\n\n"))
        .setFooter({ text: `🔥 Strong Buy  ✅ Buy  ⏸️ Wait  ❌ Avoid · Updates every 15 min` })
        .setTimestamp()
    );
  }

  return embeds;
}

export async function postMovers(client: any): Promise<boolean> {
  const channelId = CONFIG.LIVE_PRICES_CHANNEL_ID;
  if (!channelId) return false;

  const now = Date.now();
  if (now - lastPostTime < MIN_INTERVAL) return false;
  lastPostTime = now;

  let channel: TextChannel | null = null;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch && ch.isTextBased()) channel = ch as TextChannel;
  } catch {}
  if (!channel) return false;

  try {
    const { gainers, losers } = await scanMovers();
    if (gainers.length === 0 && losers.length === 0) {
      console.log("  Movers: no data available");
      return false;
    }

    const embeds = buildMoversEmbed(gainers, losers);
    for (const embed of embeds) {
      await channel.send({ embeds: [embed] });
    }
    console.log(`  Movers posted: ${gainers.length} gainers, ${losers.length} losers`);
    return true;
  } catch (e: any) {
    console.error("  Movers error:", e.message);
    return false;
  }
}

export function startMoversPolling(client: any): void {
  if (interval) clearInterval(interval);
  if (!CONFIG.LIVE_PRICES_CHANNEL_ID) return;

  console.log(`  Movers scanner active — channel ${CONFIG.LIVE_PRICES_CHANNEL_ID}`);
  postMovers(client);
  interval = setInterval(() => postMovers(client), MIN_INTERVAL);
}

export function stopMoversPolling(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
