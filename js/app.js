import {calculateNetwork} from './physics.js';
import {EEWMap} from './map.js';
import {parseSTP,normalizeObservations,evaluateArrivals} from './observations.js';
import {modelComparisons,timingStages,alertStations,topResiduals,stationImportance,importanceColor,candidateStationMap,candidateCellColor,applyCandidateMetric,candidateMarginColor,TEST_STATION_ID} from './research.js';

const $=id=>document.getElementById(id);
const settings={vp:['vpKmS',true],vs:['vsKmS',true],'trigger-count':['triggersRequired',false],'detect-delay':['detectionDelayS',false],'network-delay':['networkDelayS',false],'process-delay':['processingDelayS',false],'delivery-delay':['deliveryDelayS',false]};
const phases={p:'P',s:'S'};
const stageColors=['#376f86','#80a6b3','#a9c0c8','#c2a476','#b98067'];
const make=(tag,cls='',value='')=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined&&value!==null)e.textContent=String(value);return e;};
const f2=n=>n===null||n===undefined||!Number.isFinite(n)?'—':n.toFixed(2)+' s';
const signed=n=>n===null||n===undefined||!Number.isFinite(n)?'—':(n>0?'+':'')+n.toFixed(2)+' s';
const polarity=n=>n===null?'':n<0?'negative':'positive';
const candidateSteps={coarse:.10,medium:.055,fine:.035};
let data,defaults,params,results,map,observed=null,validation=null,modelType='constant',modelData={},cases=[],observationsCache={},selectionEpoch=0;
let elapsed=0,playing=false,speed=1,lastFrame=0,selected={kind:'city',id:'ridgecrest'},toastHandle,importance=null;
let candidateGrid=null,manualStation=null,networkData=null;
const candidateState={sourceMode:'event',manual:{latitude:35.705,longitude:-117.505,depthKm:10},stepKey:'medium',analysis:'regional',radiusKm:35,metric:'margin',enabled:true};
const disabled=new Set();

function notify(text,error=false){
  const box=$('toast');box.textContent=text;box.classList.toggle('error',error);box.classList.add('show');
  clearTimeout(toastHandle);toastHandle=setTimeout(()=>box.classList.remove('show'),2800);
}

async function init(){
  try{
    const request=await fetch('./data/events.json',{cache:'no-store'});
    if(!request.ok)throw Error('Event catalog unavailable');
    const collection=await request.json();cases=collection.events;
    data={...collection,event:cases[0]};params={...collection.model};defaults={...params};
    candidateState.manual={latitude:data.event.latitude,longitude:data.event.longitude,depthKm:data.event.depthKm};
    map=new EEWMap($('map'),select);map.data=data;map.selection=selected;
    map.onMapRightClick=placeManualStation;
    map.onCandidateHover=(cell,x,y)=>{
      const tip=$('candidate-pointer');
      if(!cell||!map.candidateEnabled){tip.hidden=true;return;}
      const value=cell.gain===null?'—':`+${cell.gain.toFixed(3)} s`;
      const margin=cell.margin===null?'—':`${cell.margin>=0?'+':''}${cell.margin.toFixed(3)} s`;
      tip.textContent=`${cell.lat.toFixed(3)}, ${cell.lon.toFixed(3)} · Gain ${value} · Margin ${margin}${candidateState.analysis==='regional'?` · ${Math.round(cell.positiveFraction*100)}% improved`:''}`;
      tip.style.left=Math.max(4,Math.min(map.width-250,x+12))+'px';
      tip.style.top=Math.max(4,Math.min(map.height-42,y-40))+'px';
      tip.hidden=false;
    };
    $('candidate-lat').value=String(candidateState.manual.latitude.toFixed(3));
    $('candidate-lon').value=String(candidateState.manual.longitude.toFixed(3));
    $('candidate-depth').value=String(candidateState.manual.depthKm.toFixed(1));
    $('scrubber').max=params.durationS;$('duration-readout').textContent=params.durationS+' s';
    bind();refresh();setElapsed(0);
    $('load-state').textContent='';
    lastFrame=performance.now();requestAnimationFrame(frame);
    await Promise.all([loadPredictions('1d'),loadPredictions('3d')]);
    await loadObservations();
  }catch(error){$('load-state').textContent='Data error';notify(error.message,true);console.error(error);}
}

async function loadPredictions(key){
  try{
    const response=await fetch(`./data/models-${key}.json`,{cache:'no-store'});
    if(!response.ok)return;
    const record=await response.json();
    if(!cases.every(x=>record.events?.[x.id]))return;
    modelData[key]=record;
    const option=$('model-select').querySelector(`option[value="${key}"]`);
    option.disabled=false;option.textContent=key==='1d'?'iasp91 · 1D':'Tomography · 3D';
    if(results)updateComparison();
  }catch(error){console.error(error);}
}

async function loadObservations(){
  const epoch=++selectionEpoch;
  observed=null;validation=null;map.observed=new Map();refresh();
  $('validation-status').textContent='Loading SCEDC picks';
  const id=data.event.id;
  try{
    if(!observationsCache[id]){
      const request=await fetch(`./data/observations/${id}.json`,{cache:'no-store'});
      if(!request.ok)throw Error('Observed picks unavailable');
      observationsCache[id]=await request.json();
    }
    if(epoch!==selectionEpoch)return;
    useObservations(observationsCache[id],'SCEDC');
  }catch(error){
    if(epoch!==selectionEpoch)return;
    $('validation-status').textContent='No observed picks';$('validation-status').classList.add('empty');
    refresh();
  }
}

function useObservations(raw,source){
  observed=normalizeObservations(raw,data.event.id,data.stations.map(x=>x.id));
  map.observed=observed;
  $('validation-status').textContent=`${source} picks`;
  $('validation-status').classList.remove('empty');
  refresh();notify(`${observed.size} stations: observations loaded`);
}

function selectEvent(id){
  const event=cases.find(x=>x.id===id);
  if(!event||event.id===data.event.id)return;
  data={...data,event};map.data=data;selected={kind:'city',id:'ridgecrest'};map.selection=selected;
  $('event-select').value=event.id;map.focus(event.latitude,event.longitude,8);
  if(candidateState.sourceMode==='event'){$('candidate-lat').value=String(event.latitude.toFixed(3));$('candidate-lon').value=String(event.longitude.toFixed(3));$('candidate-depth').value=String(event.depthKm.toFixed(1));}
  setPlay(false);setElapsed(0);loadObservations();
}

function activePredictions(){return modelType==='constant'?null:modelData[modelType]?.events?.[data.event.id]??null;}

function setModel(key){
  if(key!=='constant'&&!modelData[key]?.events?.[data.event.id]){
    $('model-select').value=modelType;notify('Model data unavailable',true);return;
  }
  modelType=key;$('model-select').value=key;
  map.showBaselineWavefront=key==='constant';
  $('velocity-fields').hidden=key!=='constant';
  $('toggle-p').disabled=key!=='constant';$('toggle-s').disabled=key!=='constant';
  refresh();
}

function currentCandidateSource(){
  if(candidateState.sourceMode==='event')return {...data.event};
  const lat=Number($('candidate-lat').value), lon=Number($('candidate-lon').value), depth=Number($('candidate-depth').value);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(depth)||Math.abs(lat)>85||Math.abs(lon)>180||depth<0||depth>50)return null;
  return {id:'manual-source',latitude:lat,longitude:lon,depthKm:depth,magnitude:data.event.magnitude,originUTC:data.event.originUTC};
}

function refresh(){
  if(!data)return;
  const useManual=modelType==='constant'&&!!manualStation;
  const allCount=data.stations.length+(useManual?1:0);
  $('trigger-count').max=String(allCount);
  if(params.triggersRequired>allCount){params.triggersRequired=allCount;$('trigger-count').value=String(allCount);}
  networkData=useManual?{...data,stations:[...data.stations,{id:TEST_STATION_ID,code:'NEW1',...manualStation,simulated:true}]}:data;
  results=calculateNetwork(networkData,params,disabled,activePredictions());
  map.results=results;
  map.manualStationPreview=manualStation&&modelType!=='constant'?manualStation:null;
  validation=observed?evaluateArrivals(results.stations,observed):null;
  updateStationImportance();
  updateSimulatedStationPanel();
  updateCandidateMap();
  map.render();
  updateReadouts();updateComparison();updateTiming();updateStationList();updateCityList();updateInspector();updateValidation();
}

function placeManualStation(location){
  if(!Number.isFinite(location.latitude)||!Number.isFinite(location.longitude)||Math.abs(location.latitude)>85||Math.abs(location.longitude)>180)return;
  if(modelType!=='constant')setModel('constant');
  manualStation={latitude:location.latitude,longitude:location.longitude};
  disabled.delete(TEST_STATION_ID);
  selected={kind:'station',id:TEST_STATION_ID};map.selection=selected;
  refresh();
  notify('NEW1 added to the network');
}

function removeManualStation(){
  if(!manualStation)return;
  manualStation=null;disabled.delete(TEST_STATION_ID);
  if(selected.id===TEST_STATION_ID){selected={kind:'event',id:data.event.id};map.selection=selected;}
  refresh();notify('Hypothetical station removed');
}

function updateSimulatedStationPanel(){
  $('manual-station-focus').disabled=!manualStation;
  $('manual-station-remove').disabled=!manualStation;
  const label=$('manual-station-info');
  if(!manualStation){label.textContent='Right-click map to add a station';return;}
  const coords=`${manualStation.latitude.toFixed(4)}°, ${manualStation.longitude.toFixed(4)}°`;
  if(modelType!=='constant'){
    label.textContent=`NEW1 · ${coords} · Inactive (Constant velocity only)`;
    return;
  }
  const record=results.stations.find(station=>station.id===TEST_STATION_ID);
  label.textContent=`NEW1 · ${coords} · ${record?.enabled?'P '+f2(record.p):'Disabled'}`;
}

function updateReadouts(){
  for(const [id,[key,velocity]] of Object.entries(settings)){
    const v=params[key];$(''+id+'-out').textContent=id==='trigger-count'?String(v):velocity?v.toFixed(1)+' km/s':v.toFixed(1)+' s';
  }
  $('station-count').textContent=results.stations.filter(x=>x.enabled).length+' / '+results.stations.length;
}

function updateComparison(){
  if(!data)return;
  const comparison=modelComparisons(data,params,disabled,observed,modelData);
  const maxP=Math.max(.01,...comparison.map(x=>x.p??0));
  const maxS=Math.max(.01,...comparison.map(x=>x.s??0));
  const root=$('comparison-list');root.replaceChildren();
  for(const item of comparison){
    const btn=make('button','model-choice');btn.type='button';btn.dataset.model=item.key;btn.disabled=!item.available;
    btn.classList.toggle('selected',item.key===modelType);btn.setAttribute('aria-pressed',String(item.key===modelType));
    const name=make('span','model-label',item.label);
    btn.append(name);
    for(const [phase,max] of [['p',maxP],['s',maxS]]){
      const value=make('span','model-value');
      value.append(make('b','',item[phase]===null?'—':item[phase].toFixed(2)+' s'));
      const meter=make('span','model-meter '+(phase==='s'?'s':''));
      const fill=make('i');fill.style.width=item[phase]===null?'0%':Math.max(2,item[phase]/max*100)+'%';
      meter.append(fill);value.append(meter);btn.append(value);
    }
    btn.title=item.available?`${item.label}. P MAE ${f2(item.p)}, S MAE ${f2(item.s)}. Lower is better.`:'Model data unavailable';
    btn.addEventListener('click',()=>setModel(item.key));root.append(btn);
  }
  $('p-mae').textContent=f2(validation?.p.mae);
  $('s-mae').textContent=f2(validation?.s.mae);
}

function updateTiming(){
  $('issue-main').textContent=f2(results.issue);
  $('delivered-main').textContent=f2(results.delivered);
  const pieces=timingStages(results,params);
  const strip=$('timing-strip'),explain=$('timing-breakdown');strip.replaceChildren();explain.replaceChildren();
  if(!pieces.length){strip.append(make('div','', 'No alert'));return;}
  const total=pieces.reduce((n,item)=>n+item.value,0);
  for(const [i,part] of pieces.entries()){
    const segment=make('span','timing-segment');segment.style.width=(total>0?part.value/total*100:0)+'%';
    segment.title=`${part.label}: ${f2(part.value)}`;strip.append(segment);
    const item=make('div','stage-item');const color=make('i','stage-color');color.style.background=stageColors[i];
    item.append(color,make('span','',part.label),make('b','',f2(part.value)));explain.append(item);
  }
}

function updateStationImportance(){
  const container=$('station-importance');
  const scroll=container.scrollLeft;
  importance=stationImportance(results,results.stations.length);
  map.impactValues=new Map(importance.rows.map(row=>[row.id,row.cells.find(cell=>cell.k===importance.currentK)]));
  const table=make('table','importance-table');
  const head=make('thead');const headings=make('tr');
  const label=make('th','impact-station-head','Station');label.scope='col';headings.append(label);
  for(const k of importance.thresholds){
    const th=make('th',k===importance.currentK?'current-k':'',String(k));th.scope='col';th.title=`Required stations: ${k}`;headings.append(th);
  }
  head.append(headings);table.append(head);
  const body=make('tbody');
  for(const row of importance.rows){
    const tr=make('tr');
    const name=make('th','impact-station-head');name.scope='row';
    const stationButton=make('button','impact-station-name',row.code);stationButton.type='button';
    stationButton.title='Locate '+row.id;
    stationButton.addEventListener('click',()=>focusImportanceStation(row.id));
    name.append(stationButton);tr.append(name);
    for(const cell of row.cells){
      const td=make('td',cell.k===importance.currentK?'current-k':'');
      const b=make('button','impact-cell');b.type='button';b.dataset.station=row.id;b.dataset.threshold=String(cell.k);
      b.dataset.status=cell.status;b.style.backgroundColor=importanceColor(cell);b.classList.toggle('impact-dark',cell.status==='lost'||(cell.status==='delay'&&cell.delta>=3));
      if(cell.status==='lost')b.textContent='×';
      else if(cell.status==='unavailable'||cell.status==='missing'||cell.status==='disabled')b.textContent='—';
      else b.textContent=cell.delta<1e-9?'0':cell.delta<.05?'<.1':'+'+cell.delta.toFixed(1);
      const meaning=cell.status==='lost'?'No alert':cell.status==='unavailable'?'No baseline alert':cell.status==='disabled'?'Station is disabled':cell.status==='missing'?'Missing predicted P arrival':`+${cell.delta.toFixed(3)} s`;
      b.title=`${row.id} · k=${cell.k}: ${meaning}`;
      b.setAttribute('aria-label',`${row.id}, ${cell.k} required: ${meaning}`);
      b.disabled=cell.status==='disabled'||cell.status==='unavailable'||cell.status==='missing';
      b.addEventListener('click',()=>{
        params.triggersRequired=cell.k;$('trigger-count').value=String(cell.k);
        selected={kind:'station',id:row.id};map.selection=selected;
        refresh();focusImportanceStation(row.id);
        const replacement=[...container.querySelectorAll('.impact-cell')].find(el=>el.dataset.station===row.id&&el.dataset.threshold===String(cell.k));
        replacement?.focus({preventScroll:true});
      });
      td.append(b);tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);container.replaceChildren(table);container.scrollLeft=scroll;
}

function updateCandidateMap(){
  const source=currentCandidateSource();
  $('candidate-manual-fields').hidden=candidateState.sourceMode!=='manual';
  $('candidate-source-label').textContent=candidateState.sourceMode==='event'?'Current event':'Manual source';
  if(!source){
    candidateGrid=null;map.setCandidateGrid(null);map.candidateSource=null;updateCandidatePanel('Invalid source values');return;
  }
  if(modelType!=='constant'){
    candidateGrid=null;map.setCandidateGrid(null);map.candidateSource=candidateState.enabled?source:null;updateCandidatePanel('Available in Constant velocity mode');return;
  }
  candidateGrid=candidateStationMap(networkData,params,disabled,source,candidateSteps[candidateState.stepKey],{mode:candidateState.analysis,radiusKm:candidateState.radiusKm});
  applyCandidateMetric(candidateGrid,candidateState.metric);
  map.setCandidateGrid(candidateState.enabled?candidateGrid:null);
  map.candidateSource=candidateState.enabled?source:null;
  updateCandidatePanel(`${candidateGrid.coverage} sites · ${candidateGrid.scenarios} source${candidateGrid.scenarios===1?'':'s'} · maximum ${candidateGrid.maxGain.toFixed(2)} s`);
}

function updateCandidatePanel(statusText=''){
  const overlayActive=candidateState.enabled&&modelType==='constant'&&candidateGrid?.cells?.length;
  map.candidateEnabled=!!overlayActive;
  $('candidate-map-toggle').setAttribute('aria-pressed',String(!!overlayActive));
  $('candidate-map-toggle').textContent=overlayActive?'Overlay on':'Overlay off';
  $('candidate-status').textContent=statusText||'No grid';
  $('map-candidate-key').hidden=!overlayActive;
  $('candidate-pointer').hidden=true;
  $('candidate-radius-field').hidden=candidateState.analysis!=='regional';
  $('candidate-description').textContent=candidateState.analysis==='regional'?`Mean delivery-time gain across ${candidateGrid?.scenarios??21} deterministic source locations within ${candidateState.radiusKm} km. Equal weights; not an earthquake probability forecast.`:'Exact delivery-time gain for the selected source. Equal gains across many locations are expected.';
  const maxGain=candidateGrid?.maxGain??0;
  if(candidateState.metric==='margin'){
    $('candidate-scale-title').textContent=candidateState.analysis==='regional'?'Mean trigger margin':'Trigger margin';
    $('candidate-scale-min').textContent=(candidateGrid?.minMargin??0).toFixed(1)+' s';
    $('candidate-scale-mid').textContent='0 s';
    $('candidate-scale-max').textContent='+'+(candidateGrid?.maxMargin??0).toFixed(1)+' s';
    $('candidate-colorbar').classList.add('margin');
    $('candidate-description').textContent=candidateState.analysis==='regional'?`Mean P-arrival advantage over kth station across ${candidateGrid?.scenarios??21} equally weighted hypothetical sources. This is not time saved.`:'P arrival advantage over the existing kth station. This is not time saved.';
  }else{
    $('candidate-scale-title').textContent=candidateState.analysis==='regional'?'Mean alert gain':'Alert gain';
    $('candidate-scale-min').textContent='0 s';
    $('candidate-scale-mid').textContent=(maxGain/2).toFixed(2)+' s';
    $('candidate-scale-max').textContent=maxGain.toFixed(2)+' s';
    $('candidate-colorbar').classList.remove('margin');
    $('candidate-description').textContent=candidateState.analysis==='regional'?`Mean actual delivery-time saving across ${candidateGrid?.scenarios??21} equally weighted hypothetical sources; not observed probabilities.`:'Actual delivery-time saving. The flat maximum-gain area is mathematically expected with a kth-station trigger.';
  }
  const root=$('candidate-top-list');root.replaceChildren();
  const ranked=candidateState.metric==='margin'?candidateGrid?.cells.filter(c=>Number.isFinite(c.margin)).slice().sort((a,b)=>b.margin-a.margin).slice(0,8):candidateGrid?.top;
  if(!ranked?.length){root.append(make('div','field-hint',modelType==='constant'?'No candidate values available':'Switch to Constant velocity'));return;}
  for(const cell of ranked){
    const btn=make('button','candidate-row');btn.type='button';
    const left=make('span','candidate-main');left.append(make('b','',`${cell.lat.toFixed(2)}, ${cell.lon.toFixed(2)}`),make('small','',candidateState.analysis==='regional'?`${Math.round(cell.positiveFraction*100)}% of scenarios improved`:`rank ${cell.rank}`));
    const gain=make('strong','',candidateState.metric==='margin'?`${cell.margin>=0?'+':''}${cell.margin.toFixed(2)} s`:`+${cell.gain.toFixed(2)} s`);
    btn.append(left,gain);
    btn.style.borderColor=candidateCellColor(cell,candidateGrid.maxGain);
    btn.addEventListener('click',()=>map.focus(cell.lat,cell.lon,Math.max(map.zoom,8.5)));
    root.append(btn);
  }
}

function focusImportanceStation(id){
  const station=results.stations.find(s=>s.id===id);
  if(!station)return;
  select('station',id);
  map.focus(station.latitude,station.longitude,Math.max(map.zoom,8));
}

function exportImportancePNG(){
  if(!importance)return;
  const scale=2,cellW=53,rowH=33,left=145,top=125;
  const width=left+importance.thresholds.length*cellW+36;
  const height=top+importance.rows.length*rowH+124;
  const canvas=document.createElement('canvas');canvas.width=width*scale;canvas.height=height*scale;
  const c=canvas.getContext('2d');c.scale(scale,scale);
  c.fillStyle='#ffffff';c.fillRect(0,0,width,height);
  c.fillStyle='#244251';c.font='700 18px Arial, sans-serif';c.fillText('Station importance',26,34);
  c.font='13px Arial, sans-serif';c.fillText(`Ridgecrest Mw ${data.event.magnitude.toFixed(1)}  |  ${$('model-select').selectedOptions[0].text}`,26,58);
  c.fillStyle='#546870';c.font='12px Arial, sans-serif';c.fillText('Additional alert delivery delay (s) when one station is disabled',26,79);
  c.fillStyle='#244251';c.font='700 12px Arial, sans-serif';c.fillText('Station',26,top-14);
  for(const [i,k] of importance.thresholds.entries()){
    const x=left+i*cellW;
    c.fillStyle=k===importance.currentK?'#00677c':'#244251';
    c.font='700 12px Arial, sans-serif';c.fillText(String(k),x+cellW/2-4,top-14);
    if(k===importance.currentK){c.fillStyle='#e3f1f4';c.fillRect(x-1,top-3,cellW+2,importance.rows.length*rowH+3);}
  }
  for(const [j,row] of importance.rows.entries()){
    const y=top+j*rowH;
    c.font='700 12px Arial, sans-serif';c.fillStyle=row.enabled?'#204b5d':'#9ca9af';c.fillText(row.id,26,y+21);
    for(const [i,cell] of row.cells.entries()){
      const x=left+i*cellW;
      c.fillStyle=importanceColor(cell);c.fillRect(x+2,y+3,cellW-5,rowH-6);
      c.strokeStyle='#9bb1b9';c.lineWidth=.7;c.strokeRect(x+2.5,y+3.5,cellW-6,rowH-7);
      const text=cell.status==='lost'?'×':cell.delta===null?'—':cell.delta<1e-9?'0':cell.delta<.05?'<.1':'+'+cell.delta.toFixed(1);
      c.font='600 11px Arial, sans-serif';c.fillStyle=cell.status==='lost'||(cell.status==='delay'&&cell.delta>=3)?'#ffffff':'#244251';
      c.textAlign='center';c.fillText(text,x+cellW/2,y+21);c.textAlign='left';
    }
  }
  const y=top+importance.rows.length*rowH+27;
  const stops=[['#ffffff','0'],['#d8eaee','<0.5'],['#a8d1d9','0.5–1.5'],['#62acbb','1.5–3'],['#006d82','3+'],['#9b4542','No alert']];
  let x=26;
  for(const [color,label] of stops){c.fillStyle=color;c.fillRect(x,y,16,13);c.strokeStyle='#94a7ae';c.strokeRect(x+.5,y+.5,15,12);c.fillStyle='#435c68';c.font='11px Arial, sans-serif';c.fillText(label,x+21,y+11);x+=label==='No alert'?98:90;}
  c.fillStyle='#5c727a';c.font='11px Arial, sans-serif';c.fillText(`Source: EEW Lab model output; ${results.stations.length} stations including hypothetical NEW1 if present. Not actual ShakeAlert.`,26,height-26);
  canvas.toBlob(blob=>{
    if(!blob){notify('PNG export failed',true);return;}
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;
    a.download=`station-importance-${data.event.id}-${modelType}.png`;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
    notify('Heatmap PNG exported');
  },'image/png');
}

function updateStationList(){
  const root=$('station-list');root.replaceChildren();
  const active=alertStations(results,params.triggersRequired);
  const candidates=results.stations.filter(s=>s.enabled&&s.p!==null);
  const ranks=new Map(candidates.map((s,i)=>[s.id,i+1]));
  for(const station of [...results.stations].sort((a,b)=>Number(b.enabled)-Number(a.enabled)||(a.available??Infinity)-(b.available??Infinity))){
    const row=make('div','station-row');row.classList.toggle('trigger-key',active.has(station.id));
    row.classList.toggle('selected',selected.kind==='station'&&selected.id===station.id);
    const toggle=make('input');toggle.type='checkbox';toggle.checked=station.enabled;
    toggle.setAttribute('aria-label','Enable '+station.id);
    toggle.addEventListener('change',()=>{
      if(toggle.checked)disabled.delete(station.id);else disabled.add(station.id);
      refresh();notify(`${station.id}: ${toggle.checked?'enabled':'disabled'}`);
    });
    const btn=make('button','station-pick');btn.type='button';btn.dataset.simulated=String(!!station.simulated);btn.setAttribute('aria-label',`Focus station ${station.id}`);
    const left=make('span','station-main');
    left.append(make('span','rank',ranks.get(station.id)||'–'),make('b','',station.code));
    btn.append(left,make('small','',`${station.p===null?'—':station.p.toFixed(2)+' s'} · ${station.distanceKm.toFixed(1)} km`));
    btn.addEventListener('click',()=>{select('station',station.id);map.focus(station.latitude,station.longitude,9.5);});
    row.append(toggle,btn);root.append(row);
  }
}

function updateCityList(){
  const root=$('city-list');root.replaceChildren();
  for(const city of results.cities){
    const btn=make('button','city-button');btn.type='button';
    btn.classList.toggle('selected',selected.kind==='city'&&selected.id===city.id);
    btn.setAttribute('aria-pressed',String(selected.kind==='city'&&selected.id===city.id));
    const name=make('span','',city.name);
    const lead=make('strong',polarity(city.lead),f2(city.lead));
    btn.append(name,lead);btn.addEventListener('click',()=>select('city',city.id));root.append(btn);
  }
}

function updateInspector(){
  const station=results.stations.find(s=>s.id===selected.id);
  const city=results.cities.find(s=>s.id===selected.id);
  const display=$('lead-value');display.classList.remove('negative');
  if(selected.kind==='station'&&station){
    $('selected-name').textContent=station.id;
    $('selected-distance').textContent=station.distanceKm.toFixed(1)+' km';
    $('lead-label').textContent='P arrival';display.textContent=f2(station.p);
  }else if(selected.kind==='candidate'){
    $('selected-name').textContent='Candidate site';
    $('selected-distance').textContent=`${selected.lat.toFixed(3)}, ${selected.lon.toFixed(3)}`;
    $('lead-label').textContent=candidateState.analysis==='regional'?'Mean gain':'Gain';display.textContent=f2(selected.gain);
  }else if(selected.kind==='station'&&selected.id===TEST_STATION_ID&&manualStation){
    $('selected-name').textContent='NEW1';
    $('selected-distance').textContent='Inactive in this model';
    $('lead-label').textContent='P arrival';display.textContent='—';
  }else if(selected.kind==='event'){
    $('selected-name').textContent='Ridgecrest';
    $('selected-distance').textContent=data.event.id;
    $('lead-label').textContent='Alert issue';display.textContent=f2(results.issue);
  }else if(city){
    $('selected-name').textContent=city.name;
    $('selected-distance').textContent=city.distanceKm.toFixed(1)+' km';
    $('lead-label').textContent='S-wave lead';display.textContent=f2(city.lead);
    display.classList.toggle('negative',city.lead!==null&&city.lead<0);
  }
}

function updateValidation(){
  $('p-bias').textContent=f2(validation?.p.bias);
  $('s-bias').textContent=f2(validation?.s.bias);
  $('pick-count').textContent=(validation?.comparisons.length??0)+' picks';
  if(!validation){$('residual-chart').replaceChildren();$('residual-summary').textContent='No observed arrivals';$('pick-rows').replaceChildren();return;}
  const sorted=validation.comparisons.slice().sort((a,b)=>a.id.localeCompare(b.id)||a.phase.localeCompare(b.phase));
  const body=$('pick-rows');body.replaceChildren();
  for(const value of sorted){
    const row=make('tr');const cell=make('td');const btn=make('button','pick-link',value.id.replace('CI.',''));
    btn.type='button';btn.addEventListener('click',()=>{
      select('station',value.id);
      const station=results.stations.find(s=>s.id===value.id);if(station)map.focus(station.latitude,station.longitude,9.5);
    });
    cell.append(btn);row.append(cell,make('td','',phases[value.phase]),make('td',polarity(value.residual),signed(value.residual)));body.append(row);
  }
  renderResidual();
}

function renderResidual(){
  const root=$('residual-chart');root.replaceChildren();
  const rows=topResiduals(validation,10);
  if(!rows.length){root.append(make('div','field-hint','No comparable picks'));return;}
  const max=Math.max(1,...rows.map(x=>Math.abs(x.residual)));
  for(const row of rows){
    const line=make('div','residual-row');
    line.append(make('span','',row.id.replace('CI.','')),make('i','phase-symbol '+(row.phase==='s'?'s':'p'),row.phase.toUpperCase()));
    const track=make('div','residual-track');const bar=make('i','residual-bar '+(row.phase==='s'?'s':''));
    const width=Math.abs(row.residual)/max*47;
    bar.style.left=(row.residual<0?50-width:50)+'%';bar.style.width=width+'%';track.append(bar);
    line.append(track,make('span','residual-num '+polarity(row.residual),signed(row.residual).replace(' s','')));root.append(line);
  }
  $('residual-summary').textContent=`P ${validation.p.n} · S ${validation.s.n}`;
}

function select(kind,id,payload=null){
  selected=kind==='candidate'&&payload?{kind,id,...payload}:{kind,id};map.selection=selected;
  updateStationList();updateCityList();updateInspector();map.render();
}

function setElapsed(t){
  elapsed=Math.max(0,Math.min(params.durationS,t));$('scrubber').value=elapsed;
  const mins=Math.floor(elapsed/60).toString().padStart(2,'0');const secs=(elapsed%60).toFixed(1).padStart(4,'0');
  $('time-readout').textContent=`${mins}:${secs}`;map.elapsed=elapsed;map.render();
}

function setPlay(value){
  playing=value;$('play').setAttribute('aria-pressed',String(value));$('play').setAttribute('aria-label',value?'Pause':'Play');$('play').title=value?'Pause':'Play';
  $('play').textContent=value?'Ⅱ':'▶';
}

function frame(now){
  const delta=Math.min(.18,(now-lastFrame)/1000);lastFrame=now;
  if(playing){const next=Math.min(params.durationS,elapsed+delta*speed);setElapsed(next);if(next>=params.durationS)setPlay(false);}
  requestAnimationFrame(frame);
}

function setBasemap(style){
  map.baseStyle=style;map.render();$('base-select').value=style;
  $('map-attribution').textContent=style==='satellite'?'Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community':style==='street'?'© OpenStreetMap contributors':'WGS84 coordinate grid';
}

function restoreSettings(){
  params={...defaults};disabled.clear();manualStation=null;
  for(const [id,[key]] of Object.entries(settings))$(id).value=params[key];
  setPlay(false);setElapsed(0);map.focus(data.event.latitude,data.event.longitude,8);
  refresh();notify('Experiment settings reset');
}

function exportCandidateCSV(){
  if(!candidateGrid){notify('Candidate grid unavailable',true);return;}
  const source=currentCandidateSource();
  const rows=[['Analysis',candidateState.analysis],['Scenario count',candidateGrid.scenarios],['Scenario radius km',candidateState.analysis==='regional'?candidateState.radiusKm:0],['Displayed metric',candidateState.metric],['Source mode',candidateState.sourceMode],['Latitude',source.latitude],['Longitude',source.longitude],['Depth km',source.depthKm],['Grid step deg',candidateSteps[candidateState.stepKey]],['Trigger stations',params.triggersRequired],[],['lat','lon','rank','mean_or_single_gain_s','mean_or_single_trigger_margin_s','improved_scenario_fraction','status','candidate_p_s','candidate_available_s']];
  for(const cell of candidateGrid.cells)rows.push([cell.lat,cell.lon,cell.rank,cell.gain??'',cell.margin??'',cell.positiveFraction,cell.status,cell.p,cell.available]);
  const csv=rows.map(r=>r.map(v=>'\"'+String(v).replace(/\"/g,'\"\"')+'\"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`candidate-station-grid-${candidateState.sourceMode}.csv`;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);notify('Candidate grid exported');
}

function bind(){
  $('event-select').addEventListener('change',e=>selectEvent(e.target.value));
  $('model-select').addEventListener('change',e=>setModel(e.target.value));
  $('base-select').addEventListener('change',e=>setBasemap(e.target.value));
  $('export-results').addEventListener('click',exportCSV);
  $('reset-all').addEventListener('click',restoreSettings);
  $('toggle-p').addEventListener('change',e=>{map.showP=e.target.checked;map.render();});
  $('toggle-s').addEventListener('change',e=>{map.showS=e.target.checked;map.render();});
  $('toggle-stations').addEventListener('change',e=>{map.showStations=e.target.checked;map.showLabels=e.target.checked;$('map-importance-key').hidden=!map.importanceEnabled||!map.showStations;$('map-candidate-key').hidden=!map.candidateEnabled;map.render();});
  $('zoom-in').addEventListener('click',()=>map.changeZoom(.7));
  $('zoom-out').addEventListener('click',()=>map.changeZoom(-.7));
  $('recenter').addEventListener('click',()=>map.focus(data.event.latitude,data.event.longitude,8));
  for(const [id,[key]]of Object.entries(settings))$(id).addEventListener('input',e=>{params[key]=Number(e.target.value);refresh();});
  $('reset-velocities').addEventListener('click',()=>{
    params.vpKmS=defaults.vpKmS;params.vsKmS=defaults.vsKmS;
    $('vp').value=params.vpKmS;$('vs').value=params.vsKmS;refresh();notify('Velocity values reset');
  });
  $('reset-latency').addEventListener('click',()=>{
    for(const [id,[key]]of Object.entries(settings))if(id!=='vp'&&id!=='vs'){params[key]=defaults[key];$(id).value=params[key];}
    refresh();notify('Trigger and latency values reset');
  });
  $('enable-all').addEventListener('click',()=>{disabled.clear();refresh();notify('All stations enabled');});
  $('disable-all').addEventListener('click',()=>{results.stations.forEach(s=>disabled.add(s.id));refresh();notify('All stations disabled');});
  $('export-impact-png').addEventListener('click',exportImportancePNG);
  $('manual-station-remove').addEventListener('click',removeManualStation);
  $('manual-station-focus').addEventListener('click',()=>{if(manualStation){map.focus(manualStation.latitude,manualStation.longitude,Math.max(map.zoom,9));}else map.focus(data.event.latitude,data.event.longitude,8);});
  $('impact-map-toggle').addEventListener('click',()=>{map.importanceEnabled=!map.importanceEnabled;map.candidateEnabled=false;candidateState.enabled=false;$('candidate-map-toggle').textContent='Overlay off';const button=$('impact-map-toggle');button.setAttribute('aria-pressed',String(map.importanceEnabled));$('map-importance-key').hidden=!map.importanceEnabled;if(map.importanceEnabled&&!map.showStations){map.showStations=true;$('toggle-stations').checked=true;}map.render();});
  $('candidate-source-mode').addEventListener('change',e=>{candidateState.sourceMode=e.target.value;refresh();});
  $('candidate-grid').addEventListener('change',e=>{candidateState.stepKey=e.target.value;refresh();});
  $('candidate-analysis').addEventListener('change',e=>{candidateState.analysis=e.target.value;refresh();});
  $('candidate-radius').addEventListener('change',e=>{candidateState.radiusKm=Number(e.target.value);refresh();});
  $('candidate-display').addEventListener('change',e=>{map.candidateDisplay=e.target.value;map.render();});
  $('candidate-metric').addEventListener('change',e=>{candidateState.metric=e.target.value;refresh();});
  $('candidate-lat').addEventListener('change',refresh);
  $('candidate-lon').addEventListener('change',refresh);
  $('candidate-depth').addEventListener('change',refresh);
  $('candidate-use-center').addEventListener('click',()=>{const center=map.screenToGeo(map.width/2,map.height/2);candidateState.sourceMode='manual';$('candidate-source-mode').value='manual';$('candidate-lat').value=center.latitude.toFixed(3);$('candidate-lon').value=center.longitude.toFixed(3);refresh();notify('Manual source moved to map center');});
  $('candidate-map-toggle').addEventListener('click',()=>{candidateState.enabled=!candidateState.enabled;if(candidateState.enabled){map.importanceEnabled=false;$('impact-map-toggle').setAttribute('aria-pressed','false');$('map-importance-key').hidden=true;}refresh();if(candidateState.enabled&&candidateGrid?.top?.[0]){const point=candidateGrid.top[0];map.focus(point.lat,point.lon,9.5);}});
  $('candidate-export').addEventListener('click',exportCandidateCSV);
  $('candidate-focus').addEventListener('click',()=>{const point=candidateState.metric==='margin'?candidateGrid?.cells.filter(c=>Number.isFinite(c.margin)).sort((a,b)=>b.margin-a.margin)[0]??currentCandidateSource():candidateGrid?.top?.[0]??currentCandidateSource();if(!point)return;map.focus(point.lat??point.latitude,point.lon??point.longitude,10);notify('Focused on highest-gain area');});
  $('play').addEventListener('click',()=>{if(elapsed>=params.durationS)setElapsed(0);setPlay(!playing);});
  $('restart').addEventListener('click',()=>{setPlay(false);setElapsed(0);});
  $('scrubber').addEventListener('input',e=>setElapsed(Number(e.target.value)));
  $('speed').addEventListener('change',e=>{speed=Number(e.target.value);});
  $('phase-file-trigger').addEventListener('click',()=>$('phase-file').click());
  $('phase-file').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      const text=await file.text();const parsed=file.name.toLowerCase().endsWith('.json')?JSON.parse(text):parseSTP(text,data.event.id,data.stations.map(s=>s.id),data.event.originUTC);
      useObservations(parsed,file.name);$('import-state').textContent=file.name;$('section-observed').open=true;
    }catch(error){notify(error.message,true);$('import-state').textContent='Import failed';}
    e.target.value='';
  });
  document.addEventListener('keydown',e=>{
    if(e.code==='Space'&&!['INPUT','SELECT','TEXTAREA','BUTTON','SUMMARY','A'].includes(document.activeElement?.tagName)){
      e.preventDefault();if(elapsed>=params.durationS)setElapsed(0);setPlay(!playing);
    }
  });
}

function exportCSV(){
  const rows=[["EEW Lab V0.4.12"],["Event",data.event.id],["Model",modelType],["P velocity",params.vpKmS],["S velocity",params.vsKmS],["Trigger stations",params.triggersRequired],["Detection",params.detectionDelayS],["Telemetry",params.networkDelayS],["Processing",params.processingDelayS],["Delivery latency",params.deliveryDelayS],["Alert issue",results.issue??''],["Message delivery",results.delivered??''],[],["City","P predicted","S predicted","Delivery","S-wave lead"]];
  rows.splice(rows.length-2,0,['NEW1 latitude',manualStation?.latitude??''],['NEW1 longitude',manualStation?.longitude??''],['NEW1 enabled',manualStation?modelType==='constant'&&!disabled.has(TEST_STATION_ID):'']);
  for(const city of results.cities)rows.push([city.name,city.p??'',city.s??'',results.delivered??'',city.lead??'']);
  rows.push([],["Station","Phase","Predicted","Observed","Residual"]);
  for(const r of validation?.comparisons||[])rows.push([r.id,r.phase,r.predicted,r.observed,r.residual]);
  rows.push([],["Model","P MAE","P N","S MAE","S N"]);
  for(const m of modelComparisons(data,params,disabled,observed,modelData))rows.push([m.label,m.p??'',m.pN??'',m.s??'',m.sN??'']);
  rows.push([],['Network station','P arrival','Signal available','Enabled']);
  for(const st of results.stations)rows.push([st.id,st.p??'',st.available??'',st.enabled]);
  rows.push([],["Station importance: one-station removal; delay in seconds"],["Station",...importance.thresholds.map(k=>'k='+k)]);
  for(const station of importance.rows)rows.push([station.id,...station.cells.map(cell=>cell.status==='lost'?'NO_ALERT':cell.status==='unavailable'?'NO_BASELINE':cell.status==='disabled'?'DISABLED':cell.status==='missing'?'NO_PICK':cell.delta)]);
  if(candidateGrid){
    const source=currentCandidateSource();
    rows.push([],["Candidate station map"],["Source mode",candidateState.sourceMode],["Latitude",source.latitude],["Longitude",source.longitude],["Depth km",source.depthKm],["Grid step deg",candidateSteps[candidateState.stepKey]]);
    rows.push(["lat","lon","rank","gain_s","status","candidate_p_s","candidate_available_s"]);
    for(const cell of candidateGrid.cells)rows.push([cell.lat,cell.lon,cell.rank,cell.gain??'',cell.margin??'',cell.positiveFraction,cell.status,cell.p,cell.available]);
  }
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`eew-lab-${data.event.id}-${modelType}-v0.4.12.csv`;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);notify('CSV exported');
}

init();
