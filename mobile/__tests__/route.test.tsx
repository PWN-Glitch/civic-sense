import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import RouteScreen, { rankOptions } from '../src/screens/Route';
import { api } from '../src/api/client';
import type { ContactResolveResponse } from '../src/types';

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

const mockNavigate = jest.fn();

const routeParams = {
  photoUri: 'file:///photo.jpg',
  predictions: [{ category: 'pothole' as const, confidence: 0.9 }],
  band: 'high' as const,
  severity: { level: 'moderate' as const, reason: 'test' },
  disclaimer: '',
  preselected: 'pothole' as const,
  category: 'pothole' as const,
  lat: 39.2904,
  lng: -76.6122,
  locationAccuracy: 12,
};

const resolveResponse: ContactResolveResponse = {
  jurisdiction: 'Baltimore, MD',
  department: 'Department of Transportation',
  options: [
    {
      type: 'WEB_FORM',
      destination: 'https://seeclickfix.com/baltimore',
      confidence: 0.9,
      reasons: ['Jurisdiction match', 'Category match', 'Verified contact'],
      source_url: 'https://seeclickfix.com/baltimore',
      verification_status: 'verified',
      requires: {},
    },
    {
      type: 'PHONE',
      destination: '311',
      confidence: 0.7,
      reasons: ['Jurisdiction match'],
      source_url: 'https://baltimorecity.gov/311',
      verification_status: 'verified',
      requires: {},
    },
    {
      type: 'EMAIL',
      destination: 'dot@baltimorecity.gov',
      confidence: 0.3,
      reasons: ['Category match only'],
      source_url: 'https://baltimorecity.gov/dot',
      verification_status: 'unverified',
      requires: {},
    },
  ],
  universal_report: {
    issue: {
      category: 'pothole',
      description: 'Pothole observed.',
      severity: 'moderate',
    },
    location: { lat: 39.2904, lng: -76.6122, jurisdiction: 'Baltimore, MD' },
    evidence: ['photo-1'],
    responsibility: {
      organization: 'City of Baltimore',
      department: 'Department of Transportation',
      confidence: 0.9,
      reasons: ['Jurisdiction match'],
    },
    submission: {
      method: 'WEB_FORM',
      destination: 'https://seeclickfix.com/baltimore',
    },
    report: { subject: 'Pothole report', body: 'Body text' },
    verification: { user_approved: false },
  },
};

async function renderRoute() {
  return render(
    <RouteScreen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      route={{ key: 'route-1', name: 'Route', params: routeParams } as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigation={{ navigate: mockNavigate } as any}
    />,
  );
}

describe('Route screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.post as jest.Mock).mockResolvedValue({ data: resolveResponse });
  });

  it('calls POST /contacts/resolve with the report coordinates', async () => {
    await renderRoute();
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/contacts/resolve', {
        lat: 39.2904,
        lng: -76.6122,
        category: 'pothole',
        severity: 'moderate',
      });
    });
  });

  it('renders ranked options with a Recommended badge on the top one', async () => {
    const { getByText, getAllByText } = await renderRoute();
    await waitFor(() => {
      expect(getByText('Recommended')).toBeTruthy();
    });
    // Exactly one badge, on the highest-confidence (WEB_FORM) option.
    expect(getAllByText('Recommended')).toHaveLength(1);
    expect(getByText('Official web form')).toBeTruthy();
    expect(getByText('Phone call')).toBeTruthy();
    expect(getByText('Email')).toBeTruthy();
  });

  it('re-ranks by confidence if the backend returns unsorted options', () => {
    const shuffled = [
      resolveResponse.options[2],
      resolveResponse.options[0],
      resolveResponse.options[1],
    ];
    const ranked = rankOptions(shuffled);
    expect(ranked[0].type).toBe('WEB_FORM');
    expect(ranked[1].type).toBe('PHONE');
    expect(ranked[2].type).toBe('EMAIL');
  });

  it('expands the Why panel to show confidence and reasons', async () => {
    const { getAllByLabelText, getByText, queryByText } = await renderRoute();
    await waitFor(() => {
      expect(getByText('Recommended')).toBeTruthy();
    });
    // Why content is hidden until toggled.
    expect(queryByText(/Match confidence/)).toBeNull();
    const toggles = getAllByLabelText('Why this contact?');
    fireEvent.press(toggles[0]);
    await waitFor(() => {
      expect(getByText('Match confidence: 90%')).toBeTruthy();
      expect(getByText('• Category match')).toBeTruthy();
    });
  });

  it('marks unverified contacts as possibly outdated', async () => {
    const { getByText } = await renderRoute();
    await waitFor(() => {
      expect(getByText('Unverified — may be outdated')).toBeTruthy();
      expect(getByText(/double-check it before sending/)).toBeTruthy();
    });
  });

  it('shows the source host for each option', async () => {
    const { getByText, getAllByText } = await renderRoute();
    await waitFor(() => {
      expect(getByText('Source: seeclickfix.com')).toBeTruthy();
      // PHONE + EMAIL share the same host.
      expect(getAllByText('Source: baltimorecity.gov')).toHaveLength(2);
    });
  });

  it('selecting an option navigates to Report with the channel attached', async () => {
    const { getAllByLabelText } = await renderRoute();
    await waitFor(() => {
      expect(getAllByLabelText(/Send via/).length).toBe(3);
    });
    fireEvent.press(getAllByLabelText('Send via Official web form')[0]);
    expect(mockNavigate).toHaveBeenCalledWith(
      'Report',
      expect.objectContaining({
        channel: expect.objectContaining({ type: 'WEB_FORM' }),
        jurisdiction: 'Baltimore, MD',
        department: 'Department of Transportation',
      }),
    );
  });

  it('shows an error state with retry when resolve fails', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));
    const { getByText } = await renderRoute();
    await waitFor(() => {
      expect(getByText(/couldn't look up who handles this issue/)).toBeTruthy();
    });
  });
});
