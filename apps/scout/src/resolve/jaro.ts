const PREFIX_SCALE = 0.1;
const PREFIX_MAX = 4;

/** Jaro–Winkler with prefix scale 0.1 and at most 4 prefix characters. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const jaro = jaroSimilarity(a, b);
  const prefix = commonPrefixLength(a, b);
  return jaro + prefix * PREFIX_SCALE * (1 - jaro);
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(PREFIX_MAX, a.length, b.length);
  let i = 0;
  while (i < limit && a.charAt(i) === b.charAt(i)) i += 1;
  return i;
}

function jaroSimilarity(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0 || bLen === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1);
  const aMatched = new Array<boolean>(aLen).fill(false);
  const bMatched = new Array<boolean>(bLen).fill(false);
  let matches = 0;
  for (let i = 0; i < aLen; i += 1) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, bLen);
    for (let j = start; j < end; j += 1) {
      if (bMatched[j] === true) continue;
      if (a.charAt(i) !== b.charAt(j)) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < aLen; i += 1) {
    if (aMatched[i] !== true) continue;
    while (k < bLen && bMatched[k] !== true) k += 1;
    if (a.charAt(i) !== b.charAt(k)) transpositions += 1;
    k += 1;
  }
  const half = transpositions / 2;
  return (matches / aLen + matches / bLen + (matches - half) / matches) / 3;
}
