import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChartColumn,
  ClipboardList,
  Map as MapIcon,
  Plus,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react-native';
import ImpactScreen from '../screens/Impact';
import MapScreen from '../screens/Map';
import MyReportsScreen from '../screens/MyReports';
import SettingsScreen from '../screens/Settings';
import { Icon, ICON_STROKE } from '../components/Icon';
import { useDraftStore } from '../lib/offline';
import { useTheme } from '../lib/theme';
import { font, layout, spacing, type ThemeColors } from '../theme';
import type { RootStackParamList, RootTabParamList } from '../navigation';

const Tab = createBottomTabNavigator<RootTabParamList>();
type StackNav = NativeStackNavigationProp<RootStackParamList>;

interface TabSpec {
  name: keyof RootTabParamList;
  label: string;
  icon: LucideIcon;
}

const LEFT_TABS: TabSpec[] = [
  { name: 'MapTab', label: 'Map', icon: MapIcon },
  { name: 'MyReportsTab', label: 'My Reports', icon: ClipboardList },
];
const RIGHT_TABS: TabSpec[] = [
  { name: 'ImpactTab', label: 'Impact', icon: ChartColumn },
  { name: 'SettingsTab', label: 'Settings', icon: SettingsIcon },
];

/**
 * Custom tab bar: two content tabs on the left, one on the right, and a
 * raised primary Report button in the center. Report isn't a tab screen —
 * it's the persistent primary action, so it pushes the Camera flow on the
 * parent stack from anywhere in the app and never scrolls away.
 */
function CivicTabBar({ state, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const stackNavigation = useNavigation<StackNav>();
  const unsentDrafts = useDraftStore((s) => s.unsentCount);
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const renderTab = (spec: TabSpec) => {
    const routeIndex = state.routes.findIndex((r) => r.name === spec.name);
    if (routeIndex === -1) return null;
    const focused = state.index === routeIndex;
    const tint = focused ? colors.ink : colors.muted;
    // Unsent offline drafts surface as a badge on the My Reports tab — the
    // same signal the old home card carried, now where the drafts live.
    const badge = spec.name === 'MyReportsTab' && unsentDrafts > 0;

    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: state.routes[routeIndex].key,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) {
        navigation.navigate(spec.name);
      }
    };

    return (
      <Pressable
        key={spec.name}
        testID={`tab-${spec.name}`}
        onPress={onPress}
        style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={
          badge
            ? `${spec.label}, ${unsentDrafts} unsent ${
                unsentDrafts === 1 ? 'draft' : 'drafts'
              }`
            : spec.label
        }
      >
        {focused ? <View style={styles.tabActiveRule} /> : null}
        <View>
          <Icon
            icon={spec.icon}
            size={20}
            color={tint}
            strokeWidth={focused ? ICON_STROKE + 0.4 : ICON_STROKE}
          />
          {badge ? (
            <View
              style={styles.badge}
              testID="tab-badge-myreports"
              importantForAccessibility="no"
            >
              <Text style={styles.badgeText}>
                {unsentDrafts > 9 ? '9+' : unsentDrafts}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.tabLabel, { color: tint }]} numberOfLines={1}>
          {spec.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, spacing(2)) },
      ]}
    >
      <View style={styles.barRow}>
        {LEFT_TABS.map(renderTab)}

        <View style={styles.reportSlot} pointerEvents="box-none">
          <Pressable
            testID="tab-report"
            onPress={() => stackNavigation.navigate('Camera')}
            style={({ pressed }) => [
              styles.reportHitArea,
              pressed && styles.reportPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Report a problem"
            accessibilityHint="Opens the camera to start a new report"
          >
            {/*
              The report action is the one die-cut piece on the whole shell: a
              squared ink pad that breaks the bar's top rule. Everything else
              on the bar is flat type and hairlines, so the eye lands here
              first without any colour shouting.
            */}
            <View style={styles.reportButton}>
              <Plus
                size={24}
                color={colors.onPrimary}
                strokeWidth={2.6}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            </View>
            <Text
              style={[styles.reportLabel, { color: colors.ink }]}
              numberOfLines={1}
            >
              Report
            </Text>
          </Pressable>
        </View>

        {RIGHT_TABS.map(renderTab)}
      </View>
    </View>
  );
}

/**
 * Signed-in shell: Map is the landing tab, My Reports and Settings are one
 * tap away, and the raised Report button is always in reach. Flow screens
 * (Camera, Preview, Analysis, …) live on the parent stack and push over
 * these tabs.
 */
export default function TabsNavigator() {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      initialRouteName="MapTab"
      tabBar={(props) => <CivicTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.ink,
        headerTitleStyle: {
          fontFamily: font.semibold,
          fontSize: 16,
          letterSpacing: 0,
        },
        headerShadowVisible: true,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tab.Screen
        name="MapTab"
        component={MapScreen}
        options={{ title: 'Nearby issues', headerShown: false }}
      />
      <Tab.Screen
        name="MyReportsTab"
        component={MyReportsScreen}
        options={{ title: 'My Reports', headerShown: false }}
      />
      <Tab.Screen
        name="ImpactTab"
        component={ImpactScreen}
        options={{ title: 'Impact', headerShown: false }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{ title: 'Settings', headerShown: false }}
      />
    </Tab.Navigator>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // The bar is a ruled strip of the form, not a floating shelf: one solid
    // rule along the top edge, square corners, no shadow.
    bar: {
      backgroundColor: c.background,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    barRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingTop: spacing(2),
      paddingHorizontal: spacing(2),
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      // Bottom-anchored, not centred: the Report plate's label in the middle
      // slot sits flush above the bar's bottom padding, so both slots have to
      // measure their labels from that same edge or "REPORT" rides low.
      justifyContent: 'flex-end',
      minHeight: 52,
      paddingBottom: spacing(2),
      gap: 4,
    },
    // Active tab = a gold rule across its own strip, like the tab of a
    // file folder marking where you are.
    tabActiveRule: {
      position: 'absolute',
      top: 0,
      left: spacing(3),
      right: spacing(3),
      height: 2,
      backgroundColor: c.warning,
    },
    tabPressed: {
      opacity: 0.7,
    },
    tabLabel: {
      fontFamily: font.monoBold,
      fontSize: 9.5,
      lineHeight: 12,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    badge: {
      position: 'absolute',
      top: -4,
      right: -10,
      minWidth: 16,
      height: 16,
      borderRadius: 2,
      backgroundColor: c.warning,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    badgeText: {
      // Ink-on-amber reads in both palettes (light warning is a dark amber,
      // dark warning is a light amber — ink (#17233B / #0F1520-adjacent)
      // keeps ≥4.5:1 on both).
      color: c.primary,
      fontFamily: font.monoBold,
      fontSize: 10,
      fontVariant: ['tabular-nums'],
    },
    reportSlot: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-end',
      minHeight: 52,
    },
    // The whole center slot is the touch target (≥48dp tall, full flex
    // width) — the raised dial is its visual anchor.
    reportHitArea: {
      alignItems: 'center',
      justifyContent: 'flex-end',
      alignSelf: 'stretch',
      minHeight: 64,
      // Matches `tab.paddingBottom` so the dial label shares the tab labels'
      // baseline instead of hanging at the bar's edge.
      paddingBottom: spacing(2),
    },
    // The one die-cut piece of the shell: a squared pad that breaks the bar's
    // top rule by a few dp, so the primary action is found before it is read.
    reportButton: {
      width: 44,
      height: 44,
      borderRadius: 2,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -8,
    },
    reportPressed: {
      opacity: 0.85,
    },
    reportLabel: {
      // Same metrics as `tabLabel` — it sits in the same row, so it reads as a
      // peer label rather than a stamped-on caption.
      fontFamily: font.monoBold,
      fontSize: 9.5,
      lineHeight: 12,
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginTop: 4,
    },
  });
