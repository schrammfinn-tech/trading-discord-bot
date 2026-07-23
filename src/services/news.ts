import Parser from "rss-parser";
import { TextChannel, EmbedBuilder } from "discord.js";
import { CONFIG } from "../config";

const parser = new Parser();
const seenUrls = new Set<string>();
const seenTitles = new Set<string>();

const FEEDS = [
  // Metals: Gold, Silver, Copper, Platinum
  {
    url: "https://www.investing.com/rss/news_12.rss",
    category: "Metals",
    label: "Investing.com",
  },
  {
    url: "https://www.investing.com/rss/news_25.rss",
    category: "Commodities",
    label: "Investing.com",
  },
  // Crypto: BTC, ETH, SOL + market-wide
  {
    url: "https://www.investing.com/rss/news_301.rss",
    category: "Crypto",
    label: "Investing.com",
  },
  // S&P 500, Nasdaq, Dow
  {
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
    category: "S&P 500",
    label: "CNBC",
  },
  {
    url: "https://www.investing.com/rss/news_1.rss",
    category: "US Markets",
    label: "Investing.com",
  },
  // Fed / macro (impacts metals + indices)
  {
    url: "https://www.investing.com/rss/news_14.rss",
    category: "Macro",
    label: "Investing.com",
  },
];

const TOPIC_FILTER = [
  // Metals
  "gold", "silver", "xau", "xag", "copper", "platinum", "palladium",
  "precious metal", "bullion", "goldman", "miner", "mining",
  "gold price", "metal price",
  // Crypto
  "bitcoin", "btc", "ethereum", "eth", "crypto", "solana", "sol ",
  "blockchain", "defi", "xrp", "ripple", "altcoin", "dogecoin", "doge",
  "coinbase", "binance", "sec", "etf",
  // S&P 500 / Nasdaq / US-100 / major indices
  "s&p 500", "sp500", "spx", "s&p", "nasdaq", "nasdaq-100", "nasdaq100",
  "ndx", "us100", "us-100", "dow jones", "dow", "djia",
  "wall street", "nyse", "stock market", "equities", "bull market",
  // Major tech (drives Nasdaq)
  "apple", "aapl", "microsoft", "msft", "nvidia", "nvda", "google", "googl",
  "amazon", "amzn", "meta", "tesla", "tsla", "netflix", "nflx",
  // Macro/Fed (impacts all)
  "federal reserve", "powell", "interest rate", "rate cut", "rate hike",
  "inflation", "cpi", "ppi", "gdp", "job", "payroll", "unemployment",
  "fomc", "yield", "treasury", "dollar index", "dxy",
];

const IMPORTANCE_KEYWORDS = [
  "federal reserve", "fed ", "interest rate", "inflation", "cpi", "gdp",
  "earnings", "revenue", "recession", "layoff", "acquisition", "merger",
  "ipo", "sec", "regulation", "crash", "rally", "surge", "plunge",
  "record", "all-time", "breaking", "downgrade", "upgrade", "outlook",
  "guidance", "dividend", "split", "buyback", "bankruptcy", "bailout",
  "stimulus", "tariff", "sanction", "supply chain", "shortage", "surplus",
  "jobs report", "unemployment", "payroll", "gdp growth", "pce",
  "manufacturing", "consumer confidence", "housing", "retail sales",
];

const BULLISH_WORDS: [string, number][] = [
  ["surge", 3], ["soar", 3], ["rally", 3], ["jump", 2], ["spike", 2],
  ["record high", 4], ["all-time high", 4], ["all time high", 4],
  ["beat estimates", 3], ["beat expectations", 3], ["tops estimates", 3],
  ["exceeds", 2], ["upgrade", 3], ["upgraded", 3], ["outperform", 2],
  ["bullish", 3], ["buyback", 2], ["dividend increase", 2],
  ["revenue growth", 2], ["profit jump", 3], ["earnings beat", 3],
  ["positive outlook", 2], ["optimistic", 2], ["rebound", 2],
  ["recovery", 2], ["gains", 1], ["rises", 1], ["grew", 1],
  ["expansion", 2], ["boost", 1], ["outperformed", 2],
  ["strong earnings", 3], ["beat revenue", 3], ["double upgrade", 4],
  ["raised guidance", 3], ["raised forecast", 3], ["cut rates", 2],
  ["stimulus", 2], ["dovish", 2], ["easing", 1],
  ["breakthrough", 2], ["approval", 1], ["partnership", 1],
];

const BEARISH_WORDS: [string, number][] = [
  ["plunge", 3], ["crash", 4], ["tumble", 3], ["collapse", 4],
  ["drop", 1], ["fall", 1], ["decline", 1], ["sink", 2],
  ["record low", 4], ["all-time low", 4], ["all time low", 4],
  ["missed estimates", 3], ["misses estimates", 3],
  ["downgrade", 3], ["downgraded", 3], ["underperform", 2],
  ["bearish", 3], ["sell-off", 3], ["sell off", 3], ["selloff", 3],
  ["layoff", 2], ["layoffs", 2], ["cut jobs", 2],
  ["loss", 1], ["losses", 2], ["warning", 2], ["warns", 2],
  ["bankruptcy", 4], ["default", 4], ["delisting", 3],
  ["investigation", 2], ["lawsuit", 2], ["fine", 1],
  ["negative outlook", 2], ["recession", 3], ["slowdown", 2],
  ["contraction", 2], ["declining", 2], ["weak", 1],
  ["missed revenue", 3], ["misses revenue", 3],
  ["lowered guidance", 3], ["lowered forecast", 3],
  ["raised rates", 2], ["hawkish", 2], ["tightening", 1],
  ["supply chain", 1], ["shortage", 1], ["sanction", 2], ["tariff", 2],
];

interface Sentiment {
  score: number;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  bar: string;
}

function getSentiment(title: string, summary: string): Sentiment {
  const text = `${title} ${summary}`.toLowerCase();
  let score = 0;

  for (const [word, weight] of BULLISH_WORDS) {
    if (text.includes(word)) score += weight;
  }
  for (const [word, weight] of BEARISH_WORDS) {
    if (text.includes(word)) score -= weight;
  }

  const absScore = Math.abs(score);
  const confidence = Math.min(Math.round((absScore / 12) * 100), 100);

  let direction: "bullish" | "bearish" | "neutral" = "neutral";
  let bar = "";

  if (score >= 3) {
    direction = "bullish";
    const blocks = Math.min(Math.round(confidence / 10), 10);
    bar = "🟩".repeat(blocks) + "⬜".repeat(10 - blocks);
  } else if (score <= -3) {
    direction = "bearish";
    const blocks = Math.min(Math.round(confidence / 10), 10);
    bar = "🟥".repeat(blocks) + "⬜".repeat(10 - blocks);
  } else {
    direction = "neutral";
    bar = "⬜".repeat(10);
  }

  return { score, direction, confidence, bar };
}

function isImportant(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return IMPORTANCE_KEYWORDS.some((kw) => text.includes(kw));
}

function isRelevant(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return TOPIC_FILTER.some((kw) => text.includes(kw));
}

function extractSymbols(title: string): string[] {
  const symbolRegex = /\$([A-Z]{1,5})\b|\(([A-Z]{1,5})\)|([A-Z]{2,5}):\s/g;
  const symbols: string[] = [];
  let match;
  while ((match = symbolRegex.exec(title)) !== null) {
    const sym = (match[1] || match[2] || match[3])?.trim();
    if (sym && !["THE", "AND", "FOR", "ARE", "WAS", "HAS", "NEW", "ITS", "BUT"].includes(sym)) {
      symbols.push(`$${sym}`);
    }
  }
  return [...new Set(symbols)].slice(0, 5);
}

let pollingInterval: ReturnType<typeof setInterval> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFeed(feedUrl: string): Promise<Parser.Output<any> | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(feedUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (response.status === 429) {
        await sleep((attempt + 1) * 5000);
        continue;
      }
      if (!response.ok) return null;

      const xml = await response.text();
      return parser.parseString(xml);
    } catch (e) {
      if (attempt === 2) return null;
      await sleep(2000);
    }
  }
  return null;
}

export async function fetchLatestNews(client: any): Promise<number> {
  const channelId = CONFIG.NEWS_CHANNEL_ID;
  if (!channelId) return 0;

  let channel: TextChannel | null = null;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch && ch.isTextBased()) channel = ch as TextChannel;
  } catch {
    return 0;
  }
  if (!channel) return 0;

  let posted = 0;

  for (const feed of FEEDS) {
    const parsed = await fetchFeed(feed.url);
    if (!parsed?.items) continue;

    const items = parsed.items.slice(0, 3);

    for (const item of items) {
      const url = item.link || item.guid || "";
      if (!url || seenUrls.has(url)) continue;

      seenUrls.add(url);
      if (seenUrls.size > 800) {
        const it = seenUrls.values();
        for (let i = 0; i < 300; i++) { const v = it.next().value; if (v) seenUrls.delete(v); }
      }

      const title = item.title || "No title";
      const titleKey = title.slice(0, 80).toLowerCase().replace(/\s+/g, " ");
      if (seenTitles.has(titleKey)) continue;
      seenTitles.add(titleKey);
      const summary = (item.contentSnippet || item.content || "").slice(0, 350);
      if (!summary) continue;
      if (!isRelevant(title, summary)) continue;
      const symbols = extractSymbols(title);
      const important = isImportant(title, summary);
      if (!important) continue;
      const sentiment = getSentiment(title, summary);
      if (sentiment.direction === "neutral") continue;
      const color = sentiment.direction === "bullish" ? 0x00E676 : 0xFF5252;
      const prefix = "🔥 ";
      const source = feed.label;

      const dirEmoji = sentiment.direction === "bullish" ? "📈" : "📉";
      const dirLabel = sentiment.direction === "bullish" ? "BULLISH" : "BEARISH";
      const pctText = ` ${sentiment.confidence}%`;

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${prefix}${title}`)
        .setURL(url)
        .setDescription(summary || "*No summary available*")
        .addFields(
          { name: "Source", value: `${source} · ${feed.category}`, inline: true },
          { name: `${dirEmoji} Market Impact`, value: `**${dirLabel}**${pctText}\n${sentiment.bar}`, inline: true },
        )
        .setFooter({ text: new Date(item.pubDate || Date.now()).toLocaleString() })
        .setTimestamp();

      if (symbols.length > 0) {
        embed.addFields({ name: "Related", value: symbols.join(" "), inline: false });
      }

      try {
        await channel!.send({ embeds: [embed] });
        posted++;
        await sleep(1500);
      } catch {}
    }
  }

  return posted;
}

export function startNewsPolling(client: any): void {
  if (pollingInterval) clearInterval(pollingInterval);
  if (!CONFIG.NEWS_CHANNEL_ID) return;

  console.log(`  News polling started — channel ${CONFIG.NEWS_CHANNEL_ID}`);
  fetchLatestNews(client);
  pollingInterval = setInterval(() => fetchLatestNews(client), CONFIG.NEWS_INTERVAL_MS);
}

export function stopNewsPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}
