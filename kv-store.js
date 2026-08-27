const Database = require('better-sqlite3');
const db = new Database('./data.db');

class KVStore {
  constructor() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT,
        expiration INTEGER
      )
    `);
    db.exec(`DELETE FROM kv WHERE expiration IS NOT NULL AND expiration < ${Date.now()}`);
  }

  async get(key) {
    const stmt = db.prepare(`SELECT value FROM kv WHERE key = ? AND (expiration IS NULL OR expiration > ?)`);
    const row = stmt.get(key, Date.now());
    return row ? row.value : null;
  }

  async put(key, value, options = {}) {
    const expiration = options.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null;
    const stmt = db.prepare(`INSERT OR REPLACE INTO kv (key, value, expiration) VALUES (?, ?, ?)`);
    stmt.run(key, value, expiration);
  }

  async delete(key) {
    const stmt = db.prepare(`DELETE FROM kv WHERE key = ?`);
    stmt.run(key);
  }
}

module.exports = KVStore;