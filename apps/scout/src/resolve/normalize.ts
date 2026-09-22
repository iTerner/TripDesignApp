/** Whole-token venue words and articles (spec §4), matched after diacritics are stripped. */
const GENERIC_TOKENS = new Set([
  "ristorante",
  "trattoria",
  "osteria",
  "pizzeria",
  "gelateria",
  "pasticceria",
  "bar",
  "caffe",
  "museo",
  "chiesa",
  "basilica",
  "palazzo",
  "the",
  "il",
  "la",
  "le",
  "i",
  "gli",
]);

/**
 * lowercase → strip diacritics → strip punctuation → drop generic prefix/suffix
 * tokens → collapse whitespace. A sole remaining token is kept, even if generic.
 */
export function normalizeName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/ +/g, " ");
  if (cleaned.length === 0) return "";
  const tokens = cleaned.split(" ");
  let start = 0;
  let end = tokens.length;
  while (start < end - 1 && GENERIC_TOKENS.has(tokens[start] ?? "")) start += 1;
  while (end > start + 1 && GENERIC_TOKENS.has(tokens[end - 1] ?? "")) end -= 1;
  return tokens.slice(start, end).join(" ");
}
