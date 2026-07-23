import { Client, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
import { CONFIG } from "./config";
import { handleSlashCommand, handlePrefixCommand, commands, handleMemberJoin } from "./commands";
import { db } from "./database";
import { startNewsPolling } from "./services/news";
import { startXAUUSDPolling } from "./services/xauusd";
import { startMarketTimes } from "./services/sessions";
import { startMoversPolling } from "./services/movers";

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.on("ready", async () => {
  console.log(`\n  Logged in as ${client.user?.tag}`);
  console.log(`  Serving ${client.guilds.cache.size} guild(s)\n`);

  client.user?.setPresence({
    activities: [{ name: "markets | /help", type: 3 }],
    status: "online",
  });

  try {
    const rest = new REST({ version: "10" }).setToken(CONFIG.DISCORD_TOKEN);
    const body = commands.map((c) => c.toJSON());

    const guilds = client.guilds.cache;
    if (guilds.size > 0) {
      console.log(`  Registering slash commands in ${guilds.size} guild(s)...`);
      for (const [guildId, guild] of guilds) {
        await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID || client.user!.id, guildId), { body });
        console.log(`    ✓ ${guild.name}`);
      }
      console.log("  Slash commands registered.\n");
    } else {
      console.log("  No guilds joined yet — slash commands will register on join.\n");
    }
  } catch (error) {
    console.error("  Failed to register slash commands:", error);
  }

  startNewsPolling(client);
  startXAUUSDPolling(client);
  startMarketTimes(client);
  startMoversPolling(client);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    console.log(`  /${interaction.commandName} from ${interaction.user.username}`);
    await handleSlashCommand(interaction);
  } else if (interaction.isButton()) {
    console.log(`  [Button] ${interaction.customId}`);
    if (interaction.customId.startsWith("reset-y-")) {
      const userId = interaction.customId.split("-").pop()!;
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: "This is not your reset prompt.", ephemeral: true });
        return;
      }
      db.resetAccount(userId, interaction.guildId ?? "dm");
      await interaction.update({
        content: "✅ Account reset. Starting balance: **$10,000**.",
        components: [],
      });
    } else if (interaction.customId.startsWith("reset-n-")) {
      const userId = interaction.customId.split("-").pop()!;
      if (interaction.user.id !== userId) return;
      await interaction.update({
        content: "Reset cancelled.",
        components: [],
      });
    }
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!")) return;

  try {
    await handlePrefixCommand(message);
  } catch (error) {
    console.error("Prefix command error:", error);
    try {
      await message.reply({
        content: "An error occurred.",
        allowedMentions: { repliedUser: false },
      });
    } catch {}
  }
});

client.on("guildMemberAdd", async (member) => {
  await handleMemberJoin(member);
});

client.on("guildCreate", async (guild) => {
  console.log(`  Joined guild: ${guild.name}`);
  try {
    const rest = new REST({ version: "10" }).setToken(CONFIG.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(CONFIG.CLIENT_ID || client.user!.id, guild.id),
      { body: commands.map((c) => c.toJSON()) }
    );
    console.log(`  Slash commands registered for ${guild.name}`);
  } catch (e) {
    console.error(`  Failed to register commands for ${guild.name}`);
  }
});

client.on("error", (error) => {
  console.error("Client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

if (!CONFIG.DISCORD_TOKEN) {
  console.error("ERROR: DISCORD_TOKEN is not set. Create a .env file with your bot token.");
  process.exit(1);
}

client.login(CONFIG.DISCORD_TOKEN);
