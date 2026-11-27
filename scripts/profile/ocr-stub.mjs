import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs';
function jpegSize(b) {
  assert.equal(b.readUInt16BE(0), 0xffd8);
  for (let p=2; p+9<b.length;) {
    assert.equal(b[p++],255); const marker=b[p++];
    if ([0xc0,0xc1,0xc2].includes(marker)) return [b.readUInt16BE(p+5),b.readUInt16BE(p+3)];
    p+=b.readUInt16BE(p);
  }
  throw Error('Missing JPEG frame');
}
// This service is reachable only on the disposable internal test network.
http.createServer(async (req,res)=>{
  try {
    assert.equal(req.method,'POST');
    const chunks=[]; for await (const c of req) chunks.push(c);
    const body=Buffer.concat(chunks);
    if(req.url==='/v1/files/parser/sync') {
      assert(body.includes(Buffer.from('%PDF-')));
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'succeeded',content:'Fixture transfer: USD 10.'}));return;
    }
    const json=JSON.parse(body), blocks=json.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]);
    const img=blocks.find(v=>v.type==='image_url')?.image_url?.url;
    if (img?.startsWith('data:image/jpeg;base64,')) {
      const bytes=Buffer.from(img.split(',')[1],'base64'), size=jpegSize(bytes);
      assert.deepEqual(size,[1600,1200]); fs.appendFileSync('/metrics/ocr.jsonl',JSON.stringify({bytes:bytes.length,size})+'\n');
    }
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({receiptNo:'PROFILE-OCR',orderNo:'PROFILEMARK-01',usd:10,payer:'Fixture',amount:10})}}],usage:{}}));
  }catch(e){console.error(e.message);res.writeHead(400);res.end('Invalid synthetic request');}
}).listen(8080,'0.0.0.0');
