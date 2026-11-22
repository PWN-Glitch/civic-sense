import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import ErrorState from '../components/ErrorState';
import Loading from '../components/Loading';
import ScreenHeader from '../components/ScreenHeader';
import { useTheme } from '../lib/theme';
import { font, layout, radius, spacing, type ThemeColors } from '../theme';
import type { ImpactStats } from '../types';

/**
 * City-wide tallies.
 *
 * This screen exists to answer "is any of this working?" with numbers the app
 * actually recorded. Every figure is a count of rows in the database — no
 * estimates, no projections, no sample "demo" data — and the footnote says so
 * in plain words. An empty city shows zeros, not a flattering placeholder.
 */

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function ImpactScreen() {
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<ImpactStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const { data } = await api.get<ImpactStats>('/stats/impact');
      setStats(data);
      setError(null);
    } catch {
      setError("We couldn't load the city totals.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const topInset = { paddingTop: insets.top + spacing(2) };

  if (loading) return <Loading message="Counting reports…" />;

  if (error && !stats) {
    return (
      <View style={[shared.screen, shared.container, topInset]}>
        <ErrorState
          message={error}
          hint="Check your connection, then retry."
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        />
      </View>
    );
  }

  const total = stats?.total_reports ?? 0;
  const resolved = stats?.resolved_reports ?? 0;
  const open = Math.max(0, total - resolved);
  const rate = Math.round((stats?.resolution_rate ?? 0) * 100);
  const peak = Math.max(1, ...(stats?.by_category ?? []).map((row) => row.total));
  const avgDays = stats?.avg_days_to_resolve;

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={[
        shared.container,
        topInset,
        { paddingBottom: spacing(10) },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
        />
      }
    >
      <ScreenHeader
        eyebrow="Civic Sense · 311"
        title="City impact"
        meta="BALTIMORE · ALL TIME"
      />

      {/* The three figures that answer the question. One name per number:
          "on file" is the record we hold, "resolved" is the count that came
          back fixed, "open" is the remainder. The rate lives in the fact rows
          so it cannot be mistaken for a second, differently-named total. */}
      <View style={styles.headline}>
        <View style={styles.headlineCell}>
          <Text style={[typography.meta, styles.cellLabel]}>On file</Text>
          <Text style={typography.stat}>{total}</Text>
        </View>
        <View style={styles.headlineRule} />
        <View style={styles.headlineCell}>
          <Text style={[typography.meta, styles.cellLabel]}>Resolved</Text>
          <Text style={[typography.stat, styles.resolved]}>{resolved}</Text>
        </View>
        <View style={styles.headlineRule} />
        <View style={styles.headlineCell}>
          <Text style={[typography.meta, styles.cellLabel]}>Open</Text>
          <Text style={typography.stat}>{open}</Text>
        </View>
      </View>

      <View style={styles.factRow}>
        <Text style={[typography.meta, styles.factKey]}>THIS MONTH</Text>
        <Text style={[typography.meta, styles.factValue]}>
          {stats?.reports_last_30_days ?? 0} on file
        </Text>
      </View>
      <View style={[styles.factRow, styles.factRowRule]}>
        <Text style={[typography.meta, styles.factKey]}>RESOLVE RATE</Text>
        <Text style={[typography.meta, styles.factValue]}>{rate}%</Text>
      </View>
      <View style={[styles.factRow, styles.factRowRule]}>
        <Text style={[typography.meta, styles.factKey]}>TIME TO FIX</Text>
        <Text style={[typography.meta, styles.factValue]}>
          {avgDays === null || avgDays === undefined
            ? 'no resolved cases yet'
            : `${avgDays} days on average`}
        </Text>
      </View>

      <View style={styles.sectionHead}>
        <Text style={typography.eyebrow}>By category</Text>
        <View style={styles.headRule} />
        {/* The bars are two segments; without this the colour split is
            decoration. Kept on the rule so it costs no extra vertical space. */}
        <View style={styles.legend} accessibilityElementsHidden>
          <View style={[styles.legendSwatch, styles.legendResolved]} />
          <Text style={[typography.meta, styles.legendText]}>resolved</Text>
          <View style={[styles.legendSwatch, styles.legendOpen]} />
          <Text style={[typography.meta, styles.legendText]}>on file</Text>
        </View>
      </View>

      {stats && stats.by_category.length > 0 ? (
        <View style={styles.ledger}>
          {stats.by_category.map((row, index) => (
            <View
              key={row.category}
              style={[styles.ledgerRow, index > 0 && styles.ledgerRowRule]}
              accessibilityLabel={`${titleCase(row.category)}: ${
                row.total
              } on file, ${row.resolved} resolved`}
            >
              <View style={styles.ledgerHead}>
                <Text style={[typography.label, styles.category]}>
                  {titleCase(row.category)}
                </Text>
                <Text style={[typography.meta, styles.counts]}>
                  {row.total} on file · {row.resolved} resolved
                </Text>
              </View>
              <View style={styles.track} importantForAccessibility="no">
                <View
                  style={[
                    styles.fill,
                    { width: `${Math.round((row.total / peak) * 100)}%` },
                  ]}
                />
                {row.resolved > 0 ? (
                  <View
                    style={[
                      styles.fillResolved,
                      { width: `${Math.round((row.resolved / peak) * 100)}%` },
                    ]}
                  />
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.emptyNote}>
          <Text style={[typography.body, styles.emptyBody]}>
            Nothing on file yet. The first report will show up here.
          </Text>
        </View>
      )}

      <View style={styles.footnote}>
        <Text style={[typography.caption, styles.footnoteText]}>
          Counted from reports made in Civic Sense. Baltimore&apos;s
          311 system does not publish a public API, so this is the app&apos;s
          own record — not a city-wide statistic.
        </Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // A tally header, not a card: the gold file-tab rule carries the identity,
    // and the figures sit on the page like the fact rows directly below.
    headline: {
      flexDirection: 'row',
      alignItems: 'stretch',
      borderTopWidth: 2,
      borderTopColor: c.warning,
      paddingTop: spacing(3),
      maxWidth: layout.maxContentWidth,
    },
    headlineCell: {
      flex: 1,
      gap: spacing(0.5),
    },
    headlineRule: {
      width: layout.rule,
      backgroundColor: c.hairline,
    },
    cellLabel: {
      textTransform: 'uppercase',
    },
    resolved: {
      color: c.success,
    },
    factRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      paddingVertical: spacing(3),
      maxWidth: layout.maxContentWidth,
    },
    factRowRule: {
      borderTopWidth: layout.rule,
      borderTopColor: c.hairline,
    },
    factKey: {
      letterSpacing: 1,
    },
    factValue: {
      color: c.ink,
      textTransform: 'uppercase',
    },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(2),
      marginTop: spacing(5),
      marginBottom: spacing(2),
    },
    headRule: {
      flex: 1,
      height: layout.rule,
      backgroundColor: c.border,
    },
    legend: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1),
    },
    legendSwatch: {
      width: 7,
      height: 7,
      borderRadius: radius.sm,
    },
    legendResolved: {
      backgroundColor: c.success,
    },
    legendOpen: {
      backgroundColor: c.borderStrong,
    },
    legendText: {
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginRight: spacing(1.5),
    },
    ledger: {
      maxWidth: layout.maxContentWidth,
    },
    ledgerRow: {
      paddingVertical: spacing(3),
      gap: spacing(1.5),
    },
    ledgerRowRule: {
      borderTopWidth: layout.rule,
      borderTopColor: c.hairline,
    },
    ledgerHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: spacing(2),
    },
    category: {
      fontFamily: font.semibold,
    },
    counts: {
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    track: {
      height: 10,
      backgroundColor: c.surfaceAlt,
      borderRadius: radius.sm,
      overflow: 'hidden',
      justifyContent: 'center',
    },
    fill: {
      position: 'absolute',
      left: 0,
      height: 10,
      backgroundColor: c.borderStrong,
    },
    // Resolved portion drawn over the total, so the gap is the open work.
    fillResolved: {
      position: 'absolute',
      left: 0,
      height: 10,
      backgroundColor: c.success,
    },
    emptyNote: {
      borderLeftWidth: 2,
      borderLeftColor: c.warning,
      paddingLeft: spacing(3.5),
      maxWidth: layout.maxContentWidth,
    },
    emptyBody: {
      color: c.muted,
    },
    footnote: {
      marginTop: spacing(7),
      borderTopWidth: layout.rule,
      borderTopColor: c.border,
      paddingTop: spacing(3),
      maxWidth: layout.maxContentWidth,
    },
    footnoteText: {
      lineHeight: 17,
    },
  });
