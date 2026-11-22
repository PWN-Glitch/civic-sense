import axios, { AxiosError, AxiosInstance } from 'axios';
import { tokenStorage } from '../lib/storage';

const JWT_KEY = 'civicsense.jwt';

// 10.0.2.2 is the Android emulator's alias for the host machine's localhost.
const DEFAULT_API_URL = 'http://10.0.2.2:8000';

export function getApiUrl(): string {
  // Expo inlines EXPO_PUBLIC_* at bundle time, so a device build needs it set when bundling.
  return process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;
}

/** Release builds refuse plain HTTP so the session token never travels in cleartext. */
export function assertSecureTransport(url: string, dev: boolean = __DEV__): void {
  if (!dev && !/^https:\/\//i.test(url)) {
    throw new Error(`Release builds need an https:// API URL, got ${url}`);
  }
}

/**
 * Turn a server-relative media path (`/media/<uuid>.jpg`) into an absolute
 * URI. Report photo URLs come back relative, and RN's <Image> cannot resolve
 * a path on its own — without this the photo record renders blank tiles.
 */
export function absoluteMediaUrl(url: string): string {
  if (!url) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const base = getApiUrl().replace(/\/+$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

type SignOutHandler = () => void;
let onUnauthorized: SignOutHandler | null = null;

export function setUnauthorizedHandler(handler: SignOutHandler | null): void {
  onUnauthorized = handler;
}

export const api: AxiosInstance = axios.create({
  baseURL: getApiUrl(),
  timeout: 30000,
});

api.interceptors.request.use(async (config) => {
  assertSecureTransport(config.baseURL ?? '');
  const token = await tokenStorage.get(JWT_KEY);
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      await tokenStorage.remove(JWT_KEY);
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

export async function saveJwt(token: string): Promise<void> {
  await tokenStorage.set(JWT_KEY, token);
}

export async function getJwt(): Promise<string | null> {
  return tokenStorage.get(JWT_KEY);
}

export async function clearJwt(): Promise<void> {
  await tokenStorage.remove(JWT_KEY);
}

export { JWT_KEY };
