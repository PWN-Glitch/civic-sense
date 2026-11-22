import React from 'react';
import { render } from '@testing-library/react-native';
import AnalysisScreen from '../src/screens/Analysis';
import type { ClassifyResponse } from '../src/types';

// AnalysisScreen reads everything from route params — the interesting
// contract behavior (503 → manual picker) is exercised here by simulating
// the params Preview passes after a 503 (empty predictions).

const mockNavigate = jest.fn();

async function renderAnalysis(params: object) {
  const route = { key: 'analysis-1', name: 'Analysis' as const, params };
  return render(
    <AnalysisScreen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      route={route as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigation={{ navigate: mockNavigate } as any}
    />,
  );
}

const successParams: ClassifyResponse & { photoUri: string } = {
  photoUri: 'file:///photo.jpg',
  predictions: [
    { category: 'pothole', confidence: 0.94 },
    { category: 'sidewalk damage', confidence: 0.04 },
    { category: 'other', confidence: 0.02 },
  ],
  band: 'high',
  severity: {
    level: 'moderate',
    reason: 'Road surface defect of visible depth.',
  },
  disclaimer: 'AI estimate — please verify.',
};

describe('Analysis screen', () => {
  it('renders the top category and confidence', async () => {
    const { getByText } = await renderAnalysis(successParams);
    expect(getByText('Pothole')).toBeTruthy();
    expect(getByText('94%')).toBeTruthy();
    expect(getByText('High confidence')).toBeTruthy();
  });

  it('never prints NaN: an unusable score reads as a dash', async () => {
    const { getByText, getAllByText, queryByText } = await renderAnalysis({
      ...successParams,
      predictions: [
        { category: 'pothole', confidence: Number.NaN },
        { category: 'trash', confidence: Number.NaN },
      ],
    });
    expect(getByText('Pothole')).toBeTruthy();
    expect(getAllByText('—').length).toBeGreaterThan(0);
    expect(queryByText(/NaN/)).toBeNull();
    // The slot says the score is missing instead of inventing one.
    expect(
      getByText('The model did not return a usable score.'),
    ).toBeTruthy();
  });

  it('states the percentage in words, not just a bar', async () => {
    const { getByText, queryByText } = await renderAnalysis(successParams);
    // The % sign already says percent; the words carry what it is sure about.
    expect(getByText('sure this is a pothole')).toBeTruthy();
    expect(getByText('High confidence')).toBeTruthy();
    // One caption. The old right-hand gloss ("Trustworthy") restated the band.
    expect(queryByText('Trustworthy')).toBeNull();
  });

  it('omits distracting processing captions', async () => {
    const { queryByText } = await renderAnalysis({
      ...successParams,
      classificationSource: 'on-device',
    });
    expect(queryByText('Analyzed on this device')).toBeNull();
    expect(queryByText('Analyzed in the cloud')).toBeNull();
  });

  it('shows severity and disclaimer', async () => {
    const { getByText } = await renderAnalysis(successParams);
    expect(getByText(/Estimated severity: moderate/)).toBeTruthy();
    expect(getByText('AI estimate — please verify.')).toBeTruthy();
  });

  it('shows the manual-category fallback when classify failed (503 shape)', async () => {
    const { getByText } = await renderAnalysis({
      photoUri: 'file:///photo.jpg',
      predictions: [],
      band: 'low',
      severity: { level: 'low', reason: 'unavailable' },
      disclaimer: '',
    });
    // Spec §22 copy: friendly, actionable, offers the manual fallback path.
    expect(getByText("We couldn't analyze this photo.")).toBeTruthy();
    expect(
      getByText(/Check your connection and try again, or choose a category manually/),
    ).toBeTruthy();
    expect(getByText('Choose a category')).toBeTruthy();
  });
});
