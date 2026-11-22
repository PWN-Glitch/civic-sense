import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ReportScreen from '../src/screens/Report';
import { api } from '../src/api/client';
import NetInfo from '@react-native-community/netinfo';
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

jest.mock('../src/lib/offline', () => {
  const actual = jest.requireActual('../src/lib/offline');
  return { ...actual, queueDraft: jest.fn(async () => 99) };
});

const mockNavigate = jest.fn();
const mockReplace = jest.fn();

const routeParams = {
  photoUri: 'file:///photo.jpg',
  photoId: 'photo-1',
  predictions: [{ category: 'pothole' as const, confidence: 0.9 }],
  band: 'high' as const,
  severity: { level: 'moderate' as const, reason: 'test' },
  disclaimer: '',
  preselected: 'pothole' as const,
  category: 'pothole' as const,
  lat: 39.2904,
  lng: -76.6122,
  locationAccuracy: 12,
  // Channel came from the Route screen.
  channel: {
    type: 'EMAIL' as const,
    destination: 'dot@baltimorecity.gov',
    confidence: 0.8,
    reasons: [],
    verification_status: 'verified' as const,
    requires: {},
  },
  jurisdiction: 'Baltimore, MD',
  department: 'DOT',
};

const existingDupe: Report = {
  id: 'r-existing',
  category: 'pothole',
  description: 'Same pothole, reported last week.',
  lat: 39.2905,
  lng: -76.6123,
  status: 'Submitted',
  created_at: '2026-10-02T00:00:00Z',
};

async function renderReport(overrides: Partial<typeof routeParams> = {}) {
  return render(
    <ReportScreen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      route={{ key: 'r-1', name: 'Report', params: { ...routeParams, ...overrides } } as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigation={{ navigate: mockNavigate, replace: mockReplace } as any}
    />,
  );
}

describe('Duplicate sheet (§36)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
  });

  it('shows the sheet when the pre-flight check finds a nearby report', async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: [existingDupe] });
    const { getByText } = await renderReport();
    fireEvent.press(getByText('Submit report'));
    await waitFor(() => {
      expect(getByText('Possible existing report')).toBeTruthy();
    });
    expect(getByText(/similar issue was reported nearby/)).toBeTruthy();
    expect(getByText('View existing')).toBeTruthy();
    expect(getByText('Add photo')).toBeTruthy();
    expect(getByText('Create new')).toBeTruthy();
    // Nothing was filed: the sheet precedes POST /reports.
    expect(api.post).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('View existing goes to the existing report without filing anything', async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: [existingDupe] });
    const { getByText } = await renderReport();
    fireEvent.press(getByText('Submit report'));
    await waitFor(() => getByText('Possible existing report'));
    fireEvent.press(getByText('View existing'));
    expect(mockReplace).toHaveBeenCalledWith('IssueDetails', {
      reportId: 'r-existing',
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('Add photo attaches the photo to the existing report, then opens it', async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: [existingDupe] });
    (api.post as jest.Mock).mockResolvedValueOnce({ data: {} });
    const { getByText } = await renderReport();
    fireEvent.press(getByText('Submit report'));
    await waitFor(() => getByText('Possible existing report'));
    fireEvent.press(getByText('Add photo'));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/reports/r-existing/photos',
        null,
        { params: { photo_id: 'photo-1', kind: 'before' } },
      );
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('IssueDetails', {
        reportId: 'r-existing',
      });
    });
    // No separate report was created.
    expect(api.post).not.toHaveBeenCalledWith('/reports', expect.anything());
  });

  it('Add photo uploads the original photo first when none was uploaded yet', async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: [existingDupe] });
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: { photo_id: 'late-photo' } })
      .mockResolvedValueOnce({ data: {} });
    const { getByText } = await renderReport({ photoId: undefined });
    fireEvent.press(getByText('Submit report'));
    await waitFor(() => getByText('Possible existing report'));
    fireEvent.press(getByText('Add photo'));
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('IssueDetails', { reportId: 'r-existing' });
    });
    expect(api.post).toHaveBeenLastCalledWith('/reports/r-existing/photos', null, {
      params: { photo_id: 'late-photo', kind: 'before' },
    });
  });

  it('Add photo never opens the report as if it worked when the attach fails', async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: [existingDupe] });
    (api.post as jest.Mock).mockRejectedValueOnce({
      isAxiosError: true,
      message: 'x',
      response: { status: 500 },
    });
    const { getByText } = await renderReport();
    fireEvent.press(getByText('Submit report'));
    await waitFor(() => getByText('Possible existing report'));
    fireEvent.press(getByText('Add photo'));
    await waitFor(() => {
      expect(getByText(/couldn't add your photo to that report/)).toBeTruthy();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('Add photo offline queues the photo as evidence for that report', async () => {
    const { queueDraft } = jest.requireMock('../src/lib/offline');
    queueDraft.mockResolvedValue(99);
    (api.get as jest.Mock).mockResolvedValueOnce({ data: [existingDupe] });
    (api.post as jest.Mock).mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
    const { getByText } = await renderReport();
    fireEvent.press(getByText('Submit report'));
    await waitFor(() => getByText('Possible existing report'));
    fireEvent.press(getByText('Add photo'));
    await waitFor(() => {
      expect(getByText(/photo is stored on this device/)).toBeTruthy();
    });
    expect(queueDraft).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'r-existing', photoId: 'photo-1' }),
    );
    expect(mockReplace).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalledWith('/reports', expect.anything());
  });

  it('Create new files a separate report and continues to ReportReview', async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: [existingDupe] });
    (api.post as jest.Mock).mockResolvedValue({
      data: { id: 'r-new', status: 'Draft' },
    });
    const { getByText } = await renderReport();
    fireEvent.press(getByText('Submit report'));
    await waitFor(() => getByText('Possible existing report'));
    fireEvent.press(getByText('Create new'));
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        'ReportReview',
        expect.objectContaining({
          reportId: 'r-new',
          channel: expect.objectContaining({ type: 'EMAIL' }),
        }),
      );
    });
    expect(api.post).toHaveBeenCalledWith('/reports', expect.anything());
  });

  it('no duplicates → straight to ReportReview without the sheet', async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: [] });
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: { id: 'r-new', status: 'Draft' },
    });
    const { getByText, queryByText } = await renderReport();
    fireEvent.press(getByText('Submit report'));
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        'ReportReview',
        expect.objectContaining({ reportId: 'r-new' }),
      );
    });
    expect(queryByText('Possible existing report')).toBeNull();
  });

  it('a failed probe never blocks filing (fails open)', async () => {
    (api.get as jest.Mock).mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Network Error',
      response: { status: 503 },
    });
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: { id: 'r-new', status: 'Draft' },
    });
    const { getByText } = await renderReport();
    fireEvent.press(getByText('Submit report'));
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        'ReportReview',
        expect.objectContaining({ reportId: 'r-new' }),
      );
    });
  });
});
