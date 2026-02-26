import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { DeletionStatus, ReceiptStatus, DetailStatus } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { getCurrentUser } from '@/lib/request-auth';

// 获取删除申请列表
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    // 只有管理员可以查看所有删除申请
    if (currentUser.role !== UserRole.ADMIN) {
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
}

// 创建/审批删除申请
export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

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
        return NextResponse.json({ success: true, message: '申请已拒绝' });
      }

      // 执行删除
      const { targetType, targetId } = existingRequest;

      if (targetType === 'RECEIPT') {
        // 保存历史记录
        const receipt = await db.receipt.findUnique({ where: { id: targetId } });
        if (receipt) {
          await db.receiptHistory.create({
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

          // 删除关联的DetailItem
          await db.detailItem.deleteMany({
            where: { receiptId: targetId }
          });

          // 真正删除收据
          await db.receipt.delete({
            where: { id: targetId }
          });
        }
      } else if (targetType === 'DETAIL') {
        const detail = await db.detail.findUnique({
          where: { id: targetId },
          include: { items: true }
        });
        if (detail) {
          // 关联的RECEIPT回退到SR_Received状态
          for (const item of detail.items) {
            if (item.receiptId) {
              await db.receipt.update({
                where: { id: item.receiptId },
                data: { status: ReceiptStatus.SR_Received }
              });
            }
          }

          // 删除明细项
          await db.detailItem.deleteMany({ where: { detailId: targetId } });

          // 删除明细
          await db.detail.delete({ where: { id: targetId } });
        }
      } else if (targetType === 'SWIFT') {
        const swift = await db.swift.findUnique({ where: { id: targetId } });
        if (swift) {
          // DETAIL回退到Waiting_SWIFT状态
          await db.detail.update({
            where: { id: swift.detailId },
            data: { status: DetailStatus.Waiting_SWIFT }
          });

          // 关联的RECEIPT也回退
          const detail = await db.detail.findUnique({
            where: { id: swift.detailId },
            include: { items: true }
          });

          if (detail) {
            for (const item of detail.items) {
              if (item.receiptId) {
                await db.receipt.update({
                  where: { id: item.receiptId },
                  data: { status: ReceiptStatus.Waiting_SWIFT }
                });
              }
            }
          }

          await db.swift.delete({ where: { id: targetId } });
        }
      }

      // 更新申请状态
      await db.deletionRequest.update({
        where: { id: requestId },
        data: {
          status: DeletionStatus.APPROVED,
          approvedBy: currentUser.id,
          approvedAt: new Date()
        }
      });

      return NextResponse.json({ success: true, message: '删除成功，状态已回退' });
    }

    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('Deletion API error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
