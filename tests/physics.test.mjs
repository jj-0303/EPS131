import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {haversineKm,travelTimeS,surfaceWavefrontRadiusKm,destination,calculateNetwork} from '../js/physics.js';
const data=JSON.parse(readFileSync(new URL('../data/ridgecrest-2019.json',import.meta.url)));
test('haversine self distance zero',()=>assert.equal(haversineKm(35,-118,35,-118),0));
test('haversine 1 degree at equator about 111 km',()=>assert.ok(Math.abs(haversineKm(0,0,0,1)-111.195)<0.01));
test('source-to-surface travel respects 8km depth',()=>{
 const t=travelTimeS(data.event,data.event,6);
 assert.ok(Math.abs(t-8/6)<1e-10);
});
test('surface wavefront starts after depth/v',()=>{
 assert.equal(surfaceWavefrontRadiusKm(1,8,6),null);
 assert.equal(surfaceWavefrontRadiusKm(8/6,8,6),0);
 assert.ok(Math.abs(surfaceWavefrontRadiusKm(2,8,6)-Math.sqrt(80))<1e-9);
});
test('destination 100km along east is 100km away',()=>{
 const dest=destination(35,-118,90,100);
 assert.ok(Math.abs(haversineKm(35,-118,dest.latitude,dest.longitude)-100)<1e-6);
});
test('all 15 stations sourced from NCEDC',()=>assert.equal(data.stations.length,15));
test('four station issue happens later than fourth P wave',()=>{
 const result=calculateNetwork(data,data.model);
 assert.ok(result.issue > result.kthStation.p);
 assert.ok(result.delivered > result.issue);
 assert.equal(result.triggered,15);
});
test('disable all stations removes alert without fake zero lead time',()=>{
 const result=calculateNetwork(data,data.model,new Set(data.stations.map(x=>x.id)));
 assert.equal(result.issue,null);
 assert.equal(result.delivered,null);
 assert.ok(result.cities.every(x=>x.lead===null));
});
test('greater delivery delay reduces lead by exact delta',()=>{
 const a=calculateNetwork(data,data.model);
 const b=calculateNetwork(data,{...data.model,deliveryDelayS:data.model.deliveryDelayS+4});
 assert.ok(Math.abs((a.cities[0].lead-b.cities[0].lead)-4)<1e-9);
});
test('loaded 1D predictions replace baseline arrivals without mixing missing values',()=>{
 const payload={...data,event:{...data.event,id:'ci38443183',latitude:35.705334,longitude:-117.50383,depthKm:10.5}};
 const predictions={};
 for(const site of [...payload.stations,...payload.cities])predictions[site.id]={p:4,s:7};
 predictions[payload.stations[0].id]={p:null,s:null};
 const result=calculateNetwork(payload,payload.model,new Set(),predictions);
 assert.equal(result.triggered,payload.stations.length-1);
 assert.ok(result.stations.some(x=>x.p===null));
 assert.equal(result.cities[0].s,7);
});
