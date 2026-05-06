import { UploadedAssetAttachmentType, UploadedAssetStatus, UserRole } from '@prisma/client';
import { rm } from 'fs/promises';
import { db } from '@/lib/db';
import { createApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';
import { getOwnerVisibleIds } from '@/lib/resource-visibility';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { attachUploadedAssetByPath, resolveUploadedAssetAbsolutePath } from '@/lib/uploaded-asset-service';

export type PaymentAgentPayload = {
  companyName: string;
  companyAddress?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
};

function assertManager(currentUser: CurrentUser) {
  if (currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.SALES) {
    return;
  }
  throw createApiError({
    code: 'FORBIDDEN',
    status: 403,
    message: '无权限维护付款代理',
    detail: { role: currentUser.role },
  });
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizePayload(payload: PaymentAgentPayload) {
  const companyName = normalizeText(payload.companyName);
  if (!companyName) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '公司名称不能为空',
    });
  }
  return {
    companyName,
    companyAddress: normalizeText(payload.companyAddress),
    contactName: normalizeText(payload.contactName),
    contactPhone: normalizeText(payload.contactPhone),
  };
}

export async function listPaymentAgents(currentUser: CurrentUser, options: { search?: string } = {}) {
  assertManager(currentUser);
  const ownerIds = await getOwnerVisibleIds(currentUser);
  const search = (options.search || '').trim();
  const where = {
    createdBy: { in: ownerIds },
    ...(search
      ? {
          OR: [
            { companyName: { contains: search } },
            { companyAddress: { contains: search } },
            { contactName: { contains: search } },
            { contactPhone: { contains: search } },
          ],
        }
      : {}),
  };

  const agents = await db.paymentAgent.findMany({
    where,
    include: {
      creator: {
        select: { id: true, email: true, name: true },
      },
      files: {
        orderBy: [{ createdAt: 'desc' }],
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return agents.map((agent) => ({
    id: agent.id,
    companyName: agent.companyName,
    companyAddress: agent.companyAddress,
    contactName: agent.contactName,
    contactPhone: agent.contactPhone,
    createdBy: agent.createdBy,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
    creator: agent.creator,
    files: agent.files.map((file) => ({
      id: file.id,
      name: file.name,
      path: file.path,
      mimeType: file.mimeType,
      size: file.size,
      uploadedBy: file.uploadedBy,
      createdAt: file.createdAt.toISOString(),
    })),
  }));
}

export async function createPaymentAgent(currentUser: CurrentUser, payload: PaymentAgentPayload) {
  assertManager(currentUser);
  const normalized = normalizePayload(payload);
  const agent = await db.paymentAgent.create({
    data: {
      ...normalized,
      createdBy: currentUser.id,
    },
  });
  return {
    message: '付款代理已创建',
    data: agent,
  };
}

async function getMutableAgent(agentId: string, currentUser: CurrentUser) {
  assertManager(currentUser);
  const agent = await db.paymentAgent.findUnique({
    where: { id: agentId },
    include: {
      files: true,
    },
  });
  if (!agent) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
      message: '付款代理不存在',
      detail: { agentId },
    });
  }
  if (!(await canAccessOwnedResourceAsync(agent.createdBy, currentUser))) {
    throw createApiError({
      code: 'FORBIDDEN',
      status: 403,
      message: '无权修改该付款代理',
      detail: { agentId, createdBy: agent.createdBy },
    });
  }
  return agent;
}

export async function resolveAccessiblePaymentAgentId(
  currentUser: CurrentUser,
  agentId: string | null | undefined,
): Promise<string | null> {
  const trimmed = (agentId || '').trim();
  if (!trimmed) return null;
  const agent = await db.paymentAgent.findUnique({
    where: { id: trimmed },
    select: {
      id: true,
      createdBy: true,
    },
  });
  if (!agent) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
      message: '付款代理不存在',
      detail: { agentId: trimmed },
    });
  }
  if (!(await canAccessOwnedResourceAsync(agent.createdBy, currentUser))) {
    throw createApiError({
      code: 'FORBIDDEN',
      status: 403,
      message: '无权使用该付款代理',
      detail: { agentId: trimmed, createdBy: agent.createdBy },
    });
  }
  return agent.id;
}

export async function updatePaymentAgent(currentUser: CurrentUser, agentId: string, payload: PaymentAgentPayload) {
  const normalized = normalizePayload(payload);
  await getMutableAgent(agentId, currentUser);
  const agent = await db.paymentAgent.update({
    where: { id: agentId },
    data: normalized,
  });
  return {
    message: '付款代理已更新',
    data: agent,
  };
}

export async function attachPaymentAgentFile(input: {
  currentUser: CurrentUser;
  agentId: string;
  path: string;
  name: string;
  mimeType: string;
  size: number;
}) {
  const agent = await getMutableAgent(input.agentId, input.currentUser);

  const file = await db.$transaction(async (tx) => {
    const created = await tx.paymentAgentFile.create({
      data: {
        agentId: agent.id,
        name: input.name,
        path: input.path,
        mimeType: input.mimeType,
        size: input.size,
        uploadedBy: input.currentUser.id,
      },
    });

    await attachUploadedAssetByPath({
      client: tx,
      path: input.path,
      attachedType: UploadedAssetAttachmentType.PAYMENT_AGENT_FILE,
      attachedId: created.id,
    });

    return created;
  });

  return {
    message: '付款代理附件已上传',
    data: {
      id: file.id,
      name: file.name,
      path: file.path,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt.toISOString(),
    },
  };
}

export async function deletePaymentAgentFile(currentUser: CurrentUser, fileId: string) {
  assertManager(currentUser);
  const file = await db.paymentAgentFile.findUnique({
    where: { id: fileId },
    include: {
      agent: {
        select: {
          id: true,
          createdBy: true,
        },
      },
    },
  });
  if (!file || !file.agent) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
      message: '付款代理附件不存在',
      detail: { fileId },
    });
  }
  if (!(await canAccessOwnedResourceAsync(file.agent.createdBy, currentUser))) {
    throw createApiError({
      code: 'FORBIDDEN',
      status: 403,
      message: '无权删除该付款代理附件',
      detail: { fileId, createdBy: file.agent.createdBy },
    });
  }

  await db.$transaction(async (tx) => {
    await tx.paymentAgentFile.delete({
      where: { id: file.id },
    });
    await tx.uploadedAsset.updateMany({
      where: {
        path: file.path,
        attachedType: UploadedAssetAttachmentType.PAYMENT_AGENT_FILE,
        attachedId: file.id,
        status: UploadedAssetStatus.ATTACHED,
      },
      data: {
        status: UploadedAssetStatus.DELETED,
        deletedAt: new Date(),
      },
    });
  });

  await rm(resolveUploadedAssetAbsolutePath(file.path), { force: true }).catch(() => undefined);

  return {
    message: '付款代理附件已删除',
  };
}

export async function deletePaymentAgent(currentUser: CurrentUser, agentId: string) {
  const agent = await getMutableAgent(agentId, currentUser);

  await db.$transaction(async (tx) => {
    if (agent.files.length > 0) {
      await tx.uploadedAsset.updateMany({
        where: {
          path: {
            in: agent.files.map((file) => file.path),
          },
          attachedType: UploadedAssetAttachmentType.PAYMENT_AGENT_FILE,
          status: UploadedAssetStatus.ATTACHED,
        },
        data: {
          status: UploadedAssetStatus.DELETED,
          deletedAt: new Date(),
        },
      });
    }

    await tx.paymentAgent.delete({
      where: { id: agent.id },
    });
  });

  await Promise.all(
    agent.files.map((file) =>
      rm(resolveUploadedAssetAbsolutePath(file.path), { force: true }).catch(() => undefined)
    )
  );

  return {
    message: '付款代理已删除',
  };
}
