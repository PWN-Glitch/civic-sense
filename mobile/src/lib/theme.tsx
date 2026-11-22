import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import { tokenStorage } from './storage';
import {
  dark,
  light,
  makeElevation,
  makeShared,
  makeTypography,
  type ThemeColors,
  type Typography,
} from '../theme';

/** User-selectable appearance preference. `system` follows the OS setting. */
export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_MODE_KEY = 'theme_mode';
const VALID_MODES: ThemeMode[] = ['light', 'dark', 'system'];

export interface ThemeValue {
  /** Active palette (already resolved through `system`). */
  colors: ThemeColors;
  typography: Typography;
  shared: ReturnType<typeof makeShared>;
  /** Shadow styles per tier (card / raised / hero), palette-aware. */
  elevation: ReturnType<typeof makeElevation>;
  /** True when the active palette is the dark one. */
  isDark: boolean;
  /** The user's stored preference (may be `system`). */
  mode: ThemeMode;
  /** Persist + apply a new appearance preference. */
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

/**
 * Light-theme fallback so components/tests that render without a
 * ThemeProvider (e.g. existing unit tests) keep working. Mode setters are
 * no-ops here; the real provider supplies the live implementation.
 */
const fallbackTheme: ThemeValue = {
  colors: light,
  typography: makeTypography(light),
  shared: makeShared(light),
  elevation: makeElevation(light),
  isDark: false,
  mode: 'light',
  setMode: () => {},
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Hydrate the persisted preference once. AsyncStorage/SecureStore are both
  // mocked in Jest; a missing key just leaves the default (`system`).
  useEffect(() => {
    let cancelled = false;
    void tokenStorage.get(THEME_MODE_KEY).then((stored) => {
      if (cancelled) return;
      if (stored && (VALID_MODES as string[]).includes(stored)) {
        setModeState(stored as ThemeMode);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void tokenStorage.set(THEME_MODE_KEY, next);
  }, []);

  const isDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark';

  const value = useMemo<ThemeValue>(() => {
    const palette = isDark ? dark : light;
    return {
      colors: palette,
      typography: makeTypography(palette),
      shared: makeShared(palette),
      elevation: makeElevation(palette),
      isDark,
      mode,
      setMode,
    };
  }, [isDark, mode, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Active theme. Outside a ThemeProvider (unit tests, storybook-style
 * consumers) it returns the light theme rather than throwing, so those
 * renderers stay valid; the app always wraps in ThemeProvider.
 */
export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  return ctx ?? fallbackTheme;
}
