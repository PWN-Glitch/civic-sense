import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Share2, TriangleAlert } from 'lucide-react-native';
import { api } from '../api/client';
import ErrorState from '../components/ErrorState';
import { CategoryIcon } from '../components/Icon';
import Loading from '../components/Loading';
import ScreenHeader from '../components/ScreenHeader';
import StatusStamp from '../components/StatusStamp';
import StatusTimeline from '../components/StatusTimeline';
import SubmissionTimeline from '../components/SubmissionTimeline';
import { caseNumber, reportLink, shortDate } from '../lib/docket';
import { useEnterTransition } from '../lib/motion';
import { useTheme } from '../lib/theme';
import { font, layout, spacing, type ThemeColors } from '../theme';
import type { Report, ReportEvent } from '../types';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Track'>;

export default function TrackScreen({ route }: Props) {
  const { reportId } = route.params;
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const enter = useEnterTransition();
  const [report, setReport] = useState<Report | null>(null);
  const [events, setEvents] = useState<ReportEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const nextStatusOption = useMemo(() => {
    if (!report) return null;
    if (report.status === 'Submitted') {
      return { label: 'Log city response received', nextStatus: 'Acknowledged' };
    }
    if (report.status === 'Acknowledged') {
      return { label: 'Log city repair in progress', nextStatus: 'InProgress' };
    }
    if (report.status === 'InProgress') {
      return { label: 'Log issue resolved', nextStatus: 'Resolved' };
    }
    return null;
  }, [report]);

  const recordManualUpdate = async (nextStatus: string) => {
    if (updatingStatus) return;
    setUpdatingStatus(true);
    try {
      const { data } = await api.patch<Report>(`/reports/${reportId}`, {
        status: nextStatus,
      });
      setReport(data);
    } catch {
      setError("We couldn't update the status. Please try again.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Report>(`/reports/${reportId}`);
      setReport(data);
      setError(null);
      // Submission audit log is best-effort: if the endpoint isn't there
      // yet (older backend), the official timeline still renders.
      try {
        const { data: evts } = await api.get<ReportEvent[]>(
          `/reports/${reportId}/events`,
        );
        setEvents(Array.isArray(evts) ? evts : []);
      } catch {
        setEvents([]);
      }
    } catch {
      setError("We couldn't load this report.");
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <Loading message="Loading report status…" />;
  }

  if (error && !report) {
    return (
      <View style={[shared.screen, shared.container, styles.center]}>
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            void load();
          }}
          hint="You can also find this report under My Reports."
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={shared.container}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={() => void load()} />
      }
    >
      <Animated.View style={enter}>
        <ScreenHeader
          eyebrow="Civic Sense · 311"
          title="Case file"
          meta={
            report
              ? `${caseNumber(report.id)} · ON FILE ${shortDate(report.created_at)}`
              : 'LOADING CASE'
          }
        />

        {error ? (
          <ErrorState
            message={error}
            onRetry={() => {
              setLoading(true);
              void load();
            }}
          />
        ) : null}

      {report ? (
        <>
          <View style={styles.summaryCard}>
            <View style={styles.summaryHeader}>
              <View
                style={styles.summaryIconBadge}
                importantForAccessibility="no"
              >
                <CategoryIcon
                  category={report.category}
                  size={20}
                  color={colors.ink}
                />
              </View>
              <View style={styles.summaryHeaderText}>
                <Text style={[typography.label, styles.summaryTitle]}>
                  {report.category.charAt(0).toUpperCase() +
                    report.category.slice(1)}
                </Text>
              </View>
              <StatusStamp status={report.status} />
            </View>
            <View style={styles.summaryRule} />
            <Text style={[typography.body, styles.description]}>
              {report.description}
            </Text>
            <Pressable
              onPress={() => {
                void Share.share({
                  message: `A ${report.category} reported in Baltimore — follow it on Civic Sense: ${reportLink(
                    report.id,
                  )}`,
                });
              }}
              style={({ pressed }) => [
                styles.shareRow,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Share this report"
              accessibilityHint="Opens the system share sheet with a link to this case"
            >
              <Share2
                size={15}
                color={colors.ink}
                strokeWidth={2.2}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text style={styles.shareText}>Share this report</Text>
            </Pressable>
          </View>

          {report.possible_duplicates &&
          report.possible_duplicates.length > 0 ? (
            <View style={styles.dupeBox}>
              <View style={styles.dupeTitleRow}>
                <TriangleAlert
                  size={15}
                  color={colors.warning}
                  strokeWidth={2.2}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={[typography.label, { color: colors.warning }]}>
                  Possible duplicate
                </Text>
              </View>
              <Text style={[typography.caption, styles.dupeBody]}>
                {report.possible_duplicates.length} similar report
                {report.possible_duplicates.length === 1 ? '' : 's'} already
                exist nearby. Yours still counts.
              </Text>
            </View>
          ) : null}

          <View style={styles.timeline}>
            <Text style={[typography.eyebrow, styles.timelineEyebrow]}>
              Status
            </Text>
            <View style={styles.timelineCard}>
              <StatusTimeline history={report.status_history ?? []} />
            </View>
          </View>

          {nextStatusOption ? (
            <View style={styles.manualUpdateBox}>
              <Text style={[typography.eyebrow, { color: colors.muted }]}>
                Have you received an update?
              </Text>
              <Text style={[typography.caption, { marginTop: spacing(1), marginBottom: spacing(3) }]}>
                Baltimore 311 does not publish live updates. If the city contacted you or fixed the issue, record it here (marked as reported by you).
              </Text>
              <Pressable
                style={[shared.secondaryButton, { minHeight: 44, justifyContent: 'center', alignItems: 'center' }]}
                onPress={() => void recordManualUpdate(nextStatusOption.nextStatus)}
                disabled={updatingStatus}
                accessibilityRole="button"
                accessibilityLabel={nextStatusOption.label}
              >
                <Text style={shared.secondaryButtonText}>{nextStatusOption.label}</Text>
              </Pressable>
            </View>
          ) : null}

          {events.length > 0 ? (
            <View style={styles.submissionSection}>
              <Text style={[typography.eyebrow, styles.submissionTitle]}>
                Your submission
              </Text>
              <Text style={[typography.caption, styles.submissionNote]}>
                {report.submission_state === 'status_unknown'
                  ? 'Sent by you · Awaiting city update.'
                  : "What happened on your device — separate from the city's official status above."}
              </Text>
              <View style={styles.timelineCard}>
                <SubmissionTimeline events={events} />
              </View>
            </View>
          ) : null}
        </>
      ) : null}

        <Pressable
          style={[shared.secondaryButton, styles.refresh]}
          onPress={() => void load()}
          accessibilityLabel="Refresh status"
          accessibilityRole="button"
          accessibilityHint="Reloads the latest status from the server"
        >
          <Text style={shared.secondaryButtonText}>Refresh</Text>
        </Pressable>
      </Animated.View>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    summaryCard: {
      backgroundColor: c.surface,
      borderRadius: 3,
      borderWidth: 1,
      borderColor: c.border,
      borderTopWidth: 2,
      borderTopColor: c.warning,
      padding: spacing(4),
      maxWidth: layout.maxContentWidth,
    },
    summaryHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(3),
    },
    summaryIconBadge: {
      width: 40,
      height: 40,
      borderRadius: 2,
      borderWidth: layout.rule,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    summaryTitle: {
      fontFamily: font.semibold,
      fontSize: 17,
    },
    shareRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(2),
      minHeight: 44,
      marginTop: spacing(2),
    },
    shareText: {
      fontFamily: font.semibold,
      fontSize: 14,
      color: c.ink,
    },
    pressed: {
      opacity: 0.6,
    },
    summaryHeaderText: {
      flex: 1,
      gap: 2,
    },
    summaryRule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.hairline,
      marginTop: spacing(3),
    },
    description: {
      marginTop: spacing(3),
    },
    dupeBox: {
      backgroundColor: c.warningSurface,
      borderRadius: 12,
      padding: spacing(4),
      marginTop: spacing(3),
    },
    dupeTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(2),
    },
    dupeBody: {
      marginTop: spacing(1),
    },
    timeline: {
      marginTop: spacing(5),
    },
    timelineEyebrow: {
      marginBottom: spacing(2),
    },
    timelineCard: {
      backgroundColor: c.surface,
      borderRadius: 3,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing(4),
      maxWidth: layout.maxContentWidth,
    },
    manualUpdateBox: {
      backgroundColor: c.surface,
      borderRadius: 3,
      borderWidth: 1,
      borderColor: c.hairline,
      padding: spacing(4),
      marginTop: spacing(4),
      maxWidth: layout.maxContentWidth,
    },
    submissionSection: {
      marginTop: spacing(6),
    },
    submissionTitle: {
      marginBottom: spacing(0.5),
    },
    submissionNote: {
      marginTop: spacing(1),
      marginBottom: spacing(3),
    },
    refresh: {
      marginTop: spacing(4),
    },
  });
