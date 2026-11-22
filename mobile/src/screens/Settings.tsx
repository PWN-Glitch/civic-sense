import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import ScreenHeader from '../components/ScreenHeader';
import { useTheme, type ThemeMode } from '../lib/theme';
import { font, layout, spacing, type ThemeColors } from '../theme';

const APPEARANCE_OPTIONS: { key: ThemeMode; label: string; hint: string }[] = [
  { key: 'light', label: 'Light', hint: 'Paper stock, for daylight' },
  { key: 'dark', label: 'Dark', hint: 'Night beat, for low light' },
  { key: 'system', label: 'Follow the phone', hint: 'Matches your display setting' },
];

export default function SettingsScreen() {
  const { colors, typography, shared, mode, setMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // This tab hides the native header (the title lives in ScreenHeader), so the
  // screen owns the status-bar inset itself.
  const insets = useSafeAreaInsets();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={[
        shared.container,
        // Bottom padding clears the tab bar so the last row isn't clipped.
        { paddingTop: insets.top + spacing(2), paddingBottom: spacing(10) },
      ]}
    >
      <ScreenHeader
        eyebrow="Civic Sense · 311"
        title="Settings"
        meta="DEVICE PREFERENCES"
      />

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={typography.eyebrow}>Appearance</Text>
          <View style={styles.headRule} />
        </View>
        <View
          style={styles.form}
          accessibilityRole="radiogroup"
          accessibilityLabel="Appearance"
        >
          {APPEARANCE_OPTIONS.map((option, index) => {
            const selected = mode === option.key;
            return (
              <Pressable
                key={option.key}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && styles.rowRule,
                  pressed && styles.pressed,
                ]}
                onPress={() => setMode(option.key)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${option.label}. ${option.hint}`}
              >
                <View style={styles.rowText}>
                  <Text style={[typography.label, styles.rowLabel]}>
                    {option.label}
                  </Text>
                  <Text style={typography.caption}>{option.hint}</Text>
                </View>
                {/* A box filled in by hand, not an iOS switch: this is a form. */}
                <View style={[styles.mark, selected && styles.markOn]}>
                  {selected ? (
                    <Check
                      size={13}
                      color={colors.onPrimary}
                      strokeWidth={3.5}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={typography.eyebrow}>About</Text>
          <View style={styles.headRule} />
        </View>
        <View style={styles.form}>
          <View style={styles.row}>
            <Text style={[typography.meta, styles.metaKey]}>VERSION</Text>
            <Text style={[typography.meta, styles.metaValue]}>{version}</Text>
          </View>
          <View style={[styles.row, styles.rowRule]}>
            <Text style={[typography.meta, styles.metaKey]}>FILED TO</Text>
            <Text style={[typography.meta, styles.metaValue]}>
              Baltimore 311
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={typography.eyebrow}>What leaves this phone</Text>
          <View style={styles.headRule} />
        </View>
        <View style={styles.note}>
          <Text style={[typography.body, styles.noteBody]}>
            Photos are stripped of EXIF metadata before upload. Faces are
            blurred on the server. Location is read only
            when you create a report; the app never tracks you.
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={typography.eyebrow}>Category suggestions</Text>
          <View style={styles.headRule} />
        </View>
        <View style={styles.note}>
          <Text style={[typography.body, styles.noteBody]}>
            Suggestions come from an AI model and always show a confidence
            score. You can correct the suggestion before submitting.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    section: {
      marginTop: spacing(6),
      maxWidth: layout.maxContentWidth,
    },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(2),
      marginBottom: spacing(2),
    },
    // Label, then a rule running to the margin — how a form labels a block.
    headRule: {
      flex: 1,
      height: layout.rule,
      backgroundColor: c.border,
    },
    form: {
      backgroundColor: c.surface,
      borderWidth: layout.rule,
      borderColor: c.border,
      borderRadius: 3,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(3),
      paddingVertical: spacing(3),
      paddingHorizontal: spacing(3.5),
      minHeight: 56,
    },
    rowRule: {
      borderTopWidth: layout.rule,
      borderTopColor: c.hairline,
    },
    rowText: {
      flex: 1,
      gap: 1,
    },
    rowLabel: {
      fontFamily: font.medium,
    },
    pressed: {
      backgroundColor: c.surfaceAlt,
    },
    mark: {
      width: 22,
      height: 22,
      borderRadius: 2,
      borderWidth: 1.5,
      borderColor: c.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markOn: {
      backgroundColor: c.primary,
      borderColor: c.primary,
    },
    note: {
      borderLeftWidth: 2,
      borderLeftColor: c.warning,
      paddingLeft: spacing(3.5),
      paddingVertical: spacing(1),
    },
    noteBody: {
      maxWidth: 440,
    },
    metaKey: {
      width: 96,
      color: c.muted,
    },
    metaValue: {
      flex: 1,
      color: c.body,
    },
  });
