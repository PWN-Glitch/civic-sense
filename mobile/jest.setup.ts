/* Global Jest setup: mock native modules that have no JS implementation in
 * the Node test environment. Tests can override individual mocks locally. */

// expo-secure-store — in-memory key-value store.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

// expo-auth-session + Google provider — no real browser in tests.
jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn(() => 'civicsense://redirect'),
}));

jest.mock('expo-auth-session/providers/google', () => ({
  useIdTokenAuthRequest: jest.fn(() => [
    null,
    null,
    jest.fn(async () => ({ type: 'cancel' })),
  ]),
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
}));

// expo-camera — render nothing; permission hooks default to granted.
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraView: React.forwardRef((props: object, ref: unknown) =>
      React.createElement(View, { ...props, ref, testID: 'camera-view' }),
    ),
    useCameraPermissions: jest.fn(() => [
      { granted: true, canAskAgain: true },
      jest.fn(async () => ({ granted: true, canAskAgain: true })),
    ]),
  };
});

// expo-location — fixed Baltimore coordinate.
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    status: 'granted',
  })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: {
      latitude: 39.2904,
      longitude: -76.6122,
      accuracy: 12,
    },
  })),
  Accuracy: { High: 5 },
}));

// expo-image-manipulator — pass-through.
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(async (uri: string) => ({
    uri,
    width: 1600,
    height: 1200,
  })),
  SaveFormat: { JPEG: 'jpeg' },
}));

// expo-image-picker — camera never opens in Jest; default to "cancelled"
// so add-photo flows no-op unless a test provides an asset.
jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: true,
    assets: null,
  })),
  MediaType: { Images: 'images' },
}));

// @maplibre/maplibre-react-native — native map renderer; plain host views in
// Jest. Map renders its children (Camera, RasterSource/Layer, Markers) so
// tests can query markers and assert on structure. Camera's ref API (easeTo
// etc.) is intentionally absent — screens guard ref-method calls, so the
// GPS "animate to position" path is a no-op under test.
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMap = (props: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement(View, { ...props, testID: 'maplibre-map' }, props.children);
  const MockCamera = React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
    React.createElement(View, { ...props, ref, testID: 'maplibre-camera' }),
  );
  const MockMarker = (props: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement(View, { ...props, testID: 'maplibre-marker' }, props.children);
  const MockViewAnnotation = (
    props: Record<string, unknown> & { children?: React.ReactNode },
  ) =>
    React.createElement(
      View,
      { ...props, testID: 'maplibre-view-annotation' },
      props.children,
    );
  const MockSource = (props: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement(View, { ...props, testID: 'maplibre-raster-source' }, props.children);
  const MockLayer = (props: Record<string, unknown>) =>
    React.createElement(View, { ...props, testID: 'maplibre-layer' });
  return {
    __esModule: true,
    Map: MockMap,
    Camera: MockCamera,
    Marker: MockMarker,
    ViewAnnotation: MockViewAnnotation,
    Callout: MockViewAnnotation,
    RasterSource: MockSource,
    VectorSource: MockSource,
    GeoJSONSource: MockSource,
    ImageSource: MockSource,
    RasterDEMSource: MockSource,
    Layer: MockLayer,
    Images: (props: Record<string, unknown>) =>
      React.createElement(View, { ...props, testID: 'maplibre-images' }),
    UserLocation: (props: Record<string, unknown>) =>
      React.createElement(View, { ...props, testID: 'maplibre-user-location' }),
  };
});

// expo-sqlite is imported transitively in some paths; stub it.
// (lib/drafts.ts replaces openDatabaseSync with a fully in-memory fake in
// its own tests via jest.mock('expo-sqlite', ...) local factories.)
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => ({
    execSync: jest.fn(),
    runSync: jest.fn(() => ({ lastInsertRowId: 0, changes: 0 })),
    getAllSync: jest.fn(() => []),
    getFirstSync: jest.fn(() => null),
  })),
}));

// expo-file-system (legacy API) — no real filesystem in Jest. Individual
// tests override these as needed.
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///mock-documents/',
  cacheDirectory: 'file:///mock-cache/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => '{}'),
  writeAsStringAsync: jest.fn(async () => undefined),
  downloadAsync: jest.fn(async () => ({
    uri: 'file:///mock-documents/download',
    status: 200,
  })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

// react-native-fast-tflite — native Nitro module; requires a dev build and
// never loads under Jest. loadTensorflowModel rejects so classification
// code takes its soft-fallback path unless a test stubs it otherwise.
jest.mock('react-native-fast-tflite', () => ({
  loadTensorflowModel: jest.fn(async () => {
    throw new Error('react-native-fast-tflite is unavailable in Jest');
  }),
  useTensorflowModel: jest.fn(() => ({ model: undefined, state: 'error' })),
}));

// @react-native-community/netinfo — use the library's own jest mock as the
// base; tests drive connectivity events via the addEventListener capture.
jest.mock('@react-native-community/netinfo', () => {
  const mock = require('@react-native-community/netinfo/jest/netinfo-mock');
  return { __esModule: true, default: mock, ...mock };
});

// base64-js is a pure-JS dependency of the on-device pixel pipeline; it
// resolves normally, no mock needed.

// AsyncStorage — use the library's own in-memory jest mock.
jest.mock(
  '@react-native-async-storage/async-storage',
  () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// @react-navigation/bottom-tabs — lightweight in-Jest navigator. Renders
// every screen plus the custom tabBar so tests can assert on tab labels and
// press tabs. Screen-level behavior is unchanged; this only replaces the
// native-backed tab machinery.
jest.mock('@react-navigation/bottom-tabs', () => {
  const React = require('react');
  const { View } = require('react-native');

  function createBottomTabNavigator() {
    function Navigator({
      children,
      tabBar,
    }: {
      children: React.ReactNode;
      tabBar?: (props: {
        state: { index: number; routes: { key: string; name: string }[] };
        navigation: {
          navigate: (name: string) => void;
          emit: (e: object) => { defaultPrevented: boolean };
        };
      }) => React.ReactNode;
    }) {
      const screens = React.Children.toArray(children) as React.ReactElement<{
        name: string;
        component: React.ComponentType<unknown>;
      }>[];
      const routes = screens.map((s, i) => ({
        key: `${s.props.name}-${i}`,
        name: s.props.name,
      }));
      const [index] = React.useState(0);
      const Active = screens[index]?.props.component;
      const tabBarProps = {
        state: { index, routes },
        navigation: {
          navigate: () => {},
          emit: () => ({ defaultPrevented: false }),
        },
      };
      return React.createElement(
        View,
        { style: { flex: 1 } },
        Active ? React.createElement(Active) : null,
        tabBar ? tabBar(tabBarProps) : null,
      );
    }
    function Screen() {
      return null;
    }
    return { Navigator, Screen };
  }

  return {
    __esModule: true,
    createBottomTabNavigator,
  };
});
