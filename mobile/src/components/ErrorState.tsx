import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CircleAlert } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { spacing, type ThemeColors } from '../theme';

/**
 * Standard error state.
 *
 * `message` should describe what failed in plain language.
 */
interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  /** Extra guidance shown under the message when there is one. */
  hint?: string;
  retryLabel?: string;
}

export default function ErrorState({
  message,
  onRetry,
  hint,
  retryLabel = 'Try again',
}: ErrorStateProps) {
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <View style={styles.iconBadge} importantForAccessibility="no">
        <CircleAlert size={20} color={colors.onDanger} strokeWidth={2.2} />
      </View>
      <Text style={[typography.heading, styles.title]} accessibilityRole="header">
        Something went wrong
      </Text>
      <Text style={[typography.body, styles.message]}>{message}</Text>
      {hint ? (
        <Text style={[typography.caption, styles.hint]}>{hint}</Text>
      ) : null}
      {onRetry ? (
        <Pressable
          style={({ pressed }) => [
            shared.primaryButton,
            styles.retry,
            pressed && styles.pressed,
          ]}
          onPress={onRetry}
          accessibilityLabel={retryLabel}
          accessibilityRole="button"
          accessibilityHint="Attempts the action again"
        >
          <Text style={shared.primaryButtonText}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      backgroundColor: c.dangerSurface,
      borderColor: c.danger,
      borderWidth: 1,
      borderRadius: 16,
      padding: spacing(5),
      marginVertical: spacing(2),
    },
    iconBadge: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing(3),
    },
    title: {
      color: c.danger,
    },
    message: {
      color: c.body,
      marginTop: spacing(2),
    },
    hint: {
      marginTop: spacing(2),
    },
    retry: {
      marginTop: spacing(4),
      alignSelf: 'stretch',
    },
    pressed: {
      opacity: 0.85,
      transform: [{ scale: 0.99 }],
    },
  });
