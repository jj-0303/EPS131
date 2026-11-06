export function parseSTP(text, eventId, allowedStationIds, referenceOriginUTC) {
  const allowed = new Set(allowedStationIds);
  const lines = text.replace(/\r/g, '').split('\n');
  const header = /^\s*(\d+)\s+\S+\s+(?:\S+\s+)?(\d{4}\/\d\d\/\d\d,\d\d:\d\d:\d\d(?:\.\d+)?)/;
  let originMs = null;
  const matches = new Map();
  for (const line of lines) {
    const match = line.match(header);
    if (match) {
      if (match[1] === eventId.replace(/^ci/i, '')) {
        const stamp = match[2].replace(',', 'T').replace(/\//g, '-') + 'Z';
        originMs = Date.parse(stamp);
      }
      continue;
    }
    if (originMs === null) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 13 || parts[0].toUpperCase() !== 'CI') continue;
    const id = `CI.${parts[1].toUpperCase()}`;
    const phase = parts[7]?.toUpperCase();
    if (!allowed.has(id) || (phase !== 'P' && phase !== 'S')) continue;
    const seconds = Number(parts.at(-1));
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 300) continue;
    const current = matches.get(id) || {id};
    const key = phase.toLowerCase();
    if (current[key] === undefined || seconds < current[key]) current[key] = seconds;
    matches.set(id,current);
  }
  if (originMs === null || !Number.isFinite(originMs)) throw new Error('Matching event origin not found in STP file');
  const referenceMs = Date.parse(referenceOriginUTC);
  if (!Number.isFinite(referenceMs)) throw new Error('Invalid reference origin');
  const offset = (originMs-referenceMs)/1000;
  const observations = [...matches.values()].map(x=>({id:x.id,...(x.p===undefined?{}:{p:x.p+offset}),...(x.s===undefined?{}:{s:x.s+offset})}));
  if (!observations.length) throw new Error('No phase picks for the selected stations');
  return {schemaVersion:2,eventId,originOffsetSeconds:offset,phaseOriginUTC:new Date(originMs).toISOString(),referenceOriginUTC,source:'SCEDC STP file imported locally',observations};
}

export function normalizeObservations(raw, eventId, stationIds) {
  if (!raw || raw.eventId !== eventId || !Array.isArray(raw.observations)) throw new Error('Observation event or data format mismatch');
  const allowed = new Set(stationIds);
  const observations = new Map();
  for (const row of raw.observations) {
    if (!allowed.has(row.id)) continue;
    const pick = {};
    for (const key of ['p','s']) {
      if (row[key] !== undefined && row[key] !== null && Number.isFinite(row[key]) && row[key] >= 0 && row[key] <= 300) pick[key] = row[key];
    }
    if (Object.keys(pick).length) observations.set(row.id,pick);
  }
  if (!observations.size) throw new Error('No matching valid station phase picks');
  return observations;
}

export function evaluateArrivals(stations, obsMap) {
  const comparisons=[];
  for (const st of stations) {
    const o = obsMap?.get(st.id);
    if (!o) continue;
    for (const phase of ['p','s']) {
      if (o[phase] === undefined || st[phase] === null || !Number.isFinite(st[phase])) continue;
      comparisons.push({id:st.id,phase,observed:o[phase],predicted:st[phase],residual:st[phase]-o[phase],distanceKm:st.distanceKm});
    }
  }
  const summary = phase => {
    const rows=comparisons.filter(x=>x.phase===phase);
    if (!rows.length) return {n:0,mae:null,bias:null,rmse:null};
    const n=rows.length;
    return {n,mae:rows.reduce((a,x)=>a+Math.abs(x.residual),0)/n,bias:rows.reduce((a,x)=>a+x.residual,0)/n,rmse:Math.sqrt(rows.reduce((a,x)=>a+x.residual*x.residual,0)/n)};
  };
  return {comparisons,p:summary('p'),s:summary('s')};
}
