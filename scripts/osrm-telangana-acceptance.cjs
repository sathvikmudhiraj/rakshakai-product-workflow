// Direct OSRM acceptance against an isolated staging container. No app data is changed.
const assert = require("node:assert/strict");

const baseUrl = (process.env.OSRM_URL || "http://127.0.0.1:5002").replace(/\/$/, "");
const locations = {
  Hyderabad: [78.4867, 17.3850],
  Patancheru: [78.2705, 17.5333],
  Secunderabad: [78.4983, 17.4399],
  Shamshabad: [78.4744, 17.2510],
  Sangareddy: [78.0878, 17.6240],
  Warangal: [79.5941, 17.9689],
  Karimnagar: [79.1288, 18.4386],
  Nizamabad: [78.0962, 18.6725],
  Khammam: [80.1514, 17.2473],
  Mahbubnagar: [77.9850, 16.7488]
};

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function nearest(name, point) {
  const { response, body } = await getJson(`/nearest/v1/driving/${point.join(",")}?number=1`);
  assert.equal(response.ok, true, `${name} /nearest HTTP ${response.status}: ${body.message || "unknown error"}`);
  assert.equal(body.code, "Ok", `${name} /nearest: ${body.message || body.code}`);
  assert.ok(body.waypoints?.[0], `${name} /nearest returned no waypoint`);
  return body.waypoints[0];
}

async function route(fromName, toName) {
  const { response, body } = await getJson(`/route/v1/driving/${locations[fromName].join(",")};${locations[toName].join(",")}?overview=full&geometries=geojson&steps=true&alternatives=true`);
  assert.equal(response.ok, true, `${fromName} -> ${toName} HTTP ${response.status}: ${body.message || "unknown error"}`);
  assert.equal(body.code, "Ok", `${fromName} -> ${toName}: ${body.message || body.code}`);
  const route = body.routes?.[0];
  assert.ok(route, `${fromName} -> ${toName} returned no route`);
  assert.ok(route.distance > 0, `${fromName} -> ${toName} has no road distance`);
  assert.ok(route.duration > 0, `${fromName} -> ${toName} has no road ETA`);
  assert.ok(route.geometry?.coordinates?.length >= 2, `${fromName} -> ${toName} has no geometry`);
  assert.ok(route.legs?.some((leg) => leg.steps?.length), `${fromName} -> ${toName} has no turn steps`);
  return { distance: route.distance, duration: route.duration, alternatives: body.routes.length };
}

(async () => {
  const report = { baseUrl, nearest: {}, routes: {}, outsideCoverage: null };
  for (const [name, point] of Object.entries(locations)) report.nearest[name] = await nearest(name, point);
  for (const [from, to] of [["Hyderabad", "Patancheru"], ["Secunderabad", "Shamshabad"], ["Sangareddy", "Warangal"], ["Karimnagar", "Nizamabad"], ["Khammam", "Mahbubnagar"]]) {
    report.routes[`${from} -> ${to}`] = await route(from, to);
  }
  const outside = await getJson("/route/v1/driving/72.8777,19.0760;72.9878,19.2183?overview=full&geometries=geojson&steps=true");
  assert.notEqual(outside.body.code, "Ok", "Outside-Telangana request unexpectedly returned a road route");
  report.outsideCoverage = { httpStatus: outside.response.status, code: outside.body.code || null, message: outside.body.message || null };
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
