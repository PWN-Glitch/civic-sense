import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../src/screens/Home';
import { useAuthStore } from '../src/lib/auth';
import { useDraftStore } from '../src/lib/offline';
import { ONBOARDED_KEY } from '../src/lib/onboarding';
import { tokenStorage } from '../src/lib/storage';
import { api, clearJwt } from '../src/api/client';
import type { RootStackParamList } from '../src/navigation';

jest.mock('../src/lib/drafts', () => ({
  saveDraft: jest.fn(async () => 1),
  listDrafts: jest.fn(async () => []),
  draftCount: jest.fn(async () => 0),
  markSynced: jest.fn(async () => undefined),
  deleteDraft: jest.fn(async () => undefined),
  resetDraftsForTesting: jest.fn(),
}));

// The signed-in branch mounts the Map tab, which fetches /map/issues on
// mount. Mock the client so the suite never touches the network.
jest.mock('../src/api/client', () => {
  const actual = jest.requireActual('../src/api/client');
  return {
    ...actual,
    api: {
      post: jest.fn(),
      get: jest.fn(async () => ({ data: [] })),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    },
  };
});

const Stack = createNativeStackNavigator<RootStackParamList>();

async function renderHome() {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

describe('Home (map-first tab shell)', () => {
  beforeEach(async () => {
    // Most tests exercise the shell itself; the intro has its own case below.
    await tokenStorage.set(ONBOARDED_KEY, '1');
    useAuthStore.setState({
      jwt: 'test-jwt',
      user: { id: 'u1', display_name: 'Test User' },
      booting: false,
      error: null,
    });
    useDraftStore.setState({ unsentCount: 0, syncing: false });
    (api.get as jest.Mock).mockClear();
  });

  it('lands on the Map tab with nearby issues on the map', async () => {
    await renderHome();
    await waitFor(() => {
      expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    });
    // Nearby issues load for the map viewport.
    expect(api.get).toHaveBeenCalledWith(
      '/map/issues',
      expect.objectContaining({
        params: expect.objectContaining({ bbox: expect.any(String) }),
      }),
    );
  });

  it('renders the bottom tab bar with Map, My Reports, Impact, and Settings', async () => {
    await renderHome();
    await waitFor(() => {
      expect(screen.getByTestId('tab-MapTab')).toBeTruthy();
      expect(screen.getByTestId('tab-MyReportsTab')).toBeTruthy();
      expect(screen.getByTestId('tab-ImpactTab')).toBeTruthy();
      expect(screen.getByTestId('tab-SettingsTab')).toBeTruthy();
    });
    expect(screen.getByText('Map')).toBeTruthy();
    expect(screen.getByText('My Reports')).toBeTruthy();
    expect(screen.getByText('Impact')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('keeps "Report a problem" as a persistent primary action in the tab bar', async () => {
    await renderHome();
    await waitFor(() => {
      expect(screen.getByTestId('tab-report')).toBeTruthy();
    });
    // The tab-bar action is labelled for assistive tech…
    const reportTab = screen.getByTestId('tab-report');
    expect(reportTab.props.accessibilityLabel).toBe('Report a problem');
    // …and has a visible "Report" label under the raised button.
    expect(screen.getByText('Report')).toBeTruthy();
  });

  it('badges the My Reports tab with the unsent-drafts count', async () => {
    useDraftStore.setState({ unsentCount: 3, syncing: false });
    await renderHome();
    await waitFor(() => {
      expect(screen.getByTestId('tab-badge-myreports')).toBeTruthy();
    });
    expect(screen.getByText('3')).toBeTruthy();
    // The count is announced, not just drawn.
    expect(
      screen.getByLabelText('My Reports, 3 unsent drafts'),
    ).toBeTruthy();
  });

  it('uses singular copy for exactly one draft and hides the badge at zero', async () => {
    useDraftStore.setState({ unsentCount: 1, syncing: false });
    const q = await renderHome();
    await waitFor(() => {
      expect(
        screen.getByLabelText('My Reports, 1 unsent draft'),
      ).toBeTruthy();
    });
    useDraftStore.setState({ unsentCount: 0, syncing: false });
    await waitFor(() => {
      expect(q.queryByTestId('tab-badge-myreports')).toBeNull();
    });
  });

  it('shows the introduction once and opens the shell from it', async () => {
    await tokenStorage.remove(ONBOARDED_KEY);
    await renderHome();
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-start')).toBeTruthy();
    });
    // The intro explains the percent-sure idea rather than hiding it.
    expect(screen.getByText(/how sure it is/)).toBeTruthy();
    expect(screen.queryByTestId('tab-report')).toBeNull();
    fireEvent.press(screen.getByTestId('onboarding-start'));
    await waitFor(() => {
      expect(screen.getByTestId('tab-report')).toBeTruthy();
    });
    expect(await tokenStorage.get(ONBOARDED_KEY)).toBe('1');
  });

  it('has no sign-in surface anywhere in the shell', async () => {
    await renderHome();
    await waitFor(() => {
      expect(screen.getByTestId('tab-report')).toBeTruthy();
    });
    // The account is provisioned silently, so no auth copy or form exists.
    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(screen.queryByText(/create account/i)).toBeNull();
    expect(screen.queryByTestId('auth-submit')).toBeNull();
  });

  it('offers a retry screen when the session cannot be provisioned', async () => {
    await clearJwt();
    useAuthStore.setState({
      jwt: null,
      user: null,
      booting: true,
      error: null,
    });
    (api.post as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    await renderHome();
    await waitFor(() => {
      expect(screen.getByTestId('boot-retry')).toBeTruthy();
    });
    // No tabs behind the retry: a report needs a real server session.
    expect(screen.queryByTestId('tab-report')).toBeNull();
  });
});
