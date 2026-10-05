export type LatLon = { lat: number; lon: number };

/** Great-circle distance in metres, rounded. */
export const distanceMetres = (a: LatLon, b: LatLon) => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371008.8 * Math.asin(Math.sqrt(h)));
};
