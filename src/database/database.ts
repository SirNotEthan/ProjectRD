import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export interface GuildSettings {
  guildId: string;
  prefix?: string;
  modLogChannel?: string;
  muteRole?: string;
  autoModEnabled?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWarning {
  id: number;
  userId: string;
  guildId: string;
  moderatorId: string;
  reason: string;
  createdAt: Date;
}

export interface UserNickname {
  userId: string;
  guildId: string;
  nickname: string;
  setBy: string;
  createdAt: Date;
}

class DatabaseManager {
  private db: Database.Database;
  private readonly dbPath: string;

  constructor() {
    const dataDir = join(process.cwd(), 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    
    this.dbPath = join(dataDir, 'bot.db');
    this.db = new Database(this.dbPath);
    this.initializeTables();
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        prefix TEXT DEFAULT '!',
        mod_log_channel TEXT,
        mute_role TEXT,
        auto_mod_enabled BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (guild_id) REFERENCES guild_settings (guild_id)
      );

      CREATE TABLE IF NOT EXISTS user_nicknames (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        nickname TEXT NOT NULL,
        set_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, guild_id),
        FOREIGN KEY (guild_id) REFERENCES guild_settings (guild_id)
      );

      CREATE INDEX IF NOT EXISTS idx_warnings_user_guild ON user_warnings (user_id, guild_id);
      CREATE INDEX IF NOT EXISTS idx_warnings_created ON user_warnings (created_at);
      CREATE INDEX IF NOT EXISTS idx_nicknames_guild ON user_nicknames (guild_id);
    `);

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
  }

  getGuildSettings(guildId: string): GuildSettings | null {
    const stmt = this.db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?');
    const result = stmt.get(guildId) as any;
    
    if (!result) return null;
    
    return {
      guildId: result.guild_id,
      prefix: result.prefix,
      modLogChannel: result.mod_log_channel,
      muteRole: result.mute_role,
      autoModEnabled: Boolean(result.auto_mod_enabled),
      createdAt: new Date(result.created_at),
      updatedAt: new Date(result.updated_at)
    };
  }

  createOrUpdateGuildSettings(guildId: string, settings: Partial<GuildSettings>): void {
    const stmt = this.db.prepare(`
      INSERT INTO guild_settings (guild_id, prefix, mod_log_channel, mute_role, auto_mod_enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(guild_id) DO UPDATE SET
        prefix = COALESCE(?, prefix),
        mod_log_channel = COALESCE(?, mod_log_channel),
        mute_role = COALESCE(?, mute_role),
        auto_mod_enabled = COALESCE(?, auto_mod_enabled),
        updated_at = CURRENT_TIMESTAMP
    `);
    
    stmt.run(
      guildId,
      settings.prefix || null,
      settings.modLogChannel || null,
      settings.muteRole || null,
      settings.autoModEnabled ? 1 : 0,
      settings.prefix || null,
      settings.modLogChannel || null,
      settings.muteRole || null,
      settings.autoModEnabled !== undefined ? (settings.autoModEnabled ? 1 : 0) : null
    );
  }

  addWarning(userId: string, guildId: string, moderatorId: string, reason: string): number {
    this.createOrUpdateGuildSettings(guildId, {});
    
    const stmt = this.db.prepare(`
      INSERT INTO user_warnings (user_id, guild_id, moderator_id, reason)
      VALUES (?, ?, ?, ?)
    `);
    
    const result = stmt.run(userId, guildId, moderatorId, reason);
    return result.lastInsertRowid as number;
  }

  getUserWarnings(userId: string, guildId: string): UserWarning[] {
    const stmt = this.db.prepare(`
      SELECT * FROM user_warnings 
      WHERE user_id = ? AND guild_id = ? 
      ORDER BY created_at DESC
    `);
    
    const results = stmt.all(userId, guildId) as any[];
    
    return results.map(row => ({
      id: row.id,
      userId: row.user_id,
      guildId: row.guild_id,
      moderatorId: row.moderator_id,
      reason: row.reason,
      createdAt: new Date(row.created_at)
    }));
  }

  getWarningCount(userId: string, guildId: string): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM user_warnings WHERE user_id = ? AND guild_id = ?');
    const result = stmt.get(userId, guildId) as any;
    return result.count;
  }

  setUserNickname(userId: string, guildId: string, nickname: string, setBy: string): void {
    this.createOrUpdateGuildSettings(guildId, {});
    
    const stmt = this.db.prepare(`
      INSERT INTO user_nicknames (user_id, guild_id, nickname, set_by, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, guild_id) DO UPDATE SET
        nickname = ?,
        set_by = ?,
        created_at = CURRENT_TIMESTAMP
    `);
    
    stmt.run(userId, guildId, nickname, setBy, nickname, setBy);
  }

  getUserNickname(userId: string, guildId: string): UserNickname | null {
    const stmt = this.db.prepare('SELECT * FROM user_nicknames WHERE user_id = ? AND guild_id = ?');
    const result = stmt.get(userId, guildId) as any;
    
    if (!result) return null;
    
    return {
      userId: result.user_id,
      guildId: result.guild_id,
      nickname: result.nickname,
      setBy: result.set_by,
      createdAt: new Date(result.created_at)
    };
  }

  removeUserNickname(userId: string, guildId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM user_nicknames WHERE user_id = ? AND guild_id = ?');
    const result = stmt.run(userId, guildId);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }

  backup(backupPath: string): void {
    this.db.backup(backupPath);
  }

  getStats(): { guilds: number; warnings: number; nicknames: number } {
    const guilds = this.db.prepare('SELECT COUNT(*) as count FROM guild_settings').get() as any;
    const warnings = this.db.prepare('SELECT COUNT(*) as count FROM user_warnings').get() as any;
    const nicknames = this.db.prepare('SELECT COUNT(*) as count FROM user_nicknames').get() as any;
    
    return {
      guilds: guilds.count,
      warnings: warnings.count,
      nicknames: nicknames.count
    };
  }
}

export const database = new DatabaseManager();
export default database;