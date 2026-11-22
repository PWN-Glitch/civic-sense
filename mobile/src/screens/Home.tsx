import React, { useEffect } from 'react';
import { useAuthStore } from '../lib/auth';
import BootScreen from '../components/BootScreen';
import Onboarding from '../components/Onboarding';
import { useIntroGate } from '../lib/onboarding';
import TabsNavigator from '../navigation/Tabs';

/**
 * The signed-in shell as a single mountable component: it restores or mints
 * the device session, then shows the map-first tab shell. There is no gate —
 * the app never asks anyone to sign in.
 *
 * App.tsx renders the same branch logic at the root; this component exists so
 * the test harness (and any deep-link fallback) can mount one screen that
 * resolves its own session.
 */
export default function HomeScreen() {
  const jwt = useAuthStore((s) => s.jwt);
  const bootError = useAuthStore((s) => s.error);
  const boot = useAuthStore((s) => s.boot);
  // null = not read yet, so the intro never flashes for a returning user.
  const { introSeen, dismissIntro } = useIntroGate();

  useEffect(() => {
    void boot();
  }, [boot]);

  if (!jwt) {
    return <BootScreen error={bootError} onRetry={() => void boot()} />;
  }

  if (introSeen === null) {
    return <BootScreen error={null} onRetry={() => void boot()} />;
  }

  if (!introSeen) {
    return <Onboarding onDone={dismissIntro} />;
  }

  return <TabsNavigator />;
}
