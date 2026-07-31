function text(value, limit = 300) {
  return String(value || "").trim().slice(0, limit);
}

function normalizedAddress(address = {}) {
  return {
    city: text(address.city || address.municipality, 120),
    town: text(address.town || address.village || address.hamlet, 120),
    district: text(address.state_district || address.county || address.district, 120),
    state: text(address.state, 120),
    postcode: text(address.postcode, 32),
    country: text(address.country, 120)
  };
}

function normalizedPlaceType(item = {}) {
  const category = text(item.category || item.class, 80).toLowerCase();
  const type = text(item.addresstype || item.type, 80).toLowerCase();
  if (type === "city") return "city";
  if (type === "town") return "town";
  if (type === "place_of_worship" || (category === "amenity" && /church|cathedral|temple|mosque|shrine/.test(type))) {
    return "place_of_worship";
  }
  if (["house", "building", "road", "residential", "postcode"].includes(type)) return "address";
  if (["tourism", "historic", "natural", "man_made", "leisure"].includes(category)) return "landmark";
  return "other";
}

function normalizeNominatimResult(item = {}) {
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const label = text(item.display_name);
  if (!label) return null;
  const importance = Number(item.importance);
  return {
    id: text(item.place_id || item.osm_id || `${lat},${lng}`, 120),
    label,
    shortLabel: text(item.name || label.split(",")[0], 120),
    lat,
    lng,
    type: normalizedPlaceType(item),
    provider: "nominatim",
    importance: Number.isFinite(importance) ? importance : 0,
    address: normalizedAddress(item.address)
  };
}

function normalizeNominatimResults(data) {
  return (Array.isArray(data) ? data : []).map(normalizeNominatimResult).filter(Boolean);
}

module.exports = {
  normalizeNominatimResult,
  normalizeNominatimResults,
  normalizedAddress,
  normalizedPlaceType
};
