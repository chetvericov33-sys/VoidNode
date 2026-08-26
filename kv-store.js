const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class KVStore {
  constructor(dbPath = './data.db') {
    this.db = new sqlite3.Database(dbPath);
    this.init();
  }

  init() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT,
        expiration INTEGER
      )
    `);
    // Удаляем просроченные записи при старте
    this.db.run(`DELETE FROM kv WHERE expiration IS NOT NULL AND expiration < ?`, Date.now());
  }

  async get(key) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT value FROM kv WHERE key = ? AND (expiration IS NULL OR expiration > ?)`,
        [key, Date.now()],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.value : null);
        }
      );
    });
  }

  async put(key, value, options = {}) {
    const expiration = options.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null;
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO kv (key, value, expiration) VALUES (?, ?, ?)`,
        [key, value, expiration],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async delete(key) {
    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM kv WHERE key = ?`, [key], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

module.exports = KVStore;