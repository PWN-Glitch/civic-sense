import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { font, type ThemeColors } from '../theme';

/**
 * A rubber stamp, not a pill.
 *
 * Status on a work order is stamped onto the paper: a double-ruled box, a
 * slightly crooked impression, monospaced caps. Nothing here is colour-only —
 * the word is always inside the box — and the accessible label carries the
 * full phrase so TalkBack reads the same thing sighted users read.
 */

export type StampKind =
  | 'Draft'
  | 'Confirmed'
  | 'Submitted'
  | 'Acknowledged'
  | 'InProgress'
  | 'Resolved';

/** The one place a status becomes words. The timeline and the stamp must not
 * disagree, and the raw enum (`InProgress`) must never reach a reader. */
export const STATUS_LABELS: Record<StampKind, string> = {
  Draft: 'Draft',
  Confirmed: 'Confirmed',
  Submitted: 'Submitted',
  Acknowledged: 'Received',
  InProgress: 'In progress',
  Resolved: 'Resolved',
};

const tone = (c: ThemeColors): Record<StampKind, string> => ({
  Draft: c.muted,
  Confirmed: c.ink,
  Submitted: c.ink,
  Acknowledged: c.warning,
  InProgress: c.warning,
  Resolved: c.success,
});

export default function StatusStamp({ status }: { status: StampKind | string }) {
  const { colors } = useTheme();
  const strokes = tone(colors);
  const label =
    (STATUS_LABELS as Record<string, string>)[status] ??
    String(status).toUpperCase();
  const color = (strokes as Record<string, string>)[status] ?? colors.muted;
  const styles = makeStyles(color);

  return (
    <View style={styles.outer} accessible accessibilityLabel={label}>
      <View style={styles.inner}>
        <Text style={styles.text} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (color: string) =>
  StyleSheet.create({
    // Two rules, 2dp apart, turned a degree and a half off true — the
    // impression of something pressed by hand rather than drawn by a computer.
    outer: {
      alignSelf: 'flex-start',
      borderWidth: 1.2,
      borderColor: color,
      borderRadius: 2,
      padding: 1.6,
      transform: [{ rotate: '-1.5deg' }],
    },
    inner: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color,
      borderRadius: 1,
      paddingVertical: 2.5,
      paddingHorizontal: 6,
    },
    text: {
      fontFamily: font.monoBold,
      fontSize: 9.5,
      lineHeight: 12,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color,
    },
  });
