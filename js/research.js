import {calculateNetwork, travelTimeS, destination} from './physics.js';
import {evaluateArrivals} from './observations.js';

export function modelComparisons(data, params, disabled, observed, predictions) {
  return [['constant','Constant'],['1d','TauP iasp91'],['3d','Tomography 3D']].map(([key,label])=>{
    const arrivals=key==='constant'?null:predictions[key]?.events?.[data.event.id];
    if(key!=='constant'&&!arrivals)return {key,label,available:false,p:null,s:null};
    const network=calculateNetwork(data,params,disabled,arrivals);
    const stats=observed?evaluateArrivals(network.stations,observed):null;
    return {key,label,available:true,p:stats?.p.mae??null,s:stats?.s.mae??null,pN:stats?.p.n??0,sN:stats?.s.n??0};
  });
}

export function timingStages(result, params) {
  if(result.delivered===null || result.kthStation?.p===null || !Number.isFinite(result.kthStation?.p))return [];
  return [
    {key:'travel',label:'P travel',value:result.kthStation.p},
    {key:'detect',label:'Detection',value:params.detectionDelayS},
    {key:'network',label:'Telemetry',value:params.networkDelayS},
    {key:'process',label:'Processing',value:params.processingDelayS},
    {key:'delivery',label:'Delivery',value:params.deliveryDelayS}
  ];
}

export function alertStations(result, count) {
  const relevant=result.stations.filter(s=>s.enabled && s.p!==null && Number.isFinite(s.p));
  return new Set(relevant.slice(0,count).map(s=>s.id));
}

export function topResiduals(validation, count=10) {
  return validation?.comparisons?.filter(x=>Number.isFinite(x.residual)).slice().sort((a,b)=>Math.abs(b.residual)-Math.abs(a.residual)).slice(0,count)??[];
}


export const TEST_STATION_ID='SIM.NEW1';

export function compareStationPlacement(data,params,disabled,location){
  const baseline=calculateNetwork(data,params,disabled);
  const station={id:TEST_STATION_ID,code:'NEW1',latitude:location.latitude,longitude:location.longitude,simulated:true};
  const augmented=calculateNetwork({...data,stations:[...data.stations,station]},params,disabled);
  const k=params.triggersRequired;
  const ordered=result=>result.stations.filter(s=>s.enabled&&Number.isFinite(s.available)).sort((a,b)=>a.available-b.available);
  const old=ordered(baseline), next=ordered(augmented);
  const gap=items=>items.length>k?items[k].available-items[k-1].available:null;
  const beforeGap=gap(old),afterGap=gap(next);
  const custom=augmented.stations.find(s=>s.id===TEST_STATION_ID);
  const rank=next.findIndex(s=>s.id===TEST_STATION_ID)+1;
  const targetStart=old[k-1]??null,targetEnd=old[k]??null;
  const between=!!(custom?.enabled&&targetStart&&targetEnd&&custom.available>targetStart.available&&custom.available<targetEnd.available);
  return {baseline,augmented,old,newOrder:next,custom,rank:custom?.enabled?rank:null,k,
    beforeGap,afterGap,change:beforeGap!==null&&afterGap!==null?beforeGap-afterGap:null,
    deliveryGain:baseline.delivered!==null&&augmented.delivered!==null?baseline.delivered-augmented.delivered:null,
    targetStart,targetEnd,between};
}

export function stationImportance(result, maxK=8) {
  const enabled=result.stations.filter(s=>s.enabled&&Number.isFinite(s.available)).sort((a,b)=>a.available-b.available);
  const thresholds=Array.from({length:Math.min(result.stations.length,Math.max(1,maxK))},(_,i)=>i+1);
  const processing=result.params.processingDelayS;
  const delivery=result.params.deliveryDelayS;
  const rows=result.stations.map(station=>{
    const other=enabled.filter(s=>s.id!==station.id);
    const cells=thresholds.map(k=>{
      const baseline=enabled[k-1];
      if(!station.enabled)return {k,status:'disabled',delta:null};
      if(!Number.isFinite(station.available))return {k,status:'missing',delta:null};
      if(!baseline)return {k,status:'unavailable',delta:null};
      const without=other[k-1];
      if(!without)return {k,status:'lost',delta:null,baseline:baseline.available+processing+delivery,without:null};
      const original=baseline.available+processing+delivery;
      const changed=without.available+processing+delivery;
      const delta=Math.max(0,without.available-baseline.available);
      return {k,status:delta>1e-9?'delay':'unchanged',delta,baseline:original,without:changed};
    });
    return {id:station.id,code:station.code,enabled:station.enabled,available:station.available,cells};
  });
  return {thresholds,rows,currentK:result.params.triggersRequired,activeCount:enabled.length};
}

export function importanceColor(cell) {
  if(!cell||cell.status==='unavailable'||cell.status==='missing')return '#edf0f1';
  if(cell.status==='disabled')return '#e4e6e7';
  if(cell.status==='lost')return '#9b4542';
  const value=cell.delta||0;
  if(value<1e-9)return '#ffffff';
  if(value<.5)return '#d8eaee';
  if(value<1.5)return '#a8d1d9';
  if(value<3)return '#62acbb';
  return '#006d82';
}

export function candidateBounds(data, source, paddingDeg=.45) {
  const lats=[source.latitude,...data.stations.filter(s=>!s.simulated).map(s=>s.latitude),...data.cities.map(c=>c.latitude)];
  const lons=[source.longitude,...data.stations.filter(s=>!s.simulated).map(s=>s.longitude),...data.cities.map(c=>c.longitude)];
  return {
    minLat:Math.max(-85,Math.min(...lats)-paddingDeg),
    maxLat:Math.min(85,Math.max(...lats)+paddingDeg),
    minLon:Math.max(-180,Math.min(...lons)-paddingDeg),
    maxLon:Math.min(180,Math.max(...lons)+paddingDeg)
  };
}

const candidatePalette=[
  [27,55,157],
  [24,108,215],
  [16,197,218],
  [51,203,102],
  [250,218,49],
  [255,139,37],
  [224,51,45]
];

export function candidateGainColor(cell,maxGain=1,opacity=1){
  if(!cell)return `rgba(160,165,174,${opacity})`;
  if(cell.status==='recover')return `rgba(153,68,205,${opacity})`;
  if(cell.status==='none')return `rgba(135,141,155,${opacity})`;
  const ratio=Math.max(0,Math.min(1,(cell.gain||0)/(maxGain>0?maxGain:1)));
  const position=ratio*(candidatePalette.length-1);
  const index=Math.min(candidatePalette.length-2,Math.floor(position));
  const t=position-index;
  const rgb=candidatePalette[index].map((v,i)=>Math.round(v+(candidatePalette[index+1][i]-v)*t));
  return `rgba(${rgb.join(',')},${opacity})`;
}

export function candidateCellColor(cell,maxGain=1){
  return candidateGainColor(cell,maxGain,1);
}

const marginPaletteNegative=[[27,55,157],[18,108,212],[18,194,214],[238,249,251]];
const marginPalettePositive=[[250,250,239],[250,212,47],[255,132,28],[220,44,42]];

function mixColor(stops,fraction){
  const v=Math.max(0,Math.min(1,fraction))*(stops.length-1);
  const k=Math.min(stops.length-2,Math.floor(v));
  return stops[k].map((a,i)=>Math.round(a+(stops[k+1][i]-a)*(v-k)));
}

export function candidateMarginColor(cell,minMargin,maxMargin,opacity=1){
  if(!cell)return `rgba(160,165,174,${opacity})`;
  if(cell.status==='recover')return `rgba(153,68,205,${opacity})`;
  if(cell.status==='none'||!Number.isFinite(cell.margin))return `rgba(135,141,155,${opacity})`;
  const x=cell.margin;
  const rgb=x>=0?mixColor(marginPalettePositive,maxMargin>0?x/maxMargin:0):mixColor(marginPaletteNegative,minMargin<0?(x-minMargin)/(-minMargin):1);
  return `rgba(${rgb.join(',')},${opacity})`;
}

export function applyCandidateMetric(grid,metric='gain'){
  if(!grid)return null;
  for(const cell of grid.cells){
    cell.overlayColor=metric==='margin'?candidateMarginColor(cell,grid.minMargin,grid.maxMargin,.82):candidateGainColor(cell,grid.maxGain,cell.status==='gain'?.82:.48);
  }
  grid.metric=metric;
  return grid;
}

export function scenarioSources(center, mode='single', radiusKm=35) {
  if(mode!=='regional'||radiusKm<=0)return [{...center}];
  const sources=[{...center}];
  for(const [distance,number,offset] of [[radiusKm*.52,8,11.25],[radiusKm*.88,12,0]]){
    for(let i=0;i<number;i++){
      const point=destination(center.latitude,center.longitude,offset+360*i/number,distance);
      sources.push({...center,latitude:point.latitude,longitude:point.longitude,id:`scenario-${sources.length}`});
    }
  }
  return sources;
}

export function candidateStationMap(data, params, disabled, source, stepDeg=.1, options={}) {
  const mode=options.mode==='regional'?'regional':'single';
  const radiusKm=Number.isFinite(options.radiusKm)?Math.max(0,options.radiusKm):35;
  const sourceData={...data,event:{...source,id:source.id??'manual',magnitude:source.magnitude??data.event.magnitude,originUTC:source.originUTC??data.event.originUTC}};
  const baseline=calculateNetwork(sourceData,params,disabled);
  const center=sourceData.event;
  const sources=scenarioSources(center,mode,radiusKm);
  const scenarios=sources.map(s=>{
    const network=calculateNetwork({...data,event:s},params,disabled);
    const active=network.stations.filter(st=>st.enabled&&Number.isFinite(st.available)).sort((a,b)=>a.available-b.available);
    const kth=params.triggersRequired;
    return {source:s,available:active.length,previous:kth>1?active[kth-2]?.available??null:-Infinity,kth:active[kth-1]?.available??null};
  });
  const bounds=candidateBounds(data,center);
  const cells=[];
  const detection=params.detectionDelayS+params.networkDelayS;
  const kth=params.triggersRequired;
  const cols=Math.max(1,Math.round((bounds.maxLon-bounds.minLon)/stepDeg)+1);
  const rows=Math.max(1,Math.round((bounds.maxLat-bounds.minLat)/stepDeg)+1);
  for(let r=0;r<rows;r++){
    const lat=Number((bounds.maxLat-r*stepDeg).toFixed(6));
    for(let c=0;c<cols;c++){
      const lon=Number((bounds.minLon+c*stepDeg).toFixed(6));
      let sum=0,positive=0,valid=0,recover=0,unavailable=0,marginSum=0,marginCount=0;
      let p=null,available=null,rank=null,delivered=null;
      for(let j=0;j<scenarios.length;j++){
        const scenario=scenarios[j];
        const travel=travelTimeS(scenario.source,{latitude:lat,longitude:lon},params.vpKmS);
        const arrival=travel+detection;
        if(j===0){
          p=travel;available=arrival;
          rank=baseline.stations.filter(st=>st.enabled&&Number.isFinite(st.available)&&st.available<=arrival).length+1;
        }
        if(scenario.kth===null){
          if(scenario.available+1===kth)recover++;
          else unavailable++;
          continue;
        }
        if(scenario.previous===null){unavailable++;continue;}
        marginSum+=scenario.kth-arrival;marginCount++;
        const gain=Math.max(0,scenario.kth-Math.max(scenario.previous,Math.min(arrival,scenario.kth)));
        sum+=gain;valid++;
        if(gain>1e-9)positive++;
        if(j===0)delivered=(scenario.kth-gain)+params.processingDelayS+params.deliveryDelayS;
      }
      let status='nochange',gain=valid?sum/valid:null;
      if(valid===0)status=recover>0?'recover':'none';
      else if(gain>1e-9)status='gain';
      cells.push({lat,lon,p,available,rank,delivered,gain,margin:marginCount?marginSum/marginCount:null,status,stepDeg,positiveFraction:valid?positive/valid:0,validScenarios:valid});
    }
  }
  const maxGain=Math.max(0,...cells.map(cell=>cell.gain||0));
  const margins=cells.map(cell=>cell.margin).filter(Number.isFinite);
  const minMargin=margins.length?Math.min(...margins):0;
  const maxMargin=margins.length?Math.max(...margins):0;
  const top=cells.filter(cell=>cell.status==='gain').sort((a,b)=>b.gain-a.gain||b.positiveFraction-a.positiveFraction||a.rank-b.rank).slice(0,8);
  return applyCandidateMetric({source:center,baseline,bounds,stepDeg,rows,cols,cells,top,maxGain,minMargin,maxMargin,coverage:`${rows} × ${cols}`,mode,radiusKm,scenarios:sources.length},'gain');
}
