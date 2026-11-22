import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MyReportsScreen from '../src/screens/MyReports';
import { api } from '../src/api/client';
import * as draftsLib from '../src/lib/drafts';

jest.mock('../src/api/client', () => ({
  api: {
    get: jest.fn(),
    delete: jest.fn(),
  },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

describe('MyReports deletion', () => {
  const alertSpy = jest.spyOn(Alert, 'alert');

  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        {
          id: 'report-1',
          category: 'pothole',
          description: 'Big pothole',
          status: 'Submitted',
          created_at: '2026-10-24T12:00:00Z',
        },
      ],
    });
    jest.spyOn(draftsLib, 'listDrafts').mockResolvedValue([
      {
        id: 101,
        category: 'trash',
        description: 'Overflowing bin',
        lat: 39.29,
        lng: -76.61,
        accuracy: 10,
        severity: 'low',
        photo_uri: null,
        created_at: '2026-10-24T12:00:00Z',
        synced: 0,
        client_ref: 'ref-101',
        report_id: null,
        photo_id: null,
      },
    ]);
    jest.spyOn(draftsLib, 'deleteDraft').mockResolvedValue();
  });

  it('confirms and deletes server report', async () => {
    (api.delete as jest.Mock).mockResolvedValue({});
    const res = await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <MyReportsScreen navigation={{ navigate: jest.fn() }} />
      </SafeAreaProvider>,
    );
    await waitFor(() => expect(res.getByLabelText('Delete report CS-REPORT')).toBeTruthy());

    fireEvent.press(res.getByLabelText('Delete report CS-REPORT'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete report?',
      expect.stringContaining('Are you sure you want to delete'),
      expect.any(Array),
    );

    // Trigger confirmation action
    const deleteAction = alertSpy.mock.calls[0][2]?.find((btn) => btn.text === 'Delete');
    await deleteAction?.onPress?.();

    expect(api.delete).toHaveBeenCalledWith('/reports/report-1');
  });

  it('confirms and deletes local offline draft', async () => {
    const res = await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <MyReportsScreen navigation={{ navigate: jest.fn() }} />
      </SafeAreaProvider>,
    );
    await waitFor(() => expect(res.getByLabelText('Delete draft')).toBeTruthy());

    fireEvent.press(res.getByLabelText('Delete draft'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete draft?',
      expect.stringContaining('Are you sure you want to delete this unsent'),
      expect.any(Array),
    );

    const deleteAction = alertSpy.mock.calls[0][2]?.find((btn) => btn.text === 'Delete');
    await deleteAction?.onPress?.();

    expect(draftsLib.deleteDraft).toHaveBeenCalledWith(101);
  });

  it('marks a draft whose report is filed but whose photo is still pending', async () => {
    (draftsLib.listDrafts as jest.Mock).mockResolvedValue([
      {
        id: 102,
        category: 'pothole',
        description: 'Deep pothole',
        lat: 39.29,
        lng: -76.61,
        accuracy: null,
        severity: null,
        photo_uri: 'file:///p.jpg',
        created_at: '2026-10-24T12:00:00Z',
        synced: 0,
        client_ref: 'ref-102',
        report_id: 'report-9',
        photo_id: 'ph-9',
      },
    ]);
    const res = await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <MyReportsScreen navigation={{ navigate: jest.fn() }} />
      </SafeAreaProvider>,
    );
    await waitFor(() =>
      expect(res.getByText(/FILED · PHOTO WAITING TO SEND/)).toBeTruthy(),
    );
    expect(res.getByLabelText(/filed, photo not yet sent/)).toBeTruthy();
  });
});
