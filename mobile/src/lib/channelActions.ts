import { Clipboard, Linking } from 'react-native';
import type { SubmissionChannel } from '../types';

/**
 * Channel action helpers. Everything here is a plain function of the
 * channel + draft so tests can assert exact Linking URLs without rendering.
 * Email/phone/webform open external apps — we can only know the user
 * attempted the send, never that it arrived.
 */

export function buildMailtoUrl(
  recipient: string,
  subject: string,
  body: string,
): string {
  return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function buildTelUrl(phone: string): string {
  // Strip everything except digits and leading + so Linking tel: works.
  const cleaned = phone.replace(/(?!^\+)[^\d]/g, '');
  return `tel:${cleaned}`;
}

export async function openChannelUrl(url: string): Promise<void> {
  const supported = await Linking.canOpenURL(url);
  if (!supported) {
    throw new Error(`No app on this device can open: ${url}`);
  }
  await Linking.openURL(url);
}

export function copyToClipboard(text: string): void {
  Clipboard.setString(text);
}

/** Whether this channel leaves the app to finish the job (vs. an API call
 *  the backend performs for us). */
export function isUserDrivenChannel(channel: SubmissionChannel): boolean {
  return (
    channel.type === 'EMAIL' ||
    channel.type === 'PHONE' ||
    channel.type === 'WEB_FORM' ||
    channel.type === 'GOVERNMENT_PORTAL'
  );
}
