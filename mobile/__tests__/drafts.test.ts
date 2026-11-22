import {
  draftCount,
  deleteDraft,
  listDrafts,
  markSynced,
  resetDraftsForTesting,
  saveDraft,
  saveProgress,
  type Draft,
} from '../src/lib/drafts';
import * as SQLite from 'expo-sqlite';

// Columns the fake table reports; a test drops some to mimic an older install.
let mockColumns: string[] = [];

// Replace the global expo-sqlite stub with an in-memory fake that actually
// implements the drafts table so the real query paths run in Jest.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => {
    let rows: Array<Record<string, unknown>> = [];
    let nextId = 1;
    return {
      execSync: jest.fn((sql: string) => {
        const added = /^ALTER TABLE drafts ADD COLUMN (\w+)/.exec(sql);
        if (added) mockColumns.push(added[1]);
      }),
      runSync: jest.fn((sql: string, ...params: unknown[]) => {
        if (sql.startsWith('INSERT INTO drafts')) {
          const [
            photo_uri,
            category,
            description,
            lat,
            lng,
            accuracy,
            severity,
            created_at,
            client_ref,
            photo_id,
            report_id,
          ] = params;
          const id = nextId++;
          rows.push({
            id,
            photo_uri,
            category,
            description,
            lat,
            lng,
            accuracy,
            severity,
            created_at,
            synced: 0,
            client_ref,
            report_id: report_id ?? null,
            photo_id: photo_id ?? null,
          });
          return { lastInsertRowId: id, changes: 1 };
        }
        if (sql.startsWith('UPDATE drafts SET synced')) {
          const id = params[0] as number;
          rows = rows.map((r) => (r.id === id ? { ...r, synced: 1 } : r));
          return { lastInsertRowId: 0, changes: 1 };
        }
        if (sql.startsWith('UPDATE drafts SET client_ref')) {
          const [client_ref, report_id, photo_id, id] = params;
          rows = rows.map((r) =>
            r.id === id
              ? {
                  ...r,
                  client_ref: client_ref ?? r.client_ref,
                  report_id: report_id ?? r.report_id,
                  photo_id: photo_id ?? r.photo_id,
                }
              : r,
          );
          return { lastInsertRowId: 0, changes: 1 };
        }
        if (sql.startsWith('DELETE FROM drafts')) {
          const id = params[0] as number;
          rows = rows.filter((r) => r.id !== id);
          return { lastInsertRowId: 0, changes: 1 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      getAllSync: jest.fn((sql: string) => {
        if (sql.startsWith('PRAGMA')) return mockColumns.map((name) => ({ name }));
        const unsent = rows.filter((r) => r.synced === 0);
        return unsent.sort((a, b) =>
          String(a.created_at).localeCompare(String(b.created_at)),
        );
      }),
      getFirstSync: jest.fn(() => ({
        n: rows.filter((r) => r.synced === 0).length,
      })),
    };
  }),
}));

const baseDraft = {
  category: 'pothole' as const,
  description: 'Deep pothole',
  lat: 39.2904,
  lng: -76.6122,
};

const ALL_COLUMNS = [
  'id', 'photo_uri', 'category', 'description', 'lat', 'lng', 'accuracy',
  'severity', 'created_at', 'synced', 'client_ref', 'report_id', 'photo_id',
];

beforeEach(() => {
  mockColumns = [...ALL_COLUMNS];
  resetDraftsForTesting();
  jest.clearAllMocks();
});

describe('drafts store', () => {
  it('saves a draft and lists it as unsent', async () => {
    const id = await saveDraft({
      ...baseDraft,
      photo_uri: 'file:///photo.jpg',
      accuracy: 12,
      severity: 'moderate',
    });
    expect(id).toBeGreaterThan(0);

    const drafts = await listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      photo_uri: 'file:///photo.jpg',
      category: 'pothole',
      lat: 39.2904,
      synced: 0,
    });
    expect(await draftCount()).toBe(1);
  });

  it('defaults optional fields to null', async () => {
    await saveDraft(baseDraft);
    const [draft] = await listDrafts();
    expect(draft.photo_uri).toBeNull();
    expect(draft.accuracy).toBeNull();
    expect(draft.severity).toBeNull();
    expect(typeof draft.created_at).toBe('string');
  });

  it('lists multiple drafts oldest first', async () => {
    const first = await saveDraft(baseDraft);
    const second = await saveDraft({ ...baseDraft, category: 'trash' });
    const drafts = await listDrafts();
    expect(drafts.map((d: Draft) => d.id)).toEqual([first, second]);
  });

  it('markSynced hides a draft from the unsent list and count', async () => {
    const id = await saveDraft(baseDraft);
    await markSynced(id);
    expect(await listDrafts()).toHaveLength(0);
    expect(await draftCount()).toBe(0);
  });

  it('deleteDraft removes a draft entirely', async () => {
    const id = await saveDraft(baseDraft);
    await deleteDraft(id);
    expect(await listDrafts()).toHaveLength(0);
    expect(await draftCount()).toBe(0);
  });

  it('keeps an already uploaded photo and filed report given at save time', async () => {
    await saveDraft({ ...baseDraft, client_ref: 'ref-2', photo_id: 'ph-2', report_id: 'r-2' });
    const [draft] = await listDrafts();
    expect(draft).toMatchObject({ photo_id: 'ph-2', report_id: 'r-2' });
  });

  it('stores the client_ref and records sync progress without losing earlier steps', async () => {
    const id = await saveDraft({ ...baseDraft, client_ref: 'ref-1' });
    await saveProgress(id, { photo_id: 'ph-1' });
    await saveProgress(id, { report_id: 'r-1' });
    const [draft] = await listDrafts();
    expect(draft).toMatchObject({ client_ref: 'ref-1', photo_id: 'ph-1', report_id: 'r-1' });
  });

  it('adds the progress columns to a table made by an older build', async () => {
    mockColumns = ALL_COLUMNS.filter(
      (c) => !['client_ref', 'report_id', 'photo_id'].includes(c),
    );
    await listDrafts();
    const handle = (SQLite.openDatabaseSync as jest.Mock).mock.results.at(-1)!.value;
    const alters = handle.execSync.mock.calls
      .map((c: string[]) => c[0])
      .filter((sql: string) => sql.startsWith('ALTER'));
    expect(alters).toEqual([
      'ALTER TABLE drafts ADD COLUMN client_ref TEXT',
      'ALTER TABLE drafts ADD COLUMN report_id TEXT',
      'ALTER TABLE drafts ADD COLUMN photo_id TEXT',
    ]);
  });
});
