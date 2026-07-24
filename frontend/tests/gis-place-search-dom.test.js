import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  cancelPlacePreview,
  confirmPreviewDestination,
  previewPlace
} from "../src/gisPlaceSelection.js";
import { renderPlaceSearchCandidates } from "../src/gisPlaceSearchUi.js";
import { emptyRouteNavigationState } from "../src/gisRouteState.js";

const medak = {
  id: "246332479",
  label: "Medak, Telangana, India",
  lat: 17.9375095,
  lng: 78.211745,
  type: "other",
  provider: "nominatim",
  locationStatus: "Provider result",
  address: {
    district: "Medak",
    state: "Telangana",
    country: "India"
  }
};

function setup(initialNavigation = emptyRouteNavigationState()) {
  const dom = new JSDOM("<main><div id=\"results\"></div><div id=\"markers\"></div></main>");
  const { document, MouseEvent } = dom.window;
  const results = document.querySelector("#results");
  const markers = document.querySelector("#markers");
  let navigation = initialNavigation;
  let previewCalls = 0;
  let confirmCalls = 0;

  const renderPreviewMarker = () => {
    markers.textContent = "";
    if (!navigation.searchPreview) return;
    const marker = document.createElement("span");
    marker.className = "search-preview-marker";
    marker.textContent = "P";
    markers.append(marker);
  };

  renderPlaceSearchCandidates({
    container: results,
    places: [medak],
    onPreview: (place) => {
      previewCalls += 1;
      navigation = previewPlace(navigation, place);
      renderPreviewMarker();
      return true;
    },
    onConfirm: () => {
      confirmCalls += 1;
      navigation = confirmPreviewDestination(navigation);
      renderPreviewMarker();
    },
    onCancel: () => {
      navigation = cancelPlacePreview(navigation);
      renderPreviewMarker();
    }
  });

  const click = (target) => target.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true
  }));

  return {
    document,
    click,
    navigation: () => navigation,
    previewCalls: () => previewCalls,
    confirmCalls: () => confirmCalls
  };
}

test("one provider-result click renders preview P without confirming destination", () => {
  const page = setup();
  page.click(page.document.querySelector(".map-search-result"));

  assert.equal(page.previewCalls(), 1);
  assert.equal(page.confirmCalls(), 0);
  assert.equal(page.navigation().destination, null);
  assert.equal(page.navigation().searchPreview.label, medak.label);
  assert.equal(page.document.querySelectorAll(".search-preview-marker").length, 1);
  assert.equal(page.document.querySelector(".search-preview-marker").textContent, "P");
  assert.equal(page.document.querySelectorAll(".map-search-confirm").length, 1);
  assert.match(page.document.querySelector(".map-search-confirm").textContent, /Medak, Telangana, India/);
  assert.match(page.document.querySelector(".map-search-confirm").textContent, /Location: Medak, Telangana, India/);
  assert.match(page.document.querySelector(".map-search-confirm").textContent, /17\.93751, 78\.21174/);
  assert.match(page.document.querySelector(".map-search-confirm").textContent, /Provider: nominatim/);

  page.click(page.document.querySelector("[data-action='confirm-search-destination']"));

  assert.equal(page.confirmCalls(), 1);
  assert.equal(page.navigation().searchPreview, null);
  assert.equal(page.navigation().destination.label, medak.label);
  assert.equal(page.document.querySelectorAll(".search-preview-marker").length, 0);
});

test("Cancel Preview clears only P and preserves an existing destination", () => {
  const existingDestination = {
    id: "existing",
    label: "Previously confirmed destination",
    lat: medak.lat,
    lng: medak.lng
  };
  const page = setup(emptyRouteNavigationState({ destination: existingDestination }));

  page.click(page.document.querySelector(".map-search-result"));
  assert.equal(page.navigation().destination, existingDestination);
  assert.equal(page.navigation().searchPreview.label, medak.label);
  assert.equal(page.document.querySelectorAll(".search-preview-marker").length, 1);

  page.click(page.document.querySelector("[data-action='cancel-search-preview']"));

  assert.equal(page.navigation().searchPreview, null);
  assert.equal(page.navigation().destination, existingDestination);
  assert.equal(page.document.querySelectorAll(".search-preview-marker").length, 0);
  assert.equal(page.document.querySelectorAll(".map-search-confirm").length, 0);
  assert.equal(page.confirmCalls(), 0);
});
