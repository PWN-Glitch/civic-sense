import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme';
import { font, layout, radius, spacing, type ThemeColors } from '../theme';

/**
 * First-launch orientation.
 *
 * Three sentences and one button: what the app is for, what the AI actually
 * does, and what happens after you send. Shown once — the flag lives in
 * storage — because a returning user should never have to dismiss a tour.
 */
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const steps = [
    {
      n: '01',
      title: 'Photograph the problem',
      body: 'A pothole, a dead streetlight, an overflowing bin. The app attaches where you are, so you never type an address.',
    },
    {
      n: '02',
      title: 'Check what the model thinks',
      body: 'The AI names a category and tells you how sure it is, as a percentage. You can change it before anything is sent.',
    },
    {
      n: '03',
      title: 'File it and follow it',
      body: 'The report is addressed to the agency that owns the problem, then tracked on one timeline from draft to resolved.',
    },
  ];

  return (
    <View
      style={[
        shared.screen,
        styles.root,
        { paddingTop: insets.top + spacing(4) },
      ]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.rule} />
        <Text style={[typography.eyebrow, styles.eyebrow]}>
          Baltimore · 311
        </Text>
        <Text style={[typography.display, styles.title]} accessibilityRole="header">
          File a city report in about a minute.
        </Text>

        <View style={styles.steps}>
          {steps.map((step, index) => (
            <View
              key={step.n}
              style={[styles.step, index > 0 && styles.stepRule]}
            >
              <Text style={[typography.meta, styles.stepNumber]}>{step.n}</Text>
              <View style={styles.stepText}>
                <Text style={[typography.label, styles.stepTitle]}>
                  {step.title}
                </Text>
                <Text style={[typography.body, styles.stepBody]}>
                  {step.body}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, spacing(4)) },
        ]}
      >
        <Pressable
          testID="onboarding-start"
          onPress={onDone}
          style={({ pressed }) => [
            shared.primaryButton,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Get started"
          accessibilityHint="Closes this introduction and opens the map"
        >
          <Text style={shared.primaryButtonText}>Get started</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: {
      paddingHorizontal: layout.gutter,
      maxWidth: layout.maxContentWidth,
      alignSelf: 'center',
      width: '100%',
    },
    scroll: {
      flexGrow: 1,
      paddingBottom: spacing(4),
    },
    rule: {
      width: 40,
      height: 3,
      backgroundColor: c.warning,
      marginBottom: spacing(2.5),
    },
    eyebrow: {
      color: c.muted,
      marginBottom: spacing(2),
    },
    title: {
      marginBottom: spacing(5),
    },
    steps: {
      borderTopWidth: layout.rule,
      borderTopColor: c.border,
    },
    step: {
      flexDirection: 'row',
      gap: spacing(3),
      paddingVertical: spacing(3.5),
    },
    stepRule: {
      borderTopWidth: layout.rule,
      borderTopColor: c.hairline,
    },
    stepNumber: {
      paddingTop: 2,
      fontFamily: font.monoMedium,
      letterSpacing: 0.5,
    },
    stepText: {
      flex: 1,
      gap: spacing(1),
    },
    stepTitle: {
      fontFamily: font.semibold,
      fontSize: 16,
    },
    stepBody: {
      fontSize: 14.5,
      lineHeight: 21,
    },
    footer: {
      paddingTop: spacing(3),
      borderTopWidth: layout.rule,
      borderTopColor: c.border,
      backgroundColor: c.background,
    },
    pressed: {
      opacity: 0.85,
    },
    pressedSurface: {
      borderRadius: radius.control,
    },
  });
