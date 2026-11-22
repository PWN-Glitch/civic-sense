import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import SettingsScreen from '../src/screens/Settings';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

describe('Settings screen layout', () => {
  it('omits MAP DATA row and keeps essential version info', async () => {
    const res = await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <SettingsScreen />
      </SafeAreaProvider>,
    );
    expect(res.getByText('VERSION')).toBeTruthy();
    expect(res.getByText('FILED TO')).toBeTruthy();
    expect(res.queryByText('MAP DATA')).toBeNull();
    expect(res.getByText('What leaves this phone')).toBeTruthy();
    expect(res.getByText('Category suggestions')).toBeTruthy();
  });
});
