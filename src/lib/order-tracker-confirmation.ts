export const ORDER_TRACKER_CONFIRMED_STATUS = 'Confirmed';

export function confirmedAtForNewOrder(status: string, now = new Date()): Date | null {
  return status === ORDER_TRACKER_CONFIRMED_STATUS ? now : null;
}

export function confirmedAtForStatusUpdate(input: {
  currentStatus: string;
  nextStatus: string;
  now?: Date;
}): Date | null | undefined {
  if (input.currentStatus === input.nextStatus) return undefined;
  if (input.nextStatus === ORDER_TRACKER_CONFIRMED_STATUS) return input.now || new Date();
  if (input.currentStatus === ORDER_TRACKER_CONFIRMED_STATUS) return null;
  return undefined;
}
