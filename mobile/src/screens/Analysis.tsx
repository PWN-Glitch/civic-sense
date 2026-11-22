import React, { useMemo } from 'react';
import {Animated, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Cpu, Smartphone } from 'lucide-react-native';
import ConfidenceBar, { formatPercent } from '../components/ConfidenceBar';
import { CategoryIcon, SeverityBars } from '../components/Icon';
import { useEnterTransition } from '../lib/motion';
import { useTheme } from '../lib/theme';
import { font, spacing, type ThemeColors } from '../theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Analysis'>;

function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

// Severity tint per level; the drawn bars carry the signal, color supports.
const severityColor = (c: ThemeColors, level: string): string =>
  level === 'high' ? c.danger : level === 'moderate' ? c.warning : c.success;

export default function AnalysisScreen({ route, navigation }: Props) {
  const {
    photoUri,
    photoId,
    predictions,
    band,
    severity,
    disclaimer,
    classificationSource,
  } = route.params;
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const enter = useEnterTransition();

  const top = predictions.length > 0 ? predictions[0] : null;
  const fallback = !top;

  const goToConfirm = () => {
    navigation.navigate('Confirm', {
      photoUri,
      photoId,
      predictions,
      band,
      severity,
      disclaimer,
      classificationSource,
      preselected: top?.category,
    });
  };

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.container}>
      <Animated.View style={enter}>
        <Image
          source={{ uri: photoUri }}
          style={styles.thumbnail}
          accessibilityLabel="Your photo"
          resizeMode="cover"
        />

      {fallback ? (
        <View style={styles.fallbackBox} accessibilityLiveRegion="polite">
          <Text style={[typography.heading, styles.fallbackTitle]}>
            We couldn&apos;t analyze this photo.
          </Text>
          <Text style={typography.body}>
            Check your connection and try again, or choose a category
            manually.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.topPickRow}>
            <View
              style={styles.topPickBadge}
              importantForAccessibility="no"
            >
              <CategoryIcon
                category={top.category}
                size={26}
                color={colors.primary}
              />
            </View>
            <View style={styles.topPickText}>
              <Text style={[typography.eyebrow, styles.sectionLabel]}>
                This looks like
              </Text>
              <Text style={typography.title} accessibilityRole="header">
                {formatCategory(top.category)}
              </Text>
            </View>
          </View>

          <View style={[shared.card, styles.analysisCard]}>
            <ConfidenceBar
              confidence={top.confidence}
              band={band}
              category={top.category}
            />

            <View style={styles.severityBox}>
              <View style={styles.severityRow}>
                <SeverityBars
                  level={severity.level}
                  color={severityColor(colors, severity.level)}
                />
                <Text style={[typography.label, styles.severityLabel]}>
                  Estimated severity: {severity.level}
                </Text>
              </View>
              <Text style={[typography.caption, styles.severityReason]}>
                {severity.reason}
              </Text>
            </View>

            {predictions.length > 1 && (
              <View style={styles.alternates}>
                <Text style={[typography.eyebrow, styles.alternatesEyebrow]}>
                  Also possible
                </Text>
                {predictions.slice(1, 3).map((p, i) => (
                  <View
                    key={p.category}
                    style={[styles.alternateRow, i > 0 && styles.alternateRowSeparated]}
                  >
                    <CategoryIcon
                      category={p.category}
                      size={14}
                      color={colors.muted}
                    />
                    <Text
                      style={[typography.caption, styles.alternateText]}
                    >
                      {formatCategory(p.category)}
                    </Text>
                    <Text style={styles.alternatePct}>
                      {formatPercent(p.confidence)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {disclaimer ? (
              <Text style={[typography.caption, styles.disclaimer]}>
                {disclaimer}
              </Text>
            ) : null}
          </View>
        </>
      )}

      <Pressable
        style={({ pressed }) => [
          shared.primaryButton,
          styles.confirmButton,
          pressed && styles.pressed,
        ]}
        onPress={goToConfirm}
        accessibilityLabel={fallback ? 'Choose a category' : 'Confirm category'}
        accessibilityRole="button"
        accessibilityHint="Continues to category confirmation"
      >
        <Text style={shared.primaryButtonText}>
          {fallback ? 'Choose a category' : 'Confirm'}
        </Text>
      </Pressable>

      {!fallback && (
        <Pressable
          style={({ pressed }) => [
            shared.secondaryButton,
            styles.differentButton,
            pressed && styles.pressed,
          ]}
          onPress={goToConfirm}
          accessibilityLabel="Choose a different category"
          accessibilityRole="button"
        >
          <Text style={shared.secondaryButtonText}>
            Choose different category
          </Text>
        </Pressable>
      )}
      </Animated.View>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    thumbnail: {
      width: '100%',
      height: 220,
      borderRadius: 3,
      backgroundColor: c.surfaceAlt,
    },
    topPickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing(5),
      gap: spacing(3),
    },
    topPickBadge: {
      width: 56,
      height: 56,
      borderRadius: 3,
      backgroundColor: c.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
    },
    topPickText: {
      flex: 1,
    },
    sectionLabel: {
      color: c.primary,
    },
    analysisCard: {
      marginTop: spacing(3),
    },
    sourceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1.5),
      marginTop: spacing(1),
    },
    sourceLabel: {
      fontStyle: 'italic',
    },
    fallbackBox: {
      backgroundColor: c.warningSurface,
      borderRadius: 3,
      padding: spacing(5),
      marginTop: spacing(5),
    },
    fallbackTitle: {
      marginBottom: spacing(1),
    },
    // Not a card. The severity estimate is one more line of evidence on the
    // same sheet, so it gets a rule above it like "Also possible" does —
    // a nested box here was the only dashboard-shaped element on the screen.
    severityBox: {
      marginTop: spacing(3),
      paddingTop: spacing(3),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hairline,
    },
    severityReason: {
      marginTop: spacing(1),
    },
    severityRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    severityLabel: {
      marginLeft: spacing(2),
    },
    alternates: {
      marginTop: spacing(3),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hairline,
      paddingTop: spacing(2.5),
    },
    alternatesEyebrow: {
      marginBottom: spacing(1),
    },
    alternateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(2),
      paddingVertical: spacing(1.5),
    },
    alternateRowSeparated: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hairline,
    },
    alternateText: {
      flex: 1,
    },
    // Right-aligned tabular percent — the instrument readout column.
    alternatePct: {
      fontSize: 13,
      fontFamily: font.bold,
      fontVariant: ['tabular-nums'],
      color: c.body,
    },
    disclaimer: {
      marginTop: spacing(4),
      fontStyle: 'italic',
    },
    confirmButton: {
      marginTop: spacing(6),
    },
    differentButton: {
      marginTop: spacing(3),
    },
    pressed: {
      opacity: 0.85,
      transform: [{ scale: 0.99 }],
    },
  });
