import { whatsappLabel, whatsappFailure, whatsappVariable } from './whatsapp-labels';
const zh = (text: string) => text;
it('explains delivery and review statuses without claiming sent means delivered', () => {
  expect(whatsappLabel('SENT', zh)).toBe('已发送');
  expect(whatsappLabel('DELIVERED', zh)).toBe('已送达');
  expect(whatsappLabel('UNCERTAIN', zh)).toBe('发送结果待确认');
  expect(whatsappLabel('APPROVED', zh)).toBe('审核通过');
  expect(whatsappFailure('131026', zh)).toContain('不能视为客户上线后会自动收到');
  expect(whatsappFailure('OTHER', zh)).toBe('失败代码: OTHER');
  expect(whatsappLabel('NEW_STATUS', zh)).toBe('NEW_STATUS');
  expect(whatsappVariable('orderBalance', zh)).toBe('关联订单扣款后余额');
});
