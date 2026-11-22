import { StyleSheet } from 'react-native';

/**
 * Civic Sense design tokens — "Citation" language.
 *
 * The subject is a municipal work order: a form printed on manila stock,
 * filled in by hand, stamped when it moves. So the interface is built from
 * the materials of that artifact rather than from dashboard conventions —
 * ruled edges instead of floating cards, a monospaced docket line for every
 * record, and a rubber stamp for state.
 *
 * Colour comes from the Baltimore flag (Calvert gold, Crossland red, black,
 * white) rather than generic institutional blue: this app files reports to
 * Baltimore 311, and the flag's gold/black pairing is the city's own.
 *
 * Type: Public Sans (the US Web Design System face — the actual typeface of
 * American government services) for interface text, IBM Plex Mono for case
 * numbers, dates, coordinates and counters. Nothing is decorative; the mono
 * face marks data you could read off a citation slip.
 *
 * WCAG AA key ratios
 * ──────────────────
 * Light (paper #EDE7DA · form stock #F9F5EA):
 *   ink      #11181A on #F9F5EA → 15.4:1 (AAA)
 *   body     #333C3B on #F9F5EA →  9.4:1 (AAA)
 *   muted    #5B6462 on #F9F5EA →  5.5:1 (AA)
 *   muted    #5B6462 on #EDE7DA →  5.0:1 (AA)
 *   danger   #A32B1C on #F7E2DD →  5.6:1 (AA)
 *   warning  #8A5A00 on #F7E7BF →  5.2:1 (AA)
 *   onPrimary (gold #F5C455) on ink #11181A → 10.4:1 (AAA)
 *
 * Dark (night beat #0B1012 · form stock #141B1E):
 *   ink      #F1EBDD on #141B1E → 13.9:1 (AAA)
 *   body     #CEC8BA on #141B1E → 10.1:1 (AAA)
 *   muted    #98A29D on #141B1E →  6.4:1 (AA)
 *   primary  #F2BF55 on #0B1012 → 11.2:1 (AAA)
 *   onPrimary #16130A on #F2BF55 → 11.6:1 (AAA)
 */
export interface ThemeColors {
  /** Screen background — manila (light) / night beat (dark). */
  background: string;
  /** Form stock: sheets, panels, list rows. */
  surface: string;
  /** Recessed fills: wells, tracks, unselected toggles. */
  surfaceAlt: string;
  /** Highest layer: floating bars, sheets, the raised dial seat. */
  surfaceRaised: string;

  primary: string;
  primaryDark: string;
  /** Secondary brand shade — pressed states, active toggles. */
  primaryDeep: string;
  primarySurface: string;
  /** Text/icons rendered on top of `primary`. */
  onPrimary: string;
  /** Subtle text/icons rendered on top of `primary`. */
  onPrimarySubtle: string;

  ink: string;
  body: string;
  muted: string;
  border: string;
  /** Stronger border for interactive outlines (inputs, buttons). */
  borderStrong: string;
  /** Hairline separators inside forms and lists. */
  hairline: string;

  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  danger: string;
  dangerSurface: string;
  /** Text/icons rendered on top of `danger`. */
  onDanger: string;

  /** Backdrop color behind modals/sheets (apply ~50–65% alpha at use site). */
  scrim: string;
  /** Color used to render shadows (both themes; dark uses near-black). */
  shadow: string;
}

export const light: ThemeColors = {
  background: '#EDE7DA', // manila stock
  surface: '#F9F5EA', // form paper
  surfaceAlt: '#E3DBC9', // recessed rule
  surfaceRaised: '#FFFCF3',

  primary: '#11181A', // ink — the primary fill is the ink pad
  primaryDark: '#000000',
  primaryDeep: '#2A3335',
  primarySurface: '#B9B29C',
  onPrimary: '#F5C455', // Calvert gold on ink
  onPrimarySubtle: '#E8DDBB',

  ink: '#11181A',
  body: '#333C3B',
  muted: '#5B6462',
  border: '#CBC2AC',
  borderStrong: '#8B8270',
  hairline: '#D8D0BC',

  success: '#1C6B45',
  successSurface: '#DFEFE3',
  warning: '#8A5A00', // gold, darkened for text
  warningSurface: '#F7E7BF',
  danger: '#A32B1C', // Crossland red, darkened for text
  dangerSurface: '#F7E2DD',
  onDanger: '#FFFFFF',

  scrim: '#11181A',
  shadow: '#2A3335',
};

export const dark: ThemeColors = {
  background: '#0B1012',
  surface: '#141B1E',
  surfaceAlt: '#1E272B',
  surfaceRaised: '#1A2427',

  primary: '#F2BF55', // gold becomes the fill at night
  primaryDark: '#FFD37A',
  primaryDeep: '#C79A38',
  primarySurface: '#2A2312',
  onPrimary: '#16130A',
  onPrimarySubtle: '#2A2312',

  ink: '#F1EBDD',
  body: '#CEC8BA',
  muted: '#98A29D',
  border: '#2A3437',
  borderStrong: '#46524F',
  hairline: '#232C2F',

  success: '#74D3A4',
  successSurface: '#102A1D',
  warning: '#F2C46B',
  warningSurface: '#322610',
  danger: '#FF8A7A',
  dangerSurface: '#331715',
  onDanger: '#331715',

  scrim: '#020506',
  shadow: '#000000',
};

/** @deprecated Legacy alias kept for back-compat; prefer `light`/`dark`. */
export const colors = light;

/**
 * Font families. Static cuts are registered individually, so a style picks a
 * weight by *family*, never by `fontWeight` — Android ignores the weight
 * modifier when a custom family is set and silently falls back to Roboto.
 */
export const font = {
  regular: 'PublicSans_400Regular',
  medium: 'PublicSans_500Medium',
  semibold: 'PublicSans_600SemiBold',
  bold: 'PublicSans_700Bold',
  black: 'PublicSans_800ExtraBold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoBold: 'IBMPlexMono_600SemiBold',
} as const;

export const spacing = (n: number): number => n * 4;

/**
 * Layout constants. `gutter` is the single screen-edge inset every screen
 * shares; content is capped at `maxContentWidth` so lines never run
 * edge-to-edge on wide phones or tablets. `rule` is the weight of a form
 * rule — the structural device this design leans on, so it is a token and
 * not a magic number.
 */
export const layout = {
  gutter: 20,
  maxContentWidth: 560,
  rule: StyleSheet.hairlineWidth,
  /** Heavier rule used at the head of a form. */
  ruleStrong: 1,
} as const;

/**
 * Border-radius scale. Forms are nearly square (a printed slip has a cut
 * corner, not a rounded one); only the dial and pills are round.
 */
export const radius = {
  sm: 2,
  control: 3,
  card: 3,
  sheet: 6,
  pill: 999,
} as const;

/** Shadow styles per elevation tier, derived from the palette's shadow hue. */
export interface Elevation {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export function makeElevation(c: ThemeColors): Record<'card' | 'raised' | 'hero', Elevation> {
  return {
    // A sheet of paper on a desk: barely lifted. Most surfaces carry no
    // shadow at all — the rule does the separating.
    card: {
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
    // Floating bars and sheets.
    raised: {
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.16,
      shadowRadius: 12,
      elevation: 5,
    },
    // The dial — the one element allowed to sit above the plane.
    hero: {
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.28,
      shadowRadius: 18,
      elevation: 9,
    },
  };
}

/** Standard icon sizes; pair with <Icon size={...} />. */
export const iconSize = {
  /** Inline with caption/label text. */
  sm: 16,
  /** Default glyph in cards, chips, rows. */
  md: 20,
  /** Section headers, empty-state badges. */
  lg: 24,
  /** Hero glyph. */
  xl: 32,
} as const;

/**
 * Type scale. `display` is the screen title, `eyebrow` the mono label that
 * opens a record, `meta` the docket line under it.
 */
export interface Typography {
  display: {
    fontFamily: string;
    fontSize: number;
    letterSpacing: number;
    lineHeight: number;
    color: string;
  };
  title: { fontFamily: string; fontSize: number; letterSpacing: number; color: string };
  heading: { fontFamily: string; fontSize: number; letterSpacing: number; color: string };
  body: { fontFamily: string; fontSize: number; lineHeight: number; color: string };
  label: {
    fontFamily: string;
    fontSize: number;
    letterSpacing: number;
    color: string;
  };
  /** Mono, tracked-out, uppercase — opens a record or a section. */
  eyebrow: {
    fontFamily: string;
    fontSize: number;
    letterSpacing: number;
    textTransform: 'uppercase';
    color: string;
  };
  /** Docket line: case number, date, coordinates. Always mono. */
  meta: {
    fontFamily: string;
    fontSize: number;
    letterSpacing: number;
    color: string;
  };
  /** Large instrument readout (tallies, counters) — always tabular. */
  stat: {
    fontFamily: string;
    fontSize: number;
    letterSpacing: number;
    fontVariant: Array<'tabular-nums'>;
    color: string;
  };
  caption: { fontFamily: string; fontSize: number; lineHeight: number; color: string };
}

export function makeTypography(c: ThemeColors): Typography {
  return {
    display: {
      fontFamily: font.black,
      fontSize: 29,
      letterSpacing: -0.9,
      lineHeight: 33,
      color: c.ink,
    },
    title: {
      fontFamily: font.bold,
      fontSize: 24,
      letterSpacing: -0.5,
      color: c.ink,
    },
    heading: {
      fontFamily: font.semibold,
      fontSize: 18,
      letterSpacing: -0.2,
      color: c.ink,
    },
    body: {
      fontFamily: font.regular,
      fontSize: 15.5,
      lineHeight: 23,
      color: c.body,
    },
    label: {
      fontFamily: font.semibold,
      fontSize: 13.5,
      letterSpacing: 0.1,
      color: c.ink,
    },
    eyebrow: {
      fontFamily: font.monoMedium,
      fontSize: 10.5,
      letterSpacing: 1.3,
      textTransform: 'uppercase' as const,
      color: c.muted,
    },
    meta: {
      fontFamily: font.mono,
      fontSize: 11.5,
      letterSpacing: 0.2,
      color: c.muted,
    },
    stat: {
      fontFamily: font.monoMedium,
      fontSize: 32,
      letterSpacing: -0.8,
      fontVariant: ['tabular-nums'] as Array<'tabular-nums'>,
      color: c.ink,
    },
    caption: {
      fontFamily: font.regular,
      fontSize: 12.5,
      lineHeight: 18,
      color: c.muted,
    },
  };
}

/** Build the shared style sheet against an active palette. */
export function makeShared(c: ThemeColors) {
  const elevation = makeElevation(c);
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.background,
    },
    container: {
      flexGrow: 1,
      padding: spacing(5),
    },
    /**
     * A form: paper stock with a ruled edge. No shadow — on a printed slip
     * the edge is the edge.
     */
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.card,
      borderWidth: layout.rule,
      borderColor: c.border,
      padding: spacing(4),
    },
    /** Recessed well: a box ruled *inside* the form. */
    well: {
      backgroundColor: c.surfaceAlt,
      borderRadius: radius.sm,
      padding: spacing(3),
    },
    /** Ink-pad button: dark fill, gold label — a stamp ready to press. */
    primaryButton: {
      backgroundColor: c.primary,
      borderRadius: radius.control,
      paddingVertical: spacing(3.5),
      paddingHorizontal: spacing(5),
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 52, // comfortable touch target
    },
    primaryButtonText: {
      color: c.onPrimary,
      fontFamily: font.bold,
      fontSize: 15,
      letterSpacing: 0.3,
    },
    secondaryButton: {
      backgroundColor: 'transparent',
      borderColor: c.borderStrong,
      borderWidth: 1,
      borderRadius: radius.control,
      paddingVertical: spacing(3.5),
      paddingHorizontal: spacing(5),
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 52,
    },
    secondaryButtonText: {
      color: c.ink,
      fontFamily: font.semibold,
      fontSize: 15,
      letterSpacing: 0.2,
    },
    errorBox: {
      backgroundColor: c.dangerSurface,
      borderColor: c.danger,
      borderWidth: 1,
      borderRadius: radius.control,
      padding: spacing(3),
      marginVertical: spacing(2),
    },
    errorText: {
      color: c.danger,
      fontFamily: font.medium,
      fontSize: 13.5,
      lineHeight: 20,
    },
    mutedText: makeTypography(c).caption,
  });
}

/** Light-theme static exports (back-compat for non-themed consumers). */
export const typography = makeTypography(light);
export const shared = makeShared(light);
