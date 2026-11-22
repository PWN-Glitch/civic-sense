import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import NetInfo from '@react-native-community/netinfo';
import OfflineBanner, {
  startNetworkMonitor,
  useNetworkStore,
} from '../src/components/OfflineBanner';

const fetchMock = NetInfo.fetch as jest.Mock;
const addEventListenerMock = NetInfo.addEventListener as jest.Mock;

describe('OfflineBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useNetworkStore.setState({ isOffline: false });
    fetchMock.mockResolvedValue({ isConnected: true });
  });

  it('is hidden while online', async () => {
    await render(<OfflineBanner />);
    expect(screen.queryByText(/You're offline/)).toBeNull();
  });

  it('appears with the drafts message when offline', async () => {
    useNetworkStore.setState({ isOffline: true });
    await render(<OfflineBanner />);
    expect(
      screen.getByText("You're offline — reports will be saved as drafts"),
    ).toBeTruthy();
  });

  it('reacts to NetInfo connectivity events', async () => {
    type Listener = (state: { isConnected: boolean | null }) => void;
    let listener: Listener | null = null;
    addEventListenerMock.mockImplementation((cb: Listener) => {
      listener = cb;
      return jest.fn();
    });
    fetchMock.mockResolvedValue({ isConnected: true });

    const stop = startNetworkMonitor();
    await render(<OfflineBanner />);

    // Let the initial NetInfo.fetch() resolve.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(/You're offline/)).toBeNull();

    const fire = listener as Listener | null;
    // External (non-React) event → wrap in act; zustand's notify schedules
    // the re-render, so assert under waitFor.
    act(() => {
      fire?.({ isConnected: false });
    });
    await waitFor(() => {
      expect(
        screen.getByText("You're offline — reports will be saved as drafts"),
      ).toBeTruthy();
    });

    act(() => {
      fire?.({ isConnected: true });
    });
    await waitFor(() => {
      expect(screen.queryByText(/You're offline/)).toBeNull();
    });
    stop();
  });

  it('starts offline when NetInfo says the device is already disconnected', async () => {
    fetchMock.mockResolvedValue({ isConnected: false });
    addEventListenerMock.mockImplementation(() => jest.fn());
    await render(<OfflineBanner />);
    const stop = startNetworkMonitor();
    await waitFor(() => {
      expect(useNetworkStore.getState().isOffline).toBe(true);
    });
    stop();
  });
});
