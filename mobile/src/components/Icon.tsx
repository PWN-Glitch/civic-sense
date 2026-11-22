import React from 'react';
import { StyleSheet, View } from 'react-native';
import {
  CircleQuestionMark,
  Footprints,
  Lightbulb,
  SprayCan,
  TrafficCone,
  Trash2,
  type LucideIcon,
} from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import type { Category } from '../types';

/**
 * Civic Sense icon system (lucide-react-native, 2px round-stroke family).
 *
 * Every icon in the app renders through this file so the stroke weight and
 * sizing stay consistent, and so decorative icons are hidden from TalkBack
 * in exactly one place (icons never carry meaning on their own — they sit
 * next to text, or the parent supplies an accessibilityLabel).
 */

/** Default stroke width for the whole icon system. */
export const ICON_STROKE = 2;

interface IconProps {
  icon: LucideIcon;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/**
 * Draw a lucide icon, hidden from the accessibility tree by default. Icons
 * in Civic Sense are always decorative: any meaning they add is duplicated
 * by adjacent text or by the parent's accessibilityLabel.
 */
export function Icon({ icon: Lucide, size = 20, color, strokeWidth }: IconProps) {
  const { colors } = useTheme();
  return (
    <Lucide
      size={size}
      color={color ?? colors.ink}
      strokeWidth={strokeWidth ?? ICON_STROKE}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

/**
 * One distinctive lucide icon per issue category — the visual shorthand that
 * gives Confirm/Analysis/report cards their identity.
 */
export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  pothole: TrafficCone,
  streetlight: Lightbulb,
  trash: Trash2,
  graffiti: SprayCan,
  'sidewalk damage': Footprints,
  other: CircleQuestionMark,
};

export function categoryIcon(category: string): LucideIcon {
  return (
    (CATEGORY_ICONS as Record<string, LucideIcon>)[category] ??
    CircleQuestionMark
  );
}

interface CategoryIconProps {
  category: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/** Category glyph, drawn at a consistent weight. */
export function CategoryIcon({
  category,
  size = 20,
  color,
  strokeWidth,
}: CategoryIconProps) {
  return (
    <Icon
      icon={categoryIcon(category)}
      size={size}
      color={color}
      strokeWidth={strokeWidth}
    />
  );
}

const SEVERITY_BAR_COUNT: Record<string, number> = {
  low: 1,
  moderate: 2,
  high: 3,
};

/**
 * Drawn severity signal: 1–3 bars of rising height, replacing the old ●●●
 * unicode dots. Severity is never color-only — the bar count carries the
 * information even for colorblind users.
 */
export function SeverityBars({
  level,
  color,
}: {
  level: string;
  color: string;
}) {
  const bars = SEVERITY_BAR_COUNT[level] ?? 1;
  return (
    <View style={severityStyles.bars} importantForAccessibility="no">
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[
            severityStyles.bar,
            { height: 4 + i * 3.5 },
            i < bars
              ? { backgroundColor: color }
              : { backgroundColor: color + '38' },
          ]}
        />
      ))}
    </View>
  );
}

const severityStyles = StyleSheet.create({
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2.5,
    height: 12,
  },
  bar: {
    width: 3.5,
    borderRadius: 1.75,
  },
});
