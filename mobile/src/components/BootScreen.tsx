import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from 'react-native';
import { useTheme } from '../lib/theme';
import { font, layout, spacing, type ThemeColors } from '../theme';

/**
 * Shown for the moment it takes to restore or mint the session. It also
 * carries the only error state the app can hit before any screen exists:
 * the server is unreachable and no session could be set up.
 */
export default function BootScreen({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + spacing(10), paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.rule} />
      <Text style={[typography.eyebrow, styles.eyebrow]}>
        Baltimore · 311
      </Text>
      <Text style={[typography.display, styles.title]}>Civic Sense</Text>
      <Text style={[typography.body, styles.body]}>
        {error
          ? error
          : 'Opening your case file — reports, routes and contacts load from the city server.'}
      </Text>
      {error ? (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          testID="boot-retry"
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      ) : (
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
      paddingHorizontal: layout.gutter,
      maxWidth: layout.maxContentWidth,
      alignSelf: 'center',
      width: '100%',
    },
    rule: {
      height: 3,
      width: 44,
      backgroundColor: c.warning,
      marginBottom: spacing(5),
    },
    eyebrow: {
      marginBottom: spacing(2),
    },
    title: {
      marginBottom: spacing(3),
    },
    body: {
      maxWidth: 380,
    },
    spinner: {
      marginTop: spacing(6),
      alignSelf: 'flex-start',
    },
    retry: {
      marginTop: spacing(6),
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: c.borderStrong,
      borderRadius: 3,
      paddingHorizontal: spacing(5),
      paddingVertical: spacing(3),
      minHeight: 48,
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.6,
    },
    retryText: {
      fontFamily: font.semibold,
      fontSize: 15,
      color: c.ink,
    },
  });
