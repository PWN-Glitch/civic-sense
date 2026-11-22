import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { layout, spacing, type ThemeColors } from '../theme';

/**
 * The tally at the top of the case file: two figures a resident actually
 * cares about, set in monospace like the counters on a meter. No icons, no
 * accent per row beyond the one that marks a resolved case — the numbers are
 * the content, and two chroma colours in a three-item row is noise.
 */
export default function ImpactStats({
  reported,
  resolved,
}: {
  reported: number;
  resolved: number;
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.block}>
      <View style={styles.cell}>
        <Text style={[typography.meta, styles.label]}>On file</Text>
        <Text style={[typography.stat, styles.value]}>{reported}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.cell}>
        <Text style={[typography.meta, styles.label]}>Resolved</Text>
        <Text style={[typography.stat, styles.value, styles.resolved]}>
          {resolved}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Same tally header as City impact: gold file-tab rule, figures on the
    // page. A bordered card here would be the only one left in the app.
    block: {
      flexDirection: 'row',
      alignItems: 'stretch',
      borderTopWidth: 2,
      borderTopColor: c.warning,
      paddingTop: spacing(3),
      maxWidth: layout.maxContentWidth,
    },
    cell: {
      flex: 1,
      gap: spacing(0.5),
    },
    divider: {
      width: layout.rule,
      backgroundColor: c.hairline,
    },
    label: {
      textTransform: 'uppercase',
    },
    value: {
      marginTop: 2,
    },
    resolved: {
      color: c.success,
    },
  });
