import { TextChannel, EmbedBuilder } from "discord.js";
import { CONFIG } from "../config";

let timeout: ReturnType<typeof setTimeout> | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;
let lastMessageId: string | null = null;
let lastState = "";

interface Session {
  name: string;
  open: number;  // hour in UTC
  close: number; // hour in UTC
  emoji: string;
  color: number;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isDST(): boolean {
  const now = new Date();
  const month = now.getUTCMonth(); // 0=Jan
  // Northern hemisphere DST: ~March to October
  return month >= 2 && month <= 9;
}

function getSessionTimes(): Session[] {
  if (isDST()) {
    return [
      { name: "Sydney", open: 22, close: 7, emoji: "🇦🇺", color: 0x00C853 },
      { name: "Tokyo", open: 0, close: 9, emoji: "🇯🇵", color: 0xFF1744 },
      { name: "London", open: 7, close: 16, emoji: "🇬🇧", color: 0x2979FF },
      { name: "New York", open: 12, close: 21, emoji: "🇺🇸", color: 0xFF6D00 },
    ];
  }
  return [
    { name: "Sydney", open: 22, close: 7, emoji: "🇦🇺", color: 0x00C853 },
    { name: "Tokyo", open: 0, close: 9, emoji: "🇯🇵", color: 0xFF1744 },
    { name: "London", open: 8, close: 17, emoji: "🇬🇧", color: 0x2979FF },
    { name: "New York", open: 13, close: 22, emoji: "🇺🇸", color: 0xFF6D00 },
  ];
}

function getUTCHour(): number {
  return new Date().getUTCHours();
}

function getUTCMinute(): number {
  return new Date().getUTCMinutes();
}

function getUTCDay(): number {
  return new Date().getUTCDay();
}

function getUTC(): Date {
  return new Date();
}

function isSessionOpen(session: Session, hour: number): boolean {
  if (session.open < session.close) {
    return hour >= session.open && hour < session.close;
  }
  // Overnight session (e.g., Sydney 22-07)
  return hour >= session.open || hour < session.close;
}

function nextSessionOpen(session: Session, now: Date): number {
  const currentHour = now.getUTCHours();
  const currentMin = now.getUTCMinutes();

  let openHour = session.open;
  // If session is currently open, return 0
  if (isSessionOpen(session, currentHour)) return 0;

  // Calculate hours until open
  let hoursUntil = openHour - currentHour;
  if (hoursUntil < 0) hoursUntil += 24;
  if (hoursUntil === 0 && currentMin > 0) hoursUntil = 24;

  return hoursUntil;
}

function countdown(hoursUntil: number): string {
  if (hoursUntil === 0) return "**NOW**";
  const now = getUTC();
  const targetHour = (now.getUTCHours() + hoursUntil) % 24;
  const minsLeft = 60 - now.getUTCMinutes();
  const totalMin = hoursUntil * 60 + (hoursUntil > 0 ? minsLeft : 0);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `in **${m}m**`;
  return `in **${h}h ${m}m**`;
}

function formatHour(h: number): string {
  return `${h.toString().padStart(2, "0")}:00 UTC`;
}

function buildTimeline(): string {
  const bars: string[] = [];
  const now = getUTCHour();

  for (let h = 0; h < 24; h++) {
    const active: string[] = [];
    for (const s of getSessionTimes()) {
      if (isSessionOpen(s, h)) active.push(s.emoji);
    }
    if (active.length > 0) {
      bars.push(active.join(""));
    } else {
      bars.push("·");
    }
  }

  // Mark current hour
  bars[now] = `**[${bars[now]}]**`;

  return bars.join(" ");
}

function getSessionStatus(s: Session, hour: number): string {
  if (isSessionOpen(s, hour)) {
    const closeHour = s.close;
    const now = getUTC();
    let minLeft: number;
    if (s.open < s.close) {
      minLeft = (closeHour - now.getUTCHours()) * 60 - now.getUTCMinutes();
    } else {
      let h = closeHour - hour;
      if (h <= 0) h += 24;
      minLeft = h * 60 - now.getUTCMinutes();
    }
    if (minLeft < 0) minLeft = 0;
    const hLeft = Math.floor(minLeft / 60);
    return `🟢 **OPEN** — closes in ~${hLeft}h`;
  }
  return `⚫ Closed — opens at ${formatHour(s.open)}`;
}

export function getMarketTimesEmbed(): EmbedBuilder {
  const hour = getUTCHour();
  const now = getUTC();
  const day = DAYS[getUTCDay()];
  const timeStr = `${now.getUTCHours().toString().padStart(2, "0")}:${now.getUTCMinutes().toString().padStart(2, "0")} UTC`;

  // Find current active sessions
  const activeSessions = getSessionTimes().filter((s) => isSessionOpen(s, hour));

  // Find next session to open
  let nextSession: Session | null = null;
  let nextHours = 999;
  for (const s of getSessionTimes()) {
    const h = nextSessionOpen(s, now);
    if (h > 0 && h < nextHours) {
      nextHours = h;
      nextSession = s;
    }
  }

  const activeNames = activeSessions.map((s) => `${s.emoji} **${s.name}**`).join("  ") || "No active session";

  let nextText = "";
  if (nextSession) {
    const openTime = (hour + nextHours) % 24;
    nextText = `${nextSession.emoji} **${nextSession.name}** opens at ${formatHour(openTime)}`;
  } else {
    nextText = "All sessions currently closed";
  }

  const sessionLines = getSessionTimes().map((s) => {
    const status = getSessionStatus(s, hour);
    return `${s.emoji} **${s.name}** \`${formatHour(s.open)} → ${formatHour(s.close)}\` — ${status}`;
  }).join("\n");

  const embed = new EmbedBuilder()
    .setColor(activeSessions.length > 0 ? activeSessions[0].color : 0x607D8B)
    .setTitle(`🌍 Market Sessions — ${day} ${timeStr}`)
    .setDescription(`### Now Active\n${activeNames}\n\n### Timeline\n${buildTimeline()}\n\n### Next Session\n${nextText}`)
    .addFields(
      { name: "Sessions", value: sessionLines, inline: false },
    )
    .setFooter({ text: "Times in UTC · Updates on session change · Weekends: forex closed" })
    .setTimestamp();

  return embed;
}

export async function postMarketTimes(client: any): Promise<boolean> {
  const channelId = CONFIG.MARKET_TIMES_CHANNEL_ID;
  if (!channelId) return false;

  let channel: TextChannel | null = null;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch && ch.isTextBased()) channel = ch as TextChannel;
  } catch {
    return false;
  }
  if (!channel) return false;

  const embed = getMarketTimesEmbed();
  const hour = getUTCHour();
  const state = getSessionTimes().map((s) => `${s.name}:${isSessionOpen(s, hour)}`).join(",");

  try {
    // Edit last message if it exists, otherwise send new
    if (lastMessageId && lastState !== state) {
      try {
        const lastMsg = await channel.messages.fetch(lastMessageId);
        await lastMsg.edit({ embeds: [embed] });
        lastState = state;
        return true;
      } catch {}
    }

    if (lastState !== state) {
      const msg = await channel.send({ embeds: [embed] });
      lastMessageId = msg.id;
      lastState = state;
      return true;
    }
  } catch {}
  return false;
}

export function startMarketTimes(client: any): void {
  if (checkInterval) clearInterval(checkInterval);
  if (!CONFIG.MARKET_TIMES_CHANNEL_ID) return;

  console.log(`  Market times active — channel ${CONFIG.MARKET_TIMES_CHANNEL_ID}`);
  postMarketTimes(client);
  checkInterval = setInterval(() => postMarketTimes(client), 300_000);
}

export function stopMarketTimes(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}
