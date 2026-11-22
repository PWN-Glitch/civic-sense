import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ImpactScreen from '../src/screens/Impact';
import { api } from '../src/api/client';
import type { ImpactStats } from '../src/types';

jest.mock('../src/api/client', () => {
  const actual = jest.requireActual('../src/api/client');
  return {
    ...actual,
    api: {
      get: jest.fn(),
      post: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    },
  };
});

const get = api.get as jest.Mock;

const metrics: { frame: { x: number; y: number; width: number; height: number }; insets: { top: number; bottom: number; left: number; right: number } } = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

async function renderImpact() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ImpactScreen />
    </SafeAreaProvider>,
  );
}

const populated: ImpactStats = {
  total_reports: 12,
  resolved_reports: 5,
  resolution_rate: 5 / 12,
  avg_days_to_resolve: 4.2,
  reports_last_30_days: 7,
  by_status: { Draft: 4, Submitted: 3, Resolved: 5 },
  by_category: [
    { category: 'pothole', total: 6, resolved: 3 },
    { category: 'trash', total: 4, resolved: 2 },
    { category: 'graffiti', total: 2, resolved: 0 },
  ],
};

describe('Impact screen', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('renders real counts, rate and average time to fix', async () => {
    get.mockResolvedValueOnce({ data: populated });
    await renderImpact();
    await waitFor(() => {
      expect(screen.getByText('12')).toBeTruthy();
    });
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('4.2 days on average')).toBeTruthy();
    expect(screen.getByText('7 on file')).toBeTruthy();
    expect(screen.getByText('6 on file · 3 resolved')).toBeTruthy();
    // One name per number: the rate is a labelled row, not a second cell
    // called "Resolved" that happens to hold a percentage.
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('RESOLVE RATE')).toBeTruthy();
    // The footnote must not let the numbers pass as city-wide statistics.
    expect(screen.getByText(/does not publish a public API/)).toBeTruthy();
  });

  it('shows zeros and says so when nothing has been filed', async () => {
    get.mockResolvedValueOnce({
      data: {
        total_reports: 0,
        resolved_reports: 0,
        resolution_rate: 0,
        avg_days_to_resolve: null,
        reports_last_30_days: 0,
        by_status: {},
        by_category: [],
      } satisfies ImpactStats,
    });
    await renderImpact();
    await waitFor(() => {
      expect(
        screen.getByText('Nothing on file yet. The first report will show up here.'),
      ).toBeTruthy();
    });
    expect(screen.getByText('no resolved cases yet')).toBeTruthy();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
  });

  it('offers a retry that reloads when the fetch fails', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    await renderImpact();
    await waitFor(() => {
      expect(screen.getByText("We couldn't load the city totals.")).toBeTruthy();
    });
    get.mockResolvedValueOnce({ data: populated });
    fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => {
      expect(screen.getByText('12')).toBeTruthy();
    });
  });
});
