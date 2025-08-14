import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';


export enum InfractionType {
  WARN = 'WARN',
  MUTE = 'MUTE',
  KICK = 'KICK',
  BAN = 'BAN',
  TIMEOUT = 'TIMEOUT'
}

export interface Infraction {
  id: string;
  userId: string;
  guildId: string;
  moderatorId: string;
  type: InfractionType;
  reason: string;
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
      CREATE TABLE IF NOT EXISTS user_infractions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        type TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_infractions_user_guild ON user_infractions (user_id, guild_id);
      CREATE INDEX IF NOT EXISTS idx_infractions_type ON user_infractions (type);
      CREATE INDEX IF NOT EXISTS idx_infractions_created ON user_infractions (created_at);
    `);

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
  }


  private generateInfractionId(): string {
    // Generate a random 8-character alphanumeric ID
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private isInfractionIdUnique(id: string): boolean {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM user_infractions WHERE id = ?');
    const result = stmt.get(id) as any;
    return result.count === 0;
  }

  private getUniqueInfractionId(): string {
    let id: string;
    do {
      id = this.generateInfractionId();
    } while (!this.isInfractionIdUnique(id));
    return id;
  }

  addInfraction(userId: string, guildId: string, moderatorId: string, type: InfractionType, reason: string): string {
    const id = this.getUniqueInfractionId();
    const stmt = this.db.prepare(`
      INSERT INTO user_infractions (id, user_id, guild_id, moderator_id, type, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, userId, guildId, moderatorId, type, reason);
    return id;
  }

  // Convenience method for backwards compatibility
  addWarning(userId: string, guildId: string, moderatorId: string, reason: string): string {
    return this.addInfraction(userId, guildId, moderatorId, InfractionType.WARN, reason);
  }

  getUserInfractions(userId: string, guildId: string, type?: InfractionType): Infraction[] {
    let query = `
      SELECT * FROM user_infractions 
      WHERE user_id = ? AND guild_id = ?
    `;
    const params: any[] = [userId, guildId];
    
    if (type) {
      query += ` AND type = ?`;
      params.push(type);
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const stmt = this.db.prepare(query);
    const results = stmt.all(...params) as any[];
    
    return results.map(row => ({
      id: row.id,
      userId: row.user_id,
      guildId: row.guild_id,
      moderatorId: row.moderator_id,
      type: row.type as InfractionType,
      reason: row.reason,
      createdAt: new Date(row.created_at)
    }));
  }

  getInfractionCount(userId: string, guildId: string, type?: InfractionType): number {
    let query = 'SELECT COUNT(*) as count FROM user_infractions WHERE user_id = ? AND guild_id = ?';
    const params: any[] = [userId, guildId];
    
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    
    const stmt = this.db.prepare(query);
    const result = stmt.get(...params) as any;
    return result.count;
  }

  getInfractionById(id: string): Infraction | null {
    const stmt = this.db.prepare('SELECT * FROM user_infractions WHERE id = ?');
    const result = stmt.get(id) as any;
    
    if (!result) return null;
    
    return {
      id: result.id,
      userId: result.user_id,
      guildId: result.guild_id,
      moderatorId: result.moderator_id,
      type: result.type as InfractionType,
      reason: result.reason,
      createdAt: new Date(result.created_at)
    };
  }




  close(): void {
    this.db.close();
  }

  backup(backupPath: string): void {
    this.db.backup(backupPath);
  }

  getStats(): { infractions: number; warns: number; mutes: number; kicks: number; bans: number; timeouts: number } {
    const totalInfractions = this.db.prepare('SELECT COUNT(*) as count FROM user_infractions').get() as any;
    const warns = this.db.prepare('SELECT COUNT(*) as count FROM user_infractions WHERE type = ?').get('WARN') as any;
    const mutes = this.db.prepare('SELECT COUNT(*) as count FROM user_infractions WHERE type = ?').get('MUTE') as any;
    const kicks = this.db.prepare('SELECT COUNT(*) as count FROM user_infractions WHERE type = ?').get('KICK') as any;
    const bans = this.db.prepare('SELECT COUNT(*) as count FROM user_infractions WHERE type = ?').get('BAN') as any;
    const timeouts = this.db.prepare('SELECT COUNT(*) as count FROM user_infractions WHERE type = ?').get('TIMEOUT') as any;
    
    return {
      infractions: totalInfractions.count,
      warns: warns.count,
      mutes: mutes.count,
      kicks: kicks.count,
      bans: bans.count,
      timeouts: timeouts.count
    };
  }
}

export const database = new DatabaseManager();
export default database;