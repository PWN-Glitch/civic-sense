/** Formatting shared by the docket-style screens (My Reports, case file). */

/** "CS-4F2A1B" from a real report id — a stable way to say one case. */
export function caseNumber(id: string): string {
  return `CS-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

/** "OCT 21" in the device's locale, uppercased for the mono docket line. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    .toUpperCase();
}

/** Link that opens a case file inside the app (see the linking config). */
export function reportLink(id: string): string {
  return `civicsense://report/${id}`;
}
