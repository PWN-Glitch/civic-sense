import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import BeforeAfter from '../src/components/BeforeAfter';
import { api } from '../src/api/client';
import type { ReportPhoto } from '../src/types';

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

const postMock = api.post as jest.Mock;
const pickerMock = ImagePicker.launchCameraAsync as jest.Mock;

const before1: ReportPhoto = {
  photo_id: 'p-1',
  kind: 'before',
  url: 'https://files.example.com/p1.jpg',
  blurred: true,
};
const progress1: ReportPhoto = {
  photo_id: 'p-2',
  kind: 'progress',
  url: 'https://files.example.com/p2.jpg',
  blurred: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  pickerMock.mockResolvedValue({ canceled: true, assets: null });
});

describe('BeforeAfter', () => {
  it('renders before and after slots side by side', async () => {
    const { getByText, getByLabelText } = await render(
      <BeforeAfter
        reportId="r-1"
        photos={[before1, progress1]}
        isOwnReport={false}
        onPhotoAdded={jest.fn()}
      />,
    );
    expect(getByText('Before')).toBeTruthy();
    expect(getByText('Progress')).toBeTruthy();
    expect(
      getByLabelText('Photo when the issue was reported'),
    ).toBeTruthy();
    expect(getByLabelText('Progress photo')).toBeTruthy();
  });

  it('hides entirely for other users when there are no photos', async () => {
    const { queryByText } = await render(
      <BeforeAfter
        reportId="r-1"
        photos={[]}
        isOwnReport={false}
        onPhotoAdded={jest.fn()}
      />,
    );
    expect(queryByText('Photo record')).toBeNull();
  });

  it('shows the add affordance on the user\'s own reports', async () => {
    const { getByText } = await render(
      <BeforeAfter
        reportId="r-1"
        photos={[before1]}
        isOwnReport
        onPhotoAdded={jest.fn()}
      />,
    );
    expect(getByText('+ Add progress photo')).toBeTruthy();
  });

  it('hides the add affordance on other people\'s reports', async () => {
    const { queryByText } = await render(
      <BeforeAfter
        reportId="r-1"
        photos={[before1]}
        isOwnReport={false}
        onPhotoAdded={jest.fn()}
      />,
    );
    expect(queryByText(/Add progress photo/)).toBeNull();
  });

  it('uploads the picked photo, then attaches it with kind=progress', async () => {
    pickerMock.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///new-photo.jpg' }],
    });
    postMock
      .mockResolvedValueOnce({ data: { photo_id: 'p-2', url: '/media/p-2.jpg' } })
      .mockResolvedValueOnce({ data: progress1 });
    const onPhotoAdded = jest.fn();

    const r = await render(
      <BeforeAfter
        reportId="r-1"
        photos={[before1]}
        isOwnReport
        onPhotoAdded={onPhotoAdded}
      />,
    );
    await fireEvent.press(await r.findByText('+ Add progress photo'));

    await waitFor(() => {
      expect(onPhotoAdded).toHaveBeenCalledWith(progress1);
    });
    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/media',
      expect.any(FormData),
      expect.objectContaining({
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    );
    expect(postMock).toHaveBeenNthCalledWith(2, '/reports/r-1/photos', null, {
      params: { photo_id: 'p-2', kind: 'progress' },
    });
  });

  it('uses kind=after once a progress photo already exists', async () => {
    pickerMock.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///after.jpg' }],
    });
    postMock
      .mockResolvedValueOnce({ data: { photo_id: 'p-3', url: '/media/p-3.jpg' } })
      .mockResolvedValueOnce({
        data: { ...progress1, photo_id: 'p-3', kind: 'after' },
      });

    const r = await render(
      <BeforeAfter
        reportId="r-1"
        photos={[before1, progress1]}
        isOwnReport
        onPhotoAdded={jest.fn()}
      />,
    );
    await fireEvent.press(await r.findByText('+ Add after photo'));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/reports/r-1/photos', null, {
        params: { photo_id: 'p-3', kind: 'after' },
      });
    });
  });

  it('does nothing when the user cancels the camera', async () => {
    const r = await render(
      <BeforeAfter
        reportId="r-1"
        photos={[before1]}
        isOwnReport
        onPhotoAdded={jest.fn()}
      />,
    );
    await fireEvent.press(await r.findByText('+ Add progress photo'));
    await new Promise((res) => setTimeout(res, 20));
    expect(postMock).not.toHaveBeenCalled();
  });

  it('surfaces upload failures through onError', async () => {
    pickerMock.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///new.jpg' }],
    });
    postMock.mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
    const onError = jest.fn();

    const r = await render(
      <BeforeAfter
        reportId="r-1"
        photos={[before1]}
        isOwnReport
        onPhotoAdded={jest.fn()}
        onError={onError}
      />,
    );
    await fireEvent.press(await r.findByText('+ Add progress photo'));
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining("couldn't add that photo"),
      );
    });
  });
});
