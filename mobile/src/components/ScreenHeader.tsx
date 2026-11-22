import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { layout, spacing, type ThemeColors } from '../theme';

/**
 * The head of a form: a gold rule, the issuing office, the title, and a
 * monospaced line of facts about what is on the page. Every tab screen opens
 * with one, which is why the native stack header is hidden on those screens —
 * two titles in a row is the defect this replaces.
 */
interface ScreenHeaderProps {
  /** Issuing office / context. Mono, tracked-out, uppercased. */
  eyebrow?: string;
  title: string;
  /** Docket line: counts, dates, case ranges. Rendered in mono. */
  meta?: string;
  /** Optional trailing element (a control, a mode toggle). */
  accessory?: React.ReactNode;
}

export default function ScreenHeader({
  eyebrow,
  title,
  meta,
  accessory,
}: ScreenHeaderProps) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <View style={styles.text}>
        <View style={styles.rule} />
        {eyebrow ? (
          <Text style={[typography.eyebrow, styles.eyebrow]}>{eyebrow}</Text>
        ) : null}
        <Text style={[typography.display, styles.title]} accessibilityRole="header">
          {title}
        </Text>
        {meta ? <Text style={[typography.meta, styles.meta]}>{meta}</Text> : null}
      </View>
      {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing(3),
      paddingBottom: spacing(5),
      maxWidth: layout.maxContentWidth,
      alignSelf: 'stretch',
    },
    text: {
      flex: 1,
      gap: spacing(1.5),
    },
    // The one fixed mark of the identity: 3dp of city gold, 40dp wide.
    rule: {
      width: 40,
      height: 3,
      backgroundColor: c.warning,
      marginBottom: spacing(2),
    },
    eyebrow: {
      color: c.muted,
    },
    title: {},
    meta: {
      marginTop: spacing(0.5),
    },
    accessory: {
      paddingTop: spacing(4),
    },
  });
