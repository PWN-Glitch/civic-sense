import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { font, radius, spacing, type ThemeColors } from '../theme';
import type { Category } from '../types';

interface ConfidenceBarProps {
  /** 0..1 */
  confidence: number;
  band: 'high' | 'medium' | 'low';
  /** Category being judged — named in the plain-language line. */
  category?: Category;
}

const BAND_LABELS = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
} as const;

/** Percent (0–100) for a 0–1 score, or null when the score isn't a number. */
export function percentSure(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

/** "94%" for 0.94, "—" when the score isn't a number. */
export function formatPercent(value: number): string {
  const pct = percentSure(value);
  return pct === null ? '—' : `${pct}%`;
}

/**
 * Noun phrase for a category, article included: "a pothole" but "trash".
 *
 * Category names are mass nouns or count nouns depending on the class, so a
 * single template ("this is a X") reads wrong for half of them — "this is a
 * trash" is the kind of line that makes an app feel machine-written.
 */
export function categoryPhrase(category?: Category | null): string {
  switch (category) {
    case 'pothole':
      return 'a pothole';
    case 'streetlight':
      return 'a streetlight problem';
    case 'sidewalk damage':
      return 'sidewalk damage';
    case 'trash':
      return 'trash';
    case 'graffiti':
      return 'graffiti';
    default:
      return 'a problem';
  }
}

/**
 * "How sure is it?" — the one number a person needs before trusting a
 * machine's guess.
 *
 * The percentage is the headline, stated in words ("percent sure this is a
 * pothole"), with the band as the caption. One caption: the screen already
 * says once that the category is a guess and once what leaves the phone, and a
 * third hedge ("Trustworthy" / "Check it before filing") only repeated the
 * band in different words. The track is squared like the rest of the form and
 * the fill is the only saturated colour on the screen, so the eye can read the
 * certainty without reading the copy.
 */
export default function ConfidenceBar({
  confidence,
  band,
  category,
}: ConfidenceBarProps) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const bandColors = {
    high: colors.success,
    medium: colors.warning,
    low: colors.danger,
  } as const;
  const pct = percentSure(confidence);
  const barColor = bandColors[band];
  const phrase = categoryPhrase(category);
  const subject = ` it's ${phrase}`;
  const spoken =
    pct === null
      ? 'Confidence unavailable.'
      : `${pct} percent sure${subject}. ${BAND_LABELS[band]}.`;

  return (
    <View
      accessible
      accessibilityLabel={spoken}
      accessibilityRole="progressbar"
      accessibilityValue={
        pct === null ? undefined : { min: 0, max: 100, now: pct }
      }
      style={styles.wrapper}
    >
      <View style={styles.readout}>
        <Text
          style={[
            typography.stat,
            styles.pct,
            pct === null ? styles.unknown : { color: barColor },
          ]}
        >
          {pct === null ? '—' : `${pct}%`}
        </Text>
        <View style={styles.readoutText}>
          <Text style={typography.body} numberOfLines={2}>
            {pct === null
              ? 'The model did not return a usable score.'
              : `sure this is ${phrase}`}
          </Text>
        </View>
      </View>

      <View style={styles.track} importantForAccessibility="no">
        <View
          style={[
            styles.fill,
            {
              width: `${pct ?? 0}%`,
              backgroundColor: pct === null ? colors.border : barColor,
            },
          ]}
        />
      </View>

      <View style={styles.labelRow}>
        <Text style={[typography.caption, styles.band]}>{BAND_LABELS[band]}</Text>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrapper: {
      marginVertical: spacing(1),
      gap: spacing(2),
    },
    readout: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(3),
    },
    pct: {
      fontSize: 38,
      lineHeight: 42,
      letterSpacing: -1.4,
    },
    unknown: {
      color: c.muted,
    },
    readoutText: {
      flex: 1,
      gap: 2,
    },
    track: {
      height: 8,
      borderRadius: radius.sm,
      backgroundColor: c.surfaceAlt,
      overflow: 'hidden',
    },
    fill: {
      height: 8,
      borderRadius: radius.sm,
    },
    labelRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing(2),
    },
    band: {
      fontFamily: font.mono,
      fontSize: 10.5,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
  });
