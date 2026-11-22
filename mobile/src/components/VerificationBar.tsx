import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { useTheme } from '../lib/theme';
import { font, spacing, type ThemeColors } from '../theme';
import type {
  VerificationCounts,
  VerificationResponse,
  VerificationsResponse,
  VerifyResponse,
} from '../types';

/**
 * Community verification bar.
 *
 * Lets anyone viewing an issue answer "is it still there?":
 *   Still present / Appears fixed / Not sure.
 */

interface Props {
  reportId: string;
  /** Seed counts from GET /reports/{id} when available; refetched on mount. */
  initialCounts?: VerificationCounts;
  onError?: (message: string) => void;
}

interface Option {
  key: VerificationResponse;
  label: string;
  hint: string;
}

const OPTIONS: Option[] = [
  { key: 'still_present', label: 'Still present', hint: 'The issue is still there' },
  { key: 'appears_fixed', label: 'Appears fixed', hint: 'The issue looks resolved' },
  { key: 'not_sure', label: 'Not sure', hint: 'You cannot tell from here' },
];

const EMPTY: VerificationCounts = {
  still_present: 0,
  appears_fixed: 0,
  not_sure: 0,
};

export default function VerificationBar({ reportId, initialCounts, onError }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [counts, setCounts] = useState<VerificationCounts>(initialCounts ?? EMPTY);
  const [userVote, setUserVote] = useState<VerificationResponse | null>(null);
  const [busy, setBusy] = useState<VerificationResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<VerificationsResponse>(
        `/reports/${reportId}/verifications`,
      );
      setCounts(data.counts);
      setUserVote(data.user_vote);
    } catch {
      // Counts are a nice-to-have; the vote buttons must keep working.
      onError?.("Couldn't load community verification counts.");
    } finally {
      setLoading(false);
    }
  }, [reportId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const vote = async (response: VerificationResponse) => {
    if (busy) return;
    setBusy(response);
    try {
      const { data } = await api.post<VerifyResponse>(
        `/reports/${reportId}/verify`,
        { response },
      );
      setCounts(data.counts);
      setUserVote(response);
    } catch {
      onError?.("Your vote couldn't be saved. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const total = counts.still_present + counts.appears_fixed + counts.not_sure;

  return (
    <View style={styles.container}>
      <Text style={typography.eyebrow} accessibilityRole="header">
        Community check
      </Text>
      <Text style={[typography.caption, styles.subtitle]}>
        {loading
          ? 'Loading community responses…'
          : total === 0
            ? 'No responses yet. Have you seen this issue recently?'
            : `${total} ${total === 1 ? 'response' : 'responses'} from the community`}
      </Text>

      <View style={styles.row}>
        {OPTIONS.map((option) => {
          const selected = userVote === option.key;
          const count = counts[option.key];
          return (
            <Pressable
              key={option.key}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && styles.optionPressed,
              ]}
              onPress={() => void vote(option.key)}
              disabled={busy !== null}
              accessibilityLabel={`${option.label}. ${option.hint}. ${count} ${
                count === 1 ? 'vote' : 'votes'
              }${selected ? '. Your current vote' : ''}`}
              accessibilityRole="button"
              accessibilityState={{ selected, busy: busy === option.key }}
            >
              {busy === option.key ? (
                <ActivityIndicator
                  color={selected ? colors.onPrimary : colors.primary}
                  size="small"
                />
              ) : (
                <>
                  <Text
                    style={[styles.optionLabel, selected && styles.optionLabelSelected]}
                  >
                    {option.label}
                  </Text>
                  <Text
                    style={[styles.optionCount, selected && styles.optionCountSelected]}
                  >
                    {count}
                  </Text>
                  {selected ? (
                    <View style={styles.yourVoteBadge}>
                      <Text style={styles.yourVoteText}>Your vote</Text>
                    </View>
                  ) : null}
                </>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      marginTop: spacing(6),
      backgroundColor: c.surface,
      borderRadius: 3,
      padding: spacing(4),
    },
    subtitle: {
      marginTop: spacing(1),
      marginBottom: spacing(3),
    },
    row: {
      flexDirection: 'row',
      gap: spacing(2),
    },
    option: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.background,
      borderColor: c.borderStrong,
      borderWidth: 1,
      borderRadius: 3,
      paddingVertical: spacing(3),
      paddingHorizontal: spacing(2),
      minHeight: 64, // ≥44dp touch target
    },
    optionSelected: {
      backgroundColor: c.primary,
      borderColor: c.primaryDark,
    },
    optionPressed: {
      opacity: 0.75,
      transform: [{ scale: 0.97 }],
    },
    optionLabel: {
      color: c.ink,
      fontSize: 13,
      fontFamily: font.semibold,
      textAlign: 'center',
    },
    optionLabelSelected: {
      color: c.onPrimary,
    },
    optionCount: {
      color: c.muted,
      fontSize: 15,
      fontFamily: font.bold,
      marginTop: spacing(1),
    },
    optionCountSelected: {
      color: c.onPrimarySubtle,
    },
    yourVoteBadge: {
      marginTop: spacing(1),
      backgroundColor: c.surface,
      borderRadius: 999,
      paddingHorizontal: spacing(2),
      paddingVertical: 2,
    },
    yourVoteText: {
      color: c.primary,
      fontSize: 10,
      fontFamily: font.bold,
      letterSpacing: 0.3,
    },
  });
