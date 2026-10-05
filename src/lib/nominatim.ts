import { endpoints, userAgent } from "./config.js";

const headers = { "User-Agent": userAgent };

export const geocodeNominatim = async (
  text: string
): Promise<{
  lat: number;
  lon: number;
}> => {
  const response = await fetch(
    `${endpoints().nominatim}/search?format=json&q=${encodeURIComponent(
      text
    )}`,
    { headers }
  );
  if (!response.ok) {
    throw new Error(`Error fetching geocode data: ${response.statusText}`);
  }
  const data = await response.json();
  if (data.length === 0) {
    throw new Error("No results found");
  }
  const { lat, lon } = data[0];
  return {
    lat: parseFloat(lat),
    lon: parseFloat(lon),
  };
};

export const reverseGeocodeNominatim = async (
  lat: number,
  lon: number
): Promise<{
  displayName: string;
}> => {
  const response = await fetch(
    `${endpoints().nominatim}/reverse?format=json&lat=${lat}&lon=${lon}`,
    { headers }
  );
  if (!response.ok) {
    throw new Error(
      `Error fetching reverse geocode data: ${response.statusText}`
    );
  }
  const data = await response.json();
  if (!data.address) {
    throw new Error("No address found");
  }
  return {
    displayName: data.display_name,
  };
};
