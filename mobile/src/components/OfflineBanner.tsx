import React, { useEffect, useMemo } from 'react';
import {StyleSheet, Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';
import { WifiOff } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { font, spacing, type ThemeColors, type Typography } from '../theme';

/**
 * App-wide offline banner.
 *
 * `useNetworkStore` mirrors NetInfo connectivity into zustand so any screen
 * can read it. `OfflineBanner` renders once at the app root and explains
 * that reports made while offline are saved as local drafts.
 */
interface NetworkState {
  isOffline: boolean;
  setOffline: (offline: boolean) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  isOffline: false,
  setOffline: (offline) => set({ isOffline: offline }),
}));

/** Subscribe NetInfo → zustand. Call once from a root-level effect. */
export function startNetworkMonitor(): () => void {
  // Sync the current state immediately so we don't wait for the first event.
  void NetInfo.fetch()
    .then((state) => {
      useNetworkStore.getState().setOffline(state.isConnected === false);
    })
    .catch(() => {
      // NetInfo unavailable; assume online rather than nagging falsely.
    });
  return NetInfo.addEventListener((state) => {
    useNetworkStore.getState().setOffline(state.isConnected === false);
  });
}

export default function OfflineBanner() {
  const isOffline = useNetworkStore((s) => s.isOffline);
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors, typography), [colors, typography]);
  if (!isOffline) return null;
  return (
    <View
      style={styles.banner}
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      accessibilityLabel="You're offline. Reports will be saved as drafts and sent when you're back online."
    >
      <WifiOff
        size={14}
        color={colors.warning}
        strokeWidth={2.4}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text style={styles.text}>
        You&apos;re offline — reports will be saved as drafts
      </Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors, t: Typography) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing(2),
      backgroundColor: c.warningSurface,
      borderBottomColor: c.warning,
      borderBottomWidth: 1,
      paddingVertical: spacing(3),
      paddingHorizontal: spacing(4),
    },
    text: {
      ...t.caption,
      color: c.warning,
      fontFamily: font.bold,
      letterSpacing: 0.1,
    },
  });
