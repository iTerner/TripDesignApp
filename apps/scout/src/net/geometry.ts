import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { AreaKind, BBox, LatLng, ScoutConfig } from "@wayfare/domain";
import type { MultiPolygon, Polygon } from "geojson";

/** Circle bbox. Degrees: lat += km/110.574, lng += km/(111.320*cos(lat)). */
export function areaCircleBBox(center: LatLng, kind: AreaKind, cfg: ScoutConfig): BBox {
  const km = cfg.areaRadiusKm[kind];
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  return {
    south: center.lat - dLat,
    north: center.lat + dLat,
    west: center.lng - dLng,
    east: center.lng + dLng,
  };
}

export function pointInside(lat: number, lng: number, polygon: Polygon | MultiPolygon): boolean {
  return booleanPointInPolygon([lng, lat], polygon);
}
