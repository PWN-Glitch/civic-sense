import { caseNumber, reportLink, shortDate } from '../src/lib/docket';

describe('docket formatting', () => {
  it('derives a stable case number from the real report id', () => {
    expect(caseNumber('4f2a1b9c-1111-2222-3333-444455556666')).toBe('CS-4F2A1B');
    expect(caseNumber('abc-def')).toBe('CS-ABCDEF');
  });

  it('formats a filing date in short uppercase form', () => {
    expect(shortDate('2026-10-21T15:04:05Z')).toMatch(/^[A-Z]{3} \d{1,2}$/);
  });

  it('leaves an unparseable date as-is rather than printing Invalid Date', () => {
    expect(shortDate('not-a-date')).toBe('not-a-date');
  });

  it('builds the deep link the share sheet hands out', () => {
    expect(reportLink('abc-123')).toBe('civicsense://report/abc-123');
  });
});
