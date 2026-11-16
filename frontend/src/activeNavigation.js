// Project a GPS fix onto provider geometry; this is an estimate, not map matching.
const RAD = Math.PI / 180;
function xy([lng, lat], referenceLat) { return [lng * RAD * 6371000 * Math.cos(referenceLat * RAD), lat * RAD * 6371000]; }
export function shouldRecenterFollow(point, last, now = Date.now()) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng) || !Number.isFinite(point?.accuracy) || point.accuracy >= 100) return false;
  if (!last) return true;
  const distance = Math.hypot(...xy([point.lng, point.lat], point.lat).map((v, i) => v - xy([last.lng, last.lat], point.lat)[i]));
  return now - last.at >= 1500 && distance >= Math.max(10, point.accuracy * 0.5);
}
function project(coordinates, point) {
  const origin = xy([point.lng, point.lat], point.lat);
  let total = 0, best = null;
  for (let i = 1; i < coordinates.length; i++) {
    const a = xy(coordinates[i-1], point.lat), b = xy(coordinates[i], point.lat);
    const dx = b[0]-a[0], dy = b[1]-a[1], length = Math.hypot(dx,dy);
    const t = length ? Math.max(0, Math.min(1, ((origin[0]-a[0])*dx+(origin[1]-a[1])*dy)/(length*length))) : 0;
    const distance = Math.hypot(origin[0]-a[0]-t*dx, origin[1]-a[1]-t*dy);
    if (!best || distance < best.distance) best = { distance, along: total + t*length };
    total += length;
  }
  return best ? { ...best, total } : null;
}

// Two consecutive accurate fixes confirm deviation or arrival; 35 m is the
// lower threshold for returning to the route. Distances are in metres.
export function navigationProgress(route, point, previous = {}) {
  if (!route || route.isApproximate || route.provider !== 'osrm' || !Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return null;
  const geometry = route.geometry?.coordinates;
  if (!Array.isArray(geometry) || geometry.length < 2 || geometry.some((p) => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  const projected = project(geometry, point);
  if (!projected?.total) return null;
  const accuracy = Number.isFinite(point.accuracy) ? Math.max(0, point.accuracy) : null;
  const poorGps = accuracy === null || accuracy >= 100;
  const candidateOffRoute = !poorGps && projected.distance > Math.max(50, accuracy * 2);
  const onRoute = !poorGps && projected.distance <= Math.max(35, accuracy);
  const offRouteFixes = candidateOffRoute ? (previous.offRouteFixes || 0) + 1 : 0;
  const onRouteFixes = onRoute ? (previous.onRouteFixes || 0) + 1 : 0;
  const offRoute = poorGps ? Boolean(previous.offRoute) : previous.offRoute ? onRouteFixes < 2 : offRouteFixes >= 2;
  const previousAlong = Number.isFinite(previous.along) ? previous.along : 0;
  const along = poorGps || candidateOffRoute || offRoute ? previousAlong : Math.max(previousAlong, projected.along);
  const remainingFraction = Math.max(0, Math.min(1, 1 - along / projected.total));
  const destination = geometry.at(-1);
  const endDistance = Math.hypot(...xy(destination, point.lat).map((v, i) => v - xy([point.lng,point.lat],point.lat)[i]));
  const arrivalCandidate = !poorGps && accuracy <= 50 && endDistance <= Math.max(25, accuracy) && !offRoute && !candidateOffRoute;
  const arrivalFixes = arrivalCandidate ? (previous.arrivalFixes || 0) + 1 : 0;
  const arrived = arrivalFixes >= 2;
  const upcoming = (route.steps || []).map((step) => {
    const location = step.maneuver?.location;
    if (!Array.isArray(location) || location.length < 2 || !Number.isFinite(location[0]) || !Number.isFinite(location[1])) return null;
    const position = project(geometry, { lng:location[0], lat:location[1] });
    return position ? { step, distance: position.along - along } : null;
  }).filter((item) => item && item.distance >= -5).sort((a,b) => a.distance-b.distance)[0];
  return { offRoute, offRouteFixes, onRouteFixes, arrivalFixes, along, poorGps, accuracy, arrived, remainingKm: Number(route.distanceKm)*remainingFraction, remainingMinutes: Number(route.durationMinutes)*remainingFraction, nextStep: upcoming?.step || null, nextDistanceMeters: Math.max(0, upcoming?.distance || 0) };
}

export function maneuverText(step) {
  if (!step?.maneuver?.type) return 'No upcoming maneuver available';
  const type = step.maneuver.type.replace(/_/g,' '), modifier = step.maneuver.modifier || '';
  return [type, modifier, step.name ? `onto ${step.name}` : ''].filter(Boolean).join(' ');
}
