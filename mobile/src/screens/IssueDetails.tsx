import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Landmark } from 'lucide-react-native';
import { api } from '../api/client';
import BeforeAfter from '../components/BeforeAfter';
import ErrorState from '../components/ErrorState';
import { CategoryIcon } from '../components/Icon';
import Loading from '../components/Loading';
import StatusStamp from '../components/StatusStamp';
import StatusTimeline from '../components/StatusTimeline';
import VerificationBar from '../components/VerificationBar';
import { useAuthStore } from '../lib/auth';
import { caseNumber, shortDate } from '../lib/docket';
import { useTheme } from '../lib/theme';
import { spacing, type ThemeColors } from '../theme';
import type { Report, ReportPhoto, RoutingResult } from '../types';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'IssueDetails'>;

export default function IssueDetailsScreen({ route }: Props) {
  const { reportId } = route.params;
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [report, setReport] = useState<Report | null>(null);
  const [routing, setRouting] = useState<RoutingResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Report>(`/reports/${reportId}`);
      setReport(data);
      setError(null);

      try {
        const { data: routeData } = await api.post<RoutingResult>(
          '/routing/resolve',
          { lat: data.lat, lng: data.lng, category: data.category },
        );
        setRouting(routeData);
      } catch {
        // Routing info is helpful but not essential to this screen.
        setRouting(null);
      }
    } catch {
      setError("We couldn't load this issue.");
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <Loading message="Loading issue details…" />;
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
          hint="You can also find it again from the map of nearby issues."
        />
      </View>
    );
  }

  // A resolved case is closed: the routing card becomes a record of where it
  // went, not an instruction to go finish the job.
  const isClosed = report?.status === 'Resolved';

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.container}>
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
          <View style={styles.headerRow}>
            <View
              style={styles.headerIconBadge}
              importantForAccessibility="no"
            >
              <CategoryIcon
                category={report.category}
                size={22}
                color={colors.ink}
              />
            </View>
            <View style={styles.headerText}>
              <Text style={typography.heading} accessibilityRole="header">
                {report.category.charAt(0).toUpperCase() +
                  report.category.slice(1)}
              </Text>
              <Text style={[typography.meta, styles.status]}>
                {caseNumber(report.id)} · ON FILE {shortDate(report.created_at)}
              </Text>
            </View>
            <StatusStamp status={report.status} />
          </View>
          <Text style={[typography.body, styles.description]}>
            {report.description}
          </Text>

          {routing ? (
            <View style={styles.routingCard}>
              <View style={styles.routingTitleRow}>
                <Landmark
                  size={13}
                  color={colors.primary}
                  strokeWidth={2.2}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={[typography.eyebrow, styles.routingEyebrow]}>
                  Routed to
                </Text>
              </View>
              <Text style={[typography.body, styles.routingBody]}>
                {routing.department} · {routing.jurisdiction}
              </Text>
              {routing.url ? (
                <Pressable
                  style={[shared.secondaryButton, styles.routeButton]}
                  onPress={() => void Linking.openURL(routing.url!)}
                  accessibilityLabel={`Open ${routing.jurisdiction} official channel`}
                  accessibilityRole="button"
                >
                  <Text style={shared.secondaryButtonText}>
                    {isClosed ? 'View official channel' : 'Open official channel'}
                  </Text>
                </Pressable>
              ) : null}
              {/* The disclaimer says "submit there to complete". On a closed
                  case that is a contradiction: there is nothing left to
                  submit, so the card becomes a record of where it went. */}
              {routing.disclaimer && !isClosed ? (
                <Text style={[typography.caption, styles.disclaimer]}>
                  {routing.disclaimer}
                </Text>
              ) : null}
            </View>
          ) : null}

          {report.status_history && report.status_history.length > 0 ? (
            <View style={styles.timeline}>
              <Text style={[typography.eyebrow, styles.timelineTitle]}>
                Status
              </Text>
              <StatusTimeline history={report.status_history} />
            </View>
          ) : null}

          <VerificationBar
            reportId={report.id}
            initialCounts={report.verifications}
            onError={setNotice}
          />

          <BeforeAfter
            reportId={report.id}
            photos={report.photos ?? []}
            isOwnReport={
              currentUserId !== null && report.reporter_id === currentUserId
            }
            onPhotoAdded={(photo: ReportPhoto) =>
              setReport((r) =>
                r ? { ...r, photos: [...(r.photos ?? []), photo] } : r,
              )
            }
            onError={setNotice}
          />

          {notice ? (
            <View style={shared.errorBox}>
              <Text style={shared.errorText}>{notice}</Text>
            </View>
          ) : null}

          {report.community_suggests_resolved ? (
            <View style={styles.communityNote} accessibilityLiveRegion="polite">
              <Text style={[typography.caption, styles.communityNoteText]}>
                Community responses suggest this issue may be resolved.
                Official status comes from the city.
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(3),
    },
    headerIconBadge: {
      width: 48,
      height: 48,
      borderRadius: 2,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: {
      flex: 1,
    },
    status: {
      marginTop: spacing(1),
      letterSpacing: 0.5,
    },
    description: {
      marginTop: spacing(4),
    },
    routingCard: {
      backgroundColor: c.surface,
      borderRadius: 3,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
      padding: spacing(4),
      marginTop: spacing(5),
    },
    routingTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1.5),
    },
    routingEyebrow: {
      color: c.primary,
    },
    routingBody: {
      marginTop: spacing(1),
    },
    routeButton: {
      marginTop: spacing(3),
    },
    disclaimer: {
      marginTop: spacing(3),
      fontStyle: 'italic',
    },
    timeline: {
      marginTop: spacing(6),
    },
    timelineTitle: {
      marginBottom: spacing(3),
    },
    communityNote: {
      backgroundColor: c.successSurface,
      borderRadius: 3,
      padding: spacing(4),
      marginTop: spacing(4),
    },
    communityNoteText: {
      color: c.success,
    },
  });
