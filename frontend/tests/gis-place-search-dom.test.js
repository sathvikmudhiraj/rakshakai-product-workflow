import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderPlaceSearchCandidates } from "../src/gisPlaceSearchUi.js";

const medak = {
  id: "246332479",
  label: "Medak, Telangana, India",
  lat: 17.9375095,
  lng: 78.211745,
  type: "city",
  provider: "nominatim",
  address: { district: "Medak", state: "Telangana", country: "India" }
};

test("selecting a search result immediately selects the place without a hidden confirmation step", () => {
  const dom = new JSDOM("<main><div id=results></div><div id=details hidden></div></main>");
  const results = dom.window.document.querySelector("#results");
  const details = dom.window.document.querySelector("#details");
  let selected = null;
  renderPlaceSearchCandidates({
    container: results,
    places: [medak],
    onSelect: (place) => {
      selected = place;
      details.hidden = false;
      details.textContent = `${place.label} ${place.address.district}, ${place.address.state} ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)} ${place.provider}`;
      return true;
    }
  });

  results.querySelector(".map-search-result").click();

  assert.equal(selected, medak);
  assert.equal(results.hidden, true);
  assert.match(details.textContent, /Medak, Telangana/);
  assert.match(details.textContent, /17\.93751, 78\.21174/);
  assert.match(details.textContent, /nominatim/);
  assert.equal(results.querySelector("[data-action='confirm-search-destination']"), null);
  assert.equal(results.querySelector("[data-action='cancel-search-preview']"), null);
});
