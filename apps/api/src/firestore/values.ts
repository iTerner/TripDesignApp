export type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export function toFirestoreValue(v: unknown): FirestoreValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number")
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === "object") {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFirestoreValue(val);
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported Firestore value: ${typeof v}`);
}

export function fromFirestoreValue(v: FirestoreValue): unknown {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(fromFirestoreValue);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v.mapValue.fields ?? {})) out[k] = fromFirestoreValue(val);
  return out;
}

export function fromFirestoreDocument(doc: {
  fields?: Record<string, FirestoreValue>;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields ?? {})) out[k] = fromFirestoreValue(v);
  return out;
}
