import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ChevronDown,
  ChevronUp,
  Globe,
  Landmark,
  Mail,
  Phone,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Store,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import { api } from '../api/client';
import ErrorState from '../components/ErrorState';
import Loading from '../components/Loading';
import { useTheme } from '../lib/theme';
import { font, spacing, type ThemeColors, type Typography } from '../theme';
import type {
  ContactResolveResponse,
  SubmissionChannel,
  VerificationStatus,
} from '../types';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Route'>;

export const CHANNEL_LABELS: Record<string, string> = {
  OPEN311: 'Open311 API (automatic)',
  API: 'Direct API (automatic)',
  EMAIL: 'Email',
  PHONE: 'Phone call',
  WEB_FORM: 'Official web form',
  GOVERNMENT_PORTAL: 'Government portal',
  MOBILE_APP: 'Official app',
  IN_PERSON: 'In person',
  MANUAL: 'Manual submission',
};

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  verified: 'Verified contact',
  likely: 'Likely current',
  unverified: 'Unverified — may be outdated',
  unknown: 'Unknown — may be outdated',
};

/** One drawn glyph per submission channel — the card reads at a glance. */
const CHANNEL_ICONS: Record<string, LucideIcon> = {
  OPEN311: Zap,
  API: Zap,
  EMAIL: Mail,
  PHONE: Phone,
  WEB_FORM: Globe,
  GOVERNMENT_PORTAL: Landmark,
  MOBILE_APP: Smartphone,
  IN_PERSON: Store,
  MANUAL: Send,
};

/**
 * Backend ranks options; if it ever returns them unranked we re-rank by
 * confidence so "Recommended" always sits on the strongest channel.
 */
export function rankOptions(
  options: SubmissionChannel[],
): SubmissionChannel[] {
  return [...options].sort((a, b) => b.confidence - a.confidence);
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  const match = /^https?:\/\/([^/]+)/i.exec(url);
  return match ? match[1] : null;
}

function OptionCard({
  option,
  recommended,
  onSelect,
}: {
  option: SubmissionChannel;
  recommended: boolean;
  onSelect: () => void;
}) {
  const [whyOpen, setWhyOpen] = useState(false);
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const host = hostOf(option.source_url);
  const stale =
    option.verification_status === 'unverified' ||
    option.verification_status === 'unknown';
  const confidencePct = Math.round(option.confidence * 100);
  const ChannelIcon = CHANNEL_ICONS[option.type] ?? Send;
  const VerifyIcon = stale ? ShieldAlert : ShieldCheck;
  const verifyColor = stale ? colors.warning : colors.success;

  return (
    <View style={[styles.card, recommended && styles.cardRecommended]}>
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.channelBadge,
            recommended && styles.channelBadgeRecommended,
          ]}
          importantForAccessibility="no"
        >
          <ChannelIcon
            size={20}
            color={recommended ? colors.onPrimary : colors.primary}
            strokeWidth={2}
          />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={typography.label}>
            {CHANNEL_LABELS[option.type] ?? option.type}
          </Text>
          {recommended ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Recommended</Text>
            </View>
          ) : null}
        </View>
      </View>

      <Text style={[typography.body, styles.destination]} numberOfLines={2}>
        {option.destination}
      </Text>

      <View style={styles.verificationRow}>
        <VerifyIcon
          size={14}
          color={verifyColor}
          strokeWidth={2.2}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text
          style={[
            typography.caption,
            styles.verification,
            { color: verifyColor },
          ]}
        >
          {VERIFICATION_LABELS[option.verification_status]}
        </Text>
      </View>
      {stale ? (
        <Text style={[typography.caption, styles.staleNote]}>
          This contact may be outdated — double-check it before sending.
        </Text>
      ) : null}

      {host ? (
        <Text style={typography.caption}>Source: {host}</Text>
      ) : null}

      <Pressable
        style={styles.whyToggle}
        onPress={() => setWhyOpen((v) => !v)}
        accessibilityLabel={whyOpen ? 'Hide why this contact' : 'Why this contact?'}
        accessibilityRole="button"
        accessibilityState={{ expanded: whyOpen }}
      >
        <Text style={styles.whyToggleText}>
          {whyOpen ? 'Hide why' : 'Why this contact?'}
        </Text>
        {whyOpen ? (
          <ChevronUp size={16} color={colors.primary} strokeWidth={2.4} />
        ) : (
          <ChevronDown size={16} color={colors.primary} strokeWidth={2.4} />
        )}
      </Pressable>
      {whyOpen ? (
        <View style={styles.whyBox}>
          <Text style={[typography.caption, styles.confidenceLine]}>
            Match confidence: {confidencePct}%
          </Text>
          {option.reasons.map((reason) => (
            <Text key={reason} style={[typography.caption, styles.reason]}>
              • {reason}
            </Text>
          ))}
          {option.reasons.length === 0 ? (
            <Text style={[typography.caption, styles.reason]}>
              No additional reasons were provided by the resolver.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* One filled action on the screen. The alternates keep the same verb and
          the same shape so the choice reads as one action in two weights —
          rank is carried by fill, not by different wording. */}
      {recommended ? (
        <Pressable
          style={({ pressed }) => [
            shared.primaryButton,
            styles.selectButton,
            pressed && styles.pressed,
          ]}
          onPress={onSelect}
          accessibilityLabel={`Send via ${CHANNEL_LABELS[option.type] ?? option.type}`}
          accessibilityRole="button"
          accessibilityHint="Composes the report for this contact"
        >
          <Text style={shared.primaryButtonText}>Use this option</Text>
        </Pressable>
      ) : (
        <Pressable
          style={({ pressed }) => [
            shared.secondaryButton,
            styles.selectButton,
            pressed && styles.pressed,
          ]}
          onPress={onSelect}
          accessibilityLabel={`Send via ${CHANNEL_LABELS[option.type] ?? option.type}`}
          accessibilityRole="button"
          accessibilityHint="Composes the report for this contact"
        >
          <Text style={shared.secondaryButtonText}>Use this option</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function RouteScreen({ route, navigation }: Props) {
  const params = route.params;
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [result, setResult] = useState<ContactResolveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<ContactResolveResponse>(
        '/contacts/resolve',
        {
          lat: params.lat,
          lng: params.lng,
          category: params.category,
          severity: params.severity.level,
        },
      );
      setResult(data);
    } catch {
      setError(
        "We couldn't look up who handles this issue. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ranked = useMemo(
    () => (result ? rankOptions(result.options) : []),
    [result],
  );

  const select = (option: SubmissionChannel) => {
    if (!result) return;
    // The report doesn't exist yet (unless the duplicate flow passed one
    // in) — Report writes the description and POSTs it, then hands the id +
    // channel to ReportReview for composing.
    navigation.navigate('Report', {
      ...params,
      channel: option,
      jurisdiction: result.jurisdiction,
      department: result.department,
      universalReport: result.universal_report,
    });
  };

  if (loading) {
    return <Loading message="Finding the right contact…" />;
  }

  if (error || !result) {
    return (
      <View style={[shared.screen, shared.container, styles.center]}>
        <ErrorState
          message={error ?? 'No contact information came back.'}
          onRetry={() => void load()}
          hint="You can go back and submit a plain report instead."
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={shared.container}
    >
      <Text style={typography.heading} accessibilityRole="header">
        Who should receive this report?
      </Text>
      <Text style={[typography.body, styles.subtitle]}>
        {result.department} · {result.jurisdiction}
      </Text>
      <Text style={typography.caption}>
        Pick a contact option. We only list official sources — nothing is
        guessed.
      </Text>

      <View style={styles.list}>
        {ranked.map((option, index) => (
          <OptionCard
            key={`${option.type}-${option.destination}-${index}`}
            option={option}
            recommended={index === 0}
            onSelect={() => select(option)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    subtitle: {
      marginTop: spacing(2),
    },
    list: {
      marginTop: spacing(4),
      gap: spacing(4),
    },
    card: {
      borderRadius: 3,
      padding: spacing(4),
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
    },
    cardRecommended: {
      // The recommendation declares itself with the filled badge + border,
      // not a bigger glow — shadow stays at card level.
      borderColor: c.primary,
      borderWidth: 1.5,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(3),
    },
    channelBadge: {
      width: 44,
      height: 44,
      borderRadius: 3,
      backgroundColor: c.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    channelBadgeRecommended: {
      backgroundColor: c.primary,
    },
    cardHeaderText: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing(2),
    },
    badge: {
      alignSelf: 'flex-start',
      backgroundColor: c.primary,
      borderRadius: 2,
      paddingHorizontal: spacing(2),
      paddingVertical: 3,
    },
    badgeText: {
      color: c.onPrimary,
      fontSize: 10,
      fontFamily: font.bold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    destination: {
      marginTop: spacing(3),
    },
    verificationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1.5),
      marginTop: spacing(2),
    },
    verification: {
      fontFamily: font.semibold,
    },
    staleNote: {
      color: c.warning,
      marginTop: spacing(1),
    },
    whyToggle: {
      marginTop: spacing(3),
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1),
    },
    whyToggleText: {
      color: c.primary,
      fontFamily: font.bold,
      fontSize: 14,
    },
    whyBox: {
      backgroundColor: c.surfaceAlt,
      borderRadius: 3,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
      padding: spacing(3),
    },
    confidenceLine: {
      fontVariant: ['tabular-nums'],
    },
    reason: {
      marginTop: spacing(1),
    },
    selectButton: {
      marginTop: spacing(3),
    },
    pressed: {
      opacity: 0.85,
      transform: [{ scale: 0.99 }],
    },
  });
