import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const appSource = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const begin = appSource.indexOf("function locationDistrictState(location) {");
const end = appSource.indexOf("function showSelectedGisLocation(", begin);

test("selected-location card shows disambiguating details and all explicit route actions", () => {
  assert.ok(begin >= 0 && end > begin);
  const dom = new JSDOM("<section id=card hidden></section>");
  const card = dom.window.document.querySelector("#card");
  const actions = [];
  const context = vm.createContext({
    selectedGisLocation: {
      label: "Medak, Telangana, India",
      displayName: "Medak, Medak District, Telangana, India",
      lat: 17.9375095,
      lng: 78.211745,
      source: "nominatim",
      address: { district: "Medak", state: "Telangana", country: "India" },
      addressStatus: "available"
    },
    node: (tag, className, text) => {
      const element = dom.window.document.createElement(tag);
      element.className = className;
      element.textContent = String(text);
      return element;
    },
    applySelectedLocationAction: (action) => actions.push(action)
  });
  vm.runInContext(appSource.slice(begin, end), context);
  context.renderSelectedGisLocation({ selectedLocationCard: card });

  assert.equal(card.hidden, false);
  assert.match(card.textContent, /Medak District/);
  assert.match(card.textContent, /Medak, Telangana, India/);
  assert.match(card.textContent, /17\.93751, 78\.21174/);
  assert.match(card.textContent, /Source: nominatim/);
  const buttons = [...card.querySelectorAll("button")];
  assert.deepEqual(buttons.map((button) => button.textContent), ["Directions", "Set as Start", "Set as Destination", "Close"]);
  buttons.forEach((button) => button.click());
  assert.deepEqual(actions, ["directions", "start", "destination", "close"]);
});

test("map-click card keeps coordinates when reverse geocoding is unavailable", () => {
  const dom = new JSDOM("<section id=card hidden></section>");
  const card = dom.window.document.querySelector("#card");
  const context = vm.createContext({
    selectedGisLocation: {
      label: "Map location", lat: 17.5109, lng: 78.3276, source: "Map click",
      address: {}, addressStatus: "unavailable"
    },
    node: (tag, className, text) => {
      const element = dom.window.document.createElement(tag);
      element.className = className;
      element.textContent = String(text);
      return element;
    },
    applySelectedLocationAction() {}
  });
  vm.runInContext(appSource.slice(begin, end), context);
  context.renderSelectedGisLocation({ selectedLocationCard: card });
  assert.match(card.textContent, /Address unavailable/);
  assert.match(card.textContent, /17\.51090, 78\.32760/);
});
