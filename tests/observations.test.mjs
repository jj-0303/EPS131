import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSTP,normalizeObservations,evaluateArrivals} from '../js/observations.js';
import {calculateNetwork} from '../js/physics.js';
const data=JSON.parse(readFileSync(new URL('../data/ridgecrest-2019.json',import.meta.url)));
const sample='38457511 le 2019/07/06,03:19:53.500 35.7700 -117.5990 8.0 7.1 l 1.0\nCI CLC HHZ -- 35.81574 -117.5975 1469.0 P c. i 1.0 5.44 2.100\nCI CLC HHZ -- 35.81574 -117.5975 1469.0 P c. i 1.0 5.44 2.300\nCI CCC HHE -- 35.52495 -117.3645 512.0 S c. i 1.0 25.2 12.500';
test('import STP picks adjusts origin and deduplicates channels',()=>{
 const parsed=parseSTP(sample,data.event.id,data.stations.map(s=>s.id),data.event.originUTC);
 assert.equal(parsed.observations.length,2);
 const p=parsed.observations.find(s=>s.id==='CI.CLC');
 assert.ok(Math.abs(p.p-2.6)<1e-8);
 const o=normalizeObservations(parsed,data.event.id,data.stations.map(s=>s.id));
 assert.equal(o.size,2);
});
test('real SCEDC header with eq l and arrival offsets',()=>{
 const raw='  38457511 eq  l 2019/07/06,03:19:53.040   35.7695   -117.5993   8.00  7.10  w 0.5\n\tCI    CLC HHZ --   35.8157  -117.5975   775.0 P d. i  0.8    5.14   0.628';
 const observed=parseSTP(raw,data.event.id,data.stations.map(x=>x.id),data.event.originUTC);
 assert.equal(observed.observations.length,1);
 assert.ok(Math.abs(observed.observations[0].p-0.668)<1e-8);
});
test('no matching header throws',()=>assert.throws(()=>parseSTP(sample.replace('38457511 le','10000000 le'),data.event.id,data.stations.map(s=>s.id),data.event.originUTC)));
test('validation computes signed residual and MAE',()=>{
 const m=new Map([['CI.CLC',{p:2,s:5}],['CI.CCC',{p:7}]]);
 const r=evaluateArrivals(calculateNetwork(data,data.model).stations,m);
 assert.equal(r.p.n,2);assert.equal(r.s.n,1);
 const meanAbs=r.comparisons.filter(x=>x.phase==='p').reduce((a,b)=>a+Math.abs(b.residual),0)/2;
 assert.ok(Math.abs(r.p.mae-meanAbs)<1e-9);
});
test('empty observations produces null metrics',()=>{
 const r=evaluateArrivals(calculateNetwork(data,data.model).stations,new Map());
 assert.equal(r.p.mae,null);assert.equal(r.s.n,0);
});

test('missing model arrival does not create a fictitious residual',()=>{
 const obs=new Map([['CI.CLC',{p:0.7,s:2.4}]]);
 const rows=evaluateArrivals([{id:'CI.CLC',p:null,s:null,distanceKm:3}],obs);
 assert.equal(rows.p.n,0);assert.equal(rows.s.n,0);
});
