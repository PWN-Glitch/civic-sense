import React from 'react';
import { Share } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import TrackScreen from '../src/screens/Track';
import { api } from '../src/api/client';
import { useAuthStore } from '../src/lib/auth';
import type { Report } from '../src/types';

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

const report: Report = {
  id: '4f2a1b9c-1111-2222-3333-444455556666',
  category: 'pothole',
  description: 'Deep pothole on Charles St',
  lat: 39.2904,
  lng: -76.6122,
  status: 'Submitted',
  created_at: '2026-10-01T10:00:00.000Z',
  reporter_id: 'user-1',
  photos: [],
  verifications: { still_present: 0, appears_fixed: 0, not_sure: 0 },
  status_history: [{ status: 'Submitted', created_at: '2026-10-01T10:00:00.000Z' }],
};

function renderTrack() {
  const route = {
    key: 'track-1',
    name: 'Track' as const,
    params: { reportId: report.id },
  };
  return render(
    <TrackScreen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      route={route as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigation={{} as any}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    jwt: 'test-jwt',
    user: { id: 'user-1', display_name: 'Reporter' },
    booting: false,
    error: null,
  });
  getMock.mockImplementation(async (url: string) => {
    if (url === `/reports/${report.id}`) return { data: report };
    if (url === `/reports/${report.id}/events`) return { data: [] };
    throw new Error(`Unexpected GET ${url}`);
  });
});

describe('Track screen', () => {
  it('files the case under a docket number and a stamped status', async () => {
    await renderTrack();
    await waitFor(() => {
      expect(screen.getByText(/CS-4F2A1B/)).toBeTruthy();
    });
    // The status is a stamp whose accessible label is the word itself.
    expect(screen.getAllByLabelText('Submitted').length).toBeGreaterThan(0);
  });

  it('shares a deep link that opens this case file', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);
    await renderTrack();
    await waitFor(() => screen.getByText('Share this report'));
    fireEvent.press(screen.getByText('Share this report'));
    expect(share).toHaveBeenCalledTimes(1);
    const message = share.mock.calls[0][0]?.message ?? '';
    expect(message).toContain(`civicsense://report/${report.id}`);
    expect(message).toContain('pothole');
  });
});
