import { useCallback, useEffect, useState } from 'react';

import { tokenStorage } from './storage';

/** Storage flag: the first-launch introduction has been dismissed. */
export const ONBOARDED_KEY = 'civicsense.onboarded';

export async function hasSeenIntro(): Promise<boolean> {
  const value = await tokenStorage.get(ONBOARDED_KEY).catch(() => null);
  return value === '1';
}

export async function markIntroSeen(): Promise<void> {
  // Failing to persist only means the intro shows again; never block the app.
  await tokenStorage.set(ONBOARDED_KEY, '1').catch(() => undefined);
}

/**
 * The first-launch gate as one hook, so the app root and the mountable Home
 * shell cannot drift apart. `null` means "still reading" — callers render a
 * boot frame so a returning user never sees the intro flash.
 */
export function useIntroGate(): {
  introSeen: boolean | null;
  dismissIntro: () => void;
} {
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void hasSeenIntro().then((seen) => {
      if (alive) setIntroSeen(seen);
    });
    return () => {
      alive = false;
    };
  }, []);

  const dismissIntro = useCallback(() => {
    setIntroSeen(true);
    void markIntroSeen();
  }, []);

  return { introSeen, dismissIntro };
}
