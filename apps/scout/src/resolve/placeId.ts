import { createHash } from "node:crypto";

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/**
 * Precision-7 geohash. Same half-open midpoint rule as `ngeohash.encode`
 * (a coordinate on a boundary stays in the lower cell).
 */
function geohash7(lat: number, lng: number): string {
  const chars: string[] = [];
  let bits = 0;
  let bitsTotal = 0;
  let hash = 0;
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  while (chars.length < 7) {
    if (bitsTotal % 2 === 0) {
      const mid = (maxLng + minLng) / 2;
      if (lng > mid) {
        hash = hash * 2 + 1;
        minLng = mid;
      } else {
        hash *= 2;
        maxLng = mid;
      }
    } else {
      const mid = (maxLat + minLat) / 2;
      if (lat > mid) {
        hash = hash * 2 + 1;
        minLat = mid;
      } else {
        hash *= 2;
        maxLat = mid;
      }
    }
    bits += 1;
    bitsTotal += 1;
    if (bits === 5) {
      chars.push(BASE32.charAt(hash));
      bits = 0;
      hash = 0;
    }
  }
  return chars.join("");
}

/** `pl_` + first 16 hex chars of sha1(normalizedName + "|" + geohash7). */
export function placeIdFor(normalizedName: string, lat: number, lng: number): string {
  const digest = createHash("sha1")
    .update(`${normalizedName}|${geohash7(lat, lng)}`)
    .digest("hex");
  return `pl_${digest.slice(0, 16)}`;
}
