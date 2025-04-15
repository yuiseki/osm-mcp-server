export const geocodeNominatim = async (
  text: string
): Promise<{
  lat: number;
  lon: number;
}> => {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      text
    )}`
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
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
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
