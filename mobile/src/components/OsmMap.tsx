import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { useTheme } from '../lib/theme';
import { font, spacing, type ThemeColors } from '../theme';

/**
 * Free OpenStreetMap raster tiles — no API key, no Google SDK, no billing.
 *
 * The map stack is MapLibre Native (`@maplibre/maplibre-react-native`):
 * an open-source renderer that needs no API key at all. Base cartography is
 * the standard free OSM tile server, delivered to `Map` as an inline
 * MapLibre style (`OSM_MAP_STYLE`) whose only layer is the OSM raster
 * source — 256px XYZ tiles, the standard slippy-map scheme.
 *
 * OSM tile usage policy: fine for a student/demo app at this volume.
 * Attribution is rendered by `OsmAttribution` (ODbL requirement) — every
 * screen that mounts a map must also mount it.
 */

/** Standard free OSM tile server. {z}/{x}/{y} are substituted at runtime. */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** OSM serves tiles up to zoom 19. */
export const OSM_MAX_ZOOM = 19;

/**
 * Minimal MapLibre style: a single OSM raster source + raster layer, so the
 * map needs no hosted style JSON and no key. Pass to `Map`'s `mapStyle`.
 */
export const OSM_MAP_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: [OSM_TILE_URL],
      tileSize: 256,
      minzoom: 0,
      maxzoom: OSM_MAX_ZOOM,
      scheme: 'xyz',
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
      // Raster tiles carry their place labels baked in. With the default
      // fade, MapLibre cross-dissolves two tile zoom levels while zooming,
      // so "Baltimore" paints twice at different sizes. Zeroing the fade
      // swaps tile sets cleanly instead of blending them.
      paint: {
        'raster-fade-duration': 0,
        // Pulled back from full chroma so the basemap sits behind the
        // app's own marks instead of competing with them — a printed
        // reference map under a work order, not a branded map product.
        'raster-saturation': -0.45,
        'raster-contrast': 0.04,
      },
    },
  ],
};

/**
 * "© OpenStreetMap contributors" — required by the OSM license. Positioned
 * bottom-left by default; pass `position="top"` when a sheet/panel covers
 * the bottom of the map (e.g. the Location screen's location panel).
 */
export function OsmAttribution({
  bottomOffset = 0,
  position = 'bottom',
}: {
  bottomOffset?: number;
  position?: 'top' | 'bottom';
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const placement =
    position === 'top' ? { top: spacing(3) } : { bottom: bottomOffset + spacing(2) };
  return (
    <View
      style={[styles.attribution, placement]}
      pointerEvents="none"
      importantForAccessibility="no"
    >
      <Text style={[typography.caption, styles.attributionText]}>
        © OpenStreetMap contributors
      </Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // A ruled credit strip, not a floating pill: it belongs to the frame.
    attribution: {
      position: 'absolute',
      left: spacing(2),
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 5,
      paddingVertical: 2,
    },
    attributionText: {
      color: c.body,
      fontFamily: font.mono,
      fontSize: 9.5,
      lineHeight: 13,
      letterSpacing: 0.2,
    },
  });
