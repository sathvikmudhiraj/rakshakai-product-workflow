function placeLabel(place = {}) {
  return place.label || place.displayName || place.name || "Unnamed provider result";
}

function placeLocality(place = {}) {
  const address = place.address || {};
  return [address.district, address.state, address.country].filter(Boolean).join(", ")
    || "District, state, and country unavailable";
}

function placeCoordinates(place = {}) {
  return `${Number(place.lat).toFixed(5)}, ${Number(place.lng).toFixed(5)}`;
}

function element(document, tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

function stopActionEvent(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

export function renderPlaceSearchCandidates({ container, places, onSelect }) {
  container.textContent = "";
  const document = container.ownerDocument;

  places.forEach((place) => {
    const option = element(document, "button", "map-search-result");
    option.type = "button";
    option.dataset.action = "select-search-result";
    option.dataset.placeId = String(place.id || `${place.lat},${place.lng}`);
    option.append(
      element(document, "strong", "", placeLabel(place)),
      element(document, "small", "", placeLocality(place)),
      element(document, "small", "", `${place.type || "other"} - ${placeCoordinates(place)}`)
    );

    option.addEventListener("click", (event) => {
      stopActionEvent(event);
      if (onSelect(place) === false) return;
      container.querySelectorAll(".map-search-result").forEach((item) => item.classList.remove("active"));
      option.classList.add("active");
      container.hidden = true;
    });

    container.append(option);
  });
}
