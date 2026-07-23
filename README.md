# Trading Discord Bot

A full-featured paper trading Discord bot with real-time market data across stocks, crypto, forex, and commodities.

## Features

- **Paper Trading** — Buy and sell with virtual currency ($10,000 starting balance)
- **Real-time Prices** — Stock, crypto, forex, and commodity price quotes
- **Portfolio Tracking** — Track your holdings, P/L, and transaction history
- **Leaderboard** — Compete with other server members
- **Watchlists** — Track your favorite assets
- **Price Alerts** — Get notified when prices hit your targets
- **Daily Rewards** — Earn daily virtual cash with streak bonuses
- **Money Sharing** — Send cash to other traders

## Quick Start

### 1. Create a Discord Bot

1. Go to https://discord.com/developers/applications
2. Create a New Application
3. Go to the Bot tab and click "Add Bot"
4. Under Privileged Gateway Intents, enable:
   - Message Content Intent
   - Server Members Intent
5. Copy the bot token
6. Go to OAuth2 > URL Generator, select `bot` scope and `Send Messages`, `Read Message History`, `Add Reactions` permissions
7. Use the generated URL to invite the bot to your server

### 2. Configure

```bash
# Copy the example env file
copy .env.example .env
# (on macOS/Linux: cp .env.example .env)
```

Edit `.env` and paste your bot token:

```
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id
```

### 3. Run & Setup

```bash
npm install
npm run dev
```

Once the bot is online, type `!setup` in any channel to automatically create:

- **6 categories** — MARKETS, TRADING, LEARNING, COMMUNITY, SERVER, VOICE
- **26 channels** — trading-floor, live-prices, market-news, portfolio-showcase, and more
- **6 roles** — @Trader, @Whale, @Day Trader, @Analyst, @Moderator, @Admin
- **Rules & command reference** — auto-posted

## Commands

### Trading
| Command | Description |
|---------|-------------|
| `!buy <symbol> <qty>` | Buy shares/coins |
| `!sell <symbol> <qty>` | Sell shares/coins |
| `!sell <symbol> all` | Sell entire position |
| `!share @user <amount>` | Send cash to another user |

### Market Data
| Command | Description |
|---------|-------------|
| `!price <symbol>` | Get current price and stats |
| `!p <symbol>` | Shortcut for price |
| `!<symbol>` | Quick price lookup |
| `!markets` | List supported assets |

### Portfolio
| Command | Description |
|---------|-------------|
| `!portfolio` / `!pf` | View all holdings |
| `!balance` / `!bal` | Check cash and net worth |
| `!transactions` / `!tx` | Recent trade history |

### Social & Utility
| Command | Description |
|---------|-------------|
| `!leaderboard` / `!lb` | Top traders ranking |
| `!daily` | Claim daily reward |
| `!watchlist add <symbol>` | Add to watchlist |
| `!watchlist` | View watchlist |
| `!watchlist remove <symbol>` | Remove from watchlist |
| `!alert <symbol> <price>` | Set price alert |
| `!alert` | View active alerts |
| `!alert cancel <symbol>` | Cancel alert |
| `!resetme` | Reset your account |
| `!help` | Show all commands |

## Supported Assets

- **Stocks:** Thousands of US stocks (AAPL, TSLA, MSFT, GOOGL, AMZN, NVDA, etc.)
- **Crypto:** Bitcoin, Ethereum, Solana, +20 more via CoinGecko
- **Forex:** EUR/USD, GBP/USD, USD/JPY, +7 more major pairs
- **Commodities:** Gold, Silver, Oil, Natural Gas, Copper, Platinum, + agricultural futures

## Data Storage

All data is stored in JSON files under the `data/` directory:
- `accounts.json` — User balances and stats
- `portfolios.json` — User holdings
- `transactions.json` — Trade history
- `alerts.json` — Active price alerts
- `watchlists.json` — User watchlists
- `server_config.json` — Per-server settings

## Market Data Sources

- **Stocks, Forex, Commodities:** Yahoo Finance (yahoo-finance2)
- **Cryptocurrency:** CoinGecko free API
