import * as FileSystem from 'expo-file-system/legacy';
import { getApiUrl } from '../api/client';
import type { ModelMetadata } from '../types';

/**
 * On-device classifier model management.
 *
 * The fine-tuned MobileNetV3 TFLite model is served by the backend
 * (week 2 contract):
 *   GET /models/civic-classifier.tflite:  int8-quantized model binary
 *   GET /models/civic-classifier.json:    {version, labels, input}
 *
 * Both are downloaded on first launch and cached under the app's document
 * directory. On subsequent launches we fetch only the small JSON and
 * re-download the binary when the version changes.
 *
 * NOTE: react-native-fast-tflite (which loads this model) requires a dev
 * build; it does NOT run in Expo Go. See app.json plugins and ondevice.ts.
 */

const MODEL_DIR = `${FileSystem.documentDirectory ?? ''}models`;
const TFLITE_URI = `${MODEL_DIR}/civic-classifier.tflite`;
const META_URI = `${MODEL_DIR}/civic-classifier.json`;

export const MODEL_TFLITE_PATH = 'models/civic-classifier.tflite';
export const MODEL_JSON_PATH = 'models/civic-classifier.json';

export interface CachedModel {
  uri: string;
  metadata: ModelMetadata;
}

let cached: CachedModel | null = null;
let inflight: Promise<CachedModel | null> | null = null;

/** Validate the shape of the downloaded metadata before trusting it. */
export function parseModelMetadata(raw: unknown): ModelMetadata | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Partial<ModelMetadata>;
  if (
    typeof candidate.version !== 'string' ||
    !Array.isArray(candidate.labels) ||
    candidate.labels.length === 0 ||
    candidate.labels.some((l) => typeof l !== 'string') ||
    typeof candidate.input !== 'object' ||
    candidate.input === null ||
    !Array.isArray(candidate.input.shape) ||
    candidate.input.shape.length !== 4
  ) {
    return null;
  }
  return candidate as ModelMetadata;
}

async function readCached(): Promise<CachedModel | null> {
  try {
    const metaInfo = await FileSystem.getInfoAsync(META_URI);
    const modelInfo = await FileSystem.getInfoAsync(TFLITE_URI);
    if (!metaInfo.exists || !modelInfo.exists) return null;
    const metadata = parseModelMetadata(
      JSON.parse(await FileSystem.readAsStringAsync(META_URI)),
    );
    if (!metadata) return null;
    return { uri: TFLITE_URI, metadata };
  } catch {
    return null;
  }
}

async function download(metadata: ModelMetadata): Promise<CachedModel> {
  const base = getApiUrl();
  await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true }).catch(
    () => undefined, // already exists
  );
  const modelDownload = await FileSystem.downloadAsync(
    `${base}/${MODEL_TFLITE_PATH}`,
    TFLITE_URI,
  );
  if (modelDownload.status < 200 || modelDownload.status >= 300) {
    throw new Error(`Model download failed with HTTP ${modelDownload.status}`);
  }
  await FileSystem.writeAsStringAsync(META_URI, JSON.stringify(metadata));
  return { uri: TFLITE_URI, metadata };
}

/**
 * Ensure the on-device model is present and current. Returns null when the
 * model cannot be obtained (offline on first launch, endpoint 404s, corrupt
 * metadata); callers must then fall back to server classification.
 *
 * Concurrent calls share one in-flight download.
 */
export async function ensureModel(): Promise<CachedModel | null> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async (): Promise<CachedModel | null> => {
    try {
      const base = getApiUrl();
      const existing = await readCached();

      let remoteMeta: ModelMetadata | null = null;
      try {
        const response = await fetch(`${base}/${MODEL_JSON_PATH}`);
        if (!response.ok) {
          // 404 = model not exported on the server yet; 5xx = server issue.
          // Either way, keep whatever we have cached.
          return existing;
        }
        remoteMeta = parseModelMetadata(await response.json());
      } catch {
        // Network down; a cached model is still perfectly usable offline.
        return existing;
      }
      if (!remoteMeta) return existing;

      if (existing && existing.metadata.version === remoteMeta.version) {
        return existing;
      }
      return await download(remoteMeta);
    } catch {
      return null;
    }
  })();

  try {
    cached = await inflight;
    return cached;
  } finally {
    inflight = null;
  }
}

/** True when a usable on-device model is cached locally. */
export async function onDeviceAvailable(): Promise<boolean> {
  return (await ensureModel()) !== null;
}

/** Kick off the download without awaiting it (call at app startup). */
export function prefetchModel(): void {
  void ensureModel();
}

/** Drop the in-memory cache (and optionally the files). For tests/dev. */
export async function resetModelCache(deleteFiles = false): Promise<void> {
  cached = null;
  if (deleteFiles) {
    await FileSystem.deleteAsync(MODEL_DIR, { idempotent: true }).catch(
      () => undefined,
    );
  }
}
