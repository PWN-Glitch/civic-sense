import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MapScreen, { bboxForBounds } from '../src/screens/Map';
import { api } from '../src/api/client';

// Safe-area context is required by MapScreen's inset-aware chrome; the app
// always provides it via SafeAreaProvider, so the tests mirror that.
const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const withSafeArea = (node: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={safeAreaMetrics}>{node}</SafeAreaProvider>
);


jest.mock('../src/api/client', () => {
  const actual = jest.requireActual('../src/api/client');
  return {
    ...actual,
    api: {
      post: jest.fn(),
      get: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    },
  };
});

const mockNavigate = jest.fn();

const mockIssues = [
  { id: '1', category: 'pothole', status: 'Submitted', lat: 39.29, lng: -76.61 },
  { id: '2', category: 'trash', status: 'Resolved', lat: 39.3, lng: -76.62 },
  { id: '3', category: 'graffiti', status: 'InProgress', lat: 39.28, lng: -76.6 },
];

describe('Map screen', () => {
  beforeEach(() => {
    (api.get as jest.Mock).mockReset();
  });

  it('renders markers from GET /map/issues on the MapLibre map', async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: mockIssues });
    await render(
      withSafeArea(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <MapScreen navigation={{ navigate: mockNavigate } as any} route={{ key: 'm', name: 'Map' } as any} />,
      ),
    );

    await waitFor(() => {
      expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    });

    await waitFor(() => {
      const markers = screen.getAllByTestId('maplibre-marker');
      expect(markers).toHaveLength(3);
    });

    const map = screen.getByTestId('maplibre-map');
    const countLayer = screen.getAllByTestId('maplibre-layer')
      .find((layer) => layer.props.id === 'issue-cluster-counts');
    expect(countLayer?.props.layout['text-font']).toEqual(['Open Sans Semibold']);
    expect(map.props.mapStyle.glyphs).toMatch(/^https:\/\/.+\/\{fontstack\}\/\{range\}\.pbf$/);

    expect(api.get).toHaveBeenCalledWith(
      '/map/issues',
      expect.objectContaining({ params: expect.objectContaining({ bbox: expect.any(String) }) }),
    );
  });

  it('computes bbox as minLng,minLat,maxLng,maxLat from MapLibre bounds', () => {
    // MapLibre LngLatBounds: [west, south, east, north] → "minLng,minLat,maxLng,maxLat".
    const bbox = bboxForBounds([-76.2, 38.9, -75.8, 39.1]);
    expect(bbox).toBe('-76.2,38.9,-75.8,39.1');
  });

  it('shows a friendly message when loading issues fails', async () => {
    (api.get as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await render(withSafeArea(<MapScreen navigation={{ navigate: mockNavigate } as any} route={{ key: 'm', name: 'Map' } as any} />));
    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load nearby issues/i),
      ).toBeTruthy();
    });
  });
});
