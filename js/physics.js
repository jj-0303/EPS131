export const EARTH_RADIUS_KM = 6371.0088;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export function haversineKm(lat1, lon1, lat2, lon2) {
  const a1 = lat1 * DEG, a2 = lat2 * DEG;
  const dLat = (lat2 - lat1) * DEG, dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export function travelTimeS(event, location, velocityKmS) {
  if (!(velocityKmS > 0)) throw new Error('Velocity must be positive');
  const surface = haversineKm(event.latitude, event.longitude, location.latitude, location.longitude);
  return Math.hypot(surface, event.depthKm) / velocityKmS;
}
export function surfaceWavefrontRadiusKm(t, depthKm, velocityKmS) {
  const traveled = Math.max(0, t) * velocityKmS;
  return traveled < depthKm ? null : Math.sqrt(traveled ** 2 - depthKm ** 2);
}
export function destination(lat, lon, bearingDegrees, km) {
  const bearing = bearingDegrees * DEG;
  const d = km / EARTH_RADIUS_KM;
  const p1 = lat * DEG, l1 = lon * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(bearing));
  const l2 = l1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { latitude: p2 * RAD, longitude: ((l2 * RAD + 540) % 360) - 180 };
}
export function calculateNetwork(data, params, disabled = new Set(), predictions = null) {
  const {event} = data;
  const compute = (place, phase) => {
    if (predictions !== null) {
      const value = predictions[place.id]?.[phase];
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    }
    return travelTimeS(event, place, phase === 'p' ? params.vpKmS : params.vsKmS);
  };
  const stations = data.stations.map(station => {
    const distanceKm = haversineKm(event.latitude, event.longitude, station.latitude, station.longitude);
    const p = compute(station, 'p');
    const s = compute(station, 's');
    return {...station, distanceKm, p, s,
      available: p === null ? null : p + params.detectionDelayS + params.networkDelayS,
      enabled: !disabled.has(station.id) };
  }).sort((a,b) => (a.available ?? Infinity) - (b.available ?? Infinity));
  const triggers = stations.filter(station => station.enabled && station.available !== null);
  const kth = triggers[params.triggersRequired - 1];
  const issue = kth ? kth.available + params.processingDelayS : null;
  const delivered = issue === null ? null : issue + params.deliveryDelayS;
  const cities = data.cities.map(city => {
    const p = compute(city, 'p');
    const s = compute(city, 's');
    return {...city,p,s,distanceKm:haversineKm(event.latitude,event.longitude,city.latitude,city.longitude),
      lead:delivered === null || s === null ? null : s - delivered};
  });
  return {stations, issue, delivered, cities, params, triggered: triggers.length, kthStation: kth ?? null, firstStation: triggers[0] ?? null};
}
export function fmtSeconds(s) { return s === null || !Number.isFinite(s) ? '—' : `${s.toFixed(1)} s`; }
export function fmtSignedSeconds(s) { return s === null || !Number.isFinite(s) ? '—' : `${s > 0 ? '+' : ''}${s.toFixed(1)} s`; }
