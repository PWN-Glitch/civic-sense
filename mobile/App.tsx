import 'react-native-gesture-handler';
import React, { useEffect, useMemo } from 'react';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type LinkingOptions,
  type Theme as NavTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { setUnauthorizedHandler } from './src/api/client';
import OfflineBanner, { startNetworkMonitor } from './src/components/OfflineBanner';
import { useAuthStore } from './src/lib/auth';
import { prefetchModel } from './src/lib/modelManager';
import { startOfflineSync, useDraftStore } from './src/lib/offline';
import { ThemeProvider, useTheme } from './src/lib/theme';
import { useAppFonts } from './src/lib/fonts';
import { useIntroGate } from './src/lib/onboarding';
import { font, light } from './src/theme';
import type { RootStackParamList } from './src/navigation';

import BootScreen from './src/components/BootScreen';
import Onboarding from './src/components/Onboarding';
import TabsNavigator from './src/navigation/Tabs';
import CameraScreen from './src/screens/Camera';
import PreviewScreen from './src/screens/Preview';
import AnalysisScreen from './src/screens/Analysis';
import ConfirmScreen from './src/screens/Confirm';
import LocationScreen from './src/screens/Location';
import ReportScreen from './src/screens/Report';
import RouteScreen from './src/screens/Route';
import ReportReviewScreen from './src/screens/ReportReview';
import TrackScreen from './src/screens/Track';
import IssueDetailsScreen from './src/screens/IssueDetails';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Deep links. A shared case file (`civicsense://report/<id>`) opens that
 * report's status screen; `civicsense://map` opens the map tab. The linking
 * config is deliberately tiny — one shared link is the whole feature.
 */
const LINKING: LinkingOptions<RootStackParamList> = {
  prefixes: ['civicsense://'],
  config: {
    screens: {
      Tabs: {
        screens: {
          MapTab: 'map',
        },
      },
      Track: 'report/:reportId',
    },
  },
};

function Root() {
  const { colors, isDark } = useTheme();
  const jwt = useAuthStore((s) => s.jwt);
  const bootError = useAuthStore((s) => s.error);
  const boot = useAuthStore((s) => s.boot);
  // First launch only: three sentences, then the map. Without this gate the
  // intro was dead code — App went straight to the tabs after a fresh install.
  const { introSeen, dismissIntro } = useIntroGate();

  const screenOptions = useMemo(
    () => ({
      headerStyle: { backgroundColor: colors.background },
      headerTintColor: colors.ink,
      headerTitleStyle: {
        fontFamily: font.semibold,
        fontSize: 16,
        letterSpacing: -0.1,
      },
      headerBackTitle: 'Back',
      headerShadowVisible: false,
      contentStyle: { backgroundColor: colors.background },
    }),
    [colors],
  );

  // Align the native chrome (headers, gestures, transitions) with the active
  // palette by deriving a nav theme whose colors mirror ours.
  const navTheme: NavTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.background,
        text: colors.ink,
        border: colors.hairline,
        notification: colors.danger,
      },
    };
  }, [isDark, colors]);

  // No sign-in screen exists: the app opens on its first real screen as soon
  // as the session is restored (or minted) in the background.
  if (!jwt) {
    return <BootScreen error={bootError} onRetry={() => void boot()} />;
  }

  if (introSeen === null) {
    // Reading the flag is instant, but rendering the map first would make the
    // intro flash on for a returning user. One quiet frame instead.
    return <BootScreen error={null} onRetry={() => void boot()} />;
  }

  if (!introSeen) {
    return (
      <>
        <Onboarding onDone={dismissIntro} />
        <StatusBar style={isDark ? 'light' : 'dark'} />
      </>
    );
  }

  return (
    <NavigationContainer theme={navTheme} linking={LINKING}>
      <OfflineBanner />
      <Stack.Navigator screenOptions={screenOptions}>
        <>
            <Stack.Screen
              name="Tabs"
              component={TabsNavigator}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Camera"
              component={CameraScreen}
              options={{ title: 'Photograph the issue', headerShown: false }}
            />
            <Stack.Screen
              name="Preview"
              component={PreviewScreen}
              options={{ title: 'Preview' }}
            />
            <Stack.Screen
              name="Analysis"
              component={AnalysisScreen}
              options={{ title: 'AI Analysis' }}
            />
            <Stack.Screen
              name="Confirm"
              component={ConfirmScreen}
              options={{ title: 'Confirm category' }}
            />
            <Stack.Screen
              name="Location"
              component={LocationScreen}
              options={{ title: 'Where is it?' }}
            />
            <Stack.Screen
              name="Report"
              component={ReportScreen}
              options={{ title: 'Your report' }}
            />
            <Stack.Screen
              name="Route"
              component={RouteScreen}
              options={{ title: 'Route report' }}
            />
            <Stack.Screen
              name="ReportReview"
              component={ReportReviewScreen}
              options={{ title: 'Review & send' }}
            />
            <Stack.Screen
              name="Track"
              component={TrackScreen}
              options={{ title: 'Case file' }}
            />
            <Stack.Screen
              name="IssueDetails"
              component={IssueDetailsScreen}
              options={{ title: 'Issue details' }}
            />
        </>
      </Stack.Navigator>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </NavigationContainer>
  );
}

export default function App() {
  const reprovision = useAuthStore((s) => s.reprovision);
  const boot = useAuthStore((s) => s.boot);
  const [fontsLoaded, fontError] = useAppFonts();

  useEffect(() => {
    // A 401 means the token died; the device credential can mint a new one
    // without asking anyone for a password.
    setUnauthorizedHandler(() => {
      void reprovision();
    });
    void boot();
    // Week 2: warm the on-device model cache, hydrate the drafts badge, and
    // replay queued drafts whenever connectivity returns.
    prefetchModel();
    void useDraftStore.getState().refresh();
    const stopOfflineSync = startOfflineSync();
    // Week 3 (P-3): mirror NetInfo into zustand for the app-wide offline
    // banner.
    const stopNetworkMonitor = startNetworkMonitor();
    return () => {
      setUnauthorizedHandler(null);
      stopOfflineSync();
      stopNetworkMonitor();
    };
  }, [boot, reprovision]);

  // Hold the first frame until the type is actually there — a flash of Roboto
  // followed by a reflow is worse than a beat of paper-coloured nothing.
  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: light.background }} />;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
