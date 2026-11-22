import { api, getJwt, JWT_KEY } from '../src/api/client';
import { tokenStorage } from '../src/lib/storage';
import {
  NETWORK_ERROR_MESSAGE,
  SESSION_KEYS,
  useAuthStore,
} from '../src/lib/auth';

/**
 * Session boot without a sign-in screen: restore a live token, backfill the
 * profile, or mint a device credential — and never ask the user anything.
 */

jest.mock('../src/api/client', () => {
  const actual = jest.requireActual('../src/api/client');
  return {
    ...actual,
    api: { post: jest.fn(), get: jest.fn() },
  };
});

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async (n: number) =>
    Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256),
  ),
}));

const postMock = api.post as jest.Mock;
const getMock = api.get as jest.Mock;

const USER = {
  id: 'u1',
  display_name: 'Resident',
  email: 'device-abc@devices.civicsense.app',
};

function resetStore(): void {
  useAuthStore.setState({
    user: null,
    jwt: null,
    booting: true,
    error: null,
  });
}

describe('Session boot', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Same storage backend the app uses, so the reset is real on every
    // platform (SecureStore on device, AsyncStorage in the Jest env).
    await tokenStorage.remove(JWT_KEY);
    await tokenStorage.remove(SESSION_KEYS.user);
    await tokenStorage.remove(SESSION_KEYS.device);
    resetStore();
  });

  it('mints and registers a device account on first launch', async () => {
    postMock.mockResolvedValueOnce({
      data: { jwt: 'jwt-1', user: USER },
    });

    await useAuthStore.getState().boot();

    expect(postMock).toHaveBeenCalledWith('/auth/register', {
      email: expect.stringMatching(/^device-[0-9a-f]{12}@devices\.civicsense\.app$/),
      password: expect.any(String),
    });
    const [, body] = postMock.mock.calls[0];
    // The generated password is long enough for the server's policy.
    expect(body.password.length).toBeGreaterThanOrEqual(16);

    expect(useAuthStore.getState().jwt).toBe('jwt-1');
    expect(useAuthStore.getState().user?.email).toBe(USER.email);
    expect(useAuthStore.getState().error).toBeNull();
    await expect(getJwt()).resolves.toBe('jwt-1');
  });

  it('logs in with the stored credential when the account already exists', async () => {
    postMock
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } })
      .mockResolvedValueOnce({ data: { jwt: 'jwt-2', user: USER } });

    await useAuthStore.getState().boot();
    expect(postMock.mock.calls[1][0]).toBe('/auth/login');
    expect(useAuthStore.getState().jwt).toBe('jwt-2');
  });

  it('a cold start with a live token makes no request at all', async () => {
    postMock.mockResolvedValueOnce({ data: { jwt: 'jwt-3', user: USER } });
    await useAuthStore.getState().boot();
    expect(postMock).toHaveBeenCalledTimes(1);

    // Simulate the process dying: memory gone, storage intact.
    resetStore();
    await useAuthStore.getState().boot();

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(getMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().jwt).toBe('jwt-3');
    expect(useAuthStore.getState().user?.display_name).toBe('Resident');
  });

  it('backfills a missing profile from /auth/me', async () => {
    postMock.mockResolvedValueOnce({ data: { jwt: 'jwt-4', user: USER } });
    await useAuthStore.getState().boot();

    // Token survives but the cached profile was wiped.
    await tokenStorage.remove(SESSION_KEYS.user);
    resetStore();
    getMock.mockResolvedValueOnce({ data: USER });

    await useAuthStore.getState().boot();

    expect(getMock).toHaveBeenCalledWith('/auth/me');
    expect(useAuthStore.getState().user?.email).toBe(USER.email);
    expect(useAuthStore.getState().jwt).toBe('jwt-4');
  });

  it('re-provisions when the server rejects the token', async () => {
    postMock.mockResolvedValueOnce({ data: { jwt: 'jwt-old', user: USER } });
    await useAuthStore.getState().boot();

    await tokenStorage.remove(SESSION_KEYS.user);
    resetStore();
    getMock.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } });
    postMock.mockResolvedValueOnce({ data: { jwt: 'jwt-new', user: USER } });

    await useAuthStore.getState().boot();

    expect(useAuthStore.getState().jwt).toBe('jwt-new');
    expect(useAuthStore.getState().booting).toBe(false);
  });

  it('surfaces the unreachable-server message and recovers on retry', async () => {
    postMock.mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });

    await useAuthStore.getState().boot();
    expect(useAuthStore.getState().error).toBe(NETWORK_ERROR_MESSAGE);
    expect(useAuthStore.getState().jwt).toBeNull();
    expect(useAuthStore.getState().booting).toBe(false);

    postMock.mockResolvedValueOnce({ data: { jwt: 'jwt-5', user: USER } });
    await useAuthStore.getState().boot();
    expect(useAuthStore.getState().jwt).toBe('jwt-5');
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('collapses concurrent boots into one request', async () => {
    postMock.mockResolvedValueOnce({ data: { jwt: 'jwt-6', user: USER } });

    await Promise.all([
      useAuthStore.getState().boot(),
      useAuthStore.getState().boot(),
      useAuthStore.getState().boot(),
    ]);

    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
