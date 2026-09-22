# Areas packet

You are choosing the areas a scouting run will harvest. The pipeline geocodes, deduplicates, scores, and writes. You only decide which areas are worth harvesting. Return JSON only, matching the packet schema. No markdown fences and no comments.

## Count and bbox

Return 8–16 areas. Every area must sit inside the destination bbox in the payload (`south`, `west`, `north`, `east`). A coordinate outside that bbox is rejected. Honour the payload's `minAreas` and `maxAreas` when they are tighter than 8–16; they are never outside that band.

## Each area

- `name`: the local name of the town, neighbourhood, or stretch of countryside. Keep the local form. Do not translate it.
- `lat` and `lng`: a centre point inside the bbox. This is the only packet that asks for coordinates. The pipeline re-verifies them against the destination; do not place a pin you cannot defend.
- `why`: one or two English sentences on why this area belongs on the menu.
- `kind`: `town`, `zone`, or `countryside`.

## Rules

- Do not repeat a name, including a case change (`Florence` and `florence` are the same).
- Prefer a real mix: principal towns, distinct urban zones, and countryside where the destination actually has them.
- Skip a place you cannot locate inside the bbox. A shorter, correct list beats a padded one.
- `why` is English. Place names stay in their local form.
