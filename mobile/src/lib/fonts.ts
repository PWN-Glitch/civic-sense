import { useFonts } from 'expo-font';
import {
  PublicSans_400Regular,
  PublicSans_500Medium,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
  PublicSans_800ExtraBold,
} from '@expo-google-fonts/public-sans';
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from '@expo-google-fonts/ibm-plex-mono';

/**
 * The two faces the design is built on: Public Sans for interface text and
 * IBM Plex Mono for anything read off a citation slip (case numbers, dates,
 * coordinates, counters). Keys must match `font` in `src/theme.ts` exactly —
 * a mismatch renders Roboto, silently.
 */
export const appFonts = {
  PublicSans_400Regular,
  PublicSans_500Medium,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
  PublicSans_800ExtraBold,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
};

export function useAppFonts(): [boolean, Error | null] {
  const [loaded, error] = useFonts(appFonts);
  return [loaded, error ?? null];
}
