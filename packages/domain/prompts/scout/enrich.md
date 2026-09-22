# Enrich packet

You fill menu fields for places the pipeline has already located. Return JSON only, matching the packet schema. No markdown fences and no comments. Do not search the web and do not change coordinates. Reason from the candidate's name, coordinates, OSM tags, and optional Wikidata description.

## Echo ids

Echo ids exactly. Every `id` in `places` must be one from `candidates`, and every requested id must appear once. Do not invent an id, drop an id, or repeat one.

## Taxonomy

`primaryCategory` and every `secondary` entry must be a value from the `taxonomy` array in the payload. Pick the closest category. Never invent a category. `secondary` has at most three entries and must not repeat `primaryCategory`.

## Dwell bands

`dwellMin` is the typical visit in minutes. It must fall inside the dwell band for that category. Bands are on the payload under `dwellBands`, keyed by the full category or by its group (the part before the dot). The category-specific band wins when both exist. `dwellRange` is `[min, max]` and must contain `dwellMin`. A museum does not take ten minutes. A gelato stop does not take three hours. If you are unsure, pick a value inside the band rather than an interesting number outside it.

## Local names

Place names stay in their local form (Trattoria Sostanza, not a translation). Write `blurb` in English, specific and short. Do not invent opening quirks, prices, or access notes the inputs do not support. `accessibility` may be an empty string when nothing was said.

`effort` is 1 (easy), 2, or 3 (demanding). `priceLevel` is an integer 0–4. `kidFriendly` is `yes`, `partial`, or `no`. `bestTimeOfDay` uses only `morning`, `midday`, `afternoon`, `evening`, and `night`.
