import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { CategoryIcon } from './Icon';
import { useTheme } from '../lib/theme';
import { font, radius, spacing, type ThemeColors } from '../theme';

interface CategoryChipProps {
  label: string;
  /** Category key (e.g. 'pothole') — selects the drawn glyph. */
  category?: string;
  selected: boolean;
  onPress: () => void;
}

export default function CategoryChip({
  label,
  category,
  selected,
  onPress,
}: CategoryChipProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.chipPressed,
      ]}
      onPress={onPress}
      accessibilityLabel={`${label}${selected ? ', selected' : ''}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      {category ? (
        <View style={styles.iconWrap} importantForAccessibility="no">
          <CategoryIcon
            category={category}
            size={17}
            color={selected ? colors.onPrimary : colors.body}
          />
        </View>
      ) : null}
      <Text style={[styles.text, selected && styles.textSelected]}>
        {label}
      </Text>
      {selected ? (
        <View style={styles.checkWrap} importantForAccessibility="no">
          <Check size={13} color={colors.onPrimary} strokeWidth={3.4} />
        </View>
      ) : null}
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // A check box on a form, not a pill: squared, ruled, and filled with ink
    // when chosen. Selection is carried by the fill and the tick, so it
    // survives a colourblind reader and a greyscale screenshot alike.
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: c.borderStrong,
      backgroundColor: c.surface,
      paddingVertical: spacing(2.5),
      paddingHorizontal: spacing(3.5),
      margin: spacing(1),
      minHeight: 48,
    },
    chipSelected: {
      backgroundColor: c.primary,
      borderColor: c.primary,
    },
    chipPressed: {
      opacity: 0.75,
      transform: [{ scale: 0.97 }],
    },
    iconWrap: {
      marginRight: spacing(2),
    },
    checkWrap: {
      marginLeft: spacing(2),
    },
    text: {
      fontSize: 15,
      color: c.body,
      fontFamily: font.medium,
    },
    textSelected: {
      color: c.onPrimary,
      fontFamily: font.semibold,
    },
  });
