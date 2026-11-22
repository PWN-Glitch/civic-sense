import React from 'react';
import { render } from '@testing-library/react-native';
import ConfidenceBar, { categoryPhrase } from '../src/components/ConfidenceBar';

// The percent-sure instrument has to read like a sentence a person would say.
// Category names are a mix of count and mass nouns, so the article cannot be
// hard-coded into the template.

describe('categoryPhrase', () => {
  it('uses an article only where the noun needs one', () => {
    expect(categoryPhrase('pothole')).toBe('a pothole');
    expect(categoryPhrase('streetlight')).toBe('a streetlight problem');
    expect(categoryPhrase('trash')).toBe('trash');
    expect(categoryPhrase('graffiti')).toBe('graffiti');
    expect(categoryPhrase('sidewalk damage')).toBe('sidewalk damage');
  });

  it('falls back to a neutral phrase when the category is missing', () => {
    expect(categoryPhrase(null)).toBe('a problem');
    expect(categoryPhrase(undefined)).toBe('a problem');
  });
});

describe('ConfidenceBar', () => {
  it('states the number and names the category without an article bug', async () => {
    const { getByText, getByLabelText } = await render(
      <ConfidenceBar confidence={0.47} band="medium" category="trash" />,
    );
    expect(getByText('47%')).toBeTruthy();
    expect(getByText('sure this is trash')).toBeTruthy();
    expect(
      getByLabelText("47 percent sure it's trash. Medium confidence."),
    ).toBeTruthy();
  });

  it('shows a dash instead of NaN when the score is unusable', async () => {
    const { getByText } = await render(
      <ConfidenceBar confidence={Number.NaN} band="low" category="pothole" />,
    );
    expect(getByText('—')).toBeTruthy();
    expect(getByText('The model did not return a usable score.')).toBeTruthy();
  });
});
