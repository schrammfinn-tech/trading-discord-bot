export interface UserAccount {
  userId: string;
  username: string;
  balance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  portfolioValue: number;
  createdAt: string;
  lastDailyReward: string | null;
  transactionCount: number;
}

export interface Holding {
  symbol: string;
  type: AssetType;
  quantity: number;
  averageBuyPrice: number;
  totalSpent: number;
}

export interface Portfolio {
  userId: string;
  holdings: Holding[];
  lastUpdated: string;
}

export interface Transaction {
  id: string;
  userId: string;
  symbol: string;
  type: AssetType;
  orderType: "buy" | "sell";
  quantity: number;
  price: number;
  total: number;
  timestamp: string;
  balanceAfter: number;
}

export interface PriceAlert {
  id: string;
  userId: string;
  symbol: string;
  type: AssetType;
  targetPrice: number;
  direction: "above" | "below";
  triggered: boolean;
  createdAt: string;
}

export interface WatchlistItem {
  symbol: string;
  type: AssetType;
  addedAt: string;
}

export interface ServerConfig {
  serverId: string;
  startingBalance: number;
  dailyRewardAmount: number;
  dailyRewardCooldownMs: number;
  maxPortfolioNameLength: number;
  transactionFeePercent: number;
  adminRoles: string[];
  bannedSymbols: string[];
  allowedMarkets: MarketType[];
}

export type AssetType = "stock" | "crypto" | "forex" | "commodity";
export type MarketType = "stocks" | "crypto" | "forex" | "commodities";

export interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  type: AssetType;
  currency: string;
  lastUpdated: string;
}

export interface Candlestick {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketNews {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary?: string;
  relatedSymbols?: string[];
}

export type CommandCategory = "trading" | "market" | "portfolio" | "admin" | "utility";
