import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ReportScreen from '../src/screens/Report';
import { api } from '../src/api/client';
import NetInfo from '@react-native-community/netinfo';
import { queueDraft } from '../src/lib/offline';

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

// Draft persistence is unit-tested in offline.test.ts; here we only assert
// the Report screen calls into it on network failure.
jest.mock('../src/lib/offline', () => {
  const actual = jest.requireActual('../src/lib/offline');
  return {
    ...actual,
    queueDraft: jest.fn(async () => 99),
  };
});

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'screen-ref') }));

const mockNavigate = jest.fn();
const mockReplace = jest.fn();

const routeParams = {
  photoUri: 'file:///photo.jpg',
  photoId: 'photo-1',
  predictions: [{ category: 'pothole' as const, confidence: 0.9 }],
  band: 'high' as const,
  severity: { level: 'moderate' as const, reason: 'test' },
  disclaimer: 'AI estimate — please verify.',
  preselected: 'pothole' as const,
  category: 'pothole' as const,
  lat: 39.2904,
  lng: -76.6122,
  locationAccuracy: 12,
};

async function renderReport(overrides: Partial<typeof routeParams> = {}) {
  const route = {
    key: 'report-1',
    name: 'Report' as const,
    params: { ...routeParams, ...overrides },
  };
  return render(
    <ReportScreen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      route={route as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigation={{ navigate: mockNavigate, replace: mockReplace } as any}
    />,
  );
}

describe('Report screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: device is online and the pre-flight duplicate probe is empty;
    // individual tests override as needed.
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
  });

  it('prefills the description without restating the severity', async () => {
    const { getByLabelText } = await renderReport();
    const input = getByLabelText('Report description');
    // The composed letter carries "Estimated severity" on its own line; a
    // description that repeats it makes the letter look machine-assembled.
    expect(input.props.value).toBe('Pothole observed.');
  });

  it('lets the user edit the description', async () => {
    const { getByLabelText } = await renderReport();
    const input = getByLabelText('Report description');
    await fireEvent.changeText(input, 'Deep pothole at 400 N Charles St.');
    expect(getByLabelText('Report description').props.value).toBe(
      'Deep pothole at 400 N Charles St.',
    );
  });

  it('submits the edited description to POST /reports', async () => {
    // The real API wraps the created report: { report, possible_duplicates }.
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        report: { id: 'r-123', status: 'Draft' },
        possible_duplicates: [],
      },
    });
    const { getByLabelText, getByText } = await renderReport();
    const input = getByLabelText('Report description');
    await fireEvent.changeText(input, 'Edited by the reporter.');
    await fireEvent.press(getByText('Submit report'));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/reports',
        expect.objectContaining({
          category: 'pothole',
          description: 'Edited by the reporter.',
          lat: 39.2904,
          lng: -76.6122,
        }),
      );
    });
    await waitFor(() => {
      // Week 4 flow: after the report is created, the user picks who
      // receives it on the Route screen (ReportReview comes next).
      expect(mockReplace).toHaveBeenCalledWith(
        'Route',
        expect.objectContaining({ reportId: 'r-123' }),
      );
    });
  });

  it('saves a local draft when the network is down instead of failing', async () => {
    // axios error with no response = the request never reached a server.
    (api.post as jest.Mock).mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Network Error',
    });
    (NetInfo.fetch as jest.Mock).mockResolvedValue({
      isConnected: false,
    });
    const { getByLabelText, getByText } = await renderReport();
    await fireEvent.changeText(
      getByLabelText('Report description'),
      'Pothole reported from a dead zone.',
    );
    await fireEvent.press(getByText('Submit report'));

    await waitFor(() => {
      expect(queueDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'pothole',
          description: 'Pothole reported from a dead zone.',
          photoUri: 'file:///photo.jpg',
          // The attempt may have reached the server; the draft replays the same key.
          clientRef: 'screen-ref',
        }),
      );
    });
    expect(api.post).toHaveBeenCalledWith(
      '/reports',
      expect.objectContaining({ client_ref: 'screen-ref' }),
    );
    await waitFor(() => {
      expect(getByText('Saved as a draft')).toBeTruthy();
    });
    // The user was NOT routed to Track — nothing was submitted.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('uploads the original photo when Preview could not, then attaches it', async () => {
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: { photo_id: 'late-photo' } })
      .mockResolvedValueOnce({ data: { report: { id: 'r-1' } } })
      .mockResolvedValueOnce({ data: {} });
    const { getByText } = await renderReport({ photoId: undefined });
    await fireEvent.press(getByText('Submit report'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('Route', expect.objectContaining({ reportId: 'r-1' }));
    });
    const calls = (api.post as jest.Mock).mock.calls;
    expect(calls.map((c) => c[0])).toEqual(['/media', '/reports', '/reports/r-1/photos']);
    expect(calls[2][2]).toEqual({ params: { photo_id: 'late-photo', kind: 'before' } });
  });

  it('stays put when the photo fails to attach, and a retry only attaches', async () => {
    const serverError = { isAxiosError: true, message: 'x', response: { status: 500 } };
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: { report: { id: 'r-1' } } })
      .mockRejectedValueOnce(serverError);
    const { getByText } = await renderReport();
    await fireEvent.press(getByText('Submit report'));

    await waitFor(() => {
      expect(getByText(/filed, but the photo didn't attach/)).toBeTruthy();
    });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(queueDraft).not.toHaveBeenCalled();

    (api.post as jest.Mock).mockResolvedValueOnce({ data: {} });
    (api.get as jest.Mock).mockClear();
    await fireEvent.press(getByText('Submit report'));
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('Route', expect.objectContaining({ reportId: 'r-1' }));
    });
    const paths = (api.post as jest.Mock).mock.calls.map((c) => c[0]);
    expect(paths).toEqual(['/reports', '/reports/r-1/photos', '/reports/r-1/photos']);
    // No duplicate probe either: it would only find this report itself.
    expect(api.get).not.toHaveBeenCalled();
  });

  it('queues the filed report and its uploaded photo when attaching fails offline', async () => {
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: { report: { id: 'r-1' } } })
      .mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
    const { getByText } = await renderReport();
    await fireEvent.press(getByText('Submit report'));

    await waitFor(() => {
      expect(queueDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          photoUri: 'file:///photo.jpg',
          photoId: 'photo-1',
          reportId: 'r-1',
          clientRef: 'screen-ref',
        }),
      );
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('still shows an error for server-side failures (not saved as draft)', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed',
      response: { status: 500 },
    });
    (NetInfo.fetch as jest.Mock).mockResolvedValue({
      isConnected: true,
    });
    const { getByText } = await renderReport();
    await fireEvent.press(getByText('Submit report'));
    await waitFor(() => {
      expect(
        getByText(/couldn't submit your report/),
      ).toBeTruthy();
    });
    expect(queueDraft).not.toHaveBeenCalled();
  });
});
