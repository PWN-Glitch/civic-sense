import * as SQLite from 'expo-sqlite';
import type { Category } from '../types';

/**
 * Offline report drafts.
 *
 * When a report can't reach the server (airplane mode, dead zone), it is
 * stored in a local SQLite table and replayed by lib/offline.ts once
 * connectivity returns. Drafts are the user's data until successfully
 * submitted; they are never silently dropped: a failed sync keeps the row.
 */

export interface Draft {
  id: number;
  photo_uri: string | null;
  category: Category;
  description: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  severity: string | null;
  created_at: string; // ISO-8601
  synced: 0 | 1;
  /** Idempotency key sent with POST /reports, so a replay never files twice. */
  client_ref: string | null;
  /** Set once the server has the report; retries then only attach the photo. */
  report_id: string | null;
  /** Set once the photo is uploaded; retries reuse it instead of re-uploading. */
  photo_id: string | null;
}

export type DraftProgress = Partial<Pick<Draft, 'client_ref' | 'report_id' | 'photo_id'>>;

export interface NewDraft {
  photo_uri?: string | null;
  category: Category;
  description: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  severity?: string | null;
  client_ref?: string | null;
  photo_id?: string | null;
  report_id?: string | null;
}

const PROGRESS_COLUMNS = ['client_ref', 'report_id', 'photo_id'] as const;

const DB_NAME = 'civicsense.db';

type DraftsDb = Pick<
  SQLite.SQLiteDatabase,
  'execSync' | 'runSync' | 'getAllSync' | 'getFirstSync'
>;

let db: DraftsDb | null = null;

function getDb(): DraftsDb {
  if (!db) {
    const handle = SQLite.openDatabaseSync(DB_NAME);
    handle.execSync(
      `CREATE TABLE IF NOT EXISTS drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        photo_uri TEXT,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        accuracy REAL,
        severity TEXT,
        created_at TEXT NOT NULL,
        synced INTEGER NOT NULL DEFAULT 0,
        client_ref TEXT,
        report_id TEXT,
        photo_id TEXT
      );`,
    );
    // Tables created by older builds lack the progress columns.
    const have = new Set(
      handle.getAllSync<{ name: string }>('PRAGMA table_info(drafts)').map((c) => c.name),
    );
    for (const column of PROGRESS_COLUMNS) {
      if (!have.has(column)) handle.execSync(`ALTER TABLE drafts ADD COLUMN ${column} TEXT`);
    }
    db = handle;
  }
  return db;
}

/** Persist a report locally. Returns the new draft id. */
export async function saveDraft(draft: NewDraft): Promise<number> {
  const result = getDb().runSync(
    `INSERT INTO drafts
      (photo_uri, category, description, lat, lng, accuracy, severity, created_at, synced,
       client_ref, photo_id, report_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    draft.photo_uri ?? null,
    draft.category,
    draft.description,
    draft.lat,
    draft.lng,
    draft.accuracy ?? null,
    draft.severity ?? null,
    new Date().toISOString(),
    draft.client_ref ?? null,
    draft.photo_id ?? null,
    draft.report_id ?? null,
  );
  return result.lastInsertRowId;
}

/** Record how far a sync got, so the next attempt resumes instead of repeating. */
export async function saveProgress(id: number, progress: DraftProgress): Promise<void> {
  getDb().runSync(
    `UPDATE drafts SET client_ref = COALESCE(?, client_ref),
       report_id = COALESCE(?, report_id), photo_id = COALESCE(?, photo_id)
     WHERE id = ?`,
    progress.client_ref ?? null,
    progress.report_id ?? null,
    progress.photo_id ?? null,
    id,
  );
}

/** All drafts that still need to be submitted, oldest first. */
export async function listDrafts(): Promise<Draft[]> {
  return getDb().getAllSync<Draft>(
    'SELECT * FROM drafts WHERE synced = 0 ORDER BY created_at ASC',
  );
}

export async function draftCount(): Promise<number> {
  const row = getDb().getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM drafts WHERE synced = 0',
  );
  return row?.n ?? 0;
}

/** Mark a draft as successfully submitted (kept for audit, hidden by queries). */
export async function markSynced(id: number): Promise<void> {
  getDb().runSync('UPDATE drafts SET synced = 1 WHERE id = ?', id);
}

/** Remove a draft entirely (after successful sync, or user discard). */
export async function deleteDraft(id: number): Promise<void> {
  getDb().runSync('DELETE FROM drafts WHERE id = ?', id);
}

/** Test/dev hook: drop the in-memory handle so the next call re-opens. */
export function resetDraftsForTesting(): void {
  db = null;
}
