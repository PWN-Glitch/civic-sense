import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChevronRight, Trash2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import ImpactStats from '../components/ImpactStats';
import Loading from '../components/Loading';
import ScreenHeader from '../components/ScreenHeader';
import StatusStamp from '../components/StatusStamp';
import { caseNumber, shortDate as formatDate } from '../lib/docket';
import { deleteDraft, listDrafts, type Draft } from '../lib/drafts';
import { useDraftStore } from '../lib/offline';
import { useTheme } from '../lib/theme';
import { useFocusReload } from '../lib/useFocusReload';
import { font, layout, spacing, type ThemeColors } from '../theme';
import type { Report } from '../types';

/**
 * Rendered as a bottom-tab screen; `navigate` bubbles up to the parent
 * stack for Camera / Track. Loosely typed so the screen mounts identically
 * in tests and under either navigator.
 */
interface Props {
  navigation: {
    navigate: (screen: string, params?: object) => void;
  };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function MyReportsScreen({ navigation }: Props) {
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [reports, setReports] = useState<Report[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    // Local drafts always load; they're what makes this screen useful
    // offline. The server list may legitimately fail without connectivity.
    setDrafts(await listDrafts().catch(() => []));
    try {
      const { data } = await api.get<Report[]>('/reports/mine');
      setReports(data);
      setError(null);
    } catch {
      setError("We couldn't load your reports.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // This tab stays mounted for the life of the app, so the mount fetch alone
  // would never show a report filed on another screen. Load once on mount, then
  // again whenever the tab regains focus — but not for the focus event that
  // coincides with mounting, which the mount load already covers.
  const loadedOnce = useRef(false);
  useEffect(() => {
    void load().then(() => {
      loadedOnce.current = true;
    });
  }, [load]);
  useFocusReload(navigation, () => {
    if (loadedOnce.current) void load();
  });

  const confirmDeleteServerReport = (report: Report) => {
    Alert.alert(
      'Delete report?',
      `Are you sure you want to delete ${caseNumber(report.id)}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/reports/${report.id}`);
              setReports((prev) => prev.filter((r) => r.id !== report.id));
            } catch {
              setError("We couldn't delete the report. Please try again.");
            }
          },
        },
      ],
    );
  };

  const confirmDeleteLocalDraft = (draft: Draft) => {
    Alert.alert(
      'Delete draft?',
      draft.report_id
        ? `The ${titleCase(draft.category)} report is already filed. Delete it here and its photo won't be sent.`
        : `Are you sure you want to delete this unsent ${titleCase(draft.category)} draft?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDraft(draft.id);
              await useDraftStore.getState().refresh();
              setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
            } catch {
              setError("We couldn't delete the draft.");
            }
          },
        },
      ],
    );
  };
  const resolved = reports.filter((r) => r.status === 'Resolved').length;
  // This tab hides the native header (the title lives in ScreenHeader), so the
  // screen owns the status-bar inset itself.
  const topInset = { paddingTop: insets.top + spacing(2) };

  if (loading) {
    return <Loading message="Loading your reports…" />;
  }

  // Full-screen error only when there is genuinely nothing to show;
  // otherwise the error appears inline above the drafts/list.
  if (error && reports.length === 0 && drafts.length === 0) {
    return (
      <View style={[shared.screen, shared.container, topInset, styles.center]}>
        <ErrorState
          message={error}
          hint="Reports you saved as drafts on this device would appear below. Check your connection and pull down to retry."
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        />
      </View>
    );
  }

  const empty = reports.length === 0 && drafts.length === 0 && !error;

  return (
    <FlatList
      style={shared.screen}
      contentContainerStyle={[
        shared.container,
        topInset,
        // Clears the tab bar so the final docket entry isn't cut in half.
        { paddingBottom: spacing(10) },
        empty && styles.emptyFill,
      ]}
      data={reports}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
        />
      }
      ListHeaderComponent={
        <View>
          <ScreenHeader
            eyebrow="Civic Sense · 311"
            title="My reports"
            meta={`${reports.length} ON FILE · ${resolved} RESOLVED`}
          />
          <ImpactStats reported={reports.length} resolved={resolved} />
          {error ? (
            <ErrorState
              message={error}
              onRetry={() => {
                setLoading(true);
                void load();
              }}
              hint="Pulling down also retries."
            />
          ) : null}
          {drafts.length > 0 ? (
            <View style={styles.draftsSection}>
              <View style={styles.sectionHead}>
                <Text
                  style={[typography.eyebrow, styles.draftsTitle]}
                  accessibilityRole="header"
                >
                  Not yet submitted
                </Text>
                <View style={styles.headRule} />
              </View>
              <Text style={[typography.caption, styles.sectionNote]}>
                Saved on this device while offline. They send automatically
                when you&apos;re back online.
              </Text>
              <View style={styles.docket}>
                {drafts.map((draft, index) => (
                  <View
                    key={draft.id}
                    style={[styles.draftRow, index > 0 && styles.rowRule]}
                    accessibilityLabel={`${titleCase(
                      draft.category,
                    )} draft, saved ${formatDate(
                      draft.created_at,
                    )}, ${draft.report_id ? 'filed, photo not yet sent' : 'not yet submitted'}`}
                  >
                    <View style={styles.rowHead}>
                      <Text style={[typography.meta, styles.caseNo]}>
                        LOCAL
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(2) }}>
                        <StatusStamp status="Draft" />
                        <Pressable
                          hitSlop={8}
                          onPress={() => confirmDeleteLocalDraft(draft)}
                          accessibilityRole="button"
                          accessibilityLabel="Delete draft"
                        >
                          <Trash2 size={16} color={colors.danger} strokeWidth={2} />
                        </Pressable>
                      </View>
                    </View>
                    <Text style={[typography.heading, styles.rowTitle]}>
                      {titleCase(draft.category)}
                    </Text>
                    <Text style={typography.caption} numberOfLines={2}>
                      {draft.description}
                    </Text>
                    <Text style={[typography.meta, styles.rowFoot]}>
                      {formatDate(draft.created_at)} ·{' '}
                      {draft.report_id ? 'FILED · PHOTO WAITING TO SEND' : 'WAITING TO SEND'}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {reports.length > 0 ? (
            <View style={styles.sectionHead}>
              <Text
                style={[typography.eyebrow, styles.filedTitle]}
                accessibilityRole="header"
              >
                Your docket
              </Text>
              <View style={styles.headRule} />
            </View>
          ) : null}
        </View>
      }
      ItemSeparatorComponent={() => <View style={styles.rowRule} />}
      ListEmptyComponent={
        empty ? (
          <EmptyState
            title="No reports yet"
            message="Spot a problem? Tap Report a problem and it will show up here."
            actionLabel="Report a problem"
            onAction={() => navigation.navigate('Camera')}
            actionHint="Or use the Report dial at the bottom of any screen."
            emphasis="quiet"
          />
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={() => navigation.navigate('Track', { reportId: item.id })}
          accessibilityLabel={`${item.category} report, status ${item.status}, reported ${formatDate(item.created_at)}`}
          accessibilityRole="button"
          accessibilityHint="Opens the status timeline for this report"
        >
          <View style={styles.rowHead}>
            <Text style={[typography.meta, styles.caseNo]}>
              {caseNumber(item.id)}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(2) }}>
              <StatusStamp status={item.status} />
              <Pressable
                hitSlop={8}
                onPress={() => confirmDeleteServerReport(item)}
                accessibilityRole="button"
                accessibilityLabel={`Delete report ${caseNumber(item.id)}`}
              >
                <Trash2 size={16} color={colors.danger} strokeWidth={2} />
              </Pressable>
            </View>
          </View>
          <Text style={[typography.heading, styles.rowTitle]}>
            {titleCase(item.category)}
          </Text>
          <Text style={typography.caption} numberOfLines={2}>
            {item.description}
          </Text>
          <View style={styles.rowFootRow}>
            <Text style={[typography.meta, styles.rowFoot]}>
              {formatDate(item.created_at)}
            </Text>
            <View style={styles.open}>
              <Text style={styles.openText}>Open</Text>
              <ChevronRight
                size={14}
                color={colors.muted}
                strokeWidth={2.2}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            </View>
          </View>
        </Pressable>
      )}
    />
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyFill: {
      flexGrow: 1,
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
    sectionNote: {
      marginBottom: spacing(2),
      maxWidth: 420,
    },
    draftsSection: {
      marginTop: spacing(1),
    },
    draftsTitle: {
      color: c.warning,
    },
    filedTitle: {},
    // The docket: no card, no shadow — hairline rules between entries, the
    // way a ledger separates its lines.
    docket: {},
    row: {
      paddingVertical: spacing(3.5),
      minHeight: 44,
      gap: spacing(1),
      maxWidth: layout.maxContentWidth,
    },
    draftRow: {
      paddingVertical: spacing(3),
      paddingHorizontal: spacing(3),
      borderLeftWidth: 2,
      borderLeftColor: c.warning,
      backgroundColor: c.surface,
      gap: spacing(1),
    },
    rowRule: {
      height: layout.rule,
      backgroundColor: c.border,
    },
    rowPressed: {
      backgroundColor: c.surfaceAlt,
    },
    rowHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing(3),
      marginBottom: spacing(0.5),
    },
    caseNo: {
      letterSpacing: 0.6,
    },
    rowTitle: {
      lineHeight: 23,
    },
    rowFootRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing(1),
    },
    rowFoot: {
      textTransform: 'uppercase',
    },
    open: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    openText: {
      fontFamily: font.semibold,
      fontSize: 12,
      color: c.muted,
    },
  });
