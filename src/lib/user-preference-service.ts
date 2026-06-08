import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { createApiError } from '@/lib/api-error';
import {
  DEFAULT_DASHBOARD_LAYOUT,
  normalizeDashboardLayoutPreference,
  validateDashboardLayoutPreferenceForSave,
  type DashboardLayoutPreference,
} from '@/lib/dashboard-layout-preference';
import type { CurrentUser } from '@/lib/request-auth';

export type UserImageCompressionPreference = {
  imageCompressionEnabled: boolean;
  imageCompressionQualityFloor: number;
  ocrTargetMaxKb: number;
};

export type UserPreferenceSettings = UserImageCompressionPreference & {
  dashboardLayout: DashboardLayoutPreference;
};

export const DEFAULT_USER_IMAGE_COMPRESSION_PREFERENCE: UserImageCompressionPreference = Object.freeze({
  imageCompressionEnabled: true,
  imageCompressionQualityFloor: 0.3,
  ocrTargetMaxKb: 500,
});

export const DEFAULT_USER_PREFERENCE_SETTINGS: UserPreferenceSettings = Object.freeze({
  ...DEFAULT_USER_IMAGE_COMPRESSION_PREFERENCE,
  dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
});

type UpdateUserImageCompressionPreferenceInput = Partial<UserImageCompressionPreference>;
type UpdateUserPreferenceSettingsInput = Partial<UserImageCompressionPreference & { dashboardLayout: unknown }>;

const MIN_IMAGE_COMPRESSION_QUALITY_FLOOR = 0.3;
const MAX_IMAGE_COMPRESSION_QUALITY_FLOOR = 1;
const MIN_OCR_TARGET_MAX_KB = 50;
const MAX_OCR_TARGET_MAX_KB = 10_000;

function normalizePreferenceRow(row: {
  imageCompressionEnabled: boolean;
  imageCompressionQualityFloor: unknown;
  ocrTargetMaxKb: number;
  dashboardLayout?: Prisma.JsonValue | null;
}): UserPreferenceSettings {
  return {
    imageCompressionEnabled: row.imageCompressionEnabled,
    imageCompressionQualityFloor: Number(row.imageCompressionQualityFloor),
    ocrTargetMaxKb: row.ocrTargetMaxKb,
    dashboardLayout: normalizeDashboardLayoutPreference(row.dashboardLayout ?? null),
  };
}

function toImageCompressionPreference(preference: UserPreferenceSettings): UserImageCompressionPreference {
  return {
    imageCompressionEnabled: preference.imageCompressionEnabled,
    imageCompressionQualityFloor: preference.imageCompressionQualityFloor,
    ocrTargetMaxKb: preference.ocrTargetMaxKb,
  };
}

function validateImageCompressionEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '图片压缩开关必须为布尔值',
      detail: { imageCompressionEnabled: value },
    });
  }
  return value;
}

function validateImageCompressionQualityFloor(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_IMAGE_COMPRESSION_QUALITY_FLOOR) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: `图片压缩质量下限不能低于 ${MIN_IMAGE_COMPRESSION_QUALITY_FLOOR.toFixed(2)}`,
      detail: { imageCompressionQualityFloor: value },
    });
  }
  if (parsed > MAX_IMAGE_COMPRESSION_QUALITY_FLOOR) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: `图片压缩质量下限不能高于 ${MAX_IMAGE_COMPRESSION_QUALITY_FLOOR.toFixed(2)}`,
      detail: { imageCompressionQualityFloor: value },
    });
  }
  return Number(parsed.toFixed(2));
}

function validateOcrTargetMaxKb(value: unknown): number {
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed)
    || parsed < MIN_OCR_TARGET_MAX_KB
    || parsed > MAX_OCR_TARGET_MAX_KB
  ) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: `OCR 目标大小必须为 ${MIN_OCR_TARGET_MAX_KB}-${MAX_OCR_TARGET_MAX_KB} KB 的整数`,
      detail: { ocrTargetMaxKb: value },
    });
  }
  return parsed;
}

function validateDashboardLayout(value: unknown): DashboardLayoutPreference {
  try {
    return validateDashboardLayoutPreferenceForSave(value);
  } catch (error) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: error instanceof Error ? error.message : 'Dashboard 设置格式错误',
      detail: { dashboardLayout: value },
    });
  }
}

export async function getUserPreferences(currentUser: CurrentUser): Promise<UserPreferenceSettings> {
  const preference = await db.userPreference.findUnique({
    where: { userId: currentUser.id },
  });

  if (!preference) {
    return DEFAULT_USER_PREFERENCE_SETTINGS;
  }

  return normalizePreferenceRow(preference);
}

export async function getUserImageCompressionPreference(
  currentUser: CurrentUser
): Promise<UserImageCompressionPreference> {
  return toImageCompressionPreference(await getUserPreferences(currentUser));
}

export async function updateUserPreferences(
  currentUser: CurrentUser,
  input: UpdateUserPreferenceSettingsInput
): Promise<UserPreferenceSettings> {
  const currentPreference = await getUserPreferences(currentUser);

  const nextPreference: UserPreferenceSettings = {
    imageCompressionEnabled: Object.prototype.hasOwnProperty.call(input, 'imageCompressionEnabled')
      ? validateImageCompressionEnabled(input.imageCompressionEnabled)
      : currentPreference.imageCompressionEnabled,
    imageCompressionQualityFloor: Object.prototype.hasOwnProperty.call(input, 'imageCompressionQualityFloor')
      ? validateImageCompressionQualityFloor(input.imageCompressionQualityFloor)
      : currentPreference.imageCompressionQualityFloor,
    ocrTargetMaxKb: Object.prototype.hasOwnProperty.call(input, 'ocrTargetMaxKb')
      ? validateOcrTargetMaxKb(input.ocrTargetMaxKb)
      : currentPreference.ocrTargetMaxKb,
    dashboardLayout: Object.prototype.hasOwnProperty.call(input, 'dashboardLayout')
      ? validateDashboardLayout(input.dashboardLayout)
      : currentPreference.dashboardLayout,
  };

  const dashboardLayout = nextPreference.dashboardLayout as unknown as Prisma.InputJsonValue;
  const savedPreference = await db.userPreference.upsert({
    where: { userId: currentUser.id },
    create: {
      userId: currentUser.id,
      imageCompressionEnabled: nextPreference.imageCompressionEnabled,
      imageCompressionQualityFloor: nextPreference.imageCompressionQualityFloor,
      ocrTargetMaxKb: nextPreference.ocrTargetMaxKb,
      dashboardLayout,
    },
    update: {
      imageCompressionEnabled: nextPreference.imageCompressionEnabled,
      imageCompressionQualityFloor: nextPreference.imageCompressionQualityFloor,
      ocrTargetMaxKb: nextPreference.ocrTargetMaxKb,
      dashboardLayout,
    },
  });

  return normalizePreferenceRow(savedPreference);
}

export async function updateUserImageCompressionPreference(
  currentUser: CurrentUser,
  input: UpdateUserImageCompressionPreferenceInput
): Promise<UserImageCompressionPreference> {
  return toImageCompressionPreference(await updateUserPreferences(currentUser, input));
}
