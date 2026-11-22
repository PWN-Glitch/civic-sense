import axios from 'axios';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { api } from '../api/client';
import {
  deleteDraft,
  Draft,
  draftCount,
  listDrafts,
  markSynced,
  saveDraft,
  saveProgress,
} from './drafts';
import { imageFormData } from './image';
import type { Category, MediaResponse, Report } from '../types';

/**
 * Offline detection + draft sync.
 *
 * - `isOfflineError` decides whether a failed API call means "no network"
 *   (as opposed to a server error, which the user should see).
 * - `useDraftStore` exposes the live unsent-draft count for the Home badge.
 * - `startOfflineSync` listens to NetInfo and replays queued drafts on
 *   reconnect: photo (if any) → report → attach photo → remove. Each step
 *   is saved on the draft, so a retry resumes rather than repeats.
 */

/** True when an axios failure means the network is gone (not a 4xx/5xx). */
export function isOfflineError(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    // A response means the server answered, so that's not an offline failure.
    return !err.response;
  }
  return false;
}

/** True when the device currently reports no connectivity. */
export async function isCurrentlyOffline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === false;
  } catch {
    return false;
  }
}

interface DraftState {
  unsentCount: number;
  syncing: boolean;
  refresh: () => Promise<void>;
}

export const useDraftStore = create<DraftState>((set) => ({
  unsentCount: 0,
  syncing: false,
  refresh: async () => {
    set({ unsentCount: await draftCount() });
  },
}));

/** Save a report as a local draft and update the badge count. */
export async function queueDraft(input: {
  photoUri?: string | null;
  category: Category;
  description: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  severity?: string | null;
  /** The key an online attempt already sent, if any; reusing it prevents a second report. */
  clientRef?: string;
  /** Already uploaded: the sync attaches it instead of uploading again. */
  photoId?: string;
  /** Already filed (or the existing report the photo is evidence for): the sync only attaches. */
  reportId?: string;
}): Promise<number> {
  const id = await saveDraft({
    photo_uri: input.photoUri ?? null,
    category: input.category,
    description: input.description,
    lat: input.lat,
    lng: input.lng,
    accuracy: input.accuracy ?? null,
    severity: input.severity ?? null,
    client_ref: input.clientRef ?? Crypto.randomUUID(),
    photo_id: input.photoId ?? null,
    report_id: input.reportId ?? null,
  });
  await useDraftStore.getState().refresh();
  return id;
}

/**
 * Submit one queued draft. Every step's result is saved on the draft before
 * the next starts, and any failure throws so the caller keeps the draft:
 * a retry skips the upload and the report it already has, and the report
 * POST carries the draft's client_ref so a lost response is replayed, not
 * filed twice.
 */
async function submitDraft(draft: Draft): Promise<void> {
  let clientRef = draft.client_ref;
  if (!clientRef) {
    // Drafts saved by older builds have no key; store one before the first POST.
    clientRef = Crypto.randomUUID();
    await saveProgress(draft.id, { client_ref: clientRef });
  }

  let photoId = draft.photo_id;
  if (draft.photo_uri && !photoId) {
    const { data: media } = await api.post<MediaResponse>(
      '/media',
      imageFormData(draft.photo_uri),
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    if (!media?.photo_id) throw new Error('photo upload returned no id');
    photoId = media.photo_id;
    await saveProgress(draft.id, { photo_id: photoId });
  }

  let reportId = draft.report_id;
  if (!reportId) {
    const { data } = await api.post<
      Report | { report: Report; possible_duplicates?: Report[] }
    >('/reports', {
      category: draft.category,
      description: draft.description,
      lat: draft.lat,
      lng: draft.lng,
      location_accuracy: draft.accuracy ?? undefined,
      severity: draft.severity ?? undefined,
      client_ref: clientRef,
    });
    // Normalise the real `{ report }` wrapper (see Report.tsx).
    const report = 'report' in data && data.report ? data.report : (data as Report);
    reportId = report.id;
    await saveProgress(draft.id, { report_id: reportId });
  }

  if (photoId) {
    // Re-attaching to the same report is accepted, so a lost response is safe to retry.
    await api.post(`/reports/${reportId}/photos`, null, {
      params: { photo_id: photoId, kind: 'before' },
    });
  }
}

export interface SyncResult {
  synced: number;
  failed: number;
}

/**
 * Replay every queued draft in order. Stops early when the network drops
 * again mid-sync. Failed drafts stay in the table for the next reconnect.
 */
export async function syncDrafts(): Promise<SyncResult> {
  const store = useDraftStore.getState();
  if (store.syncing) return { synced: 0, failed: 0 };

  useDraftStore.setState({ syncing: true });
  let synced = 0;
  let failed = 0;
  try {
    for (const draft of await listDrafts()) {
      try {
        await submitDraft(draft);
        await markSynced(draft.id);
        await deleteDraft(draft.id);
        synced += 1;
      } catch (err) {
        failed += 1;
        if (isOfflineError(err)) break; // went offline again mid-sync
        // Server-side failure: keep the draft, try the rest of the queue.
      }
    }
  } finally {
    await useDraftStore.getState().refresh();
    useDraftStore.setState({ syncing: false });
  }
  return { synced, failed };
}

/**
 * Subscribe to connectivity changes. On reconnect, replay the queue.
 * Returns an unsubscribe function (call from a root-level effect).
 */
export function startOfflineSync(): () => void {
  let wasConnected = true;
  const unsubscribe = NetInfo.addEventListener((state) => {
    const connected = state.isConnected === true;
    if (connected && !wasConnected) {
      void syncDrafts();
    }
    wasConnected = connected;
  });
  return unsubscribe;
}
