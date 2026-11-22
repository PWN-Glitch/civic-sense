import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import VerificationBar from '../src/components/VerificationBar';
import { api } from '../src/api/client';
import type { VerificationsResponse } from '../src/types';

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

const VERIFICATIONS: VerificationsResponse = {
  counts: { still_present: 2, appears_fixed: 5, not_sure: 1 },
  user_vote: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  getMock.mockResolvedValue({ data: VERIFICATIONS });
});

describe('VerificationBar', () => {
  it('loads and shows live counts', async () => {
    const { getByText } = await render(<VerificationBar reportId="r-1" />);
    await waitFor(() => {
      expect(getByText('8 responses from the community')).toBeTruthy();
    });
    expect(getMock).toHaveBeenCalledWith('/reports/r-1/verifications');
    expect(getByText('Still present')).toBeTruthy();
    expect(getByText('Appears fixed')).toBeTruthy();
    expect(getByText('Not sure')).toBeTruthy();
  });

  it('posts a vote and updates counts from the response', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        verification_id: 'v-9',
        counts: { still_present: 3, appears_fixed: 5, not_sure: 1 },
      },
    });
    const { getByText, getByLabelText } = await render(
      <VerificationBar reportId="r-1" />,
    );
    await waitFor(() => getByText('Still present'));
    await fireEvent.press(getByText('Still present'));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/reports/r-1/verify', {
        response: 'still_present',
      });
    });
    await waitFor(() => {
      expect(getByLabelText(/Still present\. .* 3 votes\. Your current vote/))
        .toBeTruthy();
    });
  });

  it('highlights the user\'s existing vote from the server', async () => {
    getMock.mockResolvedValueOnce({
      data: { ...VERIFICATIONS, user_vote: 'appears_fixed' },
    });
    const { getByLabelText, getByText } = await render(
      <VerificationBar reportId="r-1" />,
    );
    await waitFor(() => {
      expect(
        getByLabelText(/Appears fixed\. .* 5 votes\. Your current vote/),
      ).toBeTruthy();
    });
    // The highlight is not color-only: a "Your vote" badge is rendered.
    expect(getByText('Your vote')).toBeTruthy();
  });

  it('re-voting switches the highlighted vote', async () => {
    getMock.mockResolvedValueOnce({
      data: { ...VERIFICATIONS, user_vote: 'appears_fixed' },
    });
    postMock.mockResolvedValueOnce({
      data: {
        verification_id: 'v-9',
        counts: { still_present: 3, appears_fixed: 4, not_sure: 1 },
      },
    });
    const { getByText, getByLabelText } = await render(
      <VerificationBar reportId="r-1" />,
    );
    await waitFor(() => getByText('Still present'));
    await fireEvent.press(getByText('Still present'));

    await waitFor(() => {
      expect(
        getByLabelText(/Still present\. .* 3 votes\. Your current vote/),
      ).toBeTruthy();
    });
  });

  it('reports vote failures through onError and keeps the old vote', async () => {
    const onError = jest.fn();
    postMock.mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
    const { getByText, queryByText } = await render(
      <VerificationBar reportId="r-1" onError={onError} />,
    );
    await waitFor(() => getByText('Not sure'));
    await fireEvent.press(getByText('Not sure'));
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining("couldn't be saved"),
      );
    });
    expect(queryByText('Your vote')).toBeNull();
  });
});
