import axios from 'axios';
import { api } from '../api/client';
import { classifyLocal } from './ondevice';
import type {
  ClassificationSource,
  ClassifyResponse,
  Severity,
} from '../types';

/**
 * Unified classification step used by the Preview screen.
 *
 * Order of attempts:
 *   1. On-device TFLite model: fast and works fully offline.
 *   2. Server POST /classify (the server itself may use mobilenet or clip).
 *   3. Server 503 (classifier unavailable) → `unavailable`, and the UI hands
 *      off to the existing manual category picker.
 *
 * Network/5xx errors on the server path rethrow so the caller can show its
 * normal connection error state.
 */

export type ClassificationOutcome =
  | ({ kind: 'ok'; source: ClassificationSource } & ClassifyResponse)
  | { kind: 'unavailable' };

export const MANUAL_PICKER_SEVERITY: Severity = {
  level: 'low',
  reason: 'unavailable',
};

export async function classifyPhoto(
  formData: FormData,
  imageUri: string,
): Promise<ClassificationOutcome> {
  const local = await classifyLocal(imageUri);
  if (local) {
    return {
      kind: 'ok',
      source: 'on-device',
      predictions: local.predictions,
      band: local.band,
      severity: local.severity,
      disclaimer: local.disclaimer,
    };
  }

  try {
    const { data } = await api.post<ClassifyResponse>('/classify', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return {
      kind: 'ok',
      source: 'cloud',
      predictions: data.predictions,
      band: data.band,
      severity: data.severity,
      disclaimer: data.disclaimer,
    };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 503) {
      return { kind: 'unavailable' };
    }
    throw err;
  }
}
