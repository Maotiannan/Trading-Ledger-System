import {
  clearDashboardSummaryCache,
  readDashboardSummaryCache,
  rememberDashboardSummary,
} from './dashboard-summary-cache';

describe('dashboard summary cache', () => {
  beforeEach(() => {
    clearDashboardSummaryCache();
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps values isolated by user and expires them after 30 seconds', () => {
    const summary = { unpaidTotal: 123 };
    rememberDashboardSummary('user-a', summary);

    expect(readDashboardSummaryCache('user-a')).toEqual({ value: summary, fresh: true });
    expect(readDashboardSummaryCache('user-b')).toBeNull();

    jest.spyOn(Date, 'now').mockReturnValue(31_001);
    expect(readDashboardSummaryCache('user-a')).toEqual({ value: summary, fresh: false });
  });
});
