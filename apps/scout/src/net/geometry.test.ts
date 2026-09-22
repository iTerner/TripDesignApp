import { DEFAULT_SCOUT_CONFIG } from "@wayfare/domain";
import type { Polygon } from "geojson";
import { areaCircleBBox, pointInside } from "./geometry";

const florenceSquare: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [11.2, 43.7],
      [11.3, 43.7],
      [11.3, 43.85],
      [11.2, 43.85],
      [11.2, 43.7],
    ],
  ],
};

test("town circle bbox spans roughly ±3 km north-south", () => {
  const bbox = areaCircleBBox({ lat: 43.77, lng: 11.25 }, "town", DEFAULT_SCOUT_CONFIG);
  const northSouth = bbox.north - bbox.south;
  expect(northSouth).toBeGreaterThan(0.04);
  expect(northSouth).toBeLessThan(0.07);
  expect(bbox.south).toBeLessThan(43.77);
  expect(bbox.north).toBeGreaterThan(43.77);
  expect(bbox.west).toBeLessThan(11.25);
  expect(bbox.east).toBeGreaterThan(11.25);

  const countryside = areaCircleBBox(
    { lat: 43.77, lng: 11.25 },
    "countryside",
    DEFAULT_SCOUT_CONFIG,
  );
  expect(countryside.north - countryside.south).toBeGreaterThan(northSouth);
});

test("pointInside accepts Florence centre and rejects Rome", () => {
  expect(pointInside(43.77, 11.25, florenceSquare)).toBe(true);
  expect(pointInside(41.89, 12.49, florenceSquare)).toBe(false);
  expect(
    pointInside(43.77, 11.25, {
      type: "MultiPolygon",
      coordinates: [florenceSquare.coordinates],
    }),
  ).toBe(true);
});
