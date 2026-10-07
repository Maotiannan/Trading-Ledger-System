'use client';

import { apiCall } from '@/components/workspace/shared';
import {
  DEFAULT_DASHBOARD_LAYOUT,
  normalizeDashboardLayoutPreference,
  type DashboardLayoutPreference,
} from '@/lib/dashboard-layout-preference';
import {
  DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE,
  normalizeListPageSizePreference,
  type UserListPageSizePreference,
} from '@/lib/list-page-size-preference';

export type ClientUserPreferences = {
  dashboardLayout: DashboardLayoutPreference;
  listPageSizes: UserListPageSizePreference;
};

const DEFAULT_CLIENT_USER_PREFERENCES: ClientUserPreferences = {
  dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
  listPageSizes: DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE,
};

let preferencesRequest: Promise<ClientUserPreferences> | null = null;

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
  return normalizeClientUserPreferences(value);
}

export function clearClientUserPreferences(): void {
  preferencesRequest = null;
}

export async function loadClientUserPreferences(): Promise<ClientUserPreferences> {
  if (preferencesRequest) return preferencesRequest;

  preferencesRequest = apiCall('settings?view=user-preferences')
    .then((result) => {
      if (!result.success) return DEFAULT_CLIENT_USER_PREFERENCES;
      return rememberClientUserPreferences(result.data);
    })
    .catch(() => DEFAULT_CLIENT_USER_PREFERENCES)
    .finally(() => {
      preferencesRequest = null;
    });

  return preferencesRequest;
}
