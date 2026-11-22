import { render, screen } from '@testing-library/react-native';
import {
  OsmAttribution,
  OSM_MAP_STYLE,
  OSM_TILE_URL,
} from '../src/components/OsmMap';
import { ThemeProvider } from '../src/lib/theme';

// OsmMap hosts the free-tile style + required license attribution. These
// tests pin the style contract: an inline MapLibre style whose single raster
// source serves the free OSM tile URL (no API key, no hosted style JSON).

const wrap = (node: React.ReactElement) =>
  render(<ThemeProvider>{node}</ThemeProvider>);

describe('OSM_MAP_STYLE', () => {
  it('is a self-contained raster style on the free OSM tile server', () => {
    expect(OSM_MAP_STYLE.version).toBe(8);
    const osmSource = OSM_MAP_STYLE.sources.osm;
    if (osmSource.type !== 'raster') {
      throw new Error('osm source must be raster');
    }
    expect(osmSource.tiles).toEqual([OSM_TILE_URL]);
    expect(osmSource.tileSize).toBe(256);
    expect(osmSource.tiles?.[0]).toBe(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    );
    expect(OSM_MAP_STYLE.layers).toHaveLength(1);
    expect(OSM_MAP_STYLE.layers[0]).toMatchObject({
      type: 'raster',
      source: 'osm',
    });
  });
});

describe('OsmAttribution', () => {
  it('renders the required OSM license attribution', async () => {
    await wrap(<OsmAttribution />);
    expect(screen.getByText('© OpenStreetMap contributors')).toBeTruthy();
  });
});
