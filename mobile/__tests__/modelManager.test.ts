import * as FileSystem from 'expo-file-system/legacy';
import { api } from '../src/api/client';
import { classifyPhoto } from '../src/lib/classify';
import { classifyLocal } from '../src/lib/ondevice';
import {
  ensureModel,
  onDeviceAvailable,
  parseModelMetadata,
  resetModelCache,
  MODEL_JSON_PATH,
  MODEL_TFLITE_PATH,
} from '../src/lib/modelManager';
import type { ModelMetadata } from '../src/types';

declare const global: { fetch: typeof fetch };

// The api client talks to no real server in tests.
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

// On-device inference is stubbed per-test; the native module is globally
// mocked in jest.setup.ts and would reject by default.
jest.mock('../src/lib/ondevice', () => ({
  classifyLocal: jest.fn(),
}));

const METADATA: ModelMetadata = {
  version: '1.0.0',
  labels: [
    'pothole',
    'streetlight',
    'trash',
    'graffiti',
    'sidewalk damage',
    'other',
  ],
  input: { shape: [1, 3, 224, 224], dtype: 'uint8', normalization: 'imagenet' },
};

const getInfoAsync = FileSystem.getInfoAsync as jest.Mock;
const readAsStringAsync = FileSystem.readAsStringAsync as jest.Mock;
const downloadAsync = FileSystem.downloadAsync as jest.Mock;
const writeAsStringAsync = FileSystem.writeAsStringAsync as jest.Mock;
const classifyLocalMock = classifyLocal as jest.Mock;
const postMock = api.post as jest.Mock;

const realFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  void resetModelCache();
  getInfoAsync.mockResolvedValue({ exists: false });
  readAsStringAsync.mockResolvedValue(JSON.stringify(METADATA));
  downloadAsync.mockResolvedValue({
    uri: 'file:///mock-documents/models/civic-classifier.tflite',
    status: 200,
  });
});

afterEach(() => {
  global.fetch = realFetch;
});

function stubMetaFetch(body: unknown, status = 200) {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('parseModelMetadata', () => {
  it('accepts the documented week-2 shape', () => {
    expect(parseModelMetadata(METADATA)).toEqual(METADATA);
  });

  it('rejects malformed metadata', () => {
    expect(parseModelMetadata(null)).toBeNull();
    expect(parseModelMetadata({ version: 1 })).toBeNull();
    expect(
      parseModelMetadata({ version: '1', labels: [], input: { shape: [] } }),
    ).toBeNull();
    expect(
      parseModelMetadata({ version: '1', labels: ['pothole'], input: null }),
    ).toBeNull();
  });
});

describe('modelManager', () => {
  it('downloads the model + metadata on first launch', async () => {
    stubMetaFetch(METADATA);
    const model = await ensureModel();
    expect(model).not.toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(MODEL_JSON_PATH),
    );
    expect(downloadAsync).toHaveBeenCalledWith(
      expect.stringContaining(MODEL_TFLITE_PATH),
      expect.stringContaining('civic-classifier.tflite'),
    );
    expect(writeAsStringAsync).toHaveBeenCalled();
    expect(model?.metadata.version).toBe('1.0.0');
  });

  it('reuses the cached model when the version matches', async () => {
    getInfoAsync.mockResolvedValue({ exists: true });
    stubMetaFetch(METADATA);
    const model = await ensureModel();
    expect(model?.metadata.version).toBe('1.0.0');
    expect(downloadAsync).not.toHaveBeenCalled();
  });

  it('re-downloads when the server version differs', async () => {
    getInfoAsync.mockResolvedValue({ exists: true });
    readAsStringAsync.mockResolvedValue(
      JSON.stringify({ ...METADATA, version: '0.9.0' }),
    );
    stubMetaFetch(METADATA); // server now at 1.0.0
    const model = await ensureModel();
    expect(downloadAsync).toHaveBeenCalled();
    expect(model?.metadata.version).toBe('1.0.0');
  });

  it('keeps the cached model when the version check cannot reach the server', async () => {
    getInfoAsync.mockResolvedValue({ exists: true });
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const model = await ensureModel();
    expect(model).not.toBeNull(); // offline-capable
    expect(downloadAsync).not.toHaveBeenCalled();
  });

  it('reports unavailable when nothing is cached and the server 404s', async () => {
    stubMetaFetch({ message: 'not exported yet' }, 404);
    const model = await ensureModel();
    expect(model).toBeNull();
    expect(await onDeviceAvailable()).toBe(false);
    expect(downloadAsync).not.toHaveBeenCalled();
  });

  it('reports unavailable when the download itself fails', async () => {
    await resetModelCache();
    stubMetaFetch(METADATA);
    downloadAsync.mockRejectedValue(new Error('connection reset'));
    const model = await ensureModel();
    expect(model).toBeNull();
  });
});

describe('classifyPhoto source selection', () => {
  const form = new FormData();
  const uri = 'file:///photo.jpg';
  const localResult = {
    predictions: [{ category: 'pothole' as const, confidence: 0.9 }],
    band: 'high' as const,
    severity: { level: 'high' as const, reason: 'test' },
    disclaimer: 'On-device AI estimate — please verify',
    modelVersion: '1.0.0',
  };

  it('prefers the on-device model when it succeeds', async () => {
    classifyLocalMock.mockResolvedValue(localResult);
    const outcome = await classifyPhoto(form, uri);
    expect(outcome).toMatchObject({ kind: 'ok', source: 'on-device' });
    expect(postMock).not.toHaveBeenCalled();
  });

  it('falls back to the server when on-device is unavailable', async () => {
    classifyLocalMock.mockResolvedValue(null);
    postMock.mockResolvedValueOnce({
      data: {
        predictions: [{ category: 'trash', confidence: 0.8 }],
        band: 'high',
        severity: { level: 'moderate', reason: 'test' },
        disclaimer: 'AI estimate — please verify',
      },
    });
    const outcome = await classifyPhoto(form, uri);
    expect(outcome).toMatchObject({ kind: 'ok', source: 'cloud' });
    expect(postMock).toHaveBeenCalledWith(
      '/classify',
      form,
      expect.objectContaining({
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    );
  });

  it('maps a server 503 to the manual-picker outcome', async () => {
    classifyLocalMock.mockResolvedValue(null);
    postMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 503 },
      message: 'Service Unavailable',
    });
    const outcome = await classifyPhoto(form, uri);
    expect(outcome).toEqual({ kind: 'unavailable' });
  });

  it('rethrows network errors so the UI can show its connection state', async () => {
    classifyLocalMock.mockResolvedValue(null);
    postMock.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Network Error',
    });
    await expect(classifyPhoto(form, uri)).rejects.toBeTruthy();
  });
});
