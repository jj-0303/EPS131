import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {modelComparisons,timingStages,alertStations,topResiduals,stationImportance,importanceColor,candidateStationMap,scenarioSources,applyCandidateMetric,candidateMarginColor ,compareStationPlacement,TEST_STATION_ID} from '../js/research.js';
import {calculateNetwork,destination} from '../js/physics.js';
import {normalizeObservations} from '../js/observations.js';
const events=JSON.parse(readFileSync(new URL('../data/events.json',import.meta.url)));
const one=JSON.parse(readFileSync(new URL('../data/models-1d.json',import.meta.url)));
const three=JSON.parse(readFileSync(new URL('../data/models-3d.json',import.meta.url)));
const picks=JSON.parse(readFileSync(new URL('../data/observations/ci38457511.json',import.meta.url)));
const data={...events,event:events.events[0]};
const obs=normalizeObservations(picks,data.event.id,data.stations.map(s=>s.id));

test('comparison returns three measured-model entries',()=>{
 const list=modelComparisons(data,data.model,new Set(),obs,{"1d":one,"3d":three});
 assert.equal(list.length,3);
 assert.equal(list[0].available,true);
 assert.ok(Math.abs(list[0].p-.2437)<.002);
 assert.ok(Math.abs(list[1].s-1.03535)<.003);
 assert.ok(Math.abs(list[2].s-.7115)<.005);
});

test('absent model is marked unavailable rather than replaced',()=>{
 const list=modelComparisons(data,data.model,new Set(),obs,{});
 assert.equal(list[1].available,false);assert.equal(list[1].p,null);
 assert.equal(list[2].available,false);assert.equal(list[2].s,null);
});

test('timing segments exactly sum to delivered time',()=>{
 const result=calculateNetwork(data,data.model);
 const stages=timingStages(result,data.model);
 assert.equal(stages.length,5);
 assert.ok(Math.abs(stages.reduce((s,x)=>s+x.value,0)-result.delivered)<1e-8);
});

test('no alert produces an empty timing breakdown',()=>{
 const result=calculateNetwork(data,data.model,new Set(data.stations.map(s=>s.id)));
 assert.deepEqual(timingStages(result,data.model),[]);
});

test('contributing stations match the trigger threshold',()=>{
 const result=calculateNetwork(data,data.model);
 const active=alertStations(result,4);
 assert.equal(active.size,4);
 assert.ok(active.has(result.kthStation.id));
});

test('largest residuals are sorted by absolute magnitude',()=>{
 const list=topResiduals({comparisons:[{residual:1},{residual:-6},{residual:2}]},2);
 assert.deepEqual(list.map(x=>x.residual),[-6,2]);
});

test('station importance reports observed fourth-station delivery shift',()=>{
 const result=calculateNetwork(data,data.model);
 const matrix=stationImportance(result,8);
 assert.equal(matrix.thresholds.length,8);
 const row=matrix.rows.find(r=>r.id==='CI.CLC');
 const fourth=row.cells.find(c=>c.k===4);
 assert.equal(fourth.status,'delay');
 const expected=calculateNetwork(data,data.model,new Set(['CI.CLC'])).delivered-result.delivered;
 assert.ok(Math.abs(fourth.delta-expected)<1e-9);
 assert.ok(Math.abs(fourth.delta-1.578)<.005);
 assert.equal(matrix.rows.length,15);
});

test('station importance marks loss of alert if fewer than k remain',()=>{
 const matrix=stationImportance(calculateNetwork(data,{...data.model,triggersRequired:15}),15);
 assert.ok(matrix.rows.every(row=>row.cells[14].status==='lost'));
 const inactive=stationImportance(calculateNetwork(data,{...data.model,triggersRequired:4},new Set(['CI.CLC'])),8);
 assert.equal(inactive.rows.find(r=>r.id==='CI.CLC').cells[3].status,'disabled');
});

test('station importance does not invent times when no baseline alert',()=>{
 const matrix=stationImportance(calculateNetwork(data,data.model,new Set(data.stations.map(s=>s.id))),8);
 assert.ok(matrix.rows.every(row=>row.cells.every(cell=>cell.delta===null)));
});

test('station impact shift is independent of common delivery latency',()=>{
 const a=stationImportance(calculateNetwork(data,data.model),8);
 const b=stationImportance(calculateNetwork(data,{...data.model,deliveryDelayS:15}),8);
 for(let i=0;i<a.rows.length;i++)for(let k=0;k<8;k++){
   assert.equal(a.rows[i].cells[k].status,b.rows[i].cells[k].status);
   assert.equal(a.rows[i].cells[k].delta,b.rows[i].cells[k].delta);
 }
});

test('3D station impact responds to event and threshold changes',()=>{
 const events=JSON.parse(readFileSync(new URL('../data/events.json',import.meta.url)));
 const second={...events,event:events.events[1]};
 const model=JSON.parse(readFileSync(new URL('../data/models-3d.json',import.meta.url)));
 const a=stationImportance(calculateNetwork(data,data.model,new Set(),model.events[data.event.id]),8);
 const b=stationImportance(calculateNetwork(second,second.model,new Set(),model.events[second.event.id]),8);
 assert.ok(a.rows.some((row,i)=>row.cells[3].delta!==b.rows[i].cells[3].delta));
 assert.ok(a.rows.some(row=>row.cells[3].status==='delay'));
});


test('candidate station map finds positive-gain cells near the source',()=>{
 const grid=candidateStationMap(data,data.model,new Set(),data.event,.14);
 assert.ok(grid.cells.length>100);
 assert.ok(grid.top.length>0);
 assert.ok(grid.top[0].gain>0);
 assert.ok(grid.top[0].rank<=data.model.triggersRequired);
});

test('candidate station map responds to manual source depth and location',()=>{
 const a=candidateStationMap(data,data.model,new Set(),{latitude:data.event.latitude,longitude:data.event.longitude,depthKm:4},.14);
 const b=candidateStationMap(data,data.model,new Set(),{latitude:data.event.latitude+.25,longitude:data.event.longitude-.2,depthKm:18},.14);
 assert.notEqual(a.top[0].lat,b.top[0].lat);
 assert.notEqual(a.top[0].lon,b.top[0].lon);
});

test('candidate heatmap gains are mapped to the full color scale',()=>{
 const grid=candidateStationMap(data,data.model,new Set(),data.event,.055);
 assert.ok(grid.maxGain>0);
 assert.ok(grid.cells.some(cell=>cell.status==='nochange'&&cell.overlayColor==='rgba(27,55,157,0.48)'));
 assert.ok(grid.cells.some(cell=>cell.status==='gain'&&Math.abs(cell.gain-grid.maxGain)<1e-9&&cell.overlayColor==='rgba(224,51,45,0.82)'));
});

test('candidate map value scale updates with the earthquake event',()=>{
 const second={...events,event:events.events[1]};
 const a=candidateStationMap(data,data.model,new Set(),data.event,.055);
 const b=candidateStationMap(second,second.model,new Set(),second.event,.055);
 assert.notEqual(a.maxGain,b.maxGain);
 assert.equal(a.cells.filter(cell=>cell.status==='gain').every(cell=>cell.gain>0),true);
});


test('single-source candidate plateau follows kth-minus-previous arrival gap',()=>{
 const g=candidateStationMap(data,data.model,new Set(),data.event,.055,{mode:'single'});
 const times=g.baseline.stations.filter(s=>s.enabled).map(s=>s.available).sort((a,b)=>a-b);
 const k=data.model.triggersRequired;
 assert.ok(Math.abs(g.maxGain-(times[k-1]-times[k-2]))<1e-9);
 assert.ok(g.cells.filter(c=>c.gain!==null&&Math.abs(c.gain-g.maxGain)<1e-4).length>8);
});

test('regional ensemble yields varied actual gains and is deterministic',()=>{
 const s=scenarioSources(data.event,'regional',35);
 assert.equal(s.length,21);
 const a=candidateStationMap(data,data.model,new Set(),data.event,.055,{mode:'regional',radiusKm:35});
 const b=candidateStationMap(data,data.model,new Set(),data.event,.055,{mode:'regional',radiusKm:35});
 assert.equal(a.scenarios,21);
 assert.deepEqual(a.top.slice(0,4),b.top.slice(0,4));
 assert.ok(new Set(a.cells.map(c=>(c.gain??-1).toFixed(3))).size>35);
 assert.ok(a.cells.some(c=>c.positiveFraction>0&&c.positiveFraction<1));
});

test('regional map responds to source radius and uses common latency cancellation',()=>{
 const a=candidateStationMap(data,data.model,new Set(),data.event,.1,{mode:'regional',radiusKm:20});
 const b=candidateStationMap(data,data.model,new Set(),data.event,.1,{mode:'regional',radiusKm:50});
 const later=candidateStationMap(data,{...data.model,deliveryDelayS:data.model.deliveryDelayS+9},new Set(),data.event,.1,{mode:'regional',radiusKm:20});
 assert.notEqual(a.maxGain,b.maxGain);
 assert.deepEqual(a.cells.map(c=>c.gain),later.cells.map(c=>c.gain));
});


test('trigger margin continues varying inside actual gain plateau',()=>{
 const grid=candidateStationMap(data,data.model,new Set(),data.event,.035,{mode:'single'});
 const plateau=grid.cells.filter(c=>c.gain!==null&&Math.abs(c.gain-grid.maxGain)<1e-8);
 assert.ok(plateau.length>10);
 assert.ok(Math.max(...plateau.map(c=>c.margin))-Math.min(...plateau.map(c=>c.margin))>.2);
 const oldGains=grid.cells.map(c=>c.gain);
 applyCandidateMetric(grid,'margin');
 assert.ok(grid.cells.some(c=>c.overlayColor!==candidateMarginColor(c,grid.minMargin,grid.maxMargin,.82))===false);
 assert.deepEqual(grid.cells.map(c=>c.gain),oldGains);
});

test('regional margin reflects deterministic source ensemble',()=>{
 const regional=candidateStationMap(data,data.model,new Set(),data.event,.1,{mode:'regional',radiusKm:35});
 const single=candidateStationMap(data,data.model,new Set(),data.event,.1,{mode:'single'});
 assert.equal(regional.scenarios,21);
 assert.notDeepEqual(regional.cells.map(c=>c.margin),single.cells.map(c=>c.margin));
 assert.ok(regional.minMargin<0);
 assert.ok(regional.maxMargin>0);
});


test('right-click hypothetical station between kth and k+1 reduces removal penalty without earlier delivery',()=>{
 const baseline=calculateNetwork(data,data.model);
 const k=data.model.triggersRequired;
 const old=baseline.stations.filter(s=>s.enabled&&Number.isFinite(s.available));
 const d=(old[k-1].distanceKm+old[k].distanceKm)/2;
 const loc=destination(data.event.latitude,data.event.longitude,90,d);
 const comparison=compareStationPlacement(data,data.model,new Set(),loc);
 assert.equal(comparison.between,true);
 assert.ok(comparison.rank===k+1);
 assert.ok(comparison.beforeGap>comparison.afterGap);
 assert.ok(comparison.change>0);
 assert.ok(Math.abs(comparison.deliveryGain)<1e-9);
 assert.ok(Math.abs(comparison.beforeGap-(old[k].available-old[k-1].available))<1e-9);
 assert.equal(comparison.augmented.stations.length,16);
 assert.equal(comparison.custom.id,TEST_STATION_ID);
 const importance=stationImportance(comparison.augmented,16);
 const originalFourth=importance.rows.find(x=>x.id===old[k-1].id).cells[k-1];
 assert.ok(Math.abs(originalFourth.delta-comparison.afterGap)<1e-9);
});

test('disabled hypothetical site restores original removal sensitivity',()=>{
 const baseline=calculateNetwork(data,data.model);
 const k=data.model.triggersRequired;
 const old=baseline.stations.filter(s=>s.enabled&&Number.isFinite(s.available));
 const loc=destination(data.event.latitude,data.event.longitude,135,(old[k-1].distanceKm+old[k].distanceKm)/2);
 const experiment=compareStationPlacement(data,data.model,new Set([TEST_STATION_ID]),loc);
 assert.equal(experiment.custom.enabled,false);
 assert.equal(experiment.rank,null);
 assert.equal(experiment.between,false);
 assert.ok(Math.abs(experiment.afterGap-experiment.beforeGap)<1e-9);
 assert.ok(Math.abs(experiment.change)<1e-9);
});

test('placing a hypothetical station outside arrival band does not automatically reduce sensitivity',()=>{
 const baseline=calculateNetwork(data,data.model);
 const old=baseline.stations.filter(s=>s.enabled&&Number.isFinite(s.available));
 const far=destination(data.event.latitude,data.event.longitude,45,old[5].distanceKm+90);
 const experiment=compareStationPlacement(data,data.model,new Set(),far);
 assert.equal(experiment.between,false);
 assert.ok(Math.abs(experiment.afterGap-experiment.beforeGap)<1e-9);
 assert.ok(Math.abs(experiment.deliveryGain)<1e-9);
});

test('removal gap is undefined rather than zero when no replacement station exists',()=>{
 const experiment=compareStationPlacement(data,{...data.model,triggersRequired:15},new Set(),{latitude:data.event.latitude,longitude:data.event.longitude});
 assert.equal(experiment.beforeGap,null);
 assert.ok(Number.isFinite(experiment.afterGap));
 assert.equal(experiment.change,null);
});

test('added station changes the candidate gain map and removal analysis on the same network',()=>{
 const manual={id:TEST_STATION_ID,code:'NEW1',latitude:data.event.latitude,longitude:data.event.longitude,simulated:true};
 const enhanced={...data,stations:[...data.stations,manual]};
 const original=candidateStationMap(data,data.model,new Set(),data.event,.1,{mode:'regional',radiusKm:35});
 const updated=candidateStationMap(enhanced,data.model,new Set(),data.event,.1,{mode:'regional',radiusKm:35});
 assert.equal(original.cells.length,updated.cells.length);
 assert.ok(Math.abs(original.maxGain-updated.maxGain)>.01);
 const importance=stationImportance(calculateNetwork(enhanced,data.model),16);
 assert.equal(importance.rows.length,16);
 assert.ok(importance.rows.some(row=>row.id===TEST_STATION_ID));
});

test('disabling added station restores the original candidate placement results',()=>{
 const manual={id:TEST_STATION_ID,code:'NEW1',latitude:data.event.latitude,longitude:data.event.longitude,simulated:true};
 const enhanced={...data,stations:[...data.stations,manual]};
 for(const mode of ['single','regional']){
  const baseline=candidateStationMap(data,data.model,new Set(),data.event,.1,{mode,radiusKm:35});
  const disabledNew=candidateStationMap(enhanced,data.model,new Set([TEST_STATION_ID]),data.event,.1,{mode,radiusKm:35});
  assert.deepEqual(baseline.cells.map(c=>c.gain),disabledNew.cells.map(c=>c.gain));
 }
});

test('distant added station never expands candidate map bounds unexpectedly',()=>{
 const manual={id:TEST_STATION_ID,code:'NEW1',latitude:42,longitude:-122,simulated:true};
 const enhanced={...data,stations:[...data.stations,manual]};
 const baseline=candidateStationMap(data,data.model,new Set(),data.event,.1);
 const augmented=candidateStationMap(enhanced,data.model,new Set(),data.event,.1);
 assert.equal(augmented.cols,baseline.cols);
 assert.equal(augmented.rows,baseline.rows);
});
