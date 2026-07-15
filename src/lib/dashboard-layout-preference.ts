export const DASHBOARD_SECTION_REGISTRY = [
  { id: 'summary', defaultOrder: 10, zh: '摘要卡片', en: 'Summary Cards' },
  { id: 'analysis', defaultOrder: 20, zh: '分析卡片', en: 'Analysis Cards' },
  { id: 'recent', defaultOrder: 30, zh: '最近记录', en: 'Recent Activity' },
] as const;

export const DASHBOARD_CARD_REGISTRY = [
  { id: 'invoice-balance', sectionId: 'summary', defaultOrder: 10, zh: '账单余额', en: 'Invoice Balance' },
  { id: 'pending-receipts', sectionId: 'summary', defaultOrder: 20, zh: '待处理收据', en: 'Pending Receipts' },
  { id: 'waiting-swift', sectionId: 'summary', defaultOrder: 30, zh: '等待 SWIFT', en: 'Waiting SWIFT' },
  { id: 'pending-approvals', sectionId: 'summary', defaultOrder: 40, zh: '待审批', en: 'Pending Approvals' },
  { id: 'released-unpaid-invoices', sectionId: 'analysis', defaultOrder: 10, zh: '已放单未结清发票', en: 'Released Unpaid Invoices' },
  { id: 'customer-outstanding-ranking', sectionId: 'analysis', defaultOrder: 20, zh: '客户欠款排行', en: 'Customer Outstanding Ranking' },
  { id: 'customer-analytics', sectionId: 'analysis', defaultOrder: 25, zh: '客户分析', en: 'Customer Analytics' },
  { id: 'order-receipt-search', sectionId: 'analysis', defaultOrder: 30, zh: '客户历史订单/付款搜索', en: 'Customer Order & Payment History' },
  { id: 'recent-receipts', sectionId: 'recent', defaultOrder: 10, zh: '最近收据', en: 'Recent Receipts' },
  { id: 'recent-payment-details', sectionId: 'recent', defaultOrder: 20, zh: '最近付款明细', en: 'Recent Payment Details' },
] as const;

export type DashboardSectionId = typeof DASHBOARD_SECTION_REGISTRY[number]['id'];
export type DashboardCardId = typeof DASHBOARD_CARD_REGISTRY[number]['id'];
export type DashboardLayoutCardPreference = { id: DashboardCardId; visible: boolean };
export type DashboardLayoutSectionPreference = {
  id: DashboardSectionId;
  visible: boolean;
  cards: DashboardLayoutCardPreference[];
};
export type DashboardLayoutPreference = { sections: DashboardLayoutSectionPreference[] };
export type DashboardMoveDirection = 'up' | 'down';

const sectionIds = new Set<string>(DASHBOARD_SECTION_REGISTRY.map((section) => section.id));
const cardIds = new Set<string>(DASHBOARD_CARD_REGISTRY.map((card) => card.id));
const cardSection = new Map<string, DashboardSectionId>(DASHBOARD_CARD_REGISTRY.map((card) => [card.id, card.sectionId]));

function cloneLayout(layout: DashboardLayoutPreference): DashboardLayoutPreference {
  return {
    sections: layout.sections.map((section) => ({
      ...section,
      cards: section.cards.map((card) => ({ ...card })),
    })),
  };
}

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutPreference = {
  sections: DASHBOARD_SECTION_REGISTRY
    .slice()
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((section) => ({
      id: section.id,
      visible: true,
      cards: DASHBOARD_CARD_REGISTRY
        .filter((card) => card.sectionId === section.id)
        .slice()
        .sort((a, b) => a.defaultOrder - b.defaultOrder)
        .map((card) => ({ id: card.id, visible: true })),
    })),
};

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function normalizeDashboardLayoutPreference(value: unknown): DashboardLayoutPreference {
  const source = readObject(value);
  const rawSections = Array.isArray(source?.sections) ? source.sections : [];
  const usedSections = new Set<string>();
  const usedCards = new Set<string>();
  const normalizedSections: DashboardLayoutSectionPreference[] = [];

  for (const rawSection of rawSections) {
    const section = readObject(rawSection);
    const sectionId = String(section?.id || '') as DashboardSectionId;
    if (!sectionIds.has(sectionId) || usedSections.has(sectionId)) continue;
    usedSections.add(sectionId);
    const cards: DashboardLayoutCardPreference[] = [];
    const rawCards = Array.isArray(section?.cards) ? section.cards : [];
    for (const rawCard of rawCards) {
      const card = readObject(rawCard);
      const cardId = String(card?.id || '') as DashboardCardId;
      if (!cardIds.has(cardId) || usedCards.has(cardId)) continue;
      if (cardSection.get(cardId) !== sectionId) continue;
      usedCards.add(cardId);
      cards.push({ id: cardId, visible: typeof card?.visible === 'boolean' ? card.visible : true });
    }
    normalizedSections.push({
      id: sectionId,
      visible: typeof section?.visible === 'boolean' ? section.visible : true,
      cards,
    });
  }

  for (const defaultSection of DEFAULT_DASHBOARD_LAYOUT.sections) {
    let section = normalizedSections.find((item) => item.id === defaultSection.id);
    if (!section) {
      section = { id: defaultSection.id, visible: true, cards: [] };
      normalizedSections.push(section);
    }
    for (const defaultCard of defaultSection.cards) {
      if (usedCards.has(defaultCard.id)) continue;
      usedCards.add(defaultCard.id);
      section.cards.push({ id: defaultCard.id, visible: true });
    }
  }

  return cloneLayout({ sections: normalizedSections });
}

export function validateDashboardLayoutPreferenceForSave(value: unknown): DashboardLayoutPreference {
  const source = readObject(value);
  if (!source || !Array.isArray(source.sections)) {
    throw new Error('Dashboard layout must include sections');
  }
  for (const rawSection of source.sections) {
    const section = readObject(rawSection);
    const sectionId = String(section?.id || '');
    if (!sectionIds.has(sectionId)) throw new Error('Unknown dashboard section');
    if (!Array.isArray(section?.cards)) throw new Error('Dashboard section must include cards');
    for (const rawCard of section.cards) {
      const card = readObject(rawCard);
      const cardId = String(card?.id || '');
      if (!cardIds.has(cardId)) throw new Error('Unknown dashboard card');
      if (cardSection.get(cardId) !== sectionId) throw new Error('Dashboard card does not belong to this section');
      if (typeof card?.visible !== 'boolean') throw new Error('Dashboard card visibility must be boolean');
    }
  }
  return normalizeDashboardLayoutPreference(value);
}

function moveIndex<T>(items: T[], index: number, direction: DashboardMoveDirection): T[] {
  const nextIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items;
  const next = items.slice();
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function moveDashboardSection(
  layout: DashboardLayoutPreference,
  sectionId: DashboardSectionId,
  direction: DashboardMoveDirection,
): DashboardLayoutPreference {
  const next = cloneLayout(normalizeDashboardLayoutPreference(layout));
  next.sections = moveIndex(next.sections, next.sections.findIndex((section) => section.id === sectionId), direction);
  return next;
}

export function moveDashboardCard(
  layout: DashboardLayoutPreference,
  sectionId: DashboardSectionId,
  cardId: DashboardCardId,
  direction: DashboardMoveDirection,
): DashboardLayoutPreference {
  const next = cloneLayout(normalizeDashboardLayoutPreference(layout));
  const section = next.sections.find((item) => item.id === sectionId);
  if (section) section.cards = moveIndex(section.cards, section.cards.findIndex((card) => card.id === cardId), direction);
  return next;
}

export function hideDashboardCard(layout: DashboardLayoutPreference, cardId: DashboardCardId): DashboardLayoutPreference {
  const next = cloneLayout(normalizeDashboardLayoutPreference(layout));
  for (const section of next.sections) {
    section.cards = section.cards.map((card) => card.id === cardId ? { ...card, visible: false } : card);
  }
  return next;
}

export function restoreDashboardCard(layout: DashboardLayoutPreference, cardId: DashboardCardId): DashboardLayoutPreference {
  const next = cloneLayout(normalizeDashboardLayoutPreference(layout));
  const sectionId = cardSection.get(cardId);
  if (!sectionId) return next;
  const section = next.sections.find((item) => item.id === sectionId);
  if (!section) return next;
  section.cards = section.cards.filter((card) => card.id !== cardId);
  section.cards.push({ id: cardId, visible: true });
  return next;
}
