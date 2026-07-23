import { Client, SlashCommandBuilder, EmbedBuilder, Message, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, TextChannel, CategoryChannel, GuildMember, Role, ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from "discord.js";
import { CONFIG } from "../config";
import { db } from "../database";
import { getQuote, getMultipleQuotes, resolveAssetType } from "../services/market";
import { startNewsPolling } from "../services/news";
import { startXAUUSDPolling, analyzeXAUUSD, buildXAUUSDEmbed } from "../services/xauusd";
import { startMarketTimes, getMarketTimesEmbed } from "../services/sessions";
import { startMoversPolling, scanMovers, buildMoversEmbed } from "../services/movers";
import { Holding, MarketQuote, AssetType } from "../types";

const COLORS = {
  primary: 0x00C853,
  error: 0xFF1744,
  warn: 0xFFAB00,
  profit: 0x00E676,
  loss: 0xFF5252,
  neutral: 0x42A5F5,
  premium: 0xFFD700,
} as const;

function fNum(n: number, d: number = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fChange(c: number, cp: number): string {
  const s = c >= 0 ? "+" : "";
  return `${s}${fNum(c)} (${s}${fNum(cp)}%)`;
}

function trendEmoji(change: number): string {
  if (change > 5) return "📈";
  if (change > 0) return "🟢";
  if (change < -5) return "📉";
  if (change < 0) return "🔴";
  return "➖";
}

function fShort(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

// ──────────────────────── Slash Command Definitions ────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName("price")
    .setDescription("Get real-time market price for a symbol")
    .addStringOption((o) => o.setName("symbol").setDescription("Stock, crypto, forex, or commodity symbol").setRequired(true)),

  new SlashCommandBuilder()
    .setName("buy")
    .setDescription("Buy shares or coins with virtual currency")
    .addStringOption((o) => o.setName("symbol").setDescription("Ticker symbol (e.g. AAPL, BTC)").setRequired(true))
    .addNumberOption((o) => o.setName("quantity").setDescription("Number of shares/coins to buy").setRequired(true).setMinValue(0.000001)),

  new SlashCommandBuilder()
    .setName("sell")
    .setDescription("Sell your holdings")
    .addStringOption((o) => o.setName("symbol").setDescription("Ticker symbol to sell").setRequired(true))
    .addNumberOption((o) => o.setName("quantity").setDescription("Quantity or 0 to sell all").setRequired(true).setMinValue(0)),

  new SlashCommandBuilder()
    .setName("portfolio")
    .setDescription("View your trading portfolio and performance"),

  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("View your account balance and net worth"),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Top traders ranked by net worth"),

  new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily virtual currency reward"),

  new SlashCommandBuilder()
    .setName("watchlist")
    .setDescription("Manage your price watchlist")
    .addSubcommand((s: SlashCommandSubcommandBuilder) => s.setName("view").setDescription("View your watchlist"))
    .addSubcommand((s: SlashCommandSubcommandBuilder) => s.setName("add").setDescription("Add a symbol")
      .addStringOption((o) => o.setName("symbol").setDescription("Symbol to add").setRequired(true)))
    .addSubcommand((s: SlashCommandSubcommandBuilder) => s.setName("remove").setDescription("Remove a symbol")
      .addStringOption((o) => o.setName("symbol").setDescription("Symbol to remove").setRequired(true))),

  new SlashCommandBuilder()
    .setName("alert")
    .setDescription("Manage price alerts")
    .addSubcommand((s: SlashCommandSubcommandBuilder) => s.setName("list").setDescription("View active alerts"))
    .addSubcommand((s: SlashCommandSubcommandBuilder) => s.setName("set").setDescription("Set a price alert")
      .addStringOption((o) => o.setName("symbol").setDescription("Symbol").setRequired(true))
      .addNumberOption((o) => o.setName("price").setDescription("Target price").setRequired(true).setMinValue(0)))
    .addSubcommand((s: SlashCommandSubcommandBuilder) => s.setName("cancel").setDescription("Cancel an alert")
      .addStringOption((o) => o.setName("symbol").setDescription("Symbol of alert to cancel").setRequired(true))),

  new SlashCommandBuilder()
    .setName("markets")
    .setDescription("List supported trading assets"),

  new SlashCommandBuilder()
    .setName("transactions")
    .setDescription("View your recent trade history")
    .addIntegerOption((o) => o.setName("count").setDescription("Number of transactions (1-25)").setMinValue(1).setMaxValue(25)),

  new SlashCommandBuilder()
    .setName("share")
    .setDescription("Send virtual cash to another trader")
    .addUserOption((o) => o.setName("user").setDescription("Recipient").setRequired(true))
    .addNumberOption((o) => o.setName("amount").setDescription("Amount to send").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("resetme")
    .setDescription("Reset your entire trading account"),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("(Admin) Auto-configure the server with channels, roles, and settings"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all trading bot commands"),

  new SlashCommandBuilder()
    .setName("chart")
    .setDescription("Get a price chart for a symbol")
    .addStringOption((o) => o.setName("symbol").setDescription("Symbol to chart").setRequired(true))
    .addStringOption((o) => o.setName("period").setDescription("Chart timeframe").setRequired(false)
      .addChoices(
        { name: "1 Day", value: "1d" },
        { name: "5 Days", value: "5d" },
        { name: "1 Month", value: "1mo" },
        { name: "3 Months", value: "3mo" },
        { name: "6 Months", value: "6mo" },
        { name: "1 Year", value: "1y" },
      )),

  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("(Admin) Set the market news or XAUUSD channel")
    .addStringOption((o) => o.setName("type").setDescription("Channel type").setRequired(true)
      .addChoices(
        { name: "Market News", value: "news" },
        { name: "XAUUSD Analysis", value: "xauusd" },
        { name: "Market Sessions", value: "sessions" },
        { name: "Live Prices & Movers", value: "liveprices" },
      )),

  new SlashCommandBuilder()
    .setName("xauusd")
    .setDescription("Get real-time XAUUSD (Gold) technical analysis with entry points"),

  new SlashCommandBuilder()
    .setName("sessions")
    .setDescription("Show current market sessions, timeline, and next opening times"),

  new SlashCommandBuilder()
    .setName("movers")
    .setDescription("Top bullish and bearish movers with entry analysis"),
] as SlashCommandBuilder[];

// ──────────────────────── Slash Command Handlers ────────────────────────

export async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName } = interaction;

  try {
    switch (commandName) {
      case "price": await handleSlashPrice(interaction); break;
      case "buy": await handleSlashBuy(interaction); break;
      case "sell": await handleSlashSell(interaction); break;
      case "portfolio": await handleSlashPortfolio(interaction); break;
      case "balance": await handleSlashBalance(interaction); break;
      case "leaderboard": await handleSlashLeaderboard(interaction); break;
      case "daily": await handleSlashDaily(interaction); break;
      case "watchlist": await handleSlashWatchlist(interaction); break;
      case "alert": await handleSlashAlert(interaction); break;
      case "markets": await handleSlashMarkets(interaction); break;
      case "transactions": await handleSlashTransactions(interaction); break;
      case "share": await handleSlashShare(interaction); break;
      case "resetme": await handleSlashReset(interaction); break;
      case "setup": await handleSlashSetup(interaction); break;
      case "help": await handleSlashHelp(interaction); break;
      case "chart": await handleSlashChart(interaction); break;
      case "setchannel": await handleSlashSetChannel(interaction); break;
      case "xauusd": await handleSlashXAUUSD(interaction); break;
      case "sessions": await handleSlashSessions(interaction); break;
      case "movers": await handleSlashMovers(interaction); break;
    }
  } catch (error) {
    console.error("Slash command error:", error);
    const errMsg = { content: "An internal error occurred.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errMsg).catch(() => {});
    } else {
      await interaction.reply(errMsg).catch(() => {});
    }
  }
}

// ──────────────────────── Prefix Command Handler ────────────────────────

export async function handlePrefixCommand(message: Message): Promise<void> {
  const content = message.content.trim();
  const parts = content.split(/\s+/);
  const cmd = parts[0]!.toLowerCase().slice(1);
  const args = parts.slice(1);

  switch (cmd) {
    case "help": case "h": await sendHelpEmbed(message); break;
    case "price": case "p": await handlePrefixPrice(message, args); break;
    case "buy": case "b": await handlePrefixBuy(message, args); break;
    case "sell": case "s": await handlePrefixSell(message, args); break;
    case "portfolio": case "pf": await handlePrefixPortfolio(message, args); break;
    case "balance": case "bal": await handlePrefixBalance(message, args); break;
    case "leaderboard": case "lb": case "top": await handlePrefixLeaderboard(message, args); break;
    case "daily": case "reward": await handlePrefixDaily(message); break;
    case "watchlist": case "wl": await handlePrefixWatchlist(message, args); break;
    case "alert": await handlePrefixAlert(message, args); break;
    case "markets": case "assets": await handlePrefixMarkets(message); break;
    case "resetme": await handlePrefixReset(message); break;
    case "share": await handlePrefixShare(message, args); break;
    case "transactions": case "tx": case "history": await handlePrefixTransactions(message, args); break;
    default: {
      try { const q = await getQuote(cmd.toUpperCase()); await sendQuoteEmbed(message, q); } catch {}
    }
  }
}

// ──────────────────────── Utility Functions ────────────────────────

function ensureAccount(userId: string, username: string, guildId: string) {
  let acc = db.getAccount(userId);
  if (!acc) acc = db.createAccount(userId, username, guildId);
  return acc;
}

function ensurePortfolio(userId: string) {
  let pf = db.getPortfolio(userId);
  if (!pf) pf = db.createPortfolio(userId);
  return pf;
}

function getEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.primary).setTimestamp();
}

async function sendQuoteEmbed(target: Message | ChatInputCommandInteraction, quote: MarketQuote): Promise<void> {
  const emoji = trendEmoji(quote.change);
  const color = quote.change >= 0 ? COLORS.profit : COLORS.loss;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} ${quote.symbol}`)
    .setDescription(`### ${quote.name}\n# $${quote.price.toLocaleString()}\n${fChange(quote.change, quote.changePercent)}`)
    .addFields(
      { name: "Volume", value: quote.volume.toLocaleString(), inline: true },
      { name: "Market", value: quote.type.charAt(0).toUpperCase() + quote.type.slice(1), inline: true },
      { name: "Currency", value: quote.currency, inline: true },
    )
    .setFooter({ text: `${quote.symbol} — Real-time data` })
    .setTimestamp();

  if (target instanceof Message) await target.reply({ embeds: [embed] });
  else await target.reply({ embeds: [embed] });
}

// ──────────────────────── SLASH: Price ────────────────────────

async function handleSlashPrice(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const symbol = interaction.options.getString("symbol", true);
  try {
    const quote = await getQuote(symbol);
    await sendQuoteEmbed(interaction, quote);
  } catch (e: any) {
    await interaction.editReply({ content: `Could not find **${symbol.toUpperCase()}**.` });
  }
}

async function handlePrefixPrice(message: Message, args: string[]) {
  const symbol = args[0];
  if (!symbol) { await message.reply("Usage: `!price <symbol>`"); return; }
  try {
    const quote = await getQuote(symbol);
    await sendQuoteEmbed(message, quote);
  } catch (e: any) {
    await message.reply({ content: `Could not fetch **${symbol.toUpperCase()}**.` });
  }
}

// ──────────────────────── SLASH: Buy ────────────────────────

async function handleSlashBuy(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const symbol = interaction.options.getString("symbol", true).toUpperCase();
  const quantity = interaction.options.getNumber("quantity", true);
  const gId = interaction.guildId ?? "dm";
  const acc = ensureAccount(interaction.user.id, interaction.user.username, gId);
  const cfg = db.getServerConfig(gId);

  if (cfg.bannedSymbols.includes(symbol)) {
    await interaction.editReply({ content: `Trading **${symbol}** is restricted.` });
    return;
  }

  try {
    const quote = await getQuote(symbol);
    const total = quote.price * quantity;
    const fee = total * cfg.transactionFeePercent;
    const grandTotal = total + fee;

    if (acc.balance < grandTotal) {
      await interaction.editReply({
        content: `Insufficient funds. Need **$${grandTotal.toLocaleString()}**, balance is **$${acc.balance.toLocaleString()}**.`,
      });
      return;
    }

    acc.balance -= grandTotal;
    acc.transactionCount++;
    const pf = ensurePortfolio(interaction.user.id);
    const existing = pf.holdings.find((h: Holding) => h.symbol === quote.symbol && h.type === quote.type);

    if (existing) {
      const tq = existing.quantity + quantity;
      const ts = existing.totalSpent + total;
      existing.quantity = tq;
      existing.averageBuyPrice = ts / tq;
      existing.totalSpent = ts;
    } else {
      pf.holdings.push({ symbol: quote.symbol, type: quote.type, quantity, averageBuyPrice: quote.price, totalSpent: total });
    }
    pf.lastUpdated = new Date().toISOString();
    db.updatePortfolio(pf);
    db.updateAccount(acc);
    db.addTransaction({
      id: `B-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: interaction.user.id, symbol: quote.symbol, type: quote.type,
      orderType: "buy", quantity, price: quote.price, total,
      timestamp: new Date().toISOString(), balanceAfter: acc.balance,
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle("Buy Order Filled")
      .setDescription(`Acquired **${quantity}** ${quote.symbol} @ **$${quote.price.toLocaleString()}** each`)
      .addFields(
        { name: "Cost", value: `$${total.toLocaleString()}`, inline: true },
        { name: "Fee", value: `$${fee.toFixed(2)}`, inline: true },
        { name: "Total", value: `$${grandTotal.toLocaleString()}`, inline: true },
        { name: "Remaining Balance", value: `$${acc.balance.toLocaleString()}`, inline: true },
      )
      .setFooter({ text: `${quote.symbol} — ${quote.type}` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (e: any) {
    await interaction.editReply({ content: `Failed: ${e.message}` });
  }
}

async function handlePrefixBuy(message: Message, args: string[]) {
  const symbol = args[0]?.toUpperCase();
  const qty = parseFloat(args[1]);
  if (!symbol || isNaN(qty) || qty <= 0) { await message.reply("Usage: `!buy <symbol> <quantity>`"); return; }
  const gId = message.guildId ?? "dm";
  const acc = ensureAccount(message.author.id, message.author.username, gId);
  const cfg = db.getServerConfig(gId);

  try {
    const quote = await getQuote(symbol);
    const total = quote.price * qty;
    const fee = total * cfg.transactionFeePercent;
    const grandTotal = total + fee;
    if (acc.balance < grandTotal) { await message.reply(`Insufficient funds. Need $${grandTotal.toLocaleString()}.`); return; }

    acc.balance -= grandTotal;
    acc.transactionCount++;
    const pf = ensurePortfolio(message.author.id);
    const existing = pf.holdings.find((h: Holding) => h.symbol === quote.symbol && h.type === quote.type);

    if (existing) {
      const tq = existing.quantity + qty;
      const ts = existing.totalSpent + total;
      existing.quantity = tq;
      existing.averageBuyPrice = ts / tq;
      existing.totalSpent = ts;
    } else {
      pf.holdings.push({ symbol: quote.symbol, type: quote.type, quantity: qty, averageBuyPrice: quote.price, totalSpent: total });
    }
    pf.lastUpdated = new Date().toISOString();
    db.updatePortfolio(pf);
    db.updateAccount(acc);

    const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle("Buy Order Filled")
      .setDescription(`${qty} ${quote.symbol} @ $${quote.price.toLocaleString()}`)
      .addFields(
        { name: "Cost", value: `$${total.toLocaleString()}`, inline: true },
        { name: "Fee", value: `$${fee.toFixed(2)}`, inline: true },
        { name: "Balance", value: `$${acc.balance.toLocaleString()}`, inline: true },
      )
      .setFooter({ text: quote.symbol }).setTimestamp();
    await message.reply({ embeds: [embed] });
  } catch (e: any) { await message.reply({ content: `Failed: ${e.message}` }); }
}

// ──────────────────────── SLASH: Sell ────────────────────────

async function handleSlashSell(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const symbol = interaction.options.getString("symbol", true).toUpperCase();
  let quantity = interaction.options.getNumber("quantity", true);
  const gId = interaction.guildId ?? "dm";
  const acc = ensureAccount(interaction.user.id, interaction.user.username, gId);
  const pf = ensurePortfolio(interaction.user.id);
  const holding = pf.holdings.find((h: Holding) => h.symbol === symbol);

  if (!holding) { await interaction.editReply({ content: `You don't own **${symbol}**.` }); return; }
  if (quantity <= 0 || quantity > holding.quantity) quantity = holding.quantity;

  try {
    const quote = await getQuote(symbol);
    const total = quote.price * quantity;
    const cfg = db.getServerConfig(gId);
    const fee = total * cfg.transactionFeePercent;
    const net = total - fee;
    const pnl = (quote.price - holding.averageBuyPrice) * quantity;

    acc.balance += net;
    acc.transactionCount++;
    if (quantity >= holding.quantity) pf.holdings = pf.holdings.filter((h: Holding) => h.symbol !== symbol);
    else { holding.quantity -= quantity; holding.totalSpent -= holding.totalSpent * (quantity / (holding.quantity + quantity)); }
    pf.lastUpdated = new Date().toISOString();
    db.updatePortfolio(pf);
    db.updateAccount(acc);
    db.addTransaction({
      id: `S-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: interaction.user.id, symbol: quote.symbol, type: quote.type,
      orderType: "sell", quantity, price: quote.price, total,
      timestamp: new Date().toISOString(), balanceAfter: acc.balance,
    });

    const color = pnl >= 0 ? COLORS.profit : COLORS.loss;
    const pLabel = pnl >= 0 ? "Profit" : "Loss";
    const embed = new EmbedBuilder().setColor(color).setTitle("Sell Order Filled")
      .setDescription(`Sold **${quantity}** ${quote.symbol} @ **$${quote.price.toLocaleString()}**`)
      .addFields(
        { name: "Revenue", value: `$${total.toLocaleString()}`, inline: true },
        { name: "Fee", value: `$${fee.toFixed(2)}`, inline: true },
        { name: "Net", value: `$${net.toLocaleString()}`, inline: true },
        { name: pLabel, value: `$${Math.abs(pnl).toLocaleString()}`, inline: true },
        { name: "Balance", value: `$${acc.balance.toLocaleString()}`, inline: true },
      )
      .setFooter({ text: quote.symbol }).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (e: any) { await interaction.editReply({ content: `Failed: ${e.message}` }); }
}

async function handlePrefixSell(message: Message, args: string[]) {
  const symbol = args[0]?.toUpperCase();
  let qtyStr = args[1];
  if (!symbol || !qtyStr) { await message.reply("Usage: `!sell <symbol> <quantity|all>`"); return; }
  const gId = message.guildId ?? "dm";
  const acc = ensureAccount(message.author.id, message.author.username, gId);
  const pf = ensurePortfolio(message.author.id);
  const holding = pf.holdings.find((h: Holding) => h.symbol === symbol);
  if (!holding) { await message.reply(`You don't own **${symbol}**.`); return; }

  let quantity = qtyStr.toLowerCase() === "all" ? holding.quantity : parseFloat(qtyStr);
  if (isNaN(quantity) || quantity <= 0) { await message.reply("Invalid quantity."); return; }
  if (quantity > holding.quantity) { await message.reply(`You only have ${holding.quantity}.`); return; }

  try {
    const quote = await getQuote(symbol);
    const total = quote.price * quantity;
    const cfg = db.getServerConfig(gId);
    const fee = total * cfg.transactionFeePercent;
    const net = total - fee;
    const pnl = (quote.price - holding.averageBuyPrice) * quantity;
    acc.balance += net;
    acc.transactionCount++;
    if (quantity >= holding.quantity) pf.holdings = pf.holdings.filter((h: Holding) => h.symbol !== symbol);
    else { holding.quantity -= quantity; holding.totalSpent -= holding.totalSpent * (quantity / (holding.quantity + quantity)); }
    pf.lastUpdated = new Date().toISOString();
    db.updatePortfolio(pf);
    db.updateAccount(acc);

    const color = pnl >= 0 ? COLORS.profit : COLORS.loss;
    const pLabel = pnl >= 0 ? "Profit" : "Loss";
    const embed = new EmbedBuilder().setColor(color).setTitle("Sell Order Filled")
      .setDescription(`${quantity} ${quote.symbol} @ $${quote.price.toLocaleString()}`)
      .addFields(
        { name: "Revenue", value: `$${total.toLocaleString()}`, inline: true },
        { name: pLabel, value: `$${Math.abs(pnl).toLocaleString()}`, inline: true },
        { name: "Balance", value: `$${acc.balance.toLocaleString()}`, inline: true },
      ).setFooter({ text: quote.symbol }).setTimestamp();
    await message.reply({ embeds: [embed] });
  } catch (e: any) { await message.reply(`Failed: ${e.message}`); }
}

// ──────────────────────── SLASH: Portfolio ────────────────────────

async function handleSlashPortfolio(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const gId = interaction.guildId ?? "dm";
  const acc = ensureAccount(interaction.user.id, interaction.user.username, gId);
  const pf = ensurePortfolio(interaction.user.id);

  if (pf.holdings.length === 0) {
    await interaction.editReply({ content: "Your portfolio is empty. Use `/buy` to start trading." });
    return;
  }

  const quotes = await getMultipleQuotes(pf.holdings.map((h: Holding) => h.symbol));
  const qMap = new Map(quotes.map((q: MarketQuote) => [q.symbol, q]));

  let totalVal = acc.balance;
  let totalCost = 0;
  const lines: string[] = [];

  for (const h of pf.holdings) {
    const q = qMap.get(h.symbol);
    const cp = q?.price ?? h.averageBuyPrice;
    const mv = cp * h.quantity;
    const pnl = mv - h.totalSpent;
    const pnlPct = h.totalSpent > 0 ? (pnl / h.totalSpent) * 100 : 0;
    totalVal += mv;
    totalCost += h.totalSpent;

    const icon = pnl >= 0 ? "🟢" : "🔴";
    const pnlSign = pnl >= 0 ? "+" : "";
    lines.push(`${icon} **${h.symbol}** — ${h.quantity} × $${fNum(cp)} = $${fShort(mv)}\n　　P/L: ${pnlSign}$${fShort(Math.abs(pnl))} (${pnlSign}${pnlPct.toFixed(1)}%)`);
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor({ name: `${interaction.user.username}'s Portfolio`, iconURL: interaction.user.displayAvatarURL() })
    .setDescription(lines.join("\n\n"))
    .addFields(
      { name: "Cash", value: fShort(acc.balance), inline: true },
      { name: "Portfolio Value", value: fShort(totalVal - acc.balance), inline: true },
      { name: "Net Worth", value: fShort(totalVal), inline: true },
    )
    .setFooter({ text: `${pf.holdings.length} positions` })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handlePrefixPortfolio(message: Message, args: string[]) {
  const gId = message.guildId ?? "dm";
  const acc = ensureAccount(message.author.id, message.author.username, gId);
  const pf = ensurePortfolio(message.author.id);
  if (pf.holdings.length === 0) { await message.reply("Empty portfolio. Use `!buy`."); return; }

  const quotes = await getMultipleQuotes(pf.holdings.map((h: Holding) => h.symbol));
  const qMap = new Map(quotes.map((q: MarketQuote) => [q.symbol, q]));
  let totalVal = acc.balance;
  const lines: string[] = [];

  for (const h of pf.holdings) {
    const cp = qMap.get(h.symbol)?.price ?? h.averageBuyPrice;
    const mv = cp * h.quantity;
    const pnl = mv - h.totalSpent;
    const pnlPct = h.totalSpent > 0 ? (pnl / h.totalSpent) * 100 : 0;
    totalVal += mv;
    const icon = pnl >= 0 ? "🟢" : "🔴";
    lines.push(`${icon} **${h.symbol}** — ${h.quantity} @ $${cp.toFixed(2)} | P/L: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
  }

  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(`${message.author.username}'s Portfolio`)
    .setDescription(lines.join("\n"))
    .addFields({ name: "Cash", value: `$${acc.balance.toLocaleString()}`, inline: true }, { name: "Net Worth", value: `$${totalVal.toLocaleString()}`, inline: true })
    .setFooter({ text: `${pf.holdings.length} positions` }).setTimestamp();
  await message.reply({ embeds: [embed] });
}

// ──────────────────────── SLASH: Balance ────────────────────────

async function handleSlashBalance(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const gId = interaction.guildId ?? "dm";
  const acc = ensureAccount(interaction.user.id, interaction.user.username, gId);
  const pf = ensurePortfolio(interaction.user.id);
  let pv = 0;
  if (pf.holdings.length > 0) {
    const quotes = await getMultipleQuotes(pf.holdings.map((h: Holding) => h.symbol));
    for (const h of pf.holdings) pv += (quotes.find((q: MarketQuote) => q.symbol === h.symbol)?.price ?? h.averageBuyPrice) * h.quantity;
  }
  const nw = acc.balance + pv;
  const totalPnl = nw - 10000;
  const embed = new EmbedBuilder().setColor(COLORS.primary)
    .setAuthor({ name: `${interaction.user.username}'s Account`, iconURL: interaction.user.displayAvatarURL() })
    .addFields(
      { name: "💵 Cash", value: `$${acc.balance.toLocaleString()}`, inline: true },
      { name: "📦 Holdings", value: `$${pv.toLocaleString()}`, inline: true },
      { name: "💰 Net Worth", value: `$${nw.toLocaleString()}`, inline: true },
      { name: "📊 Total P/L", value: `${totalPnl >= 0 ? "📈" : "📉"} ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toLocaleString()}`, inline: true },
      { name: "🔄 Trades", value: `${acc.transactionCount}`, inline: true },
      { name: "📅 Member Since", value: `<t:${Math.floor(new Date(acc.createdAt).getTime() / 1000)}:d>`, inline: true },
    ).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handlePrefixBalance(message: Message, args: string[]) {
  const gId = message.guildId ?? "dm";
  const acc = ensureAccount(message.author.id, message.author.username, gId);
  const pf = ensurePortfolio(message.author.id);
  let pv = 0;
  if (pf.holdings.length > 0) {
    const quotes = await getMultipleQuotes(pf.holdings.map((h: Holding) => h.symbol));
    for (const h of pf.holdings) pv += (quotes.find((q: MarketQuote) => q.symbol === h.symbol)?.price ?? h.averageBuyPrice) * h.quantity;
  }
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(`${message.author.username}'s Account`)
    .addFields(
      { name: "Cash", value: `$${acc.balance.toLocaleString()}`, inline: true },
      { name: "Net Worth", value: `$${(acc.balance + pv).toLocaleString()}`, inline: true },
      { name: "Trades", value: `${acc.transactionCount}`, inline: true },
    ).setTimestamp();
  await message.reply({ embeds: [embed] });
}

// ──────────────────────── SLASH: Leaderboard ────────────────────────

async function handleSlashLeaderboard(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const accounts = db.getAllAccounts();
  const enriched = [];
  for (const acc of accounts) {
    const pf = db.getPortfolio(acc.userId);
    let pv = 0;
    if (pf && pf.holdings.length > 0) {
      try {
        const quotes = await getMultipleQuotes(pf.holdings.map((h: Holding) => h.symbol));
        for (const h of pf.holdings) pv += (quotes.find((q: MarketQuote) => q.symbol === h.symbol)?.price ?? h.averageBuyPrice) * h.quantity;
      } catch {}
    }
    enriched.push({ username: acc.username, netWorth: acc.balance + pv, pnl: acc.balance + pv - 10000, trades: acc.transactionCount });
  }
  enriched.sort((a, b) => b.netWorth - a.netWorth);
  const top = enriched.slice(0, 15);
  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((t, i) => {
    const p = i < 3 ? medals[i] : `\`${i + 1}.\``;
    const sign = t.pnl >= 0 ? "+" : "";
    return `${p} **${t.username}** — $${t.netWorth.toLocaleString()} (${sign}$${t.pnl.toLocaleString()})`;
  });

  const embed = new EmbedBuilder().setColor(COLORS.premium).setTitle("🏆 Trader Leaderboard")
    .setDescription(lines.join("\n") || "No traders yet.").setFooter({ text: `${accounts.length} registered traders` }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handlePrefixLeaderboard(message: Message, args: string[]) {
  const accounts = db.getAllAccounts();
  const enriched = [];
  for (const acc of accounts) {
    const pf = db.getPortfolio(acc.userId);
    let pv = 0;
    if (pf && pf.holdings.length > 0) {
      try {
        const quotes = await getMultipleQuotes(pf.holdings.map((h: Holding) => h.symbol));
        for (const h of pf.holdings) pv += (quotes.find((q: MarketQuote) => q.symbol === h.symbol)?.price ?? h.averageBuyPrice) * h.quantity;
      } catch {}
    }
    enriched.push({ username: acc.username, netWorth: acc.balance + pv, pnl: acc.balance + pv - 10000, trades: acc.transactionCount });
  }
  enriched.sort((a, b) => b.netWorth - a.netWorth);
  const top = enriched.slice(0, 15);
  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((t, i) => `${i < 3 ? medals[i] : `\`${i + 1}.\``} **${t.username}** — $${t.netWorth.toLocaleString()}`);
  const embed = new EmbedBuilder().setColor(COLORS.premium).setTitle("Leaderboard")
    .setDescription(lines.join("\n") || "No data.").setFooter({ text: `${accounts.length} traders` }).setTimestamp();
  await message.reply({ embeds: [embed] });
}

// ──────────────────────── SLASH: Daily ────────────────────────

async function handleSlashDaily(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const gId = interaction.guildId ?? "dm";
  let acc = db.getAccount(interaction.user.id);
  if (!acc) acc = db.createAccount(interaction.user.id, interaction.user.username, gId);
  const cfg = db.getServerConfig(gId);
  const now = Date.now();

  if (acc.lastDailyReward) {
    const elapsed = now - new Date(acc.lastDailyReward).getTime();
    if (elapsed < cfg.dailyRewardCooldownMs) {
      const rem = cfg.dailyRewardCooldownMs - elapsed;
      const h = Math.floor(rem / 3600000);
      const m = Math.floor((rem % 3600000) / 60000);
      await interaction.editReply({ content: `Already claimed. Try again in **${h}h ${m}m**.` });
      return;
    }
  }

  acc.balance += cfg.dailyRewardAmount;
  acc.lastDailyReward = new Date(now).toISOString();
  db.updateAccount(acc);

  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle("🎁 Daily Reward")
    .setDescription(`**$${cfg.dailyRewardAmount.toLocaleString()}** deposited`)
    .addFields({ name: "New Balance", value: `$${acc.balance.toLocaleString()}`, inline: true })
    .setFooter({ text: "Available every 24 hours" }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handlePrefixDaily(message: Message) {
  const gId = message.guildId ?? "dm";
  let acc = db.getAccount(message.author.id);
  if (!acc) acc = db.createAccount(message.author.id, message.author.username, gId);
  const cfg = db.getServerConfig(gId);
  const now = Date.now();

  if (acc.lastDailyReward) {
    const elapsed = now - new Date(acc.lastDailyReward).getTime();
    if (elapsed < cfg.dailyRewardCooldownMs) {
      const rem = cfg.dailyRewardCooldownMs - elapsed;
      await message.reply(`Come back in **${Math.floor(rem / 3600000)}h ${Math.floor((rem % 3600000) / 60000)}m**.`);
      return;
    }
  }
  acc.balance += cfg.dailyRewardAmount;
  acc.lastDailyReward = new Date(now).toISOString();
  db.updateAccount(acc);
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle("Daily Reward")
    .setDescription(`**$${cfg.dailyRewardAmount.toLocaleString()}** received`).setTimestamp();
  await message.reply({ embeds: [embed] });
}

// ──────────────────────── SLASH: Watchlist ────────────────────────

async function handleSlashWatchlist(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "add") {
    await interaction.deferReply();
    const symbol = interaction.options.getString("symbol", true).toUpperCase();
    try {
      const q = await getQuote(symbol);
      db.addToWatchlist(interaction.user.id, { symbol: q.symbol, type: q.type, addedAt: new Date().toISOString() });
      await interaction.editReply({ content: `✅ **${q.symbol}** added to watchlist.` });
    } catch { await interaction.editReply({ content: `Could not find **${symbol}**.` }); }
  } else if (sub === "remove") {
    await interaction.deferReply();
    const symbol = interaction.options.getString("symbol", true).toUpperCase();
    const removed = ["stock", "crypto", "forex", "commodity"].some((t) => db.removeFromWatchlist(interaction.user.id, symbol, t));
    await interaction.editReply({ content: removed ? `Removed **${symbol}**.` : `**${symbol}** not in watchlist.` });
  } else {
    await interaction.deferReply();
    const list = db.getWatchlist(interaction.user.id);
    if (list.length === 0) { await interaction.editReply({ content: "Watchlist empty. Use `/watchlist add <symbol>`." }); return; }
    const quotes = await getMultipleQuotes(list.map((w) => w.symbol));
    const qMap = new Map(quotes.map((q: MarketQuote) => [q.symbol, q]));
    const lines = list.map((w) => {
      const q = qMap.get(w.symbol);
      return q ? `${trendEmoji(q.change)} **${w.symbol}** — $${q.price.toLocaleString()} ${fChange(q.change, q.changePercent)}` : `❓ **${w.symbol}** — N/A`;
    });
    const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle("📋 Watchlist")
      .setDescription(lines.join("\n")).setFooter({ text: `${list.length} symbols` }).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }
}

async function handlePrefixWatchlist(message: Message, args: string[]) {
  const sub = args[0]?.toLowerCase();
  if (sub === "add" && args[1]) {
    try {
      const q = await getQuote(args[1].toUpperCase());
      db.addToWatchlist(message.author.id, { symbol: q.symbol, type: q.type, addedAt: new Date().toISOString() });
      await message.reply(`Added **${q.symbol}**.`);
    } catch { await message.reply("Symbol not found."); }
  } else if (sub === "remove" && args[1]) {
    const s = args[1].toUpperCase();
    const r = ["stock", "crypto", "forex", "commodity"].some((t) => db.removeFromWatchlist(message.author.id, s, t));
    await message.reply(r ? `Removed **${s}**.` : "Not in watchlist.");
  } else {
    const list = db.getWatchlist(message.author.id);
    if (list.length === 0) { await message.reply("Empty. Use `!wl add <symbol>`."); return; }
    const quotes = await getMultipleQuotes(list.map((w) => w.symbol));
    const qMap = new Map(quotes.map((q: MarketQuote) => [q.symbol, q]));
    const lines = list.map((w) => {
      const q = qMap.get(w.symbol);
      return q ? `${trendEmoji(q.change)} **${w.symbol}** — $${q.price.toFixed(2)}` : `❓ **${w.symbol}**`;
    });
    await message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle("Watchlist").setDescription(lines.join("\n")).setTimestamp()] });
  }
}

// ──────────────────────── SLASH: Alert ────────────────────────

async function handleSlashAlert(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "set") {
    await interaction.deferReply();
    const symbol = interaction.options.getString("symbol", true).toUpperCase();
    const price = interaction.options.getNumber("price", true);
    try {
      const q = await getQuote(symbol);
      const dir: "above" | "below" = price > q.price ? "above" : "below";
      db.addAlert({ id: `A-${Date.now()}`, userId: interaction.user.id, symbol: q.symbol, type: q.type, targetPrice: price, direction: dir, triggered: false, createdAt: new Date().toISOString() });
      await interaction.editReply({ content: `🔔 Alert: **${q.symbol}** ${dir === "above" ? "📈 above" : "📉 below"} **$${price.toLocaleString()}** (currently $${q.price.toLocaleString()})` });
    } catch (e: any) { await interaction.editReply({ content: `Failed: ${e.message}` }); }
  } else if (sub === "cancel") {
    await interaction.deferReply();
    const symbol = interaction.options.getString("symbol", true).toUpperCase();
    const alerts = db.getUserAlerts(interaction.user.id);
    const found = alerts.find((a) => a.symbol === symbol);
    if (found) { db.deleteAlert(found.id); await interaction.editReply({ content: `Cancelled alert for **${symbol}**.` }); }
    else { await interaction.editReply({ content: `No active alert for **${symbol}**.` }); }
  } else {
    await interaction.deferReply();
    const alerts = db.getUserAlerts(interaction.user.id);
    if (alerts.length === 0) { await interaction.editReply({ content: "No active alerts." }); return; }
    const lines = alerts.map((a) => `${a.direction === "above" ? "📈" : "📉"} **${a.symbol}** — ${a.direction} $${a.targetPrice.toLocaleString()}`);
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle("🔔 Active Alerts").setDescription(lines.join("\n")).setTimestamp()] });
  }
}

async function handlePrefixAlert(message: Message, args: string[]) {
  if (!args[0]) {
    const alerts = db.getUserAlerts(message.author.id);
    if (alerts.length === 0) { await message.reply("No active alerts."); return; }
    const lines = alerts.map((a) => `${a.direction === "above" ? "📈" : "📉"} **${a.symbol}** — ${a.direction} $${a.targetPrice.toLocaleString()}`);
    await message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle("Alerts").setDescription(lines.join("\n")).setTimestamp()] });
  } else if (args[0] === "cancel" && args[1]) {
    const symbol = args[1].toUpperCase();
    const found = db.getUserAlerts(message.author.id).find((a) => a.symbol === symbol);
    if (found) { db.deleteAlert(found.id); await message.reply(`Cancelled alert for **${symbol}**.`); }
    else { await message.reply("Not found."); }
  } else if (args[0] && args[1]) {
    try {
      const symbol = args[0].toUpperCase();
      const price = parseFloat(args[1]);
      if (isNaN(price)) { await message.reply("Usage: `!alert <symbol> <price>`"); return; }
      const q = await getQuote(symbol);
      const dir: "above" | "below" = price > q.price ? "above" : "below";
      db.addAlert({ id: `A-${Date.now()}`, userId: message.author.id, symbol: q.symbol, type: q.type, targetPrice: price, direction: dir, triggered: false, createdAt: new Date().toISOString() });
      await message.reply(`Set alert for **${q.symbol}** ${dir} $${price}.`);
    } catch (e: any) { await message.reply(`Failed: ${e.message}`); }
  } else {
    await message.reply("Usage: `!alert <symbol> <price>` or `!alert cancel <symbol>` or `!alert` to list");
  }
}

// ──────────────────────── SLASH: Markets ────────────────────────

async function handleSlashMarkets(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  await interaction.editReply({ embeds: [getMarketsEmbed()] });
}

async function handlePrefixMarkets(message: Message) {
  await message.reply({ embeds: [getMarketsEmbed()] });
}

function getMarketsEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.primary).setTitle("🌐 Supported Markets")
    .setDescription("Use `/price <symbol>` to get live quotes. Thousands more symbols beyond this list are available.")
    .addFields(
      { name: "📈 Stocks", value: "AAPL · MSFT · GOOGL · AMZN · TSLA · META · NVDA · NFLX · JPM · V · WMT · MA · DIS · BAC · ADBE · NKE · AMD · INTC · QCOM · BA", inline: false },
      { name: "₿ Cryptocurrency", value: "BTC · ETH · SOL · XRP · DOGE · ADA · AVAX · DOT · LINK · MATIC · LTC · UNI · SHIB · ATOM · NEAR · SUI", inline: false },
      { name: "💱 Forex", value: "EURUSD · GBPUSD · USDJPY · USDCHF · AUDUSD · USDCAD · NZDUSD · EURGBP · EURJPY · GBPJPY", inline: false },
      { name: "🛢 Commodities", value: "GC=F Gold · SI=F Silver · CL=F Oil · NG=F NatGas · HG=F Copper · PL=F Platinum · ZC=F Corn · ZS=F Soy · CT=F Cotton", inline: false },
    )
    .setFooter({ text: "Paper trading — virtual currency only" });
}

// ──────────────────────── SLASH: Transactions ────────────────────────

async function handleSlashTransactions(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const count = interaction.options.getInteger("count") ?? 10;
  const txns = db.getUserTransactions(interaction.user.id, count);
  if (txns.length === 0) { await interaction.editReply({ content: "No trade history. Use `/buy` to start." }); return; }
  const lines = txns.map((t) => {
    const icon = t.orderType === "buy" ? "🟢" : "🔴";
    return `${icon} **${t.orderType.toUpperCase()}** ${t.quantity} ${t.symbol} @ $${t.price.toLocaleString()} — $${t.total.toLocaleString()}`;
  });
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle("📜 Trade History").setDescription(lines.join("\n")).setFooter({ text: `${txns.length} transactions` }).setTimestamp()] });
}

async function handlePrefixTransactions(message: Message, args: string[]) {
  const limit = Math.min(parseInt(args[0]) || 10, 25);
  const txns = db.getUserTransactions(message.author.id, limit);
  if (txns.length === 0) { await message.reply("No history yet."); return; }
  const lines = txns.map((t) => `${t.orderType === "buy" ? "🟢" : "🔴"} ${t.quantity} ${t.symbol} @ $${t.price.toLocaleString()} — $${t.total.toLocaleString()}`);
  await message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle("Transactions").setDescription(lines.join("\n")).setTimestamp()] });
}

// ──────────────────────── SLASH: Share ────────────────────────

async function handleSlashShare(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const target = interaction.options.getUser("user", true);
  const amount = interaction.options.getNumber("amount", true);
  if (target.id === interaction.user.id) { await interaction.editReply({ content: "Cannot send to yourself." }); return; }
  const gId = interaction.guildId ?? "dm";
  ensureAccount(interaction.user.id, interaction.user.username, gId);
  ensureAccount(target.id, target.username, gId);
  const result = db.share(interaction.user.id, target.id, amount);
  if (result !== "shared") { await interaction.editReply({ content: result }); return; }
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle("💸 Transfer Complete").setDescription(`**$${amount.toLocaleString()}** sent to ${target.username}`).setTimestamp()] });
}

async function handlePrefixShare(message: Message, args: string[]) {
  const target = message.mentions.users.first();
  if (!target || !args[1]) { await message.reply("Usage: `!share @user <amount>`"); return; }
  const amount = parseFloat(args.find((a) => !a.startsWith("<@")) ?? "0");
  if (isNaN(amount) || amount <= 0) { await message.reply("Invalid amount."); return; }
  if (target.id === message.author.id) { await message.reply("Cannot send to yourself."); return; }
  const gId = message.guildId ?? "dm";
  ensureAccount(message.author.id, message.author.username, gId);
  ensureAccount(target.id, target.username, gId);
  const result = db.share(message.author.id, target.id, amount);
  if (result !== "shared") { await message.reply(result); return; }
  await message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle("Transfer").setDescription(`$${amount.toLocaleString()} to ${target.username}`).setTimestamp()] });
}

// ──────────────────────── SLASH: Reset ────────────────────────

async function handleSlashReset(interaction: ChatInputCommandInteraction) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`reset-y-${interaction.user.id}`).setLabel("Yes, Reset").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`reset-n-${interaction.user.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ content: "⚠️ Reset your entire account to $10,000? All holdings will be sold. This cannot be undone.", components: [row], ephemeral: true });
}

async function handlePrefixReset(message: Message) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`reset-y-${message.author.id}`).setLabel("Confirm").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`reset-n-${message.author.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  const reply = await message.reply({ content: "⚠️ Reset your account? Everything will be lost.", components: [row] });
  try {
    const int = await reply.awaitMessageComponent({ time: 30000 });
    if (int.customId.startsWith("reset-y")) {
      db.resetAccount(message.author.id, message.guildId ?? "dm");
      await int.update({ content: "✅ Account reset. Starting balance: $10,000.", components: [] });
    } else { await int.update({ content: "Reset cancelled.", components: [] }); }
  } catch { await reply.edit({ content: "Timed out.", components: [] }); }
}

// ──────────────────────── SLASH: Help ────────────────────────

async function handleSlashHelp(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  await interaction.editReply({ embeds: [getHelpEmbed()] });
}

async function sendHelpEmbed(target: Message) {
  await target.reply({ embeds: [getHelpEmbed()] });
}

function getHelpEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.primary).setTitle("📊 Trading Bot — Command Reference")
    .setDescription("All commands work with both `/command` and `!command` prefix. Quick lookup: `!AAPL`")
    .addFields(
      { name: "💰 Trading", value: "`/buy <symbol> <qty>` — Purchase\n`/sell <symbol> <qty>` — Sell (use 0 for all)\n`/share @user <amount>` — Send cash", inline: false },
      { name: "📊 Markets", value: "`/price <symbol>` — Live quote\n`/chart <symbol> [period]` — Price chart\n`/markets` — Supported assets", inline: false },
      { name: "📦 Portfolio", value: "`/portfolio` — Holdings & P/L\n`/balance` — Account & net worth\n`/transactions` — Trade history", inline: false },
      { name: "🏆 Social", value: "`/leaderboard` — Rankings\n`/daily` — $500 reward\n`/watchlist add|remove|view` — Track symbols\n`/alert set|list|cancel` — Price alerts", inline: false },
      { name: "⚙️ Admin", value: "`/setup` — Auto-configure server\n`/resetme` — Reset account", inline: false },
    )
    .setFooter({ text: "Paper trading · Virtual currency · Not financial advice" });
}

// ──────────────────────── SLASH: Chart ────────────────────────

async function handleSlashChart(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const symbol = interaction.options.getString("symbol", true);
  const period = (interaction.options.getString("period") ?? "1mo") as "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y";

  try {
    const quote = await getQuote(symbol);
    const { getHistorical } = await import("../services/market");
    const candles = await getHistorical(quote.symbol, period, quote.type);

    if (candles.length === 0) {
      await interaction.editReply({ content: "No chart data available." });
      return;
    }

    const prices = candles.map((c) => c.close);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const height = 10;

    const chartLines: string[] = [];
    for (let row = height; row >= 0; row--) {
      let line = "";
      const lvl = min + (range / height) * row;
      const label = row % 2 === 0 ? `$${fShort(lvl)}`.padStart(8) : " ".repeat(8);
      line += label + "│";
      for (const c of candles) {
        const normal = (c.close - min) / range;
        const y = Math.round(normal * height);
        if (y === row) line += "●";
        else if (y > row) line += "│";
        else line += " ";
      }
      chartLines.push(line);
    }

    const openTime = candles[0]?.timestamp;
    const closeTime = candles[candles.length - 1]?.timestamp;
    const tLabel = openTime && closeTime
      ? `<t:${Math.floor(new Date(openTime).getTime() / 1000)}:d> to <t:${Math.floor(new Date(closeTime).getTime() / 1000)}:d>`
      : "";

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(`📈 ${quote.symbol} — ${quote.name}`)
      .setDescription(`\`\`\`\n${chartLines.join("\n")}\n${" ".repeat(9)}└${"—".repeat(candles.length)}\n${tLabel}\n\`\`\``)
      .addFields(
        { name: "Current", value: `$${quote.price.toLocaleString()}`, inline: true },
        { name: "Range", value: `$${min.toFixed(2)} — $${max.toFixed(2)}`, inline: true },
        { name: "Period", value: period.toUpperCase(), inline: true },
      )
      .setFooter({ text: "ASCII chart — for illustration only" })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (e: any) {
    await interaction.editReply({ content: `Could not chart **${symbol}**.` });
  }
}

// ──────────────────────── SLASH: XAUUSD ────────────────────────

async function handleSlashXAUUSD(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const analysis = await analyzeXAUUSD();
  if (!analysis) {
    await interaction.editReply({ content: "Could not fetch XAUUSD data. Try again shortly." });
    return;
  }
  const embed = buildXAUUSDEmbed(analysis);
  await interaction.editReply({ embeds: [embed] });
}

// ──────────────────────── SLASH: Sessions ────────────────────────

async function handleSlashSessions(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const embed = getMarketTimesEmbed();
  await interaction.editReply({ embeds: [embed] });
}

// ──────────────────────── SLASH: Movers ────────────────────────

async function handleSlashMovers(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  try {
    const { gainers, losers } = await scanMovers();
    if (gainers.length === 0 && losers.length === 0) {
      await interaction.editReply({ content: "No movers data available right now." });
      return;
    }
    const embeds = buildMoversEmbed(gainers, losers);
    await interaction.editReply({ embeds });
  } catch {
    await interaction.editReply({ content: "Could not fetch movers. Try again shortly." });
  }
}

// ──────────────────────── SLASH: SetChannel ────────────────────────

async function handleSlashSetChannel(interaction: ChatInputCommandInteraction) {
  if (!(interaction.member as GuildMember)?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({ content: "Admin only.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const type = interaction.options.getString("type", true);
  const channelId = interaction.channelId;

  const configMap: Record<string, string> = {
    news: "NEWS_CHANNEL_ID",
    xauusd: "XAUUSD_CHANNEL_ID",
    sessions: "MARKET_TIMES_CHANNEL_ID",
    liveprices: "LIVE_PRICES_CHANNEL_ID",
  };
  const configKey = configMap[type];
  if (!configKey) { await interaction.editReply({ content: "Unknown type." }); return; }

  const fs = await import("fs");
  const envPath = ".env";
  let envContent = "";
  try { envContent = fs.readFileSync(envPath, "utf-8"); } catch {}

  if (envContent.includes(`${configKey}=`)) {
    envContent = envContent.replace(new RegExp(`${configKey}=.*`, "g"), `${configKey}=${channelId}`);
  } else {
    envContent += `\n${configKey}=${channelId}`;
  }
  fs.writeFileSync(envPath, envContent, "utf-8");

  (CONFIG as any)[configKey] = channelId;
  const { client } = await import("../index");

  if (type === "news") {
    startNewsPolling(client);
    await interaction.editReply({ content: `✅ Market news posting in <#${channelId}> every **5 min**.\n🟢 Bullish  🔴 Bearish  🔥 High-impact\nFilters: Metals, BTC, S&P 500, Nasdaq, US-100` });
  } else if (type === "xauusd") {
    startXAUUSDPolling(client);
    await interaction.editReply({ content: `✅ **XAUUSD Analysis** posting in <#${channelId}> every **5 min**.\n📈 Trend/RSI  🛡 Support  🚧 Resistance  🟢🔴 Entry points` });
  } else if (type === "sessions") {
    startMarketTimes(client);
    await interaction.editReply({ content: `✅ **Market Sessions** tracker in <#${channelId}>. Updates every minute.\n🇦🇺 Sydney  🇯🇵 Tokyo  🇬🇧 London  🇺🇸 New York` });
  } else {
    startMoversPolling(client);
    await interaction.editReply({ content: `✅ **Live Prices & Movers** posting in <#${channelId}> every **15 min**.\n📈 Top 5 gainers + entry analysis\n📉 Top 5 losers + entry analysis\n🔥 Strong Buy  ✅ Buy  ⏸️ Wait  ❌ Avoid` });
  }
}

// ──────────────────────── SLASH: Setup ────────────────────────

async function handleSlashSetup(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Server only.", ephemeral: true });
    return;
  }
  if (!(interaction.member as GuildMember)?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({ content: "Admin only.", ephemeral: true });
    return;
  }
  const botMember = interaction.guild.members.me;
  if (!botMember?.permissions.has([PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageRoles])) {
    await interaction.reply({ content: "Bot needs Manage Channels and Manage Roles permissions.", ephemeral: true });
    return;
  }

  await interaction.deferReply();
  const guild = interaction.guild;
  const created: string[] = [];

  async function mkRole(name: string, hex: string, hoist: boolean) {
    if (guild.roles.cache.find((r: Role) => r.name === name)) { created.push(`✅ @${name} (existing)`); return; }
    await guild.roles.create({ name, color: parseInt(hex.slice(1), 16), hoist, reason: "Trading server setup" });
    created.push(`✅ @${name}`);
  }

  async function mkCat(name: string): Promise<CategoryChannel | null> {
    const existing = guild.channels.cache.find((c) => c.name.toLowerCase().replace(/\s+/g, "-") === name.toLowerCase() && c.type === ChannelType.GuildCategory);
    if (existing) { created.push(`✅ ${name} (existing)`); return existing as CategoryChannel; }
    const cat = await guild.channels.create({ name, type: ChannelType.GuildCategory, reason: "Trading server setup" });
    created.push(`✅ ${name}`);
    return cat;
  }

  async function mkCh(cat: CategoryChannel | null, name: string, type: "text" | "voice", topic?: string) {
    if (guild.channels.cache.find((c) => c.name === name)) { created.push(`  └ #${name} (existing)`); return; }
    await guild.channels.create({ name, type: type === "text" ? ChannelType.GuildText : ChannelType.GuildVoice, parent: cat?.id ?? undefined, topic: topic ?? undefined, reason: "Trading server setup" });
    created.push(`  └ #${name}`);
  }

  await mkRole("Admin", "#992D22", true);
  await mkRole("Moderator", "#E74C3C", true);
  await mkRole("Analyst", "#3498DB", true);
  await mkRole("Day Trader", "#E67E22", true);
  await mkRole("Whale", "#F1C40F", true);
  await mkRole("Trader", "#5865F2", true);

  const mCat = await mkCat("📊 MARKETS");
  await mkCh(mCat, "live-prices", "text", "Real-time market data — Use /price");
  await mkCh(mCat, "market-news", "text", "Financial news, earnings reports, macro events");
  await mkCh(mCat, "stocks-discussion", "text", "Equities, ETFs, IPOs, and stock analysis");
  await mkCh(mCat, "crypto-discussion", "text", "Bitcoin, Ethereum, DeFi, and altcoins");
  await mkCh(mCat, "forex-commodities", "text", "Currencies, oil, gold, and futures");

  const tCat = await mkCat("💰 TRADING FLOOR");
  await mkCh(tCat, "order-execution", "text", "Place orders with /buy and /sell");
  await mkCh(tCat, "trade-journal", "text", "Log your entries, exits, and learnings");
  await mkCh(tCat, "portfolio-showcase", "text", "Share your performance and strategies");
  await mkCh(tCat, "leaderboard", "text", "🏆 Rankings — use /leaderboard");

  const lCat = await mkCat("🎓 ACADEMY");
  await mkCh(lCat, "beginners-guide", "text", "Getting started with trading — FAQs & guides");
  await mkCh(lCat, "technical-analysis", "text", "Charts, indicators, patterns, and setups");
  await mkCh(lCat, "fundamental-analysis", "text", "Valuation, earnings, macro, and research");
  await mkCh(lCat, "risk-management", "text", "Position sizing, stop-losses, portfolio theory");
  await mkCh(lCat, "resources", "text", "Books, courses, tools, and useful links");

  const cCat = await mkCat("💬 COMMUNITY");
  await mkCh(cCat, "general", "text", "Anything goes — hangout and chat");
  await mkCh(cCat, "introductions", "text", "New member? Introduce yourself here");
  await mkCh(cCat, "memes", "text", "Trading humor and market memes");
  await mkCh(cCat, "off-topic", "text", "Sports, games, life, and everything else");

  const sCat = await mkCat("📢 INFORMATION");
  await mkCh(sCat, "announcements", "text", "Official updates and important news");
  await mkCh(sCat, "rules", "text", "Server rules — read before trading");
  await mkCh(sCat, "commands", "text", "Bot command reference — /help for details");
  await mkCh(sCat, "suggestions", "text", "Feedback and feature requests");

  const vCat = await mkCat("🔊 VOICE");
  await mkCh(vCat, "Trading Desk", "voice");
  await mkCh(vCat, "Market Hours", "voice");
  await mkCh(vCat, "Lounge", "voice");

  // Post rules
  try {
    const rCh = guild.channels.cache.find((c) => c.name === "rules" && c.type === ChannelType.GuildText);
    if (rCh && rCh.isTextBased()) {
      await (rCh as TextChannel).send({
        embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle("📜 Server Rules")
          .setDescription("Welcome to the Trading Server. Adhere to these rules to maintain a professional community.")
          .addFields(
            { name: "1. Professional Conduct", value: "Treat all members with respect. Harassment, hate speech, and personal attacks result in immediate action.", inline: false },
            { name: "2. Not Financial Advice", value: "All discussions are educational. Nothing here constitutes financial or investment advice. Always DYOR.", inline: false },
            { name: "3. Paper Trading", value: "This server uses virtual currency only. Never share real account details or solicit real-money trades.", inline: false },
            { name: "4. No Pump & Dump", value: "Coordinated manipulation, misleading hype, and scam promotions are strictly prohibited.", inline: false },
            { name: "5. Appropriate Channels", value: "Use the correct channels — executions in order-execution, analysis in the academy, chat in community.", inline: false },
            { name: "6. No Spam or Ads", value: "No unsolicited promotions, referral links, DMs to members, or repetitive messages.", inline: false },
            { name: "7. English Only", value: "Keep all communications in English to ensure community accessibility.", inline: false },
          ).setFooter({ text: "Violations: warning → mute → kick → ban" }).setTimestamp()],
      });
    }
  } catch {}

  // Post command reference
  try {
    const cmdCh = guild.channels.cache.find((c) => c.name === "commands" && c.type === ChannelType.GuildText);
    if (cmdCh && cmdCh.isTextBased()) {
      await (cmdCh as TextChannel).send({ embeds: [getHelpEmbed()] });
    }
  } catch {}

  // Leaderboard seed
  try {
    const lbCh = guild.channels.cache.find((c) => c.name === "leaderboard" && c.type === ChannelType.GuildText);
    if (lbCh && lbCh.isTextBased()) {
      await (lbCh as TextChannel).send({
        embeds: [new EmbedBuilder().setColor(COLORS.premium).setTitle("🏆 Leaderboard")
          .setDescription("No trades yet — be the first.\nUse `/buy <symbol> <qty>` in <#order-execution> to start.\nThen run `/leaderboard` to see rankings.").setTimestamp()],
      });
    }
  } catch {}

  const summary = new EmbedBuilder().setColor(COLORS.primary).setTitle("✅ Server Configuration Complete")
    .setDescription("Your professional trading server is ready.")
    .addFields(
      { name: "Structure", value: "6 categories · 25+ channels · 6 roles", inline: false },
      { name: "Quick Start", value: "1. Assign yourself `@Admin`\n2. `/daily` for $500 starting cash\n3. `/buy AAPL 10` to trade\n4. `/leaderboard` to compete", inline: false },
      { name: "Channels Built", value: created.slice(0, 15).join("\n") + (created.length > 15 ? `\n...and ${created.length - 15} more` : ""), inline: false },
    )
    .setFooter({ text: "Happy trading — run /help anytime" }).setTimestamp();

  await interaction.editReply({ embeds: [summary] });
}

// ──────────────────────── Welcome Handler ────────────────────────

export async function handleMemberJoin(member: GuildMember): Promise<void> {
  try {
    const guild = member.guild;

    // Auto-create their paper trading account
    const gId = guild.id;
    if (!db.getAccount(member.id)) {
      db.createAccount(member.id, member.user.username, gId);
    }

    // DM welcome guide
    try {
      const guideEmbed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
        .setTitle(`👋 Welcome, ${member.user.username}`)
        .setDescription(
          `You've been granted **$10,000** in virtual currency. Here's your guide:\n\n` +
          `### 📊 Markets & Data\n` +
          `<#order-execution> — Execute paper trades\n` +
          `<#live-prices> — Top movers & entry analysis\n` +
          `<#market-news> — 🔥 High-impact financial news\n` +
          `<#market-times> — 🇦🇺🇯🇵🇬🇧🇺🇸 Session tracker\n\n` +
          `### 🎓 Academy\n` +
          `<#beginners-guide> — New to trading? Start here\n` +
          `<#technical-analysis> — Charts & indicators\n` +
          `<#fundamental-analysis> — Macro & valuation\n` +
          `<#risk-management> — Position sizing & stops\n\n` +
          `### 💬 Community\n` +
          `<#general> — Chat with fellow traders\n` +
          `<#introductions> — Say hi to the community\n` +
          `<#memes> — Trading humor\n\n` +
          `### ⚡ Quick Commands\n` +
          "`/daily` — $500 daily reward\n" +
          "`/buy AAPL 5` — Buy 5 Apple shares\n" +
          "`/portfolio` — View your holdings\n" +
          "`/leaderboard` — Top traders ranking\n" +
          "`/help` — Full command list"
        )
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: "Paper trading · Not financial advice · Read /rules" })
        .setTimestamp();

      await member.send({ embeds: [guideEmbed] }).catch(() => {});
    } catch {}

    // Public welcome
    const introChannel = guild.channels.cache.find(
      (c) => (c.name === "introductions" || c.name === "general") && c.type === ChannelType.GuildText
    );
    if (introChannel && introChannel.isTextBased()) {
      const pubEmbed = new EmbedBuilder()
        .setColor(COLORS.premium)
        .setDescription(`### 👋 ${member.user.username} just joined!\nWelcome to the server — $10,000 deposited to your paper trading account. Start with \`/daily\`!`)
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();
      await (introChannel as TextChannel).send({ embeds: [pubEmbed] });
    }
  } catch {}
}

// ──────────────────────── Export command data ────────────────────────

export { commands };
