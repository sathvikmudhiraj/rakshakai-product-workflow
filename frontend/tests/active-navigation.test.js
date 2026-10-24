import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationProgress, maneuverText, shouldRecenterFollow } from '../src/activeNavigation.js';
import { applyRouteResponse, emptyRouteNavigationState, selectRouteId, selectedRoute } from '../src/gisRouteState.js';

const route = (id, name, minutes) => ({ id, label:id, provider:'osrm', distanceKm:1.11, durationMinutes:minutes, geometry:{type:'LineString',coordinates:[[78,17],[78.005,17],[78.01,17]]}, steps:[{ name, maneuver:{ type:'turn', modifier:'right', location:[78.01,17] } }] });
test('selected alternative drives progress, ETA and provider maneuver', () => {
  let state = applyRouteResponse(emptyRouteNavigationState(), {provider:'osrm',routes:[route('one','First',16),route('two','Second',20)]});
  state = selectRouteId(state,'two');
  const start = navigationProgress(selectedRoute(state), {lat:17,lng:78,accuracy:10});
  const middle = navigationProgress(selectedRoute(state), {lat:17,lng:78.005,accuracy:10});
  assert.equal(selectedRoute(state).id,'two'); assert.match(maneuverText(middle.nextStep),/Second/);
  assert.ok(middle.remainingKm < start.remainingKm); assert.ok(middle.remainingMinutes < start.remainingMinutes);
  assert.ok(Math.abs(middle.remainingMinutes-10)<0.05);
});
test('accurate repeated fixes confirm deviation and arrival; poor accuracy suppresses them', () => {
  const selected = route('one','Road',16);
  const first = navigationProgress(selected,{lat:17.002,lng:78.005,accuracy:10});
  assert.equal(first.offRoute,false);
  assert.equal(navigationProgress(selected,{lat:17.002,lng:78.005,accuracy:10}, first).offRoute,true);
  const poor = navigationProgress(selected,{lat:17.002,lng:78.005,accuracy:200});
  assert.equal(poor.offRoute,false); assert.equal(poor.arrived,false); assert.equal(poor.poorGps,true);
  const arrival = navigationProgress(selected,{lat:17,lng:78.01,accuracy:10});
  assert.equal(arrival.arrived,false);
  assert.equal(navigationProgress(selected,{lat:17,lng:78.01,accuracy:10}, arrival).arrived,true);
  assert.equal(navigationProgress({...selected,isApproximate:true},{lat:17,lng:78,accuracy:10}),null);
});
test('route progress does not move backwards on noisy fixes', () => {
  const selected = route('one','Road',16);
  const first = navigationProgress(selected,{lat:17,lng:78.007,accuracy:10});
  const second = navigationProgress(selected,{lat:17,lng:78.006,accuracy:10},first);
  assert.equal(second.remainingKm, first.remainingKm);
});
test('follow recenter ignores poor GPS, small movements and rapid fixes', () => {
  const previous = {lat:17,lng:78,at:1000};
  assert.equal(shouldRecenterFollow({lat:17.002,lng:78,accuracy:200},previous,4000),false);
  assert.equal(shouldRecenterFollow({lat:17.00001,lng:78,accuracy:10},previous,4000),false);
  assert.equal(shouldRecenterFollow({lat:17.002,lng:78,accuracy:10},previous,2000),false);
  assert.equal(shouldRecenterFollow({lat:17.002,lng:78,accuracy:10},previous,4000),true);
});
