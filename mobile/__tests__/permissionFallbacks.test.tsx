import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import CameraScreen from '../src/screens/Camera';
import LocationScreen from '../src/screens/Location';
import { useCameraPermissions } from 'expo-camera';
import { getCurrentPosition } from '../src/lib/location';

// Permission-denied fallbacks (week 3, P-3/P-4): camera denied → Open
// Settings + library fallback; GPS unavailable → explicit Baltimore choice.
//
// getCurrentPosition is mocked per-test, so Location's effect can run under
// RNTL's auto-detection. MapView.animateToRegion is undefined on the mock,
// so the screen must guard the call (it does — optional chaining).

jest.mock('../src/lib/location', () => ({
  getCurrentPosition: jest.fn(),
}));

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockGoBack = jest.fn();

const useCameraPermissionsMock = useCameraPermissions as jest.Mock;
const getCurrentPositionMock = getCurrentPosition as jest.Mock;
const launchLibraryMock = ImagePicker.launchImageLibraryAsync as jest.Mock;

const locationParams = {
  photoUri: 'file:///photo.jpg',
  category: 'pothole',
  severity: { level: 'moderate', reason: 'Visible depth' },
  predictions: [],
  band: 'low',
  disclaimer: '',
};

// The Camera screen is inset-aware (its close control clears the status bar),
// so it needs the safe-area context the app supplies at the root.
const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderCamera() {
  return render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <CameraScreen
        navigation={{ navigate: mockNavigate, goBack: mockGoBack } as any}
        route={{ key: 'c', name: 'Camera' } as any}
      />
    </SafeAreaProvider>,
  );
}

function renderLocation() {
  return render(
    <LocationScreen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigation={{ navigate: mockNavigate, replace: mockReplace } as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      route={{ key: 'l', name: 'Location', params: locationParams } as any}
    />,
  );
}

// RNTL 14: render() is async — always await it before touching `screen`.
describe('Camera permission fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('denied-forever permission shows explanation, Open Settings, and library fallback', async () => {
    useCameraPermissionsMock.mockReturnValue([
      { granted: false, canAskAgain: false },
      jest.fn(),
    ]);
    await renderCamera();
    await waitFor(() => {
      expect(screen.getByText('Camera access needed')).toBeTruthy();
    });
    expect(screen.getByText(/Nothing is recorded or uploaded/)).toBeTruthy();

    fireEvent.press(screen.getByText('Open Settings'));
    expect(Linking.openSettings).toHaveBeenCalled();

    expect(screen.getByText('Choose from photo library')).toBeTruthy();
  });

  it('library fallback hands the picked photo to Preview', async () => {
    useCameraPermissionsMock.mockReturnValue([
      { granted: false, canAskAgain: false },
      jest.fn(),
    ]);
    launchLibraryMock.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///library-photo.jpg' }],
    });
    await renderCamera();
    fireEvent.press(screen.getByText('Choose from photo library'));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('Preview', {
        photoUri: 'file:///library-photo.jpg',
      });
    });
  });

  it('the headerless viewfinder renders its own close control', async () => {
    useCameraPermissionsMock.mockReturnValue([
      { granted: true, canAskAgain: true },
      jest.fn(),
    ]);
    await renderCamera();
    // The stack header is hidden on this screen, so without this control the
    // only exit is the system back gesture.
    await fireEvent.press(await screen.findByTestId('camera-close'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('askable permission offers the in-app prompt instead of Settings', async () => {
    const request = jest.fn();
    useCameraPermissionsMock.mockReturnValue([
      { granted: false, canAskAgain: true },
      request,
    ]);
    await renderCamera();
    expect(screen.getByText('Allow camera access')).toBeTruthy();
    expect(screen.queryByText('Open Settings')).toBeNull();
  });
});

describe('Location permission / GPS fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GPS failure makes the Baltimore starting point an explicit choice', async () => {
    getCurrentPositionMock.mockRejectedValueOnce(
      new Error(
        'Location permission was denied. You can still drag the pin to the right place.',
      ),
    );
    await renderLocation();
    await waitFor(() => {
      expect(
        screen.getByText('Using downtown Baltimore as the starting point'),
      ).toBeTruthy();
    });
    expect(screen.getByText(/drag the pin/i)).toBeTruthy();
    expect(screen.getByText('Try GPS again')).toBeTruthy();
    expect(screen.getByText('Use this location')).toBeTruthy();
  });

  it('Try GPS again recovers the real position', async () => {
    // Once-reject then resolve: first call (mount effect) fails, the
    // retry's call succeeds.
    getCurrentPositionMock.mockRejectedValueOnce(new Error('denied'));
    getCurrentPositionMock.mockResolvedValue({
      lat: 39.31,
      lng: -76.6,
      accuracy: 9,
    });
    await renderLocation();
    await waitFor(() => {
      expect(screen.getByText('Try GPS again')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Try GPS again'));
    await waitFor(() => {
      expect(screen.getByText(/GPS accuracy: within about 9 m/)).toBeTruthy();
    });
    expect(
      screen.queryByText('Using downtown Baltimore as the starting point'),
    ).toBeNull();
  });

  it('successful GPS shows accuracy guidance and no fallback notice', async () => {
    // Resolved value must be in place BEFORE mount — the mount effect calls
    // getCurrentPosition immediately.
    getCurrentPositionMock.mockResolvedValue({
      lat: 39.2904,
      lng: -76.6122,
      accuracy: 12,
    });
    await renderLocation();
    await waitFor(() => {
      expect(screen.getByText(/within about 12 m/)).toBeTruthy();
    });
    expect(screen.queryByText('Try GPS again')).toBeNull();
  });
});
