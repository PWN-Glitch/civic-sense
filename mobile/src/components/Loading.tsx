import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { spacing, type ThemeColors } from '../theme';

/**
 * Standard full-screen loading state.
 *
 * Every screen that fetches shows this while the load is in flight.
 */
interface LoadingProps {
  /** What is loading, e.g. "Loading your reports…". Announced to TalkBack. */
  message?: string;
}

export default function Loading({ message = 'Loading…' }: LoadingProps) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View
      style={styles.center}
      accessibilityLiveRegion="polite"
      accessibilityLabel={message}
    >
      <ActivityIndicator
        color={colors.primary}
        size="large"
        importantForAccessibility="no"
      />
      <Text style={[typography.caption, styles.message]}>{message}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.background,
      padding: spacing(6),
    },
    message: {
      marginTop: spacing(3),
    },
  });
