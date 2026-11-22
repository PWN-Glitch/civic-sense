import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Inbox } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { font, layout, radius, spacing, type ThemeColors } from '../theme';

/**
 * Standard empty state component.
 *
 * Shown when a fetch succeeded but there is nothing to display. Always points
 * at the next action the user can take.
 */
interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHint?: string;
  emphasis?: 'primary' | 'quiet';
}

export default function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  actionHint,
  emphasis = 'primary',
}: EmptyStateProps) {
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      {/* A ruled plate with the glyph inset — the empty box on a form,
          waiting to be filled, rather than a decorative disc. */}
      <View style={styles.iconPlate} importantForAccessibility="no">
        <Inbox size={24} color={colors.muted} strokeWidth={1.5} />
      </View>
      <Text style={[typography.heading, styles.title]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[typography.body, styles.message]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          style={({ pressed }) => [
            emphasis === 'primary' ? shared.primaryButton : shared.secondaryButton,
            styles.action,
            pressed && styles.pressed,
          ]}
          onPress={onAction}
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          accessibilityHint={actionHint}
        >
          <Text
            style={
              emphasis === 'primary'
                ? shared.primaryButtonText
                : shared.secondaryButtonText
            }
          >
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
      {actionHint ? (
        <Text style={[typography.caption, styles.hint]}>{actionHint}</Text>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing(8),
      paddingHorizontal: spacing(5),
      maxWidth: 340,
      width: '100%',
      alignSelf: 'center',
    },
    iconPlate: {
      width: 48,
      height: 48,
      borderRadius: radius.sm,
      borderWidth: layout.rule,
      borderColor: c.border,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing(4),
    },
    title: {
      textAlign: 'center',
    },
    // The hint under the action is a footnote to the form, so it sits in the
    // mono face and reads as an instruction line, not body copy.
    message: {
      color: c.muted,
      textAlign: 'center',
      marginTop: spacing(2),
      maxWidth: 300,
    },
    action: {
      marginTop: spacing(5),
      alignSelf: 'stretch',
    },
    hint: {
      color: c.muted,
      fontFamily: font.mono,
      fontSize: 11,
      lineHeight: 16,
      textAlign: 'center',
      marginTop: spacing(3),
      maxWidth: 280,
    },
    pressed: {
      opacity: 0.85,
    },
  });
