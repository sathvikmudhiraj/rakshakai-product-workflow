export function previewPlace(navigation, place) {
  return {
    ...navigation,
    searchPreview: {
      ...place,
      label: place.label || place.displayName || place.name,
      lat: Number(place.lat),
      lng: Number(place.lng)
    }
  };
}

export function confirmPreviewDestination(navigation) {
  if (!navigation.searchPreview) return navigation;
  return {
    ...navigation,
    destination: { ...navigation.searchPreview },
    searchPreview: null,
    route: null,
    routeOptions: [],
    routes: [],
    selectedRouteId: null
  };
}

export function cancelPlacePreview(navigation) {
  return {
    ...navigation,
    searchPreview: null
  };
}
