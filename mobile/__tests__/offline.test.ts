import NetInfo from '@react-native-community/netinfo';
import { api } from '../src/api/client';
import {
  isCurrentlyOffline,
  isOfflineError,
  queueDraft,
  startOfflineSync,
  syncDrafts,
  useDraftStore,
} from '../src/lib/offline';
import * as drafts from '../src/lib/drafts';

// Draft storage is mocked at the module boundary; the drafts module itself
// is covered by __tests__/drafts.test.ts against an in-memory SQLite fake.
jest.mock('../src/lib/drafts', () => ({
  saveDraft: jest.fn(async () => 42),
  listDrafts: jest.fn(async () => []),
  draftCount: jest.fn(async () => 0),
  markSynced: jest.fn(async () => undefined),
  deleteDraft: jest.fn(async () => undefined),
  saveProgress: jest.fn(async () => undefined),
  resetDraftsForTesting: jest.fn(),
}));

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-new') }));

jest.mock('../src/api/client', () => {
  const actual = jest.requireActual('../src/api/client');
  return {
    ...actual,
    api: {
      post: jest.fn(),
      get: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    },
  };
});

const postMock = api.post as jest.Mock;
const fetchMock = NetInfo.fetch as jest.Mock;
const addEventListenerMock = NetInfo.addEventListener as jest.Mock;
const listDraftsMock = drafts.listDrafts as jest.Mock;
const markSyncedMock = drafts.markSynced as jest.Mock;
const deleteDraftMock = drafts.deleteDraft as jest.Mock;
const draftCountMock = drafts.draftCount as jest.Mock;
const saveDraftMock = drafts.saveDraft as jest.Mock;
const saveProgressMock = drafts.saveProgress as jest.Mock;

const offlineAxiosError = { isAxiosError: true, message: 'Network Error' };
const serverAxiosError = {
  isAxiosError: true,
  message: 'Request failed',
  response: { status: 500 },
};

const sampleDraft: drafts.Draft = {
  id: 7,
  photo_uri: 'file:///photo.jpg',
  category: 'pothole',
  description: 'Deep pothole',
  lat: 39.2904,
  lng: -76.6122,
  accuracy: 12,
  severity: 'moderate',
  created_at: '2026-10-08T12:00:00.000Z',
  synced: 0,
  client_ref: 'ref-7',
  report_id: null,
  photo_id: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  useDraftStore.setState({ unsentCount: 0, syncing: false });
  fetchMock.mockResolvedValue({ isConnected: true });
  listDraftsMock.mockResolvedValue([]);
  draftCountMock.mockResolvedValue(0);
  saveDraftMock.mockResolvedValue(42);
});

describe('isOfflineError', () => {
  it('treats a response-less axios error as offline', () => {
    expect(isOfflineError(offlineAxiosError)).toBe(true);
  });

  it('treats server answers (4xx/5xx) as NOT offline', () => {
    expect(isOfflineError(serverAxiosError)).toBe(false);
  });

  it('treats non-axios errors as not-offline', () => {
    expect(isOfflineError(new Error('boom'))).toBe(false);
    expect(isOfflineError(undefined)).toBe(false);
  });
});

describe('isCurrentlyOffline', () => {
  it('reads NetInfo', async () => {
    fetchMock.mockResolvedValueOnce({ isConnected: false });
    expect(await isCurrentlyOffline()).toBe(true);
    fetchMock.mockResolvedValueOnce({ isConnected: true });
    expect(await isCurrentlyOffline()).toBe(false);
  });
});

describe('queueDraft', () => {
  it('persists the draft and refreshes the badge count', async () => {
    draftCountMock.mockResolvedValue(1);
    const id = await queueDraft({
      photoUri: 'file:///photo.jpg',
      category: 'trash',
      description: 'Overflowing bin',
      lat: 39.29,
      lng: -76.61,
      accuracy: 10,
      severity: 'low',
    });
    expect(id).toBe(42);
    expect(saveDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        photo_uri: 'file:///photo.jpg',
        category: 'trash',
        description: 'Overflowing bin',
        client_ref: 'uuid-new',
      }),
    );
    await Promise.resolve();
    expect(useDraftStore.getState().unsentCount).toBe(1);
  });
});

describe('queueDraft key', () => {
  it('reuses the key an online attempt already sent', async () => {
    await queueDraft({
      category: 'trash',
      description: 'd',
      lat: 1,
      lng: 2,
      clientRef: 'online-ref',
    });
    expect(saveDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({ client_ref: 'online-ref' }),
    );
  });
});

describe('syncDrafts', () => {
  it('replays a photo-less draft with its client_ref, marks it synced and removes it', async () => {
    listDraftsMock.mockResolvedValue([{ ...sampleDraft, photo_uri: null }]);
    postMock.mockResolvedValue({ data: { id: 'r-1' } });

    const result = await syncDrafts();
    expect(result).toEqual({ synced: 1, failed: 0 });

    expect(postMock.mock.calls.map((c) => c[0])).toEqual(['/reports']);
    expect(postMock).toHaveBeenCalledWith(
      '/reports',
      expect.objectContaining({
        category: 'pothole',
        lat: 39.2904,
        lng: -76.6122,
        client_ref: 'ref-7',
      }),
    );
    expect(markSyncedMock).toHaveBeenCalledWith(7);
    expect(deleteDraftMock).toHaveBeenCalledWith(7);
  });

  it('attaches the uploaded photo to the report it just filed', async () => {
    listDraftsMock.mockResolvedValue([sampleDraft]);
    postMock
      .mockResolvedValueOnce({ data: { photo_id: 'ph-1', url: '/media/ph-1.jpg' } })
      .mockResolvedValueOnce({ data: { report: { id: 'r-9' } } })
      .mockResolvedValueOnce({ data: {} });

    const result = await syncDrafts();
    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(postMock.mock.calls.map((c) => c[0])).toEqual([
      '/media',
      '/reports',
      '/reports/r-9/photos',
    ]);
    expect(postMock).toHaveBeenLastCalledWith('/reports/r-9/photos', null, {
      params: { photo_id: 'ph-1', kind: 'before' },
    });
    expect(saveProgressMock).toHaveBeenCalledWith(7, { photo_id: 'ph-1' });
    expect(saveProgressMock).toHaveBeenCalledWith(7, { report_id: 'r-9' });
  });

  it('keeps the draft and its progress when attaching the photo fails', async () => {
    listDraftsMock.mockResolvedValue([sampleDraft]);
    postMock
      .mockResolvedValueOnce({ data: { photo_id: 'ph-1' } })
      .mockResolvedValueOnce({ data: { report: { id: 'r-9' } } })
      .mockRejectedValueOnce(serverAxiosError);

    const result = await syncDrafts();
    expect(result).toEqual({ synced: 0, failed: 1 });
    expect(saveProgressMock).toHaveBeenCalledWith(7, { report_id: 'r-9' });
    expect(markSyncedMock).not.toHaveBeenCalled();
    expect(deleteDraftMock).not.toHaveBeenCalled();
  });

  it('a retry after a failed attach only attaches: no second upload, no second report', async () => {
    listDraftsMock.mockResolvedValue([
      { ...sampleDraft, report_id: 'r-9', photo_id: 'ph-1' },
    ]);
    postMock.mockResolvedValueOnce({ data: {} });

    const result = await syncDrafts();
    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(postMock.mock.calls).toEqual([
      ['/reports/r-9/photos', null, { params: { photo_id: 'ph-1', kind: 'before' } }],
    ]);
    expect(deleteDraftMock).toHaveBeenCalledWith(7);
  });

  it('a lost report response is retried with the same client_ref, which the server dedupes', async () => {
    const draft = { ...sampleDraft, photo_uri: null };
    listDraftsMock.mockResolvedValue([draft]);
    postMock.mockRejectedValueOnce(offlineAxiosError);
    expect(await syncDrafts()).toEqual({ synced: 0, failed: 1 });
    expect(deleteDraftMock).not.toHaveBeenCalled();

    postMock.mockResolvedValueOnce({ data: { report: { id: 'r-1' } } });
    expect(await syncDrafts()).toEqual({ synced: 1, failed: 0 });
    const refs = postMock.mock.calls
      .filter((c) => c[0] === '/reports')
      .map((c) => c[1].client_ref);
    expect(refs).toEqual(['ref-7', 'ref-7']);
  });

  it('gives a draft from an older build a key, stored before the first report POST', async () => {
    listDraftsMock.mockResolvedValue([{ ...sampleDraft, photo_uri: null, client_ref: null }]);
    postMock.mockResolvedValueOnce({ data: { id: 'r-1' } });

    await syncDrafts();
    expect(saveProgressMock).toHaveBeenCalledWith(7, { client_ref: 'uuid-new' });
    expect(saveProgressMock.mock.invocationCallOrder[0]).toBeLessThan(
      postMock.mock.invocationCallOrder[0],
    );
    expect(postMock).toHaveBeenCalledWith('/reports', expect.objectContaining({ client_ref: 'uuid-new' }));
  });

  it('a failed photo upload keeps the draft and files nothing', async () => {
    listDraftsMock.mockResolvedValue([sampleDraft]);
    postMock.mockRejectedValueOnce(serverAxiosError);

    expect(await syncDrafts()).toEqual({ synced: 0, failed: 1 });
    expect(postMock.mock.calls.map((c) => c[0])).toEqual(['/media']);
    expect(deleteDraftMock).not.toHaveBeenCalled();
  });

  it('keeps the draft and stops when the network drops mid-sync', async () => {
    listDraftsMock.mockResolvedValue([sampleDraft]);
    postMock.mockRejectedValue(offlineAxiosError);

    const result = await syncDrafts();
    expect(result).toEqual({ synced: 0, failed: 1 });
    expect(markSyncedMock).not.toHaveBeenCalled();
    expect(deleteDraftMock).not.toHaveBeenCalled();
  });

  it('keeps drafts on server errors but continues the queue', async () => {
    const second = { ...sampleDraft, id: 8, photo_uri: null };
    listDraftsMock.mockResolvedValue([sampleDraft, second]);
    postMock
      .mockRejectedValueOnce(serverAxiosError) // media for draft 7 — kept for retry
      .mockResolvedValueOnce({ data: { id: 'r-2' } }); // draft 8 report

    const result = await syncDrafts();
    expect(result).toEqual({ synced: 1, failed: 1 });
    expect(deleteDraftMock).toHaveBeenCalledWith(8);
    expect(deleteDraftMock).not.toHaveBeenCalledWith(7);
  });
});

describe('startOfflineSync', () => {
  type Listener = (state: { isConnected: boolean | null }) => void;

  it('syncs when connectivity returns after an offline period', () => {
    let listener: Listener | null = null;
    const unsubscribe = jest.fn();
    addEventListenerMock.mockImplementation((cb: Listener) => {
      listener = cb;
      return unsubscribe;
    });

    const stop = startOfflineSync();
    expect(addEventListenerMock).toHaveBeenCalled();

    listDraftsMock.mockResolvedValue([{ ...sampleDraft, photo_uri: null }]);
    postMock.mockResolvedValue({ data: { id: 'r-9' } });

    const fire = listener as Listener | null;
    fire?.({ isConnected: false }); // go offline
    fire?.({ isConnected: true }); // reconnect → triggers syncDrafts

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(deleteDraftMock).toHaveBeenCalledWith(7);
        stop();
        expect(unsubscribe).toHaveBeenCalled();
        resolve();
      }, 10);
    });
  });

  it('does not sync on the initial (online) event', async () => {
    let listener: Listener | null = null;
    addEventListenerMock.mockImplementation((cb: Listener) => {
      listener = cb;
      return jest.fn();
    });
    const stop = startOfflineSync();
    const fire = listener as Listener | null;
    fire?.({ isConnected: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(listDraftsMock).not.toHaveBeenCalled();
    stop();
  });
});
