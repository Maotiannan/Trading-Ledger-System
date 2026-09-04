import {
  parseNotificationEmail,
  parseOptionalNotificationEmail,
} from '@/lib/email/email-address';

describe('notification email syntax', () => {
  it('treats an empty optional address as missing', () => {
    expect(parseOptionalNotificationEmail('  ')).toBeNull();
  });

  it.each([
    'finance+guinea@example.com',
    'sales@subdomain.example.co.uk',
    'office@enterprise.solutions',
    'contact@exemple.xn--p1ai',
    'client@例子.公司',
  ])('accepts common international address %s', (value) => {
    expect(parseNotificationEmail(`  ${value}  `)).toEqual({
      email: value,
      normalizedEmail: value.toLowerCase(),
    });
  });

  it('normalizes case only for duplicate detection', () => {
    expect(parseNotificationEmail('Finance.Team@Example.COM')).toEqual({
      email: 'Finance.Team@Example.COM',
      normalizedEmail: 'finance.team@example.com',
    });
  });

  it.each([
    '',
    'missing-at.example.com',
    '@example.com',
    'name@',
    'name@example',
    'name @example.com',
    'name@example .com',
    'name\n@example.com',
  ])('rejects malformed address %j', (value) => {
    expect(() => parseNotificationEmail(value)).toThrow('邮箱格式不正确');
  });
});
