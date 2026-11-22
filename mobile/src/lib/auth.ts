import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { api, saveJwt, clearJwt, getJwt } from '../api/client';
import { tokenStorage } from './storage';
import type { AuthResponse, User } from '../types';

/**
 * Session handling with no sign-in screen.
 *
 * The app files reports against a real server account, so it still needs a
 * token — it just never asks. On first launch it mints a device credential,
 * registers it silently, and keeps the credential plus the token in secure
 * storage. Later launches reuse both; a dead token is re-issued from the
 * stored credential rather than by asking a person to type anything.
 *
 * The account is real (a row in `users`, a JWT the server verifies) — nothing
 * about it is faked, it simply has no UI.
 */

const USER_KEY = 'civicsense.user';
const DEVICE_KEY = 'civicsense.device';

/** Storage keys this store owns (exported so tests can clear a real session). */
export const SESSION_KEYS = { user: USER_KEY, device: DEVICE_KEY } as const;

/** Shown when the server cannot be reached at all. */
export const NETWORK_ERROR_MESSAGE =
  "Can't reach the server. Check your connection and try again.";

interface DeviceCredential {
  email: string;
  password: string;
}

interface AuthState {
  user: User | null;
  jwt: string | null;
  /** True while the session is being restored or provisioned. */
  booting: boolean;
  /** Set only when provisioning failed outright (server unreachable). */
  error: string | null;
  /** Restore or provision the session. Safe to call more than once. */
  boot: () => Promise<void>;
  /** Drop the token and provision a fresh session (used on 401). */
  reprovision: () => Promise<void>;
}

async function saveProfile(user: User | null): Promise<void> {
  if (!user) {
    await tokenStorage.remove(USER_KEY);
    return;
  }
  await tokenStorage.set(USER_KEY, JSON.stringify(user));
}

async function loadProfile(): Promise<User | null> {
  const raw = await tokenStorage.get(USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as User;
    return parsed && typeof parsed.id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

async function loadCredential(): Promise<DeviceCredential | null> {
  const raw = await tokenStorage.get(DEVICE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DeviceCredential;
    return parsed?.email && parsed?.password ? parsed : null;
  } catch {
    return null;
  }
}

async function saveCredential(cred: DeviceCredential): Promise<void> {
  await tokenStorage.set(DEVICE_KEY, JSON.stringify(cred));
}

/** A stable-enough identity for this install; never shown to the user. */
async function mintCredential(): Promise<DeviceCredential> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return {
    email: `device-${id.slice(0, 12)}@devices.civicsense.app`,
    password: id + id,
  };
}

function statusOf(err: unknown): number | undefined {
  const e = err as { isAxiosError?: boolean; response?: { status?: number } };
  return e?.isAxiosError ? e.response?.status : undefined;
}

/** Register the device credential, or log in if it already exists. */
async function establishDeviceSession(
  set: (partial: Partial<AuthState>) => void,
): Promise<void> {
  let credential = await loadCredential();
  if (!credential) {
    credential = await mintCredential();
    // Persist before the request: if registration succeeds but the response
    // is lost, the retry logs in to the same account instead of creating a
    // second one.
    await saveCredential(credential);
  }

  let data: AuthResponse;
  try {
    ({ data } = await api.post<AuthResponse>('/auth/register', credential));
  } catch (err) {
    if (statusOf(err) !== 409) {
      set({ booting: false, error: NETWORK_ERROR_MESSAGE });
      return;
    }
    try {
      ({ data } = await api.post<AuthResponse>('/auth/login', credential));
    } catch {
      set({ booting: false, error: NETWORK_ERROR_MESSAGE });
      return;
    }
  }

  await saveJwt(data.jwt);
  await saveProfile(data.user);
  set({ jwt: data.jwt, user: data.user, booting: false, error: null });
}

// Boot runs from both App and the Home screen; one in-flight pass is enough.
let inFlight: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  jwt: null,
  booting: true,
  error: null,

  boot: async () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      set({ booting: true, error: null });
      const jwt = await getJwt();
      if (jwt) {
        const cached = await loadProfile();
        set({ jwt, user: cached, booting: false });
        if (cached) return;
        // Token without a profile: ask the server who it is. A 401 means the
        // token is dead, so fall through to provisioning.
        try {
          const { data } = await api.get<User>('/auth/me');
          await saveProfile(data);
          set({ user: data });
          return;
        } catch (err) {
          if (statusOf(err) !== 401) return;
          await clearJwt();
          await saveProfile(null);
          set({ jwt: null, user: null });
        }
      }
      await establishDeviceSession(set);
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  },

  reprovision: async () => {
    await clearJwt();
    await saveProfile(null);
    set({ jwt: null, user: null });
    await get().boot();
  },
}));
