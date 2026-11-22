import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import TrackScreen from '../src/screens/Track';
import { api } from '../src/api/client';
import type { Report, ReportEvent } from '../src/types';

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

const report: Report = {
  id: 'r-123',
  category: 'pothole',
  description: 'Deep pothole.',
  lat: 39.2904,
  lng: -76.6122,
  status: 'Submitted',
  created_at: '2026-10-09T00:00:00Z',
  status_history: [
    { status: 'Draft', created_at: '2026-10-09T00:00:00Z' },
    { status: 'Submitted', created_at: '2026-10-09T00:05:00Z', source: 'web' },
  ],
};

const submissionEvents: ReportEvent[] = [
  {
    event_type: 'prepared',
    detail: { channel_type: 'EMAIL' },
    created_at: '2026-10-09T00:01:00Z',
  },
  {
    event_type: 'approved',
    detail: {},
    created_at: '2026-10-09T00:02:00Z',
  },
  {
    event_type: 'sent',
    detail: { channel_type: 'EMAIL' },
    created_at: '2026-10-09T00:03:00Z',
  },
];

async function renderTrack() {
  return render(
    <TrackScreen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      route={{ key: 't-1', name: 'Track', params: { reportId: 'r-123' } } as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigation={{ navigate: jest.fn() } as any}
    />,
  );
}

describe('Track screen — submission timeline', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith('/events')) {
        return Promise.resolve({ data: submissionEvents });
      }
      return Promise.resolve({ data: report });
    });
  });

  it('fetches /reports/{id}/events and renders the submission section', async () => {
    const { getByText } = await renderTrack();
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/reports/r-123/events');
    });
    await waitFor(() => {
      expect(getByText('Your submission')).toBeTruthy();
    });
  });

  it('shows submission steps separately from the official status timeline', async () => {
    const { getByText, getByLabelText } = await renderTrack();
    await waitFor(() => getByText('Your submission'));
    // Official timeline is still there.
    expect(getByLabelText('Report status timeline')).toBeTruthy();
    // Submission timeline is a distinct, labeled region.
    expect(getByLabelText('Submission timeline')).toBeTruthy();
    expect(getByText('Prepared')).toBeTruthy();
    expect(getByText('Approved')).toBeTruthy();
    expect(getByText('Attempted')).toBeTruthy();
  });

  it('ends at "Status unknown" for user-driven channels — never "received"', async () => {
    const { getByText, queryByText } = await renderTrack();
    await waitFor(() => getByText('Your submission'));
    expect(getByText('Status unknown')).toBeTruthy();
    expect(
      getByText(/Sent by you — the city's response isn't tracked/),
    ).toBeTruthy();
    // Truthfulness: nothing in the submission section claims receipt.
    expect(queryByText(/[Rr]eceived by the city/)).toBeNull();
  });

  it('omits the submission section when there are no events', async () => {
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith('/events')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: report });
    });
    const { queryByText, getByText } = await renderTrack();
    await waitFor(() => getByText('Case file'));
    expect(queryByText('Your submission')).toBeNull();
  });

  it('still renders the official timeline when /events is unavailable', async () => {
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith('/events')) return Promise.reject(new Error('404'));
      return Promise.resolve({ data: report });
    });
    const { getByText, queryByText, getByLabelText } = await renderTrack();
    await waitFor(() => getByText('Case file'));
    expect(getByLabelText('Report status timeline')).toBeTruthy();
    expect(queryByText('Your submission')).toBeNull();
  });
});
