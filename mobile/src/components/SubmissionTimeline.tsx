import React, { useMemo } from 'react';
import {StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { font, spacing, type ThemeColors } from '../theme';
import type { ReportEvent } from '../types';

/**
 * Submission timeline (week 4) — what *we* know happened to the report on
 * its way out, built from report_events. Kept strictly separate from the
 * official status timeline: for plain email/phone/webform the last node is
 * "Status unknown", never "received".
 */

interface SubmissionTimelineProps {
  events: ReportEvent[];
}

const STEPS = ['Prepared', 'Approved', 'Attempted', 'Status unknown'] as const;

const EVENT_TO_STEP: Record<string, (typeof STEPS)[number]> = {
  prepared: 'Prepared',
  approved: 'Approved',
  attempted: 'Attempted',
  sent: 'Attempted',
};

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

export default function SubmissionTimeline({ events }: SubmissionTimelineProps) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reachedAt = new Map<string, string>();
  for (const event of events) {
    const step = EVENT_TO_STEP[event.event_type];
    if (step) reachedAt.set(step, event.created_at);
  }
  // "Status unknown" is the truthful terminal state whenever the user got
  // as far as attempting a user-driven channel — we never claim receipt.
  const attempted = reachedAt.has('Attempted');

  return (
    <View accessibilityLabel="Submission timeline">
      {STEPS.map((step, index) => {
        const done =
          step === 'Status unknown' ? attempted : reachedAt.has(step);
        const isLast = index === STEPS.length - 1;
        const at = reachedAt.get(step);
        return (
          <View key={step} style={styles.row}>
            <View style={styles.rail}>
              <View style={[styles.bead, done && styles.dotDone]} />
              {!isLast && (
                <View style={[styles.line, done && styles.lineDone]} />
              )}
            </View>
            <View style={styles.content}>
              <Text
                style={[
                  typography.label,
                  !done && { color: colors.muted, fontFamily: font.regular },
                ]}
              >
                {step}
              </Text>
              {at && step !== 'Status unknown' ? (
                <Text style={typography.caption}>{formatDate(at)}</Text>
              ) : null}
              {step === 'Status unknown' && done ? (
                <Text style={typography.caption}>
                  Sent by you — the city's response isn't tracked.
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
    },
    dotDone: {
      borderColor: c.success,
      backgroundColor: c.success,
    },
    line: {
      flex: 1,
      width: 3,
      borderRadius: 1.5,
      backgroundColor: c.border,
      marginVertical: 3,
    },
    lineDone: {
      backgroundColor: c.success,
    },
    content: {
      flex: 1,
      paddingLeft: spacing(3),
      paddingBottom: spacing(4),
    },
  });
