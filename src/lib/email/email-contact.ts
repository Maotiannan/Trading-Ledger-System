import { parseNotificationEmail } from '@/lib/email/email-address';
import type { EmailContactSettings } from '@/lib/email/email-types';

export function contactPhoneHref(phone: string): string {
  const number = phone.replace(/[\s().-]/g, '');
  if (!/^\+?[0-9]{6,15}$/.test(number)) throw new Error('Invalid contact phone.');
  return `tel:${number}`;
}

export function validateEmailContact(contact: EmailContactSettings): void {
  if (!contact.contactName.trim() || !contact.companyAddress.trim()) throw new Error('Contact name and address are required.');
  contactPhoneHref(contact.contactPhone);
  parseNotificationEmail(contact.contactEmail);
  const url = new URL(contact.whatsappUrl);
  if (url.protocol !== 'https:' || url.host !== 'wa.me' || url.username || url.password
    || url.search || url.hash || !/^\/\+?[0-9]{6,15}$/.test(url.pathname)) {
    throw new Error('Invalid WhatsApp contact link.');
  }
}
