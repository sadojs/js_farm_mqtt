'use strict';

const fs = require('fs');
const path = require('path');

let Database = null;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.warn('[EVENT-QUEUE] better-sqlite3 not available — using in-memory fallback');
}

/**
 * 폴백 이벤트 SQLite 큐 (WAL 모드).
 * better-sqlite3 미설치 시 in-memory 폴백 (테스트/개발용).
 *
 * SD 카드 마모 방지를 위한 메모리 버퍼링:
 *  - enqueue() 호출 시 즉시 디스크 쓰기 하지 않고 pending 버퍼에 적재
 *  - FALLBACK_EVENT_BUFFER_MS (기본 30초) 또는 FALLBACK_EVENT_BUFFER_MAX (기본 30개) 도달 시 1회 flush
 *  - shutdown 시 강제 flush
 *
 * - enqueue({eventType, payload, occurredAt})
 * - drain(limit) → [{id, eventType, payload, occurredAt}, ...]
 * - markFlushed([id, ...]) : 서버 전송 성공한 행 삭제
 * - flushPending() : 메모리 버퍼 → SQLite 강제 쓰기
 */

const MAX_BUFFER_MEMORY = 2000;
const DEFAULT_BUFFER_MS = parseInt(process.env.FALLBACK_EVENT_BUFFER_MS || '30000', 10);
const DEFAULT_BUFFER_MAX = parseInt(process.env.FALLBACK_EVENT_BUFFER_MAX || '30', 10);

class EventQueue {
  constructor({ dbPath, bufferMs = DEFAULT_BUFFER_MS, bufferMax = DEFAULT_BUFFER_MAX }) {
    this.dbPath = dbPath;
    this.db = null;
    this.memory = [];
    this.memoryNextId = 1;
    // 디스크 쓰기 대기 버퍼 (SQLite 사용 시에만 활용)
    this.pending = [];
    this.bufferMs = bufferMs;
    this.bufferMax = bufferMax;
    this.flushTimer = null;
  }

  init() {
    if (!Database) {
      console.log('[EVENT-QUEUE] in-memory mode');
      return;
    }
    try {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      console.log(`[EVENT-QUEUE] SQLite 초기화: ${this.dbPath}`);
    } catch (err) {
      console.error(`[EVENT-QUEUE] SQLite 초기화 실패 — in-memory 모드: ${err.message}`);
      this.db = null;
    }
  }

  enqueue({ eventType, payload, occurredAt }) {
    if (this.db) {
      // SQLite 모드: pending 버퍼에 적재 후 임계값 도달 시 batch insert
      this.pending.push({ eventType, payload, occurredAt });
      if (this.pending.length >= this.bufferMax) {
        this.flushPending();
        return;
      }
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flushPending(), this.bufferMs);
      }
      return;
    }
    // in-memory fallback
    if (this.memory.length >= MAX_BUFFER_MEMORY) {
      this.memory.shift();
    }
    this.memory.push({
      id: this.memoryNextId++,
      eventType,
      payload,
      occurredAt,
    });
  }

  /** pending 버퍼를 SQLite에 1회 batch INSERT */
  flushPending() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.db || this.pending.length === 0) return;
    try {
      const insert = this.db.prepare(`
        INSERT INTO events (event_type, payload, occurred_at)
        VALUES (?, ?, ?)
      `);
      const txn = this.db.transaction((rows) => {
        for (const r of rows) {
          insert.run(r.eventType, JSON.stringify(r.payload || {}), r.occurredAt);
        }
      });
      txn(this.pending);
      this.pending = [];
    } catch (err) {
      console.error(`[EVENT-QUEUE] flushPending 실패: ${err.message}`);
    }
  }

  /** Graceful shutdown용 */
  close() {
    this.flushPending();
    if (this.db) {
      try { this.db.close(); } catch {}
    }
  }

  drain(limit = 100) {
    if (this.db) {
      // flush 전 pending이 있으면 먼저 비움 (drain 결과에 포함시키기 위함)
      if (this.pending.length > 0) this.flushPending();
      try {
        const rows = this.db.prepare(`
          SELECT id, event_type, payload, occurred_at
          FROM events
          ORDER BY id ASC
          LIMIT ?
        `).all(limit);
        return rows.map((r) => ({
          id: r.id,
          eventType: r.event_type,
          payload: safeParse(r.payload),
          occurredAt: r.occurred_at,
        }));
      } catch (err) {
        console.error(`[EVENT-QUEUE] drain 실패: ${err.message}`);
        return [];
      }
    }
    return this.memory.slice(0, limit);
  }

  markFlushed(ids) {
    if (!ids?.length) return;
    if (this.db) {
      const placeholders = ids.map(() => '?').join(',');
      try {
        this.db.prepare(`DELETE FROM events WHERE id IN (${placeholders})`).run(...ids);
      } catch (err) {
        console.error(`[EVENT-QUEUE] markFlushed 실패: ${err.message}`);
      }
      return;
    }
    this.memory = this.memory.filter((e) => !ids.includes(e.id));
  }
}

function safeParse(s) {
  try { return JSON.parse(s); }
  catch { return {}; }
}

module.exports = EventQueue;
