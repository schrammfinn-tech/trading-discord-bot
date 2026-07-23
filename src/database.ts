import fs from "fs";
import path from "path";
import {
  UserAccount,
  Portfolio,
  Transaction,
  PriceAlert,
  WatchlistItem,
  ServerConfig,
} from "./types";
import { CONFIG } from "./config";

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJSON<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      writeJSON(filePath, fallback);
      return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(filePath: string, data: T): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export class Database {
  private accounts: Map<string, UserAccount> = new Map();
  private portfolios: Map<string, Portfolio> = new Map();
  private transactions: Transaction[] = [];
  private alerts: PriceAlert[] = [];
  private watchlists: Map<string, WatchlistItem[]> = new Map();
  private serverConfigs: Map<string, ServerConfig> = new Map();

  constructor() {
    this.load();
  }

  private load(): void {
    const accountsArr = readJSON<UserAccount[]>(CONFIG.ACCOUNTS_FILE, []);
    this.accounts = new Map(accountsArr.map((a) => [a.userId, a]));

    const portfoliosArr = readJSON<Portfolio[]>(CONFIG.PORTFOLIOS_FILE, []);
    this.portfolios = new Map(portfoliosArr.map((p) => [p.userId, p]));

    this.transactions = readJSON<Transaction[]>(
      CONFIG.TRANSACTIONS_FILE,
      []
    );

    this.alerts = readJSON<PriceAlert[]>(CONFIG.ALERTS_FILE, []);

    const watchlistsObj = readJSON<Record<string, WatchlistItem[]>>(
      CONFIG.WATCHLISTS_FILE,
      {}
    );
    this.watchlists = new Map(Object.entries(watchlistsObj));

    const configsArr = readJSON<ServerConfig[]>(CONFIG.CONFIG_FILE, []);
    this.serverConfigs = new Map(configsArr.map((c) => [c.serverId, c]));
  }

  private save(): void {
    writeJSON(
      CONFIG.ACCOUNTS_FILE,
      Array.from(this.accounts.values())
    );
    writeJSON(
      CONFIG.PORTFOLIOS_FILE,
      Array.from(this.portfolios.values())
    );
    writeJSON(CONFIG.TRANSACTIONS_FILE, this.transactions);
    writeJSON(CONFIG.ALERTS_FILE, this.alerts);
    writeJSON(
      CONFIG.WATCHLISTS_FILE,
      Object.fromEntries(this.watchlists)
    );
    writeJSON(
      CONFIG.CONFIG_FILE,
      Array.from(this.serverConfigs.values())
    );
  }

  // Account methods
  getAccount(userId: string): UserAccount | undefined {
    return this.accounts.get(userId);
  }

  createAccount(userId: string, username: string, serverId: string): UserAccount {
    const cfg = this.getServerConfig(serverId);
    const account: UserAccount = {
      userId,
      username,
      balance: cfg.startingBalance,
      totalDeposited: cfg.startingBalance,
      totalWithdrawn: 0,
      portfolioValue: 0,
      createdAt: new Date().toISOString(),
      lastDailyReward: null,
      transactionCount: 0,
    };
    this.accounts.set(userId, account);
    this.createPortfolio(userId);
    this.save();
    return account;
  }

  updateAccount(account: UserAccount): void {
    this.accounts.set(account.userId, account);
    this.save();
  }

  getAllAccounts(): UserAccount[] {
    return Array.from(this.accounts.values());
  }

  // Portfolio methods
  getPortfolio(userId: string): Portfolio | undefined {
    return this.portfolios.get(userId);
  }

  createPortfolio(userId: string): Portfolio {
    const portfolio: Portfolio = {
      userId,
      holdings: [],
      lastUpdated: new Date().toISOString(),
    };
    this.portfolios.set(userId, portfolio);
    this.save();
    return portfolio;
  }

  updatePortfolio(portfolio: Portfolio): void {
    this.portfolios.set(portfolio.userId, portfolio);
    this.save();
  }

  // Transaction methods
  addTransaction(txn: Transaction): void {
    this.transactions.push(txn);
    if (this.transactions.length > 50000) {
      this.transactions = this.transactions.slice(-50000);
    }
    this.save();
  }

  getUserTransactions(
    userId: string,
    limit: number = 20
  ): Transaction[] {
    return this.transactions
      .filter((t) => t.userId === userId)
      .slice(-limit)
      .reverse();
  }

  getAllTransactions(limit: number = 50): Transaction[] {
    return this.transactions.slice(-limit).reverse();
  }

  // Alert methods
  addAlert(alert: PriceAlert): void {
    this.alerts.push(alert);
    this.save();
  }

  getUserAlerts(userId: string): PriceAlert[] {
    return this.alerts.filter((a) => a.userId === userId && !a.triggered);
  }

  getAllUntriggeredAlerts(): PriceAlert[] {
    return this.alerts.filter((a) => !a.triggered);
  }

  triggerAlert(alertId: string): void {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.triggered = true;
      this.save();
    }
  }

  deleteAlert(alertId: string): boolean {
    const idx = this.alerts.findIndex((a) => a.id === alertId);
    if (idx !== -1) {
      this.alerts.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  // Watchlist methods
  getWatchlist(userId: string): WatchlistItem[] {
    return this.watchlists.get(userId) || [];
  }

  addToWatchlist(userId: string, item: WatchlistItem): void {
    const list = this.watchlists.get(userId) || [];
    if (!list.some((w) => w.symbol === item.symbol && w.type === item.type)) {
      list.push(item);
      this.watchlists.set(userId, list);
      this.save();
    }
  }

  removeFromWatchlist(
    userId: string,
    symbol: string,
    type: string
  ): boolean {
    const list = this.watchlists.get(userId) || [];
    const idx = list.findIndex(
      (w) => w.symbol === symbol && w.type === type
    );
    if (idx !== -1) {
      list.splice(idx, 1);
      this.watchlists.set(userId, list);
      this.save();
      return true;
    }
    return false;
  }

  // Server config
  getServerConfig(serverId: string): ServerConfig {
    if (!this.serverConfigs.has(serverId)) {
      const cfg: ServerConfig = {
        serverId,
        startingBalance: CONFIG.STARTING_BALANCE,
        dailyRewardAmount: CONFIG.DAILY_REWARD_AMOUNT,
        dailyRewardCooldownMs: CONFIG.DAILY_REWARD_COOLDOWN_MS,
        maxPortfolioNameLength: CONFIG.MAX_PORTFOLIO_NAME_LENGTH,
        transactionFeePercent: CONFIG.TRANSACTION_FEE_PERCENT,
        adminRoles: CONFIG.ADMIN_ROLES,
        bannedSymbols: CONFIG.BANNED_SYMBOLS,
        allowedMarkets: ["stocks", "crypto", "forex", "commodities"],
      };
      this.serverConfigs.set(serverId, cfg);
      this.save();
    }
    return this.serverConfigs.get(serverId)!;
  }

  updateServerConfig(serverId: string, cfg: Partial<ServerConfig>): void {
    const current = this.getServerConfig(serverId);
    this.serverConfigs.set(serverId, { ...current, ...cfg });
    this.save();
  }

  // Sharing
  share(fromUserId: string, toUserId: string, amount: number): string {
    if (amount <= 0) return "Amount must be positive.";

    const fromAccount = this.accounts.get(fromUserId);
    if (!fromAccount) return "Your account was not found.";
    if (fromAccount.balance < amount) return "Insufficient balance.";

    const toAccount = this.accounts.get(toUserId);
    if (!toAccount) return "Recipient account not found.";

    fromAccount.balance -= amount;
    toAccount.balance += amount;

    this.updateAccount(fromAccount);
    this.updateAccount(toAccount);

    const txnId = `SHARE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.addTransaction({
      id: txnId,
      userId: fromUserId,
      symbol: "USD",
      type: "stock",
      orderType: "sell",
      quantity: amount,
      price: 1,
      total: amount,
      timestamp: new Date().toISOString(),
      balanceAfter: fromAccount.balance,
    });
    this.addTransaction({
      id: txnId + "-RECV",
      userId: toUserId,
      symbol: "USD",
      type: "stock",
      orderType: "buy",
      quantity: amount,
      price: 1,
      total: amount,
      timestamp: new Date().toISOString(),
      balanceAfter: toAccount.balance,
    });

    return `shared`;
  }

  resetAccount(userId: string, serverId: string): UserAccount {
    const cfg = this.getServerConfig(serverId);
    const account = this.accounts.get(userId);
    if (account) {
      account.balance = cfg.startingBalance;
      account.totalDeposited = cfg.startingBalance;
      account.totalWithdrawn = 0;
      account.portfolioValue = 0;
      account.transactionCount = 0;
      account.lastDailyReward = null;
      this.updateAccount(account);
    }
    const portfolio = this.portfolios.get(userId);
    if (portfolio) {
      portfolio.holdings = [];
      portfolio.lastUpdated = new Date().toISOString();
      this.updatePortfolio(portfolio);
    }
    return account!;
  }
}

export const db = new Database();
