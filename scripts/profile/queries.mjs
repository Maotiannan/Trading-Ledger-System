import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { ApiTestContext } from '../../tests/api/isolated/helpers/context.mjs';
const t = new ApiTestContext();
assert.equal(new URL(t.baseUrl).hostname, '127.0.0.1');
const file = process.env.METRICS_DIR + '/current';
const snapshot = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const mark = 'PROFILEMARK';
const admin = await t.initAdmin();
assert.equal(admin.status, 200);
const login = await t.loginAdmin();
const cust = await t.request('POST', '/api/customer', { json: { action: 'create', mark, orderName: mark,
  name: 'Synthetic fixture', phone: '2025550147', city: 'Fixture City', ownerId: login.data.data.id }, expectedStatus: 200 });
const orderNo = mark + '-01', now = new Date().toISOString().slice(0,10);
await t.request('POST','/api/invoice',{ json:{invNo:'PROFILE-INV',shipDate:now,releaseDate:now,
  orders:[{orderNo,amount:1200,customerMark:mark,customerName:mark}]},expectedStatus:200 });
const routes = [
  ['dashboard','/api/dashboard?action=summary', j=>j.data?.invoiceCount>=1],
  ['analytics','/api/dashboard/customer-analytics?action=ranking&metric=annual-amount',j=>j.data?.items?.some(x=>x.customerId===cust.data.data.id)],
  ['integration','/api/integrations/mucont/v1/customers/options?q='+mark,j=>j.items?.some(x=>x.customerId===cust.data.data.id)],
];
const get = async ([name,route,check]) => {
  const start=performance.now();
  const r=await t.request('GET',route,{headers: name==='integration'?{authorization:'Bearer '+process.env.MUCONT_CUSTOMERS_READ_TOKEN}:{},expectedStatus:200});
  assert.ok(check(r.data),name+' did not return the seeded row/count');
  return performance.now()-start;
};
await delay(180);
const mainPid=snapshot().pid;
const phases=[];
async function phase(name,run,assertQueries=true){
  const before=snapshot(), samples=[before], timer=setInterval(()=>samples.push(snapshot()),70);
  let durations;
  try { durations=await run(); await delay(160); } finally { clearInterval(timer); }
  const after=snapshot();samples.push(after);
  assert(samples.every(s=>s.pid===mainPid && s.created>=1),'unobserved/different server process');
  if(assertQueries) assert(after.queries>before.queries,name+' did not execute SQL');
  durations.sort((a,b)=>a-b);
  const result={name,requests:durations.length,medianMs:Math.round(durations[Math.floor(durations.length/2)]),p95Ms:Math.round(durations[Math.ceil(durations.length*.95)-1]),queries:after.queries-before.queries,
    clients:after.created,pid:after.pid,peakRss:Math.max(...samples.map(s=>s.rss)),peakCgroup:Math.max(...samples.map(s=>s.cgroup)),afterRss:after.rss};
  phases.push(result);console.log('PROFILE_PHASE '+JSON.stringify(result));
}
for(const r of routes) await phase('first-'+r[0],async()=>[await get(r)]);
await phase('sequential-repeat',async()=>{const times=[];for(let i=0;i<18;i++)times.push(await get(routes[i%3]));return times;});
await phase('concurrent-12',async()=>{const times=[];for(let i=0;i<4;i++)times.push(...await Promise.all(Array.from({length:12},(_,n)=>get(routes[n%3]))));return times;});
console.log('PROFILE_READ_RESULT '+JSON.stringify({mainPid,fixture:{customers:1,invoices:1,orders:1},final:snapshot(),phases:phases.length}));
t.destroy();
