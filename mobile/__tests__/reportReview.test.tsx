import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import ReportReviewScreen, {
  computeReadiness,
  requiredFieldNames,
} from '../src/screens/ReportReview';
import { api } from '../src/api/client';
import {
  buildMailtoUrl,
  buildTelUrl,
} from '../src/lib/channelActions';
import type { ReportDraft, SubmissionChannel } from '../src/types';

jest.mock('../src/api/client', () => {
  const actual = jest.requireActual('../src/api/client');
  return {
    ...actual,
    api: {
      post: jest.fn(),
      get: jest.fn(),
      patch: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    },
  };
});

const mockReplace = jest.fn();

const emailChannel: SubmissionChannel = {
  type: 'EMAIL',
  destination: 'dot@baltimorecity.gov',
  confidence: 0.8,
  reasons: ['Verified contact'],
  source_url: 'https://baltimorecity.gov/dot',
  verification_status: 'verified',
  requires: {},
};

const phoneChannel: SubmissionChannel = {
  type: 'PHONE',
  destination: '(410) 555-0311',
  confidence: 0.9,
  reasons: [],
  verification_status: 'verified',
  requires: {},
};

const webformChannel: SubmissionChannel = {
  type: 'WEB_FORM',
  destination: 'https://seeclickfix.com/baltimore/report',
  confidence: 0.9,
  reasons: [],
  verification_status: 'verified',
  requires: { Location: 'the address or pin', Photo: 'at least one photo' },
};

const draft: ReportDraft = {
  id: 'draft-1',
  kind: 'email',
  subject: 'Pothole on N Charles St',
  body: 'A deep pothole sits at 400 N Charles St. USER PROVIDED photo attached.',
  recipient: 'dot@baltimorecity.gov',
  user_edited: false,
};

function paramsFor(channel: SubmissionChannel) {
  return {
    reportId: 'r-123',
    channel,
    jurisdiction: 'Baltimore, MD',
    department: 'Department of Transportation',
    photoCount: 2,
    universalReport: {
      issue: { category: 'pothole', description: 'x', severity: 'moderate' },
      location: { lat: 39.2904, lng: -76.6122 },
      evidence: ['photo-1', 'photo-2'],
      responsibility: {
        organization: 'City of Baltimore',
        department: 'DOT',
        confidence: 0.9,
        reasons: [],
      },
      submission: { method: channel.type, destination: channel.destination },
      report: { subject: draft.subject, body: draft.body },
      verification: { user_approved: false },
    },
  };
}

async function renderReview(channel: SubmissionChannel = emailChannel) {
  return render(
    <ReportReviewScreen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      route={{ key: 'rr-1', name: 'ReportReview', params: paramsFor(channel) } as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigation={{ replace: mockReplace, navigate: jest.fn() } as any}
    />,
  );
}

describe('ReportReview screen', () => {
  beforeEach(() => {
    // resetAllMocks (not clear) so any mockImplementation a test installed
    // is torn down before the default below is applied.
    jest.resetAllMocks();
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    (api.post as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith('/compose')) {
        return Promise.resolve({ data: { draft } });
      }
      if (url.endsWith('/compose/regenerate')) {
        return Promise.resolve({
          data: { ...draft, body: 'Regenerated body.' },
        });
      }
      if (url.endsWith('/submission')) {
        return Promise.resolve({
          data: {
            submission_state: 'status_unknown',
            event: {
              event_type: 'sent',
              detail: {},
              created_at: '2026-10-09T00:00:00Z',
            },
          },
        });
      }
      return Promise.reject(new Error(`unexpected POST ${url}`));
    });
    (api.patch as jest.Mock).mockResolvedValue({ data: { draft } });
  });

  it('composes the draft on mount and shows subject + body', async () => {
    const { getByLabelText } = await renderReview();
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/reports/r-123/compose', {});
    });
    await waitFor(() => {
      expect(getByLabelText('Report subject').props.value).toBe(
        'Pothole on N Charles St',
      );
      expect(getByLabelText('Report body').props.value).toContain(
        'deep pothole',
      );
    });
  });

  it('edit flow: changing the subject marks the draft edited and PATCHes on save', async () => {
    const { getByLabelText, getByText } = await renderReview();
    const subject = await waitFor(() => getByLabelText('Report subject'));
    fireEvent.changeText(subject, 'Edited subject line');
    // The explicit Save edits button appears once there are unsaved changes.
    const save = await waitFor(() => getByText('Save edits'));
    fireEvent.press(save);
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/reports/r-123/draft', {
        subject: 'Edited subject line',
        body: draft.body,
        recipient: draft.recipient,
      });
    });
  });

  it('Shorter version calls the regenerate endpoint and swaps in the new draft', async () => {
    const { getByText, getByLabelText } = await renderReview();
    await waitFor(() => getByLabelText('Report subject'));
    fireEvent.press(getByText('Shorter version'));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/reports/r-123/compose/regenerate',
        { instruction: 'make_shorter' },
      );
    });
    await waitFor(() => {
      expect(getByLabelText('Report body').props.value).toBe(
        'Regenerated body.',
      );
    });
  });

  it('Make more detailed sends the right instruction', async () => {
    const { getByText, getByLabelText } = await renderReview();
    await waitFor(() => getByLabelText('Report subject'));
    fireEvent.press(getByText('Full version'));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/reports/r-123/compose/regenerate',
        { instruction: 'make_more_detailed' },
      );
    });
  });

  it('privacy panel states photo count and no-PII plainly', async () => {
    const { getByText } = await renderReview();
    await waitFor(() => {
      expect(getByText(/Photos you attached: 2/)).toBeTruthy();
      expect(getByText(/No name, email, or account details/)).toBeTruthy();
    });
  });

  it('counts the attached photo even when the resolver returned no evidence', async () => {
    // Regression: /contacts/resolve always returns evidence: [], so reading the
    // count from the universal report claimed "0 photos" on a report that had
    // one attached — directly contradicting the readiness checklist.
    const params = paramsFor(webformChannel);
    params.photoCount = 1;
    params.universalReport.evidence = [];
    const { getByText } = await render(
      <ReportReviewScreen
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        route={{ key: 'rr-2', name: 'ReportReview', params } as any}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        navigation={{ replace: mockReplace, navigate: jest.fn() } as any}
      />,
    );
    await waitFor(() => {
      expect(getByText(/Photos you attached: 1/)).toBeTruthy();
    });
  });

  it('readiness indicator shows only the gaps, not a tick list', async () => {
    (api.post as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith('/compose')) {
        return Promise.resolve({
          data: {
            draft,
            missing_fields: ['Add the issue location.', 'Add at least one photo.'],
            missing_field_keys: ['location', 'photo'],
          },
        });
      }
      return Promise.reject(new Error(`unexpected POST ${url}`));
    });
    const { getByText, queryByText, getByLabelText } = await renderReview(
      webformChannel,
    );
    await waitFor(() => getByLabelText('Report subject'));
    expect(getByText('Before you send')).toBeTruthy();
    // A satisfied check is not news; only what still blocks sending is listed.
    expect(queryByText('Subject written')).toBeNull();
    // webform requires Location; the draft body never mentions it.
    expect(getByText('Missing: Location')).toBeTruthy();
    expect(getByText('Missing: Photo')).toBeTruthy();
  });

  it('uses structured missing-field keys from the compose API', async () => {
    (api.post as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith('/compose')) {
        return Promise.resolve({
          data: {
            draft,
            missing_fields: ['Add the issue location.', 'Add at least one photo.'],
            missing_field_keys: ['location', 'photo'],
          },
        });
      }
      return Promise.reject(new Error(`unexpected POST ${url}`));
    });
    const { getByText, getByLabelText } = await renderReview(webformChannel);
    await waitFor(() => getByLabelText('Report subject'));
    expect(getByText('Missing: Location')).toBeTruthy();
    expect(getByText('Missing: Photo')).toBeTruthy();
  });

  it('EMAIL: Open in Mail builds a mailto URL with subject and body', async () => {
    const { getByText, getByLabelText } = await renderReview();
    await waitFor(() => getByLabelText('Report subject'));
    fireEvent.press(getByText('Open in Mail'));
    await waitFor(() => {
      expect(Linking.openURL).toHaveBeenCalledWith(
        buildMailtoUrl(draft.recipient, draft.subject, draft.body),
      );
    });
    const url = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    expect(url.startsWith('mailto:dot%40baltimorecity.gov')).toBe(true);
    expect(url).toContain('subject=Pothole%20on%20N%20Charles%20St');
    expect(url).toContain('body=');
  });

  it('EMAIL: after opening mail, asks the user to confirm the outcome', async () => {
    const { getByText, getByLabelText } = await renderReview();
    await waitFor(() => getByLabelText('Report subject'));
    fireEvent.press(getByText('Open in Mail'));
    await waitFor(() => {
      expect(getByText('Did you send it?')).toBeTruthy();
    });
    expect(getByText(/sent by you/)).toBeTruthy();
    fireEvent.press(getByText('Yes, I sent it'));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/reports/r-123/submission', {
        channel_type: 'EMAIL',
        action: 'sent',
      });
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('Track', { reportId: 'r-123' });
    });
  });

  it('PHONE: Call builds a tel: URL and shows an editable call script', async () => {
    const { getByText, getByLabelText } = await renderReview(phoneChannel);
    await waitFor(() => getByLabelText('Report subject'));
    expect(getByText(/Call script/)).toBeTruthy();
    fireEvent.press(getByText('Call (410) 555-0311'));
    await waitFor(() => {
      expect(Linking.openURL).toHaveBeenCalledWith('tel:4105550311');
    });
  });

  it('WEB_FORM: Open official form + per-field copy buttons', async () => {
    const { getByText, getByLabelText, getAllByText } = await renderReview(
      webformChannel,
    );
    await waitFor(() => getByLabelText('Report subject'));
    // Field list includes the required fields from channel.requires — deduped
    // against the Subject/Description rows we always show, and with the photo
    // row naming the attachment instead of offering a meaningless copy chip.
    expect(getAllByText('Description')).toHaveLength(1);
    expect(getByText('Location')).toBeTruthy();
    expect(
      getByText('Photo — upload the one attached to this report'),
    ).toBeTruthy();
    // Subject, Description and Location have something to copy; Photo does not.
    expect(getAllByText('Copy')).toHaveLength(3);
    fireEvent.press(getByText('Open official form'));
    await waitFor(() => {
      expect(Linking.openURL).toHaveBeenCalledWith(
        'https://seeclickfix.com/baltimore/report',
      );
    });
  });

  it('records attempted before asking for the outcome', async () => {
    const calls: [string, unknown][] = [];
    (api.post as jest.Mock).mockImplementation((url: string, body: unknown) => {
      calls.push([url, body]);
      if (url.endsWith('/compose')) return Promise.resolve({ data: { draft } });
      return Promise.resolve({
        data: {
          submission_state: 'submission_attempted',
          event: { event_type: 'x', created_at: '2026-10-09T00:00:00Z' },
        },
      });
    });
    const { getByText, getByLabelText } = await renderReview();
    await waitFor(() => getByLabelText('Report subject'));
    fireEvent.press(getByText('Open in Mail'));
    await waitFor(() => {
      expect(getByText('Did you send it?')).toBeTruthy();
    });
    const actions = calls
      .filter(([url]) => url.endsWith('/submission'))
      .map(([, body]) => (body as { action: string }).action);
    expect(actions).toEqual(['approved', 'attempted']);
  });

  it('computeReadiness flags missing required fields without inventing them', () => {
    const items = computeReadiness(draft, { 'Case number': 'from the 311 app' });
    expect(
      items.find((i) => i.label.startsWith('Missing: Case number'))?.ok,
    ).toBe(false);
    expect(items.find((i) => i.label === 'Subject written')?.ok).toBe(true);
  });

  it('computeReadiness trusts the composer\'s missing_fields over a body match', () => {
    // Regression: the body said "Evidence (UNKNOWN): no photos attached." and
    // the substring test still reported "Includes: photo", contradicting the
    // report itself.
    const body = `${draft.body} Evidence (UNKNOWN): no photos attached.`;
    const withPhoto = computeReadiness(
      { ...draft, body },
      { fields: ['description', 'location', 'photo'] },
      ['photo'],
    );
    expect(withPhoto.find((i) => i.label === 'Missing: photo')?.ok).toBe(false);
    // The composer's verdict folds into the base row instead of producing a
    // second row for the same fact.
    expect(
      withPhoto.find((i) => i.label === 'Description written')?.ok,
    ).toBe(true);
    expect(
      withPhoto.filter((i) => /description/i.test(i.label)),
    ).toHaveLength(1);
    const allPresent = computeReadiness(
      { ...draft, body },
      { fields: ['description', 'location', 'photo'] },
      [],
    );
    expect(allPresent.find((i) => i.label === 'Includes: photo')?.ok).toBe(true);
  });

  it('requiredFieldNames drops case-duplicate field names', () => {
    expect(
      requiredFieldNames({ fields: ['Description', 'description', 'location'] }),
    ).toEqual(['Description', 'location']);
  });

  it('requiredFieldNames flattens the seeded {fields:[...]} shape', () => {
    // Backend contacts send requires as {fields:[...]}; the UI must list the
    // real field names, not a spurious "fields" row.
    expect(requiredFieldNames({ fields: ['description', 'location', 'photo'] }))
      .toEqual(['description', 'location', 'photo']);
    expect(requiredFieldNames({ 'Case number': 'hint' })).toEqual(['Case number']);
    expect(requiredFieldNames(undefined)).toEqual([]);
    expect(requiredFieldNames({})).toEqual([]);
    const items = computeReadiness(draft, { fields: ['nearest address'] });
    expect(items.some((i) => i.label.startsWith('Missing: nearest address'))).toBe(true);
    expect(items.some((i) => i.label.includes('fields'))).toBe(false);
  });
});
