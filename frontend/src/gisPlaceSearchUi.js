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

function renderPreviewPanel({ container, option, place, onConfirm, onCancel }) {
  const document = container.ownerDocument;
  container.querySelector(".map-search-confirm")?.remove();

  const panel = element(document, "section", "map-search-confirm");
  panel.dataset.previewId = String(place.id || `${place.lat},${place.lng}`);
  panel.setAttribute("aria-label", "Destination preview");
  panel.append(
    element(document, "strong", "", "Preview P"),
    element(document, "span", "map-search-preview-label", placeLabel(place)),
    element(document, "small", "", `Type: ${place.type || "other"}`),
    element(document, "small", "", `Location: ${placeLocality(place)}`),
    element(document, "small", "", `Coordinates: ${placeCoordinates(place)}`),
    element(document, "small", "", `Provider: ${place.provider || "unknown"}`)
  );

  const actions = element(document, "div", "map-search-preview-actions");
  const confirm = element(document, "button", "primary", "Confirm Destination");
  confirm.type = "button";
  confirm.dataset.action = "confirm-search-destination";
  confirm.addEventListener("click", (event) => {
    stopActionEvent(event);
    onConfirm(place);
  });

  const cancel = element(document, "button", "ghost", "Cancel Preview");
  cancel.type = "button";
  cancel.dataset.action = "cancel-search-preview";
  cancel.addEventListener("click", (event) => {
    stopActionEvent(event);
    onCancel(place);
    option.classList.remove("active");
    panel.remove();
  });

  actions.append(confirm, cancel);
  panel.append(actions);
  option.after(panel);
}

export function renderPlaceSearchCandidates({ container, places, onPreview, onConfirm, onCancel }) {
  container.textContent = "";
  const document = container.ownerDocument;

  places.forEach((place) => {
    const option = element(document, "button", "map-search-result");
    option.type = "button";
    option.dataset.action = "preview-search-result";
    option.dataset.placeId = String(place.id || `${place.lat},${place.lng}`);
    option.append(
      element(document, "strong", "", placeLabel(place)),
      element(document, "small", "", placeLocality(place)),
      element(document, "small", "", `${place.type || "other"} - ${placeCoordinates(place)}`)
    );

    option.addEventListener("click", (event) => {
      stopActionEvent(event);
      if (onPreview(place) === false) return;
      container.querySelectorAll(".map-search-result").forEach((item) => item.classList.remove("active"));
      option.classList.add("active");
      renderPreviewPanel({ container, option, place, onConfirm, onCancel });
      return;
    });

    container.append(option);
  });
}
