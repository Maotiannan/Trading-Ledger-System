'use client';

import { apiCall } from '@/components/workspace/shared';
import {
  normalizeDashboardLayoutPreference,
  type DashboardLayoutPreference,
} from '@/lib/dashboard-layout-preference';
import {
  normalizeListPageSizePreference,
  type UserListPageSizePreference,
} from '@/lib/list-page-size-preference';

export type ClientUserPreferences = {
  dashboardLayout: DashboardLayoutPreference;
  listPageSizes: UserListPageSizePreference;
};

let preferencesRequest: Promise<ClientUserPreferences> | null = null;
let accountId: string | null = null;
let snapshot: ClientUserPreferences | null = null;
let generation = 0;

function normalizeClientUserPreferences(value: unknown): ClientUserPreferences {
  const input = value && typeof value === 'object' ? value as {
    dashboardLayout?: unknown;
    listPageSizes?: unknown;
  } : {};
  return {
    dashboardLayout: normalizeDashboardLayoutPreference(input.dashboardLayout ?? null),
    listPageSizes: normalizeListPageSizePreference(input.listPageSizes ?? null),
  };
}

export function rememberClientUserPreferences(value: unknown): ClientUserPreferences {
  snapshot = normalizeClientUserPreferences(value);
  return snapshot;
}

export function initializeClientUserPreferences(userId: string, value?: unknown): void {
  clearClientUserPreferences();
  accountId = userId;
  if (value !== undefined) rememberClientUserPreferences(value);
}

export function readClientUserPreferences(userId: string): ClientUserPreferences | null {
  return userId === accountId ? snapshot : null;
}

export function clearClientUserPreferences(): void {
  preferencesRequest = null;
  accountId = null;
  snapshot = null;
  generation += 1;
}

export async function loadClientUserPreferences(): Promise<ClientUserPreferences> {
  if (snapshot) return snapshot;
  if (preferencesRequest) return preferencesRequest;
  const requestedGeneration = generation;
  const request = apiCall('settings?view=user-preferences')
    .then((result) => {
      if (generation !== requestedGeneration) throw new Error('Account changed');
      if (!result.success) throw new Error('Failed to load preferences');
      return rememberClientUserPreferences(result.data);
    })
    .finally(() => {
      if (generation === requestedGeneration) preferencesRequest = null;
    });
  preferencesRequest = request;
  return request;
}
