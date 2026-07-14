import {
  confirmedAtForNewOrder,
  confirmedAtForStatusUpdate,
} from './order-tracker-confirmation';

describe('order tracker confirmation timestamp', () => {
  const now = new Date('2026-07-14T10:00:00.000Z');

  it('sets the timestamp only when a new order starts as Confirmed', () => {
    expect(confirmedAtForNewOrder('Confirmed', now)).toBe(now);
    expect(confirmedAtForNewOrder('In progress', now)).toBeNull();
    expect(confirmedAtForNewOrder('Canceled', now)).toBeNull();
  });

  it('sets a new timestamp whenever a non-confirmed order enters Confirmed', () => {
    expect(confirmedAtForStatusUpdate({
      currentStatus: 'In progress',
      nextStatus: 'Confirmed',
      now,
    })).toBe(now);
    expect(confirmedAtForStatusUpdate({
      currentStatus: 'Canceled',
      nextStatus: 'Confirmed',
      now,
    })).toBe(now);
  });

  it('clears the timestamp whenever a Confirmed order leaves that status', () => {
    expect(confirmedAtForStatusUpdate({
      currentStatus: 'Confirmed',
      nextStatus: 'In progress',
      now,
    })).toBeNull();
    expect(confirmedAtForStatusUpdate({
      currentStatus: 'Confirmed',
      nextStatus: 'Canceled',
      now,
    })).toBeNull();
  });

  it('preserves the stored value when there is no relevant transition', () => {
    expect(confirmedAtForStatusUpdate({
      currentStatus: 'Confirmed',
      nextStatus: 'Confirmed',
      now,
    })).toBeUndefined();
    expect(confirmedAtForStatusUpdate({
      currentStatus: 'In progress',
      nextStatus: 'Canceled',
      now,
    })).toBeUndefined();
  });
});
