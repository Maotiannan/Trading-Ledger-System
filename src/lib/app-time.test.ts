import { APP_TIME_ZONE, formatAppDate, formatAppDateTime, getAppYear } from './app-time';

describe('app-time', () => {
  it('uses Guinea time as the single display timezone', () => {
    expect(APP_TIME_ZONE).toBe('Africa/Conakry');
  });

  it('formats dates with Guinea time instead of local browser time', () => {
    expect(formatAppDate('2026-04-27T23:30:00.000Z')).toBe('27/04/2026');
  });

  it('formats date-times with Guinea time', () => {
    expect(formatAppDateTime('2026-04-27T23:30:00.000Z')).toBe('27/04/2026, 23:30');
  });

  it('derives the natural year in Guinea time', () => {
    expect(getAppYear('2026-12-31T23:30:00.000Z')).toBe(2026);
  });
});
