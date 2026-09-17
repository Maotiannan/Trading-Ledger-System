import { normalizeWhatsAppCustomerPhone } from './customer-phone';
it.each([['+224 622 49 12 86','+224622491286'],['00224-622-49-12-86','+224622491286'],['622491286',null],['+224622491286/+224620123456',null],['-',null],[null,null]])('normalizes %s without guessing', (input, expected) => {
  expect(normalizeWhatsAppCustomerPhone(input)).toBe(expected);
});
