import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import IssueDetailsScreen from '../src/screens/IssueDetails';
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
const postMock = api.post as jest.Mock;

const baseReport: Report = {
  id: 'r-42',
  category: 'pothole',
  description: 'Deep pothole on Charles St',
  lat: 39.2904,
  lng: -76.6122,
  status: 'Submitted',
  created_at: '2026-10-01T10:00:00.000Z',
  reporter_id: 'user-1',
  photos: [
    {
      photo_id: 'p-1',
      kind: 'before',
      url: 'https://files.example.com/p1.jpg',
      blurred: true,
    },
  ],
  verifications: { still_present: 2, appears_fixed: 1, not_sure: 0 },
  status_history: [{ status: 'Submitted', created_at: '2026-10-01T10:00:00.000Z' }],
};

function renderDetails(reportId = 'r-42') {
  const route = {
    key: 'issue-1',
    name: 'IssueDetails' as const,
    params: { reportId },
  };
  return render(
    <IssueDetailsScreen
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
    if (url === '/reports/r-42') return { data: baseReport };
    if (url === '/reports/r-42/verifications') {
      return {
        data: { counts: baseReport.verifications, user_vote: null },
      };
    }
    throw new Error(`Unexpected GET ${url}`);
  });
  postMock.mockRejectedValue({ isAxiosError: true, message: 'offline' }); // routing fails soft
});

describe('IssueDetails screen', () => {
  it('renders the report with verification and photo sections', async () => {
    const { getByText, getAllByLabelText } = await renderDetails();
    await waitFor(() => {
      expect(getByText('Pothole')).toBeTruthy();
    });
    await waitFor(() => {
      expect(getByText('Community check')).toBeTruthy();
      expect(getByText('Photo record')).toBeTruthy();
      expect(getByText('Still present')).toBeTruthy();
      expect(getByText('Status')).toBeTruthy();
    });
  });

  it('shows the add-photo affordance to the reporter', async () => {
    const { getByText } = await renderDetails();
    await waitFor(() => {
      expect(getByText('+ Add progress photo')).toBeTruthy();
    });
  });

  it('hides the add-photo affordance for other users\' reports', async () => {
    useAuthStore.setState({
      jwt: 'test-jwt',
      user: { id: 'someone-else', display_name: 'Viewer' },
      booting: false,
      error: null,
    });
    const { getByText, queryByText } = await renderDetails();
    await waitFor(() => {
      expect(getByText('Pothole')).toBeTruthy();
    });
    expect(queryByText(/Add progress photo/)).toBeNull();
  });

  it('surfaces the community-suggests-resolved note without flipping status', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/reports/r-42') {
        return {
          data: { ...baseReport, community_suggests_resolved: true },
        };
      }
      if (url === '/reports/r-42/verifications') {
        return {
          data: { counts: baseReport.verifications, user_vote: null },
        };
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    const { getByText, getAllByLabelText } = await renderDetails();
    await waitFor(() => {
      expect(
        getByText(/Community responses suggest this issue may be resolved/),
      ).toBeTruthy();
    });
    // Official status is untouched: the stamp still reads the city's value.
    expect(getAllByLabelText('Submitted').length).toBeGreaterThan(0);
  });
});
