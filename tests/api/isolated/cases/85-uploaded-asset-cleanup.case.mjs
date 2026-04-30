import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

export const name = 'uploaded-asset-cleanup';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnKXuQAAAAASUVORK5CYII=';

function findDetailByOrder(rows, orderNo) {
  return (Array.isArray(rows) ? rows : []).find(
    (row) => Array.isArray(row.items) && row.items.some((item) => item.orderNo === orderNo),
  );
}

async function createSalesUser(t, suffix) {
  const email = `${suffix}-sales@example.com`;
  const password = 'Sales@2026!';
  await t.createUser({
    email,
    password,
    role: 'SALES',
    name: `Uploaded Asset ${suffix}`,
  });
  return { email, password };
}

async function uploadReceiptDirectImage(t, filePath) {
  return t.request('POST', '/api/upload-image', {
    form: {
      action: 'upload',
      category: 'receipt-direct',
      file: {
        filePath,
        filename: 'receipt-direct.png',
        contentType: 'image/png',
      },
    },
    expectedStatus: 200,
  });
}

async function recognizeReceiptImage(t, filePath) {
  return t.request('POST', '/api/receipt', {
    form: {
      action: 'recognize',
      file: {
        filePath,
        filename: 'receipt-ocr.png',
        contentType: 'image/png',
      },
    },
    expectedStatus: 200,
  });
}

async function recognizeDetailImage(t, filePath) {
  return t.request('POST', '/api/detail', {
    form: {
      action: 'recognize',
      file: {
        filePath,
        filename: 'detail-ocr.png',
        contentType: 'image/png',
      },
    },
    expectedStatus: 200,
  });
}

async function recognizeSwiftImage(t, filePath) {
  return t.request('POST', '/api/swift', {
    form: {
      action: 'recognize',
      file: {
        filePath,
        filename: 'swift-ocr.png',
        contentType: 'image/png',
      },
    },
    expectedStatus: 200,
  });
}

async function createReceiptDirectly(t, payload) {
  return t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: payload.receiptNo,
      usd: payload.usd,
      orderNo: payload.orderNo,
      invNo: payload.invNo,
      customerMark: payload.customerMark,
      customerName: payload.customerName,
      imagePath: payload.imagePath,
      imageName: payload.imageName,
    },
    expectedStatus: 200,
  });
}

export default async function run(t) {
  const prisma = new PrismaClient();

  try {
    await t.initAdmin();
    await t.loginAdmin();

    const suffix = t.unique('asset');
    const sales = await createSalesUser(t, suffix);
    await t.logout();
    await t.login(sales.email, sales.password);

    const salesUser = await prisma.user.findUnique({
      where: { email: sales.email },
      select: { id: true },
    });
    assert.ok(salesUser?.id, 'sales user exists');

    const filePath = t.writeTempFile(`uploaded-asset-${suffix}.png`, Buffer.from(PNG_BASE64, 'base64'));

    const directUpload = await uploadReceiptDirectImage(t, filePath);
    const directUploadPath = directUpload.data?.data?.path;
    assert.ok(directUploadPath, 'direct upload returns image path');
    const stagedDirectAssets = await prisma.uploadedAsset.findMany({
      where: {
        path: directUploadPath,
        status: 'STAGED',
        category: 'RECEIPT_DIRECT',
        createdBy: salesUser.id,
      },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(stagedDirectAssets.length, 1);
    t.step('direct upload registers staged uploaded asset');

    const directReceiptCreate = await createReceiptDirectly(t, {
      receiptNo: `RCPT-${suffix}-DIRECT`,
      usd: 120,
      orderNo: `${suffix}-DIRECT-01`,
      invNo: 'L25MH071089C',
      customerMark: `${suffix}-DIRECT`,
      customerName: `${suffix}-DIRECT`,
      imagePath: stagedDirectAssets[0].path,
      imageName: stagedDirectAssets[0].name,
    });
    const directReceiptId = directReceiptCreate.data?.data?.id;
    assert.ok(directReceiptId, 'direct create returns receipt id');

    const attachedDirectAsset = await prisma.uploadedAsset.findFirst({
      where: { path: stagedDirectAssets[0].path },
    });
    assert.equal(attachedDirectAsset?.status, 'ATTACHED');
    assert.equal(attachedDirectAsset?.attachedType, 'RECEIPT');
    assert.equal(attachedDirectAsset?.attachedId, directReceiptId);
    t.step('direct-create receipt attaches staged uploaded asset');

    const receiptRecognize = await recognizeReceiptImage(t, filePath);
    const receiptImagePath = receiptRecognize.data?.data?.image?.path;
    assert.ok(receiptImagePath, 'receipt OCR returns image path');
    const stagedReceiptOcrAsset = await prisma.uploadedAsset.findFirst({
      where: {
        path: receiptImagePath,
        status: 'STAGED',
        category: 'RECEIPT_OCR',
      },
    });
    assert.ok(stagedReceiptOcrAsset, 'receipt OCR upload is staged');
    t.step('receipt OCR recognize registers staged asset');

    const receiptConfirm = await t.request('POST', '/api/receipt', {
      json: {
        action: 'confirm',
        receiptNo: `RCPT-${suffix}-OCR`,
        usd: 180,
        orderNo: `${suffix}-OCR-01`,
        invNo: 'L25MH071089D',
        customerMark: `${suffix}-OCR`,
        customerName: `${suffix}-OCR`,
        imagePath: stagedReceiptOcrAsset.path,
        imageName: stagedReceiptOcrAsset.name,
      },
      expectedStatus: 200,
    });
    const receiptId = receiptConfirm.data?.data?.id;
    assert.ok(receiptId, 'receipt confirm returns receipt id');

    const attachedReceiptOcrAsset = await prisma.uploadedAsset.findFirst({ where: { path: stagedReceiptOcrAsset.path } });
    assert.equal(attachedReceiptOcrAsset?.status, 'ATTACHED');
    assert.equal(attachedReceiptOcrAsset?.attachedType, 'RECEIPT');
    assert.equal(attachedReceiptOcrAsset?.attachedId, receiptId);
    t.step('receipt OCR confirm attaches staged asset');

    const detailRecognize = await recognizeDetailImage(t, filePath);
    const detailImagePath = detailRecognize.data?.data?.image?.path;
    assert.ok(detailImagePath, 'detail OCR returns image path');
    const stagedDetailOcrAsset = await prisma.uploadedAsset.findFirst({
      where: {
        path: detailImagePath,
        status: 'STAGED',
        category: 'DETAIL_OCR',
      },
    });
    assert.ok(stagedDetailOcrAsset, 'detail OCR upload is staged');
    t.step('detail OCR recognize registers staged asset');

    const detailOrderNo = `${suffix}-DETAIL-01`;
    const detailConfirm = await t.request('POST', '/api/detail', {
      json: {
        action: 'confirm',
        date: '2026-04-30',
        items: [{ mark: `${suffix}-DETAIL`, orderNo: detailOrderNo, amount: 260 }],
        imagePath: stagedDetailOcrAsset.path,
        imageName: stagedDetailOcrAsset.name,
      },
      expectedStatus: 200,
    });
    const detailId = detailConfirm.data?.data?.id;
    assert.ok(detailId, 'detail confirm returns detail id');

    const attachedDetailOcrAsset = await prisma.uploadedAsset.findFirst({ where: { path: stagedDetailOcrAsset.path } });
    assert.equal(attachedDetailOcrAsset?.status, 'ATTACHED');
    assert.equal(attachedDetailOcrAsset?.attachedType, 'DETAIL');
    assert.equal(attachedDetailOcrAsset?.attachedId, detailId);
    t.step('detail OCR confirm attaches staged asset');

    const detailList = await t.request('GET', `/api/detail?search=${encodeURIComponent(detailOrderNo)}`, { expectedStatus: 200 });
    const createdDetail = findDetailByOrder(detailList.data?.data, detailOrderNo);
    assert.ok(createdDetail?.id, 'detail exists for swift OCR confirm');

    const swiftRecognize = await recognizeSwiftImage(t, filePath);
    const swiftImagePath = swiftRecognize.data?.data?.image?.path;
    assert.ok(swiftImagePath, 'swift OCR returns image path');
    const stagedSwiftOcrAsset = await prisma.uploadedAsset.findFirst({
      where: {
        path: swiftImagePath,
        status: 'STAGED',
        category: 'SWIFT_OCR',
      },
    });
    assert.ok(stagedSwiftOcrAsset, 'swift OCR upload is staged');
    t.step('swift OCR recognize registers staged asset');

    const swiftConfirm = await t.request('POST', '/api/swift', {
      json: {
        action: 'confirm',
        detailId: createdDetail.id,
        amount: 260,
        date: '2026-04-30',
        senderName: 'OCR Sender',
        receiverName: 'OCR Receiver',
        imagePath: stagedSwiftOcrAsset.path,
        imageName: stagedSwiftOcrAsset.name,
      },
      expectedStatus: 200,
    });
    const swiftId = swiftConfirm.data?.data?.swift?.id;
    assert.ok(swiftId, 'swift confirm returns swift id');

    const attachedSwiftOcrAsset = await prisma.uploadedAsset.findFirst({ where: { path: stagedSwiftOcrAsset.path } });
    assert.equal(attachedSwiftOcrAsset?.status, 'ATTACHED');
    assert.equal(attachedSwiftOcrAsset?.attachedType, 'SWIFT');
    assert.equal(attachedSwiftOcrAsset?.attachedId, swiftId);
    t.step('swift OCR confirm attaches staged asset');

    await t.logout();
  } finally {
    await prisma.$disconnect();
  }
}
