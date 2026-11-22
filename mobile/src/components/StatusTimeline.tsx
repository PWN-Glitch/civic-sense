import React, { useMemo } from 'react';
import {StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { STATUS_LABELS } from './StatusStamp';
import { useTheme } from '../lib/theme';
import { font, spacing, type ThemeColors } from '../theme';
import type { StatusHistoryEntry } from '../types';

interface StatusTimelineProps {
  history: StatusHistoryEntry[];
}

const STATUS_ORDER = [
  'Draft',
  'Confirmed',
  'Submitted',
  'Acknowledged',
  'InProgress',
  'Resolved',
] as const;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The civic status stepper — the app's signature element. A report's journey
 * to resolution renders as a connected rail of milestone beads: done beads
 * are filled, the current milestone carries a ring, and the final "Resolved"
 * bead turns green. Everything else on screen stays quiet so this reads.
 */
export default function StatusTimeline({ history }: StatusTimelineProps) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reached = new Set(history.map((h) => h.status));
  const latestByStatus = new Map<string, StatusHistoryEntry>();
  for (const entry of history) {
    latestByStatus.set(entry.status, entry);
  }
  // The current milestone is the furthest-along reached status; it gets the
  // ring so the eye lands on "where things stand now".
  const currentIndex = STATUS_ORDER.reduce(
    (acc, status, i) => (reached.has(status) ? i : acc),
    -1,
  );

  return (
    <View accessibilityLabel="Report status timeline">
      {STATUS_ORDER.map((status, index) => {
        const done = reached.has(status);
        const isCurrent = index === currentIndex;
        const isResolved = status === 'Resolved';
        const isLast = index === STATUS_ORDER.length - 1;
        const entry = latestByStatus.get(status);
        const beadColor = isResolved ? colors.success : colors.primary;
        return (
          <View key={status} style={styles.row}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.bead,
                  done && { backgroundColor: beadColor, borderColor: beadColor },
                  isCurrent && {
                    borderColor: beadColor,
                    backgroundColor: colors.surface,
                  },
                ]}
              >
                {done && !isCurrent ? (
                  <Check
                    size={13}
                    color={colors.onPrimary}
                    strokeWidth={3}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                ) : null}
                {isCurrent ? (
                  <View
                    style={[styles.beadCore, { backgroundColor: beadColor }]}
                    importantForAccessibility="no"
                  />
                ) : null}
              </View>
              {!isLast && (
                <View
                  style={[
                    styles.line,
                    done && { backgroundColor: isResolved ? colors.success : colors.primary },
                  ]}
                />
              )}
            </View>
            <View style={styles.content}>
              <Text
                style={[
                  typography.label,
                  isCurrent && { color: beadColor },
                  !done && { color: colors.muted, fontFamily: font.regular },
                ]}
              >
                {STATUS_LABELS[status]}
              </Text>
              {entry ? (
                <Text style={[typography.caption, styles.dateText]}>
                  {formatDate(entry.created_at)}
                  {entry.source === 'reported_by_user'
                    ? ' · Reported by you'
                    : entry.source
                      ? ` · via ${entry.source}`
                      : ''}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      minHeight: 56,
    },
    rail: {
      width: 28,
      alignItems: 'center',
    },
    bead: {
      width: 22,
      height: 22,
      borderRadius: 3,
      borderWidth: 2,
      borderColor: c.border,
      backgroundColor: c.surface,
      marginTop: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    beadCore: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    line: {
      flex: 1,
      width: 3,
      borderRadius: 1.5,
      backgroundColor: c.border,
      marginVertical: 3,
    },
    content: {
      flex: 1,
      paddingLeft: spacing(3),
      paddingBottom: spacing(4),
    },
    dateText: {
      fontVariant: ['tabular-nums'],
    },
  });
