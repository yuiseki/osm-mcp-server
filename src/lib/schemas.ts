import { z } from "zod";

export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);

export const language = z
  .string()
  .optional()
  .describe(
    "Preferred language of names in the result, as an Accept-Language value (e.g. 'en' or 'ja,en')"
  );

export const place = z.object({
  name: z.string().nullable().describe("Name of the place, if it has one"),
  displayName: z.string().describe("Full name including the address"),
  lat: latitude,
  lon: longitude,
  osmType: z.string().describe("node, way or relation"),
  osmId: z.number(),
  category: z.string().describe("Main OSM tag key, e.g. amenity or railway"),
  type: z.string().describe("Its value, e.g. cafe or station"),
  boundingBox: z.object({
    south: z.number(),
    north: z.number(),
    west: z.number(),
    east: z.number(),
  }),
});
