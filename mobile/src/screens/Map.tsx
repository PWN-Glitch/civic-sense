import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  type CameraRef,
  type GeoJSONSourceRef,
  type LngLatBounds,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import type { NativeSyntheticEvent } from 'react-native';
import { ChevronRight, LocateFixed } from 'lucide-react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import Loading from '../components/Loading';
import { OsmAttribution, OSM_MAP_STYLE } from '../components/OsmMap';
import { getCurrentPosition } from '../lib/location';
import { useTheme } from '../lib/theme';
import { useFocusReload } from '../lib/useFocusReload';
import { font, layout, spacing, type ThemeColors } from '../theme';
import type { MapIssue } from '../types';

/**
 * Navigation shape Map needs. Rendered as the landing tab inside the bottom
 * tab navigator, so the prop is the tab's navigation — `navigate` bubbles
 * up to the parent stack for Camera / IssueDetails. Loosely typed so the
 * screen mounts identically in tests and under either navigator.
 */
interface Props {
  navigation: {
    navigate: (screen: string, params?: object) => void;
  };
  /** Unused; accepted so the screen can be mounted with stack-style props. */
  route?: { key: string; name: string };
}

/** Downtown Baltimore, the demo city: [longitude, latitude] (MapLibre order). */
const DEFAULT_CENTER: [number, number] = [-76.6122, 39.2904];
const DEFAULT_ZOOM = 12;

/** Cluster tuning: tight enough that the map still reads as a survey plot. */
const CLUSTER_RADIUS = 44;
const CLUSTER_MAX_ZOOM = 15;

const statusColors = (c: ThemeColors): Record<string, string> => ({
  Draft: c.muted,
  Confirmed: c.primary,
  Submitted: c.primary,
  Acknowledged: c.warning,
  InProgress: c.warning,
  Resolved: c.success,
});

/**
 * Drawn status pin: a teardrop with a light core dot, status-colored. The
 * drawn pin (vs. the platform default `pinColor`) keeps markers consistent
 * with the civic-ledger palette in both themes and stays legible at cluster
 * sizes. Color never carries meaning alone — the callout text names the
 * status.
 */
function StatusPin({ color, onPrimary }: { color: string; onPrimary: string }) {
  return (
    <Svg width={30} height={38} viewBox="0 0 30 38">
      <Path
        d="M15 1 C7.8 1 2 6.8 2 14 C2 23.5 15 37 15 37 C15 37 28 23.5 28 14 C28 6.8 22.2 1 15 1 Z"
        fill={color}
        stroke={onPrimary}
        strokeWidth={1.5}
      />
      <Circle cx={15} cy={14} r={4.5} fill={onPrimary} />
    </Svg>
  );
}

/**
 * Floating "find me" control — an instrument-style round button that flies
 * the camera to the user's live GPS position. Rendered above the map, below
 * the tab bar; 48dp touch target, spins while locating.
 */
function RecenterButton({
  locating,
  onPress,
  style,
}: {
  locating: boolean;
  onPress: () => void;
  /** Overrides the floating bottom-right placement (e.g. to sit in flow). */
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      style={[styles.recenter, style]}
      onPress={onPress}
      disabled={locating}
      testID="map-recenter"
      accessibilityRole="button"
      accessibilityLabel="Center map on my location"
      accessibilityHint="Moves the map to your current GPS position"
      accessibilityState={{ busy: locating }}
    >
      <LocateFixed
        size={22}
        color={locating ? colors.muted : colors.primary}
        strokeWidth={2.2}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

/**
 * Visible-bounds → API bbox. MapLibre reports the viewport as
 * [west, south, east, north]; the backend expects "minLng,minLat,maxLng,maxLat"
 * — exactly the same order, so this is a plain join.
 */
export function bboxForBounds(bounds: LngLatBounds): string {
  return bounds.join(',');
}

/** MapIssue[] → GeoJSON FeatureCollection for the clustered source. */
function toFeatureCollection(issues: MapIssue[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: issues.map((issue) => ({
      type: 'Feature',
      id: issue.id,
      properties: {
        id: issue.id,
        status: issue.status,
        category: issue.category,
      },
      geometry: {
        type: 'Point',
        coordinates: [issue.lng, issue.lat],
      },
    })),
  };
}

/** Properties carried on a pressed cluster feature. */
interface ClusterFeatureProps {
  cluster_id?: number;
  point_count?: number;
}

export default function MapScreen({ navigation }: Props) {
  const [issues, setIssues] = useState<MapIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { colors, typography, shared } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const markerColors = statusColors(colors);
  const sourceRef = useRef<GeoJSONSourceRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  // The user's own live position — drives the recenter dot and camera.
  const [myPosition, setMyPosition] = useState<[number, number] | null>(null); // [lng, lat]
  const [locating, setLocating] = useState(false);

  const fetchIssues = useCallback(async (bounds: LngLatBounds) => {
    try {
      const { data } = await api.get<MapIssue[]>('/map/issues', {
        params: { bbox: bboxForBounds(bounds) },
      });
      setIssues(data);
      setError(null);
    } catch {
      setError("We couldn't load nearby issues.");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * MapLibre has no initialRegion/initialBounds prop that also yields the
   * resolved viewport — the camera starts from `initialViewState` and the
   * first onRegionDidChange fires once the map settles there. Initial fetch
   * therefore comes from the first region event, same as every pan after it
   * (matching the old onRegionChangeComplete-driven fetch exactly).
   */
  // Keep the last viewport so returning to this tab can re-query it instead of
  // jumping back to the default box. Without this the pin for a report filed a
  // minute ago is missing until the user pans the map.
  const lastBounds = useRef<LngLatBounds | null>(null);

  const reload = useCallback(
    () => fetchIssues(lastBounds.current ?? defaultBounds()),
    // defaultBounds is a stable pure function of module constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchIssues],
  );

  const onRegionDidChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      lastBounds.current = event.nativeEvent.bounds;
      void fetchIssues(event.nativeEvent.bounds);
    },
    [fetchIssues],
  );

  const retry = () => {
    setLoading(true);
    // Refetch the current viewport: without a region prop we ask for the
    // default view, the same "Retry reloads nearby issues" contract as before.
    void fetchIssues(defaultBounds());
  };

  /**
   * Bounds matching the default center/zoom for retry — a ~0.08° box around
   * downtown Baltimore, the same coverage the initial camera shows at z12.
   */
  function defaultBounds(): LngLatBounds {
    const [lng, lat] = DEFAULT_CENTER;
    const delta = 0.08;
    return [lng - delta / 2, lat - delta / 2, lng + delta / 2, lat + delta / 2];
  }

  // Mount load, then a reload each time the tab regains focus: a report filed
  // a minute ago has to be on the map when the user comes back to look for it.
  const loadedOnce = useRef(false);
  useEffect(() => {
    void reload().then(() => {
      loadedOnce.current = true;
    });
  }, [reload]);
  useFocusReload(navigation, () => {
    if (loadedOnce.current) void reload();
  });

  const featureCollection = useMemo(() => toFeatureCollection(issues), [issues]);

  /**
   * Cluster tap → zoom in until the cluster expands. Guarded for test
   * environments where the source ref's methods are mocked away.
   */
  const onClusterPress = useCallback(
    async (event: NativeSyntheticEvent<{ features?: GeoJSON.Feature[] }>) => {
      const feature = event.nativeEvent.features?.[0];
      const props = feature?.properties as ClusterFeatureProps | undefined;
      if (!props || props.point_count === undefined) return;
      const geometry = feature?.geometry;
      if (geometry?.type !== 'Point') return;
      const [lng, lat] = geometry.coordinates as [number, number];
      const clusterId = props.cluster_id;
      if (clusterId === undefined) return;
      try {
        const zoom = await sourceRef.current?.getClusterExpansionZoom(clusterId);
        if (typeof zoom !== 'number') return;
        if (typeof cameraRef.current?.easeTo === 'function') {
          cameraRef.current.easeTo({
            center: [lng, lat],
            zoom,
            duration: 350,
          });
        }
      } catch {
        // Clustering API unavailable (older native build); no-op.
      }
    },
    [],
  );

  /**
   * Recenter on the user's live GPS position. Permission failure surfaces as
   * the shared inline error strip (the map itself keeps working — this is a
   * convenience control, never a gate). The camera ref method is guarded the
   * same way as the cluster handler so tests without a real Camera are safe.
   */
  const recenterToMe = useCallback(async () => {
    setLocating(true);
    try {
      const pos = await getCurrentPosition();
      const center: [number, number] = [pos.lng, pos.lat];
      setMyPosition(center);
      if (typeof cameraRef.current?.easeTo === 'function') {
        cameraRef.current.easeTo({ center, zoom: 15, duration: 500 });
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't get your location.",
      );
    } finally {
      setLocating(false);
    }
  }, []);

  if (loading) {
    return <Loading message="Loading nearby issues…" />;
  }

  // First-load failure with nothing cached: full-screen error with retry.
  if (error && issues.length === 0) {
    return (
      <View style={[shared.screen, shared.container, styles.center]}>
        <Text style={[typography.heading, styles.errorTitle]} accessibilityRole="header">
          Something went wrong
        </Text>
        <Text style={[typography.body, styles.errorMessage]}>{error}</Text>
        <Text style={[typography.caption, styles.errorHint]}>
          Panning the map also retries automatically.
        </Text>
        <Pressable
          style={[shared.primaryButton, styles.retryButton]}
          onPress={retry}
          accessibilityLabel="Try again"
          accessibilityRole="button"
          accessibilityHint="Reloads nearby issues"
        >
          <Text style={shared.primaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  // Successful load with nothing reported in view.
  if (issues.length === 0 && !error) {
    return (
      <View style={shared.screen}>
        <Map
          style={styles.map}
          mapStyle={OSM_MAP_STYLE}
          attribution={false}
          logo={false}
          onRegionDidChange={onRegionDidChange}
          accessibilityLabel="Map of reported issues"
        >
          <Camera
            ref={cameraRef}
            initialViewState={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }}
          />
          {myPosition ? (
            <Marker
              id="my-position"
              lngLat={myPosition}
              anchor="center"
              accessibilityLabel="Your current location"
            >
              <View style={styles.myDot} importantForAccessibility="no" />
            </Marker>
          ) : null}
        </Map>
        <View style={styles.emptyOverlay} pointerEvents="box-none">
          <View style={styles.recenterRow} pointerEvents="box-none">
            <RecenterButton
              locating={locating}
              onPress={() => void recenterToMe()}
              style={styles.recenterInline}
            />
          </View>
          <View style={styles.emptyPanel}>
            <View style={styles.emptyTab} />
            <Text style={[typography.meta, styles.emptyEyebrow]}>
              IN VIEW · 0 ISSUES
            </Text>
            <Text style={[typography.heading, styles.emptyTitle]}>
              No issues reported nearby
            </Text>
            <Text style={[typography.caption, styles.emptyBody]}>
              Be the first — report a problem and it will appear on the map.
            </Text>
            <Pressable
              onPress={() => navigation.navigate('Camera')}
              accessibilityRole="button"
              accessibilityLabel="Report a problem"
              accessibilityHint="Opens the camera to start a new report"
              style={({ pressed }) => [
                styles.emptyAction,
                pressed && styles.emptyActionPressed,
              ]}
            >
              <Text style={styles.emptyActionText}>Report a problem</Text>
              <ChevronRight size={15} color={colors.ink} strokeWidth={2.4} />
            </Pressable>
          </View>
        </View>
        <OsmAttribution />
        {/* The map is framed by a ruled strip: the status bar sits on paper,
            not on cartography, and the viewport count always has a home. */}
        <View style={[styles.topBand, { paddingTop: insets.top }]}>
          <Text style={[typography.meta, styles.topBandText]}>
            NEARBY · 0 ISSUES IN VIEW
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={shared.screen}>
      <Map
        style={styles.map}
        mapStyle={OSM_MAP_STYLE}
        attribution={false}
        logo={false}
        onRegionDidChange={onRegionDidChange}
        accessibilityLabel="Map of reported issues"
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }}
        />
        {/*
          Clustered survey plot: GeoJSONSource does native clustering; a
          circle layer draws the cluster dial and a symbol layer prints the
          count in tabular figures. Unclustered singles keep the drawn SVG
          StatusPin via Marker (the Layer system can't render arbitrary
          React/SVG children).
        */}
        <GeoJSONSource
          id="issues"
          ref={sourceRef}
          data={featureCollection}
          cluster
          clusterRadius={CLUSTER_RADIUS}
          clusterMaxZoom={CLUSTER_MAX_ZOOM}
          onPress={(e) => void onClusterPress(e)}
        >
          <Layer
            id="issue-clusters"
            type="circle"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': colors.primary,
              'circle-radius': [
                'step',
                ['get', 'point_count'],
                16,
                10,
                20,
                50,
                24,
              ],
              'circle-stroke-width': 2,
              'circle-stroke-color': colors.onPrimary,
              'circle-opacity': 0.94,
            }}
          />
          <Layer
            id="issue-cluster-counts"
            type="symbol"
            filter={['has', 'point_count']}
            layout={{
              'text-field': ['get', 'point_count_abbreviated'],
              'text-font': ['Open Sans Semibold'],
              'text-size': 13,
            }}
            paint={{
              'text-color': colors.onPrimary,
            }}
          />
        </GeoJSONSource>
        {issues.map((issue) => (
          <Marker
            key={issue.id}
            id={issue.id}
            lngLat={[issue.lng, issue.lat]}
            anchor="bottom"
            onPress={() =>
              navigation.navigate('IssueDetails', { reportId: issue.id })
            }
            accessibilityLabel={`${issue.category}, status ${issue.status}`}
          >
            <StatusPin
              color={markerColors[issue.status] ?? colors.primary}
              onPrimary={colors.onPrimary}
            />
          </Marker>
        ))}
        {myPosition ? (
          <Marker
            id="my-position"
            lngLat={myPosition}
            anchor="center"
            accessibilityLabel="Your current location"
          >
            <View style={styles.myDot} importantForAccessibility="no" />
          </Marker>
        ) : null}
      </Map>
      {/* The map is framed by a ruled strip: the status bar sits on paper,
          not on cartography, and the viewport count always has a home. */}
      <View style={[styles.topBand, { paddingTop: insets.top }]}>
        <Text style={[typography.meta, styles.topBandText]}>
          NEARBY · {issues.length} {issues.length === 1 ? 'ISSUE' : 'ISSUES'} IN VIEW
        </Text>
      </View>
      <RecenterButton
        locating={locating}
        onPress={() => void recenterToMe()}
      />
      <OsmAttribution />
      {error ? (
        <View style={styles.errorOverlay} pointerEvents="box-none">
          <View style={shared.errorBox} accessibilityLiveRegion="polite">
            <Text style={shared.errorText}>{error}</Text>
            <Pressable
              style={styles.inlineRetry}
              onPress={retry}
              accessibilityLabel="Try again"
              accessibilityRole="button"
              accessibilityHint="Reloads nearby issues"
            >
              <Text style={styles.inlineRetryText}>Try again</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    map: {
      flex: 1,
    },
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    errorTitle: {
      color: c.danger,
      fontSize: 18,
      textAlign: 'center',
    },
    errorMessage: {
      textAlign: 'center',
      marginTop: spacing(2),
    },
    errorHint: {
      textAlign: 'center',
      marginTop: spacing(2),
    },
    retryButton: {
      alignSelf: 'stretch',
      marginTop: spacing(4),
    },
    // A strip of form stock across the top of the map. Opaque on purpose:
    // white status-bar icons need a surface they can read against.
    topBand: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      paddingHorizontal: layout.gutter,
      paddingBottom: spacing(2),
      justifyContent: 'flex-end',
    },
    topBandText: {
      letterSpacing: 0.8,
    },
    emptyOverlay: {
      position: 'absolute',
      // Clears the OSM attribution strip pinned to the scene's bottom edge.
      bottom: spacing(9),
      left: layout.gutter,
      right: layout.gutter,
    },
    recenterRow: {
      alignItems: 'flex-end',
      marginBottom: spacing(3),
    },
    // Same control, in flow above the panel rather than floating over it.
    recenterInline: {
      position: 'relative',
      bottom: 0,
      right: 0,
    },
    // Compact field slip: names the state, explains it, offers one quiet
    // action. The filled Report plate below is the primary path, so this must
    // not present a second filled button.
    // A slip of form stock laid over the map: hard 1px edge, one gold tab
    // at the head. No drop shadow — the edge does the lifting.
    emptyPanel: {
      backgroundColor: c.surface,
      borderRadius: 3,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: spacing(4),
      paddingHorizontal: spacing(4),
      gap: spacing(1),
      maxWidth: layout.maxContentWidth,
    },
    emptyTab: {
      width: 32,
      height: 3,
      backgroundColor: c.warning,
      marginBottom: spacing(2.5),
    },
    emptyEyebrow: {
      color: c.muted,
      letterSpacing: 0.8,
    },
    emptyTitle: {
      marginTop: spacing(0.5),
    },
    emptyBody: {
      marginTop: spacing(1),
    },
    emptyAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1),
      alignSelf: 'flex-start',
      minHeight: 44,
      marginTop: spacing(1),
    },
    emptyActionPressed: {
      opacity: 0.6,
    },
    emptyActionText: {
      fontFamily: font.semibold,
      fontSize: 15,
      color: c.ink,
    },
    errorOverlay: {
      position: 'absolute',
      // Clears the OSM attribution strip pinned to the scene's bottom edge.
      bottom: spacing(9),
      left: spacing(5),
      right: spacing(5),
    },
    // Floating "find me" control — bottom-right, clear of the tab bar.
    // A keyed plate, squared like everything else on the page, with the ink
    // edge standing in for elevation.
    recenter: {
      position: 'absolute',
      right: layout.gutter,
      bottom: spacing(6),
      width: 48,
      height: 48,
      borderRadius: 3,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The user's own position — a ringed blue dot, distinct from issue pins.
    myDot: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: c.primary,
      borderWidth: 3,
      borderColor: c.onPrimary,
    },
    inlineRetry: {
      marginTop: spacing(2),
      minHeight: 44,
      justifyContent: 'center',
    },
    inlineRetryText: {
      color: c.primary,
      fontFamily: font.bold,
      fontSize: 15,
    },
  });
