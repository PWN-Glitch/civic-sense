import React from 'react';
import { render } from '@testing-library/react-native';
import StatusTimeline from '../src/components/StatusTimeline';
import { STATUS_LABELS } from '../src/components/StatusStamp';
import type { StatusHistoryEntry } from '../src/types';

const history: StatusHistoryEntry[] = [
  { status: 'Draft', created_at: '2026-10-01T10:00:00.000Z' },
  {
    status: 'InProgress',
    created_at: '2026-10-05T10:00:00.000Z',
    source: 'city',
  },
];

describe('StatusTimeline', () => {
  it('shows words, never the raw enum', async () => {
    const { getByText, queryByText } = await render(
      <StatusTimeline history={history} />,
    );

    // The camelCase enum leaked into the timeline once; the stamp always had
    // the human phrase, so the two disagreed on the same screen.
    expect(getByText('In progress')).toBeTruthy();
    expect(queryByText('InProgress')).toBeNull();
    expect(queryByText('Acknowledged')).toBeNull();
    expect(getByText('Received')).toBeTruthy();
  });

  it('agrees with the stamp for every status', () => {
    expect(STATUS_LABELS.InProgress).toBe('In progress');
    expect(STATUS_LABELS.Acknowledged).toBe('Received');
  });
});
