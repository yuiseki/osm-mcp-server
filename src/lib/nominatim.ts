// Nominatim's usage policy requires an identifying User-Agent; requests with
// the default one sent by Node's fetch are rejected with 403.
// https://operations.osmfoundation.org/policies/nominatim/
const headers = {
  "User-Agent": "osm-mcp-server/0.1.0 (+https://github.com/yuiseki/osm-mcp-server)",
};

export const geocodeNominatim = async (
  text: string
): Promise<{
  lat: number;
  lon: number;
}> => {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
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
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
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
