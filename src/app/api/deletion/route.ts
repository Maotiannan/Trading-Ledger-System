import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { DeletionStatus, ReceiptStatus, DetailStatus } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { withAuth } from '@/lib/route-auth';
import { canAccessOwnedResource, forbiddenOwnershipResponse } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { updateOrderBalance } from '@/lib/matching';

// 获取删除申请列表
export const GET = withAuth(async (_request: NextRequest, currentUser) => {
  try {
    // 管理员和销售可查看全部，普通用户仅看自己的申请
    if (currentUser.role === UserRole.USER) {
      // 普通用户只能看自己的申请
      const requests = await db.deletionRequest.findMany({
        where: { requestedBy: currentUser.id },
        include: {
          requester: { select: { id: true, name: true, email: true } },
          approver: { select: { id: true, name: true, email: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
      return NextResponse.json({ success: true, data: requests });
    }

    const requests = await db.deletionRequest.findMany({
      include: {
        requester: { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ success: true, data: requests });
  } catch (error) {
    console.error('Get deletion requests error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
});

// 创建/审批删除申请
export const POST = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const body = await request.json();
    const { action, targetType, targetId, reason, requestId } = body;

    // 发起删除申请
    if (action === 'request') {
      if (!targetType || !targetId) {
        return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
      }

      // 检查目标是否存在
      let canDelete = true;
      let errorMessage = '';

      if (targetType === 'RECEIPT') {
        const receipt = await db.receipt.findUnique({ where: { id: targetId } });
        if (!receipt) {
          return NextResponse.json({ success: false, error: '收据不存在' }, { status: 400 });
        }
        if (!canAccessOwnedResource(receipt.createdBy, currentUser)) {
          return forbiddenOwnershipResponse('无权申请删除该收据');
        }
        if (receipt.status === ReceiptStatus.RECEIVED) {
          canDelete = false;
          errorMessage = 'RECEIVED状态下禁止删除';
        }
        if (receipt.status === ReceiptStatus.Bank_Transfer) {
          canDelete = false;
          errorMessage = 'Bank_Transfer状态下禁止删除';
        }
      } else if (targetType === 'DETAIL') {
        const detail = await db.detail.findUnique({ where: { id: targetId } });
        if (!detail) {
          return NextResponse.json({ success: false, error: '付款明细不存在' }, { status: 400 });
        }
        if (!canAccessOwnedResource(detail.createdBy, currentUser)) {
          return forbiddenOwnershipResponse('无权申请删除该明细');
        }
        if (detail.status === DetailStatus.RECEIVED) {
          canDelete = false;
          errorMessage = 'RECEIVED状态下禁止删除';
        }
        if (detail.status === DetailStatus.Bank_Transfer) {
          canDelete = false;
          errorMessage = 'Bank_Transfer状态下禁止删除';
        }
      } else if (targetType === 'SWIFT') {
        const swift = await db.swift.findUnique({ where: { id: targetId } });
        if (!swift) {
          return NextResponse.json({ success: false, error: 'SWIFT不存在' }, { status: 400 });
        }
        if (!canAccessOwnedResource(swift.createdBy, currentUser)) {
          return forbiddenOwnershipResponse('无权申请删除该SWIFT');
        }
      } else {
        return NextResponse.json({ success: false, error: '无效的删除目标类型' }, { status: 400 });
      }

      if (!canDelete) {
        return NextResponse.json({ success: false, error: errorMessage }, { status: 400 });
      }

      const deletionRequest = await db.deletionRequest.create({
        data: {
          targetType,
          targetId,
          reason,
          requestedBy: currentUser.id,
          status: DeletionStatus.PENDING
        },
        include: {
          requester: { select: { id: true, name: true, email: true } }
        }
      });
      await recordAuditEvent({
        action: 'DELETION_REQUEST_CREATE',
        actorId: currentUser.id,
        targetType: targetType,
        targetId,
        metadata: { requestId: deletionRequest.id },
      });

      return NextResponse.json({ success: true, data: deletionRequest });
    }

    // 审批删除申请（管理员）
    if (action === 'approve' || action === 'reject') {
      if (currentUser.role !== UserRole.ADMIN) {
        return NextResponse.json({ success: false, error: '只有管理员可以审批' }, { status: 403 });
      }

      if (!requestId) {
        return NextResponse.json({ success: false, error: '缺少申请ID' }, { status: 400 });
      }

      const existingRequest = await db.deletionRequest.findUnique({
        where: { id: requestId }
      });

      if (!existingRequest) {
        return NextResponse.json({ success: false, error: '申请不存在' }, { status: 400 });
      }

      if (existingRequest.status !== DeletionStatus.PENDING) {
        return NextResponse.json({ success: false, error: '该申请已处理' }, { status: 400 });
      }

      if (action === 'reject') {
        await db.deletionRequest.update({
          where: { id: requestId },
          data: {
            status: DeletionStatus.REJECTED,
            approvedBy: currentUser.id,
            approvedAt: new Date()
          }
        });
        await recordAuditEvent({
          action: 'DELETION_REQUEST_REJECT',
          actorId: currentUser.id,
          targetType: existingRequest.targetType,
          targetId: existingRequest.targetId,
          metadata: { requestId },
        });
        return NextResponse.json({ success: true, message: '申请已拒绝' });
      }

      let affectedReceiptOrderId: string | null = null;

      await db.$transaction(async (tx) => {
        const requestInTx = await tx.deletionRequest.findUnique({
          where: { id: requestId }
        });
        if (!requestInTx || requestInTx.status !== DeletionStatus.PENDING) {
          throw new Error('删除申请状态已变化，请刷新后重试');
        }

        // 执行删除
        const { targetType, targetId } = requestInTx;

        if (targetType === 'RECEIPT') {
          const receipt = await tx.receipt.findUnique({ where: { id: targetId } });
          if (receipt) {
            affectedReceiptOrderId = receipt.orderId;
            const affectedDetailItems = await tx.detailItem.findMany({
              where: { receiptId: targetId },
              select: { detailId: true },
            });
            const affectedDetailIds = Array.from(new Set(affectedDetailItems.map((row) => row.detailId)));

            await tx.receiptHistory.create({
              data: {
                receiptId: targetId,
                receiptNo: receipt.receiptNo,
                date: receipt.date,
                tel: receipt.tel,
                usd: receipt.usd,
                invNo: receipt.invNo,
                orderNo: receipt.orderNo,
                payer: receipt.payer,
                imageUrl: receipt.imageUrl,
                imageName: receipt.imageName,
                status: receipt.status,
                note: '删除前保存',
                createdBy: currentUser.id
              }
            });

            await tx.detailItem.deleteMany({
              where: { receiptId: targetId }
            });

            await tx.receipt.delete({
              where: { id: targetId }
            });

            for (const detailId of affectedDetailIds) {
              const remainItems = await tx.detailItem.findMany({
                where: { detailId },
                select: { amount: true },
              });
              const totalAmount = remainItems.reduce((sum, item) => sum + item.amount, 0);
              await tx.detail.update({
                where: { id: detailId },
                data: { totalAmount },
              });
            }
          }
        } else if (targetType === 'DETAIL') {
          const detail = await tx.detail.findUnique({
            where: { id: targetId },
            include: { items: true }
          });
          if (detail) {
            for (const item of detail.items) {
              if (item.receiptId) {
                await tx.receipt.update({
                  where: { id: item.receiptId },
                  data: { status: ReceiptStatus.SR_Received }
                });
              }
            }

            await tx.detailItem.deleteMany({ where: { detailId: targetId } });
            await tx.detail.delete({ where: { id: targetId } });
          }
        } else if (targetType === 'SWIFT') {
          const swift = await tx.swift.findUnique({ where: { id: targetId } });
          if (swift) {
            await tx.detail.update({
              where: { id: swift.detailId },
              data: { status: DetailStatus.Waiting_SWIFT }
            });

            const detail = await tx.detail.findUnique({
              where: { id: swift.detailId },
              include: { items: true }
            });

            if (detail) {
              for (const item of detail.items) {
                if (item.receiptId) {
                  await tx.receipt.update({
                    where: { id: item.receiptId },
                    data: { status: ReceiptStatus.Waiting_SWIFT }
                  });
                }
              }
            }

            await tx.swift.delete({ where: { id: targetId } });
          }
        }

        await tx.deletionRequest.update({
          where: { id: requestId },
          data: {
            status: DeletionStatus.APPROVED,
            approvedBy: currentUser.id,
            approvedAt: new Date()
          }
        });
      });
      if (affectedReceiptOrderId) {
        await updateOrderBalance(affectedReceiptOrderId);
      }
      await recordAuditEvent({
        action: 'DELETION_REQUEST_APPROVE',
        actorId: currentUser.id,
        targetType: existingRequest.targetType,
        targetId: existingRequest.targetId,
        metadata: { requestId },
      });

      return NextResponse.json({ success: true, message: '删除成功，状态已回退' });
    }

    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('Deletion API error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
});
