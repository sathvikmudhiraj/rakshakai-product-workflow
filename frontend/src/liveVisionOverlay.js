function numericBoxFromDetection(item = {}) {
  const raw = Array.isArray(item.box)
    ? item.box
    : Array.isArray(item.bbox)
      ? item.bbox
      : item.bbox && typeof item.bbox === "object"
        ? [item.bbox.x, item.bbox.y, item.bbox.width, item.bbox.height]
        : [item.x, item.y, item.width, item.height];
  const values = raw.map(Number);
  return values.length === 4 && values.every(Number.isFinite) ? values : null;
}

function safeDetectionLabel(item = {}) {
  const label = String(item.label || item.className || item.class || item.name || "").replace(/\s+/g, " ").trim();
  if (!label || /face\s*match|identity|identified|recognized|recognised/i.test(label)) return "Object";
  return label.slice(0, 80);
}

function confidencePercent(item = {}) {
  const value = Number(item.confidence ?? item.score ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}

export function detectionBadgeText(item = {}) {
  return `${safeDetectionLabel(item)} ${confidencePercent(item)}%`;
}

export function renderDetectionBoxes(detections = [], frameWidth = 1, frameHeight = 1, layer = null) {
  if (!layer && typeof document !== "undefined") layer = document.querySelector("#liveDetectionBoxes");
  if (!layer) return;
  const doc = layer.ownerDocument;
  layer.textContent = "";
  detections.forEach((item) => {
    const boxValues = numericBoxFromDetection(item);
    if (!boxValues) return;
    const [x, y, width, height] = boxValues;
    const normalized = Math.max(x, y, width, height) <= 1;
    const left = normalized ? x * 100 : (x / frameWidth) * 100;
    const top = normalized ? y * 100 : (y / frameHeight) * 100;
    const boxWidth = normalized ? width * 100 : (width / frameWidth) * 100;
    const boxHeight = normalized ? height * 100 : (height / frameHeight) * 100;
    const clampedLeft = Math.max(0, Math.min(100, left));
    const clampedTop = Math.max(0, Math.min(100, top));
    const clampedWidth = Math.max(0, Math.min(100 - clampedLeft, boxWidth));
    const clampedHeight = Math.max(0, Math.min(100 - clampedTop, boxHeight));
    const box = doc.createElement("div");
    box.className = "detection-box";
    box.style.left = `${clampedLeft}%`;
    box.style.top = `${clampedTop}%`;
    box.style.width = `${clampedWidth}%`;
    box.style.height = `${clampedHeight}%`;
    const badge = doc.createElement("span");
    badge.className = "detection-label-badge";
    badge.textContent = detectionBadgeText(item);
    const badgeWidth = 120;
    const badgeHeight = 22;
    let badgeLeft = clampedLeft;
    let badgeTop = clampedTop - badgeHeight;
    if (badgeTop < 0) {
      badgeTop = clampedTop + clampedHeight;
    }
    if (badgeLeft + badgeWidth > 100) {
      badgeLeft = Math.max(0, 100 - badgeWidth);
    }
    badge.style.left = `${badgeLeft}%`;
    badge.style.top = `${badgeTop}%`;
    layer.append(box);
    layer.append(badge);
  });
}
