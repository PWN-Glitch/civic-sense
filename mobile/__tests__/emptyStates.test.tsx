import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MyReportsScreen from '../src/screens/MyReports';
import MapScreen from '../src/screens/Map';
import { api } from '../src/api/client';
import * as drafts from '../src/lib/drafts';
import type { RootStackParamList } from '../src/navigation';

// Safe-area context is required by MapScreen's inset-aware chrome; the app
// always provides it via SafeAreaProvider, so the tests mirror that.
const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const withSafeArea = (node: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={safeAreaMetrics}>{node}</SafeAreaProvider>
);


// Draft storage mocked at the module boundary (same pattern as week 2).
jest.mock('../src/lib/drafts', () => ({
  saveDraft: jest.fn(async () => 1),
  listDrafts: jest.fn(async () => []),
  draftCount: jest.fn(async () => 0),
  markSynced: jest.fn(async () => undefined),
  deleteDraft: jest.fn(async () => undefined),
  resetDraftsForTesting: jest.fn(),
}));

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

const getMock = api.get as jest.Mock;
const listDraftsMock = drafts.listDrafts as jest.Mock;
const mockNavigate = jest.fn();

const Stack = createNativeStackNavigator<RootStackParamList>();

function renderMyReports() {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="MyReports" component={MyReportsScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

describe('Empty states (week 3, P-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listDraftsMock.mockResolvedValue([]);
  });

  it('My Reports: empty state points at Report a problem', async () => {
    getMock.mockResolvedValue({ data: [] });
    renderMyReports();
    await waitFor(() => {
      expect(screen.getByText('No reports yet')).toBeTruthy();
    });
    expect(screen.getByText(/Tap Report a problem/)).toBeTruthy();
    expect(screen.getAllByText('Report a problem').length).toBeGreaterThan(0);
  });

  it('My Reports: error state offers a retry button', async () => {
    getMock.mockRejectedValue(new Error('network down'));
    renderMyReports();
    await waitFor(() => {
      expect(screen.getByText("We couldn't load your reports.")).toBeTruthy();
    });
    expect(screen.getAllByText('Try again').length).toBeGreaterThan(0);
  });

  it('My Reports: drafts still render when the server is unreachable', async () => {
    listDraftsMock.mockResolvedValue([
      {
        id: 3,
        photo_uri: null,
        category: 'trash',
        description: 'Overflowing bin',
        lat: 39.29,
        lng: -76.61,
        accuracy: null,
        severity: null,
        created_at: '2026-10-08T12:00:00.000Z',
        synced: 0,
      },
    ]);
    getMock.mockRejectedValue(new Error('network down'));
    renderMyReports();
    await waitFor(() => {
      expect(screen.getByText('Not yet submitted')).toBeTruthy();
    });
    expect(screen.getByText('Overflowing bin')).toBeTruthy();
    // Status pill pairs icon with text — never color-only.
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('Map: empty state renders when no issues are nearby', async () => {
    getMock.mockResolvedValueOnce({ data: [] });
    render(
      withSafeArea(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <MapScreen navigation={{ navigate: mockNavigate } as any} route={{ key: 'm', name: 'Map' } as any} />,
      ),
    );
    await waitFor(() => {
      expect(screen.getByText('No issues reported nearby')).toBeTruthy();
    });
  });

  it('Map: first-load failure shows a retry button, never a bare error', async () => {
    getMock.mockRejectedValueOnce(new Error('network down'));
    render(
      withSafeArea(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <MapScreen navigation={{ navigate: mockNavigate } as any} route={{ key: 'm', name: 'Map' } as any} />,
      ),
    );
    await waitFor(() => {
      expect(screen.getByText("We couldn't load nearby issues.")).toBeTruthy();
    });
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});
