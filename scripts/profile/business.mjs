import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { PDFDocument, rgb } from 'pdf-lib';
import { chromium } from '@playwright/test';
import { ApiTestContext } from '../../tests/api/isolated/helpers/context.mjs';
import signedReceipt from '../../tests/api/isolated/cases/65-receipt-generator-flow.case.mjs';
import receiptApproval from '../../tests/api/isolated/cases/66-receipt-edit-approval.case.mjs';
const t=new ApiTestContext();
assert.equal(new URL(t.baseUrl).hostname,'127.0.0.1');
const meta=process.env.METRICS_DIR;
const probe=()=>JSON.parse(fs.readFileSync(path.join(meta,'current'),'utf8'));
const phases=[];
async function measure(name,fn){
  const before=probe(),samples=[before];const timer=setInterval(()=>samples.push(probe()),70);
  const start=performance.now(); let elapsed;
  try {await fn();elapsed=performance.now()-start;await delay(180);}finally{clearInterval(timer);}
  const after=probe();samples.push(after);
  assert(samples.every(s=>s.pid===before.pid));
  const data={name,ms:Math.round(elapsed),clients:after.created,sql:after.queries-before.queries,
    peakRss:Math.max(...samples.map(s=>s.rss)),peakCgroup:Math.max(...samples.map(s=>s.cgroup)),afterRss:after.rss,heap:after.heapUsed,external:after.external};
  phases.push(data);console.log('BUSINESS_PHASE '+JSON.stringify(data));
}
await t.loginAdmin();
const folder=t.tmpDir;
try{
  const pixels=Buffer.alloc(4096*3072*3);
  let state=12345;for(let i=0;i<pixels.length;i++){state=(Math.imul(1664525,state)+1013904223)>>>0;pixels[i]=state>>>24;}
  const jpegFile=path.join(folder,'synthetic.jpg');
  await sharp(pixels,{raw:{width:4096,height:3072,channels:3}}).jpeg({quality:70}).toFile(jpegFile);
  const jpeg=fs.readFileSync(jpegFile);assert(jpeg.length<10*1024*1024);
  const form={action:'recognize',file:{filePath:jpegFile,filename:'fixture.jpg',contentType:'image/jpeg'}};
  let image;
  const recognize=async()=>{const r=await t.request('POST','/api/receipt',{form,expectedStatus:200});assert.equal(r.data?.data?.ocrResult?.usd,10);image=r.data.data.image;assert(image?.path);};
  await measure('ocr-first-12MP',recognize);
  await measure('ocr-overlap-2',()=>Promise.all([recognize(),recognize()]));
  assert.equal(fs.readFileSync(path.join(meta,'ocr.jsonl'),'utf8').trim().split('\n').length,3);
  await measure('receipt-attach-and-download',async()=>{
    const r=await t.request('POST','/api/receipt',{json:{action:'confirm',imagePath:image.path,imageName:image.name,receiptNo:'PROFILE-OCR',
      orderNo:'PROFILEMARK-01',usd:10,customerMark:'PROFILEMARK',customerName:'PROFILEMARK'},expectedStatus:200});
    assert(r.data?.success);const got=await fetch(t.baseUrl+'/api/upload-image?'+new URLSearchParams({path:image.path}),{headers:{cookie:t.cookieHeader()}});
    assert.equal(got.status,200);assert.deepEqual(Buffer.from(await got.arrayBuffer()),jpeg);
  });
  await measure('signed-receipt-finalize',()=>signedReceipt(t));
  await t.loginAdmin();
  const xlsx=path.join(folder,'orders.xlsx'), book=new ExcelJS.Workbook(), ws=book.addWorksheet('Orders');
  ws.addRow(['INV_NO','ORDER_NO','AMOUNT','CUSTOMER_MARK','CUSTOMER_ORDER_NAME']);
  for(let i=0;i<1000;i++) ws.addRow(['LOAD-INV-'+Math.floor(i/10),'LOAD-'+String(i+1).padStart(5,'0'),100+i,'PROFILEMARK','PROFILEMARK']);
  await book.xlsx.writeFile(xlsx);
  await measure('xlsx-import-1000-orders',async()=>{
    const r=await t.request('POST','/api/invoice',{form:{action:'import-excel',file:{filePath:xlsx,filename:'orders.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}},expectedStatus:200});
    assert.equal(r.data.rowResults.length,1000);assert(r.data.rowResults.every(x=>x.status==='SUCCESS'));
  });
  let exportBytes=0;
  await measure('xlsx-export-and-read',async()=>{
    const r=await fetch(t.baseUrl+'/api/report?format=excel',{headers:{cookie:t.cookieHeader()}});assert.equal(r.status,200);
    const bytes=Buffer.from(await r.arrayBuffer());exportBytes=bytes.length;const b=new ExcelJS.Workbook();await b.xlsx.load(bytes);
    const s=b.getWorksheet('Invoices');assert(s);let count=0;s.eachRow(r=>{if(String(r.getCell(1).value).startsWith('LOAD-INV-'))count++;});assert.equal(count,100);
  });
  await measure('post-import-dashboard-6',()=>Promise.all(Array.from({length:6},async()=>{
    const r=await t.request('GET','/api/dashboard?action=summary',{expectedStatus:200});assert(r.data.data.invoiceCount>=101);
  })));
  const pdf=await PDFDocument.create();pdf.addPage([300,300]).drawRectangle({x:60,y:60,width:160,height:160,color:rgb(0,0,0.3)});
  const pdfBytes=Buffer.from(await pdf.save());const browser=await chromium.launch({headless:true});
  try{
    await measure('pdf-preview-in-chromium',async()=>{
      const context=await browser.newContext();await context.addCookies(Array.from(t.cookies,([name,value])=>({name,value,url:t.baseUrl})));
      const page=await context.newPage();const failures=[];page.on('pageerror',e=>failures.push(e.message));
      await page.goto(t.baseUrl+'/swifts');await page.getByRole('button',{name:/Upload SWIFT|上传SWIFT/i}).first().click({timeout:20000});
      const dialog=page.getByRole('dialog');await dialog.locator('input[type=file]').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:pdfBytes});
      await page.waitForFunction(()=>{const c=document.querySelector('[role=dialog] [data-page="1"] canvas');if(!c?.width)return false;
        const px=c.getContext('2d').getImageData(c.width>>1,c.height>>1,1,1).data;return px[3]===255 && px[0]<50 && px[2]>40;},{},{timeout:30000});
      assert.deepEqual(failures,[]);await context.close();
    });
  }finally{await browser.close();}
  await measure('approval-finance-with-readers-and-maintenance',async()=>{
    const reviewer=new ApiTestContext();
    try {
      await Promise.all([
        receiptApproval(reviewer),
        ...Array.from({length:4},async()=>{
          for(let i=0;i<4;i++) await t.request('GET','/api/dashboard?action=summary',{expectedStatus:200});
        }),
        t.request('POST','/api/internal/maintenance/uploaded-assets',{headers:{'x-maintenance-token':process.env.MAINTENANCE_JOB_TOKEN},expectedStatus:200})
          .then(r=>assert.ok(r.data?.data?.staleSigningCleanup)),
      ]);
    } finally { reviewer.destroy(); }
  });
  await delay(30000);
  console.log('BUSINESS_RESULT '+JSON.stringify({jpegBytes:jpeg.length,jpegPixels:[4096,3072],xlsxBytes:fs.statSync(xlsx).size,orders:1000,invoices:100,exportBytes,pdfBytes:pdfBytes.length,cooldownSeconds:30,cooled:probe(),phases:phases.length}));
}finally{t.destroy();}
