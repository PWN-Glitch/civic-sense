import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MyReportsScreen from '../src/screens/MyReports';
import { useFocusReload } from '../src/lib/useFocusReload';
import { api } from '../src/api/client';
import * as drafts from '../src/lib/drafts';
import type { RootStackParamList } from '../src/navigation';

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

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * The docket and the map stay mounted for the life of the app, so a report
 * filed on another screen is only visible if they reload on focus. These tests
 * pin that behaviour — without it "file a report, go look at it" shows an empty
 * list and a map missing the pin.
 */
describe('useFocusReload', () => {
  function Probe({
    navigation,
    onFocus,
  }: {
    navigation: unknown;
    onFocus: () => void;
  }) {
    useFocusReload(navigation, onFocus);
    return <Text>probe</Text>;
  }

  it('subscribes to focus and runs the reload each time it fires', async () => {
    const listeners: Array<() => void> = [];
    const unsubscribe = jest.fn();
    const navigation = {
      addListener: jest.fn((_event: 'focus', callback: () => void) => {
        listeners.push(callback);
        return unsubscribe;
      }),
    };
    const onFocus = jest.fn();

    await render(<Probe navigation={navigation} onFocus={onFocus} />);

    expect(navigation.addListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(onFocus).not.toHaveBeenCalled();

    listeners.forEach((fire) => fire());
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', async () => {
    const unsubscribe = jest.fn();
    const navigation = { addListener: jest.fn(() => unsubscribe) };
    const onFocus = jest.fn();

    const view = await render(<Probe navigation={navigation} onFocus={onFocus} />);
    await act(async () => {
      view.unmount();
    });

    expect(unsubscribe).toHaveBeenCalled();
  });

  it('is a no-op outside a navigator (stub navigation in tests)', async () => {
    const onFocus = jest.fn();
    // Only `navigate` — the shape several screens are rendered with in tests.
    await render(<Probe navigation={{ navigate: jest.fn() }} onFocus={onFocus} />);
    expect(onFocus).not.toHaveBeenCalled();
  });
});

describe('My Reports reloads its docket on focus', () => {
  function Detail() {
    return <Text>detail</Text>;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (drafts.listDrafts as jest.Mock).mockResolvedValue([]);
  });

  it('re-queries /reports/mine when the tab is focused again', async () => {
    getMock.mockResolvedValue({ data: [] });
    const navRef = createNavigationContainerRef<RootStackParamList>();

    await render(
      <NavigationContainer ref={navRef}>
        <Stack.Navigator>
          <Stack.Screen name="MyReports" component={MyReportsScreen} />
          <Stack.Screen name="Track" component={Detail} />
        </Stack.Navigator>
      </NavigationContainer>,
    );

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));

    // Leaving for a report and coming back is exactly what a user does after
    // filing one; the second query is what makes the new report appear.
    await act(async () => {
      navRef.navigate('Track', { reportId: 'r-1' });
    });
    await act(async () => {
      navRef.goBack();
    });

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
  });
});
