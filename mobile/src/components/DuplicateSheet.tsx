import React, { useMemo } from 'react';
import {Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { font, radius, spacing, type ThemeColors } from '../theme';
import { shortDate } from '../lib/docket';
import type { Report } from '../types';

/**
 * Duplicate-protection sheet: shown when the pre-flight
 * GET /reports/duplicates probe finds a same-category report nearby.
 * Nothing has been filed at this point — the user decides whether to
 * contribute to the existing report or file a separate one.
 */
interface DuplicateSheetProps {
  visible: boolean;
  duplicates: Report[];
  onViewExisting: (existing: Report) => void;
  onAddEvidence: (existing: Report) => void;
  onCreateNew: () => void;
}

export default function DuplicateSheet({
  visible,
  duplicates,
  onViewExisting,
  onAddEvidence,
  onCreateNew,
}: DuplicateSheetProps) {
  const { colors, typography, shared, elevation } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const first = duplicates[0];
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCreateNew}
      accessibilityViewIsModal
    >
      <View style={[styles.backdrop, { backgroundColor: colors.scrim + '99' }]}>
        <View
          style={[styles.sheet, elevation.raised]}
          accessibilityLabel="Possible existing report"
        >
          <View style={styles.grabber} importantForAccessibility="no" />
          <Text style={typography.heading} accessibilityRole="header">
            Possible existing report
          </Text>
          <Text style={[typography.body, styles.body]}>
            A similar issue was reported nearby
            {first?.created_at
              ? ` on ${shortDate(first.created_at)}`
              : ''}
            . If this is the same problem, add your photo to that report.
            Otherwise file yours separately.
          </Text>

          <Pressable
            style={({ pressed }) => [
              shared.primaryButton,
              styles.button,
              pressed && styles.pressed,
            ]}
            onPress={() => first && onViewExisting(first)}
            accessibilityLabel="View existing report"
            accessibilityRole="button"
          >
            <Text style={shared.primaryButtonText}>View existing</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              shared.secondaryButton,
              styles.button,
              pressed && styles.pressed,
            ]}
            onPress={() => first && onAddEvidence(first)}
            accessibilityLabel="Add photo to existing report"
            accessibilityRole="button"
            accessibilityHint="Adds your photo to their report as confirmation"
          >
            <Text style={shared.secondaryButtonText}>Add photo</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.createNew, pressed && styles.pressed]}
            onPress={onCreateNew}
            accessibilityLabel="Create new report anyway"
            accessibilityRole="button"
          >
            <Text style={styles.createNewText}>Create new</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: c.surfaceRaised,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      padding: spacing(6),
      paddingBottom: spacing(8),
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: c.border,
      marginBottom: spacing(4),
    },
    body: {
      marginTop: spacing(3),
      marginBottom: spacing(4),
    },
    button: {
      marginTop: spacing(3),
    },
    pressed: {
      opacity: 0.85,
      transform: [{ scale: 0.99 }],
    },
    createNew: {
      marginTop: spacing(3),
      minHeight: 48,
      justifyContent: 'center',
      alignItems: 'center',
    },
    createNewText: {
      color: c.primary,
      fontFamily: font.bold,
      fontSize: 16,
    },
  });
