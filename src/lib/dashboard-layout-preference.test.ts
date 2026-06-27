import {
  DASHBOARD_CARD_REGISTRY,
  DEFAULT_DASHBOARD_LAYOUT,
  hideDashboardCard,
  moveDashboardCard,
  moveDashboardSection,
  normalizeDashboardLayoutPreference,
  restoreDashboardCard,
  validateDashboardLayoutPreferenceForSave,
} from '@/lib/dashboard-layout-preference';

describe('dashboard-layout-preference', () => {
  it('returns the current nine cards in the default section order', () => {
    const layout = normalizeDashboardLayoutPreference(null);
    expect(layout.sections.map((section) => section.id)).toEqual(['summary', 'analysis', 'recent']);
    expect(layout.sections.flatMap((section) => section.cards.map((card) => card.id))).toEqual([
      'invoice-balance',
      'pending-receipts',
      'waiting-swift',
      'pending-approvals',
      'released-unpaid-invoices',
      'customer-outstanding-ranking',
      'order-receipt-search',
      'recent-receipts',
      'recent-payment-details',
    ]);
  });

  it('appends future missing cards from the registry into their default section', () => {
    const layout = normalizeDashboardLayoutPreference({
      sections: [
        { id: 'summary', visible: true, cards: [{ id: 'invoice-balance', visible: true }] },
      ],
    });
    expect(layout.sections.find((section) => section.id === 'summary')?.cards.map((card) => card.id)).toEqual([
      'invoice-balance',
      'pending-receipts',
      'waiting-swift',
      'pending-approvals',
    ]);
    expect(layout.sections.find((section) => section.id === 'analysis')?.cards.map((card) => card.id)).toEqual([
      'released-unpaid-invoices',
      'customer-outstanding-ranking',
      'order-receipt-search',
    ]);
  });

  it('drops unknown section and card ids during normalization', () => {
    const layout = normalizeDashboardLayoutPreference({
      sections: [
        { id: 'unknown-section', visible: true, cards: [{ id: 'invoice-balance', visible: true }] },
        { id: 'summary', visible: true, cards: [{ id: 'unknown-card', visible: true }, { id: 'invoice-balance', visible: false }] },
      ],
    });
    expect(layout.sections.map((section) => section.id)).toEqual(['summary', 'analysis', 'recent']);
    expect(layout.sections[0].cards[0]).toEqual({ id: 'invoice-balance', visible: false });
  });

  it('rejects invalid saved layouts before writing to the database', () => {
    expect(() => validateDashboardLayoutPreferenceForSave({
      sections: [{ id: 'summary', visible: true, cards: [{ id: 'released-unpaid-invoices', visible: true }] }],
    })).toThrow('Dashboard card does not belong to this section');
  });

  it('hides and restores a card at the end of its owning section', () => {
    const hidden = hideDashboardCard(DEFAULT_DASHBOARD_LAYOUT, 'pending-receipts');
    expect(hidden.sections[0].cards.find((card) => card.id === 'pending-receipts')?.visible).toBe(false);
    const moved = moveDashboardCard(hidden, 'summary', 'pending-receipts', 'down');
    const restored = restoreDashboardCard(moved, 'pending-receipts');
    expect(restored.sections[0].cards.at(-1)).toEqual({ id: 'pending-receipts', visible: true });
  });

  it('moves sections and cards by one position while staying inside bounds', () => {
    expect(moveDashboardSection(DEFAULT_DASHBOARD_LAYOUT, 'analysis', 'up').sections.map((section) => section.id)).toEqual(['analysis', 'summary', 'recent']);
    expect(moveDashboardCard(DEFAULT_DASHBOARD_LAYOUT, 'summary', 'waiting-swift', 'up').sections[0].cards.map((card) => card.id)).toEqual([
      'invoice-balance',
      'waiting-swift',
      'pending-receipts',
      'pending-approvals',
    ]);
  });

  it('keeps every registered card in exactly one normalized location', () => {
    const layout = normalizeDashboardLayoutPreference({
      sections: [
        { id: 'summary', visible: true, cards: [{ id: 'invoice-balance', visible: true }, { id: 'invoice-balance', visible: false }] },
        { id: 'analysis', visible: true, cards: [{ id: 'released-unpaid-invoices', visible: true }] },
        { id: 'recent', visible: true, cards: [] },
      ],
    });
    const ids = layout.sections.flatMap((section) => section.cards.map((card) => card.id));
    expect(new Set(ids).size).toBe(DASHBOARD_CARD_REGISTRY.length);
    expect(ids.length).toBe(DASHBOARD_CARD_REGISTRY.length);
  });
});
