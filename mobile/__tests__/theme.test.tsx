import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { dark, light, makeTypography, type ThemeColors } from '../src/theme';
import { ThemeProvider, useTheme, type ThemeMode } from '../src/lib/theme';
import { tokenStorage } from '../src/lib/storage';

// ── WCAG contrast helpers ───────────────────────────────────────────────────

function luminance(hex: string): number {
  const c = hex.replace('#', '');
  const channel = (i: number) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ── Palette shape ───────────────────────────────────────────────────────────

describe('theme palettes', () => {
  it('dark exposes exactly the same token names as light', () => {
    const lightKeys = Object.keys(light).sort();
    const darkKeys = Object.keys(dark).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  it('every dark token is a valid hex color', () => {
    for (const [key, value] of Object.entries(dark) as [keyof ThemeColors, string][]) {
      expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
      void key;
    }
  });

  it('light palette matches the Citation anchors', () => {
    // Spot-check the Baltimore-flag extremes and the paper tones so a
    // refactor can't silently shift the shipped light theme off the
    // designed palette.
    expect(light.primary).toBe('#11181A'); // ink
    expect(light.onPrimary).toBe('#F5C455'); // Calvert gold
    expect(light.background).toBe('#EDE7DA'); // manila
    expect(light.surface).toBe('#F9F5EA'); // form stock
    expect(light.ink).toBe('#11181A');
    expect(light.body).toBe('#333C3B');
    expect(light.danger).toBe('#A32B1C'); // Crossland red
    expect(light.success).toBe('#1C6B45');
    expect(light.warning).toBe('#8A5A00');
  });
});

// ── Light-mode contrast (WCAG AA: 4.5 normal text, 3.0 large/bold) ─────────

describe('light theme contrast', () => {
  it('primary text (ink) on form stock meets AAA', () => {
    expect(contrast(light.ink, light.surface)).toBeGreaterThanOrEqual(7);
  });

  it('body text on form stock meets AA', () => {
    expect(contrast(light.body, light.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('muted text on form stock meets AA', () => {
    expect(contrast(light.muted, light.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('primary button (gold on ink) meets AA', () => {
    expect(contrast(light.onPrimary, light.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it('semantic accents meet AA on their surfaces', () => {
    expect(contrast(light.danger, light.dangerSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.warning, light.warningSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.success, light.successSurface)).toBeGreaterThanOrEqual(4.5);
  });
});

// ── Dark-mode contrast (WCAG AA: 4.5 normal text, 3.0 large/bold) ──────────

describe('dark theme contrast', () => {
  it('primary text (ink) on surface meets AAA', () => {
    expect(contrast(dark.ink, dark.surface)).toBeGreaterThanOrEqual(7);
  });

  it('body text on surface meets AA', () => {
    expect(contrast(dark.body, dark.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('muted text on surface meets AA', () => {
    expect(contrast(dark.muted, dark.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('primary action color on surface meets AA (for links/icons)', () => {
    expect(contrast(dark.primary, dark.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('primary button (onPrimary on primary) meets AA', () => {
    expect(contrast(dark.onPrimary, dark.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it('semantic accents meet AA on their surfaces', () => {
    expect(contrast(dark.danger, dark.dangerSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.warning, dark.warningSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.success, dark.successSurface)).toBeGreaterThanOrEqual(4.5);
  });
});

// ── makeTypography follows the palette ─────────────────────────────────────

describe('makeTypography', () => {
  it('binds text colors to the given palette', () => {
    const t = makeTypography(dark);
    expect(t.title.color).toBe(dark.ink);
    expect(t.body.color).toBe(dark.body);
    expect(t.caption.color).toBe(dark.muted);
  });
});

// ── Provider behaviour ─────────────────────────────────────────────────────

function Probe() {
  const { isDark, mode, setMode, colors } = useTheme();
  return (
    <>
      <Text testID="mode">{mode}</Text>
      <Text testID="isDark">{String(isDark)}</Text>
      <Text testID="surface">{colors.surface}</Text>
      {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
        <Pressable key={m} testID={`set-${m}`} onPress={() => setMode(m)} />
      ))}
    </>
  );
}

describe('ThemeProvider', () => {
  beforeEach(async () => {
    await tokenStorage.remove('theme_mode');
  });

  it('defaults to system and resolves to the device scheme', async () => {
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    // jest-expo mocks useColorScheme() to 'light' by default.
    await waitFor(() => {
      expect(screen.getByTestId('mode').props.children).toBe('system');
    });
    expect(screen.getByTestId('isDark').props.children).toBe('false');
    expect(screen.getByTestId('surface').props.children).toBe(light.surface);
  });

  it('switches to dark on demand and swaps the palette', async () => {
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByTestId('set-dark'));
    await waitFor(() => {
      expect(screen.getByTestId('isDark').props.children).toBe('true');
    });
    expect(screen.getByTestId('surface').props.children).toBe(dark.surface);
  });

  it('persists the chosen mode', async () => {
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByTestId('set-dark'));
    await waitFor(async () => {
      expect(await tokenStorage.get('theme_mode')).toBe('dark');
    });
  });

  it('hydrates a persisted mode on mount', async () => {
    await tokenStorage.set('theme_mode', 'dark');
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('mode').props.children).toBe('dark');
    });
    expect(screen.getByTestId('isDark').props.children).toBe('true');
  });

  it('useTheme outside a provider falls back to light', async () => {
    await render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('surface').props.children).toBe(light.surface);
    });
  });
});
