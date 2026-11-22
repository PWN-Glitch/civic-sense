import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  Camera,
  Map,
  ViewAnnotation,
  type CameraRef,
  type ViewAnnotationEvent,
} from '@maplibre/maplibre-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LocateFixed, MapPin } from 'lucide-react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { OsmAttribution, OSM_MAP_STYLE } from '../components/OsmMap';
import { getCurrentPosition } from '../lib/location';
import { useTheme } from '../lib/theme';
import { font, spacing, type ThemeColors } from '../theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Location'>;

// Downtown Baltimore, the demo city. Only used when the user explicitly
// chooses it (or while waiting for GPS to resolve).
const FALLBACK = { lat: 39.2904, lng: -76.6122 };

/** Zoom ≈ the old 0.01° latitudeDelta viewport at Baltimore's latitude. */
const PIN_ZOOM = 15;

/**
 * The draggable location pin — the same teardrop language as the map
 * screen's status pins, always in the primary palette.
 */
function LocationPin({ color, onPrimary }: { color: string; onPrimary: string }) {
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

export default function LocationScreen({ route, navigation }: Props) {
  const params = route.params;
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const cameraRef = useRef<CameraRef>(null);
  const [coordinate, setCoordinate] = useState<{ latitude: number; longitude: number } | null>(null);
  const [accuracy, setAccuracy] = useState<number | undefined>(undefined);
  const [locating, setLocating] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  // When GPS is unavailable, the fallback starting point is indicated
  // explicitly to the user.
  const [usingFallback, setUsingFallback] = useState(false);

  // The GPS fix usually lands before the native map has finished loading, so
  // the first easeTo is a no-op and the map stays on its initial (fallback)
  // centre while the pin sits off in the corner. Remember the target and
  // re-apply it once the map is ready.
  const pendingCenter = useRef<[number, number] | null>(null);

  const animateTo = (lat: number, lng: number) => {
    const center: [number, number] = [lng, lat];
    pendingCenter.current = center;
    // `typeof` guard: the ref exists but the method may not (e.g. mocked
    // Camera in tests); optional chaining alone would still throw.
    if (typeof cameraRef.current?.easeTo !== 'function') return;
    cameraRef.current.easeTo({
      center,
      zoom: PIN_ZOOM,
      duration: 400,
    });
  };

  const onMapReady = () => {
    const center = pendingCenter.current;
    if (!center) return;
    if (typeof cameraRef.current?.easeTo !== 'function') return;
    cameraRef.current.easeTo({ center, zoom: PIN_ZOOM, duration: 0 });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pos = await getCurrentPosition();
        if (cancelled) return;
        setCoordinate({ latitude: pos.lat, longitude: pos.lng });
        setAccuracy(pos.accuracy);
        animateTo(pos.lat, pos.lng);
      } catch (err) {
        if (cancelled) return;
        // GPS unavailable or permission denied: park the pin on Baltimore
        // and tell the user exactly what happened and what to do.
        setCoordinate({ latitude: FALLBACK.lat, longitude: FALLBACK.lng });
        setUsingFallback(true);
        setNotice(
          err instanceof Error
            ? err.message
            : "We couldn't get your location. Drag the pin to the issue.",
        );
      } finally {
        if (!cancelled) setLocating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryGps = async () => {
    setLocating(true);
    setNotice(null);
    try {
      const pos = await getCurrentPosition();
      setCoordinate({ latitude: pos.lat, longitude: pos.lng });
      setAccuracy(pos.accuracy);
      setUsingFallback(false);
      animateTo(pos.lat, pos.lng);
    } catch (err) {
      setCoordinate({ latitude: FALLBACK.lat, longitude: FALLBACK.lng });
      setUsingFallback(true);
      setNotice(
        err instanceof Error
          ? err.message
          : "We couldn't get your location. Drag the pin to the issue.",
      );
    } finally {
      setLocating(false);
    }
  };

  const onDragEnd = (event: NativeSyntheticEvent<ViewAnnotationEvent>) => {
    const [lng, lat] = event.nativeEvent.lngLat;
    setCoordinate({ latitude: lat, longitude: lng });
  };

  const useLocation = () => {
    if (!coordinate) return;
    navigation.navigate('Route', {
      ...params,
      lat: coordinate.latitude,
      lng: coordinate.longitude,
      locationAccuracy: accuracy,
    });
  };

  const startLat = coordinate?.latitude ?? FALLBACK.lat;
  const startLng = coordinate?.longitude ?? FALLBACK.lng;

  return (
    <View style={shared.screen}>
      <Map
        style={styles.map}
        mapStyle={OSM_MAP_STYLE}
        attribution={false}
        logo={false}
        accessibilityLabel="Map for choosing the issue location"
        onDidFinishLoadingMap={onMapReady}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: [startLng, startLat],
            zoom: PIN_ZOOM,
          }}
        />
        {coordinate && (
          <ViewAnnotation
            id="issue-location"
            lngLat={[coordinate.longitude, coordinate.latitude]}
            anchor="bottom"
            draggable
            onDragEnd={onDragEnd}
          >
            <View accessibilityLabel="Issue location pin. Drag to adjust.">
              <LocationPin color={colors.primary} onPrimary={colors.onPrimary} />
            </View>
          </ViewAnnotation>
        )}
      </Map>
      <OsmAttribution position="top" />

      <View style={styles.panel}>
        {locating ? (
          <View
            style={styles.rowCenter}
            accessibilityLiveRegion="polite"
            accessibilityLabel="Finding your location"
          >
            <ActivityIndicator
              color={colors.primary}
              importantForAccessibility="no"
            />
            <Text style={[typography.body, styles.locatingText]}>
              Finding your location…
            </Text>
          </View>
        ) : (
          <>
            {usingFallback ? (
              <View
                style={styles.fallbackBox}
                accessibilityLiveRegion="polite"
              >
                <View style={styles.fallbackTitleRow}>
                  <MapPin
                    size={15}
                    color={colors.warning}
                    strokeWidth={2.4}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                  <Text style={[typography.label, styles.fallbackTitle]}>
                    Using downtown Baltimore as the starting point
                  </Text>
                </View>
                <Text style={[typography.caption, styles.fallbackBody]}>
                  {notice ??
                    "We couldn't get your location. Drag the pin to the issue, or try GPS again."}
                </Text>
                <Pressable
                  style={styles.retryGps}
                  onPress={() => void retryGps()}
                  accessibilityLabel="Try GPS again"
                  accessibilityRole="button"
                  accessibilityHint="Requests your location again"
                >
                  <LocateFixed
                    size={15}
                    color={colors.primary}
                    strokeWidth={2.2}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                  <Text style={styles.retryGpsText}>Try GPS again</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {notice ? (
                  <Text style={[typography.caption, styles.notice]}>
                    {notice}
                  </Text>
                ) : null}
                {accuracy !== undefined && (
                  <Text style={[typography.caption, styles.coords]}>
                    GPS accuracy: within about {Math.round(accuracy)} m. Drag
                    the pin if the issue is somewhere else.
                  </Text>
                )}
              </>
            )}
            <Pressable
              style={[shared.primaryButton, styles.button]}
              onPress={useLocation}
              disabled={!coordinate}
              accessibilityLabel="Use this location"
              accessibilityRole="button"
              accessibilityHint="Confirms the pin position and continues to the report"
            >
              <Text style={shared.primaryButtonText}>Use this location</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    map: {
      flex: 1,
    },
    panel: {
      padding: spacing(5),
      backgroundColor: c.surfaceRaised,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hairline,
    },
    coords: {
      fontVariant: ['tabular-nums'],
    },
    rowCenter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing(3),
    },
    locatingText: {
      marginLeft: spacing(3),
    },
    notice: {
      color: c.warning,
      marginBottom: spacing(2),
    },
    fallbackBox: {
      backgroundColor: c.warningSurface,
      borderColor: c.warning,
      borderWidth: 1,
      borderRadius: 3,
      padding: spacing(4),
    },
    fallbackTitle: {
      color: c.warning,
    },
    fallbackTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1.5),
    },
    fallbackBody: {
      marginTop: spacing(1),
      color: c.body,
    },
    retryGps: {
      marginTop: spacing(2),
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1.5),
    },
    retryGpsText: {
      color: c.primary,
      fontFamily: font.bold,
      fontSize: 15,
    },
    button: {
      marginTop: spacing(3),
    },
  });
