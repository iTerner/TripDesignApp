import { DEFAULT_SCOUT_CONFIG, StaysRequestSchema } from "@wayfare/domain";
import { staysPackets, validateStays } from "./06-stays";

const florence = { name: "Florence", lat: 43.7696, lng: 11.2558, kind: "town" as const };

test("includes a hotel 1 km from Florence and drops one 50 km away", () => {
  const packets = staysPackets(
    [florence],
    [
      {
        name: "Hotel Lungarno",
        lat: 43.7786,
        lng: 11.2558,
        tourism: "hotel",
        website: "https://lungarno.example",
      },
      { name: "Hotel Distant", lat: 44.2196, lng: 11.2558, tourism: "hotel" },
      { name: "Trattoria Sostanza", lat: 43.7786, lng: 11.2558, tourism: "restaurant" },
      { name: "Guest House Pitti", lat: 43.7786, lng: 11.2683, tourism: "guest_house" },
      { name: "Apartment Duomo", lat: 43.7786, lng: 11.2558, tourism: "apartment" },
      { name: "Hostel Santa Croce", lat: 43.7786, lng: 11.2558, tourism: "hostel" },
      { name: "Chalet Boboli", lat: 43.7786, lng: 11.2558, tourism: "chalet" },
    ],
    DEFAULT_SCOUT_CONFIG,
  );

  expect(packets).toHaveLength(1);
  const packet = packets[0];
  expect(packet?.packetId).toBe("stays-1");
  expect(packet?.request.area).toEqual(florence);
  expect(packet?.request.areaFacts).toEqual([]);
  expect(packet?.request.accommodations.map((a) => a.name).sort()).toEqual([
    "Apartment Duomo",
    "Chalet Boboli",
    "Guest House Pitti",
    "Hostel Santa Croce",
    "Hotel Lungarno",
  ]);
  const lungarno = packet?.request.accommodations.find((a) => a.name === "Hotel Lungarno");
  expect(lungarno?.website).toBe("https://lungarno.example");
  const pitti = packet?.request.accommodations.find((a) => a.name === "Guest House Pitti");
  expect(pitti?.website).toBeUndefined();
  expect(StaysRequestSchema.parse(packet?.request).accommodations).toHaveLength(5);
  expect(
    packets.some((p) => p.request.accommodations.some((a) => a.name === "Hotel Distant")),
  ).toBe(false);
});

test("assigns a stay to the nearest area centre inside that area's radius", () => {
  const oltrarno = { name: "Oltrarno", lat: 43.7606, lng: 11.2558, kind: "zone" as const };
  const packets = staysPackets(
    [florence, oltrarno],
    [{ name: "Hotel Silla", lat: 43.7624, lng: 11.2558, tourism: "guest_house" }],
    DEFAULT_SCOUT_CONFIG,
  );

  expect(packets.map((p) => p.packetId)).toEqual(["stays-1"]);
  expect(packets.map((p) => p.request.area.name)).toEqual(["Oltrarno"]);
  expect(packets[0]?.request.accommodations.map((a) => a.name)).toEqual(["Hotel Silla"]);
});

test("drops a stay that is outside a zone radius", () => {
  const oltrarno = { name: "Oltrarno", lat: 43.7606, lng: 11.2558, kind: "zone" as const };
  const packets = staysPackets(
    [oltrarno],
    [{ name: "Hotel Outside", lat: 43.7786, lng: 11.2558, tourism: "hostel" }],
    DEFAULT_SCOUT_CONFIG,
  );
  expect(packets).toEqual([]);
});

test("keeps at most 60 accommodations on a stays request", () => {
  const accommodations = Array.from({ length: 61 }, (_, i) => ({
    name: `Hotel ${i + 1}`,
    lat: 43.7786,
    lng: 11.2558,
    tourism: "hotel",
  }));
  const packets = staysPackets([florence], accommodations, DEFAULT_SCOUT_CONFIG);
  expect(packets[0]?.request.accommodations).toHaveLength(60);
  expect(packets[0]?.request.accommodations[59]?.name).toBe("Hotel 60");
  expect(StaysRequestSchema.safeParse(packets[0]?.request).success).toBe(true);
});

const zone = {
  name: "Oltrarno",
  rationale: "quiet, artisan streets, 10 min walk to the Uffizi",
  exampleProperties: [{ name: "Hotel Palazzo Guadagni", priceLevel: 3 }],
};

test("rejects zero zones, a sixth example property, and an unknown field", () => {
  const empty = validateStays({ zones: [] });
  expect(empty.ok).toBe(false);
  if (!empty.ok) expect(empty.reasons.length).toBeGreaterThan(0);

  const five = Array.from({ length: 5 }, (_, i) => ({
    name: `Hotel ${i + 1}`,
    priceLevel: 2,
  }));
  const atMax = validateStays({ zones: [{ ...zone, exampleProperties: five }] });
  expect(atMax.ok).toBe(true);

  const six = [...five, { name: "Hotel 6", priceLevel: 2 }];
  const overMax = validateStays({ zones: [{ ...zone, exampleProperties: six }] });
  expect(overMax.ok).toBe(false);
  if (!overMax.ok) {
    expect(overMax.reasons.some((r) => r.path.includes("exampleProperties"))).toBe(true);
  }

  const secret = validateStays({ zones: [zone], secret: "nope" });
  expect(secret.ok).toBe(false);
  if (!secret.ok) {
    expect(secret.reasons.some((r) => r.path === "secret" || r.reason.includes("secret"))).toBe(
      true,
    );
  }
});
