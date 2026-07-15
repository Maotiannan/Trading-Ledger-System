import { logger } from '@/lib/logger';
import { getSystemSettingsWithDefaults } from '@/lib/system-settings';
import {
  DEFAULT_CUSTOMER_ANALYTICS_SETTINGS,
  getCustomerAnalyticsSettings,
} from './customer-analytics-settings';

jest.mock('@/lib/system-settings', () => ({
  customerAnalyticsSystemSettingKeys: [
    'CUSTOMER_ANALYTICS_LOOKBACK_MONTHS',
    'CUSTOMER_ANALYTICS_NORMAL_DAYS',
    'CUSTOMER_ANALYTICS_MILD_DELAY_DAYS',
    'CUSTOMER_ANALYTICS_DELAY_DAYS',
    'CUSTOMER_ANALYTICS_WARNING_DAYS',
    'CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS',
    'CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS',
  ],
  getSystemSettingsWithDefaults: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn() },
}));

const mockGetSettings = getSystemSettingsWithDefaults as jest.Mock;
const mockWarn = logger.warn as jest.Mock;

describe('customer analytics runtime settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns one validated runtime settings object', async () => {
    mockGetSettings.mockResolvedValue({
      CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: '18',
      CUSTOMER_ANALYTICS_NORMAL_DAYS: '35',
      CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: '65',
      CUSTOMER_ANALYTICS_DELAY_DAYS: '95',
      CUSTOMER_ANALYTICS_WARNING_DAYS: '125',
      CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS: '155',
      CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: '185',
    });

    await expect(getCustomerAnalyticsSettings()).resolves.toEqual({
      lookbackMonths: 18,
      normalDays: 35,
      mildDelayDays: 65,
      delayDays: 95,
      warningDays: 125,
      doubleWarningDays: 155,
      severeWarningDays: 185,
    });
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('falls back as one complete set when stored thresholds are malformed', async () => {
    mockGetSettings.mockResolvedValue({
      CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: '12',
      CUSTOMER_ANALYTICS_NORMAL_DAYS: '90',
      CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: '60',
      CUSTOMER_ANALYTICS_DELAY_DAYS: '30.5',
      CUSTOMER_ANALYTICS_WARNING_DAYS: '120',
      CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS: '150',
      CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: '180',
    });

    await expect(getCustomerAnalyticsSettings()).resolves.toEqual(DEFAULT_CUSTOMER_ANALYTICS_SETTINGS);
    expect(mockWarn).toHaveBeenCalledWith(
      'Invalid customer analytics settings; using defaults',
      expect.objectContaining({ stored: expect.any(Object) }),
    );
  });

  it.each([
    ['zero lookback', { CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: '0' }],
    ['excessive lookback', { CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: '61' }],
    ['decimal lookback', { CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: '12.5' }],
    ['equal thresholds', { CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: '30' }],
    ['excessive threshold', { CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: '3651' }],
  ])('falls back as one complete set for %s', async (_label, override) => {
    mockGetSettings.mockResolvedValue({
      CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: '12',
      CUSTOMER_ANALYTICS_NORMAL_DAYS: '30',
      CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: '60',
      CUSTOMER_ANALYTICS_DELAY_DAYS: '90',
      CUSTOMER_ANALYTICS_WARNING_DAYS: '120',
      CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS: '150',
      CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: '180',
      ...override,
    });

    await expect(getCustomerAnalyticsSettings()).resolves.toEqual(DEFAULT_CUSTOMER_ANALYTICS_SETTINGS);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });
});
