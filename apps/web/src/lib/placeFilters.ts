import type { BackendId, Place, PlaceCategory, PlaceStatus } from "@wayfare/domain";

export interface PlaceFilters {
  area?: string;
  category?: PlaceCategory;
  status?: PlaceStatus;
  backend?: BackendId;
  hasTrend?: boolean;
  hasOverride?: boolean;
  possiblyClosed?: boolean;
}

/** In-memory filters. Firestore queries stay on one orderBy so they use automatic indexes. */
export function placeMatches(place: Place, filters: PlaceFilters): boolean {
  if (filters.area !== undefined && place.areaName !== filters.area) return false;
  if (filters.category !== undefined && place.primaryCategory !== filters.category) return false;
  if (filters.status !== undefined && place.status !== filters.status) return false;
  if (filters.backend !== undefined && place.backend !== filters.backend) return false;
  if (filters.hasTrend === true && !(place.trendScore > 0)) return false;
  if (filters.hasOverride === true && Object.keys(place.adminOverrides).length === 0) return false;
  if (filters.possiblyClosed === true && place.notSeenSince === undefined) return false;
  return true;
}
