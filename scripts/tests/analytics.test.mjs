import test from 'node:test';import assert from 'node:assert/strict';import {timeBuckets,depthBuckets} from '../../apps/web/src/lib/analytics.ts';
const events=['2026-10-01T12:00:00Z','2026-10-03T12:00:00Z','2026-10-10T12:00:00Z'].map((ocurrido_en,i)=>({id:String(i),ocurrido_en,profundidad:i*25}));
test('Temporal aggregation retains zero buckets, respects bounds and conserves the sample',()=>{
 for(const group of ['dia','semana','mes']){const rows=timeBuckets(events,'2026-10-24T12:00:00Z',30,group);assert.equal(rows.reduce((s,r)=>s+r.value,0),3)}
 const rows=timeBuckets(events,'2026-10-24T12:00:00Z',30,'dia','2026-10-03','2026-10-10');assert.equal(rows.reduce((s,r)=>s+r.value,0),2);assert.equal(rows.length,8);assert.ok(rows.some(r=>r.value===0));
 assert.equal(depthBuckets(events,25).reduce((s,r)=>s+r.value,0),3)
});
