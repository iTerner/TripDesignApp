import { packetJsonSchema } from "./jsonSchema";

test("response JSON schema is an object schema with the top-level array and no $schema key", () => {
  const s = packetJsonSchema("trends") as {
    type: string;
    properties: Record<string, unknown>;
    $schema?: string;
  };
  expect(s.type).toBe("object");
  expect(Object.keys(s.properties)).toEqual(["findings"]);
  expect(s.$schema).toBeUndefined();
  expect(JSON.stringify(s)).toContain("food.dessert");
});

test("every packet type has a schema", () => {
  for (const t of ["areas", "trends", "enrich", "stays"] as const) {
    expect((packetJsonSchema(t) as { type: string }).type).toBe("object");
  }
});
