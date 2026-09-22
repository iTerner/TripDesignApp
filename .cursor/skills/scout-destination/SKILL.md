---
name: scout-destination
description: Build or refresh the verified place menu for one destination by answering scout work packets. Use when the owner says "scout <destination>", "refresh trends for <destination>", or runs /scout-destination.
---

# Scout a destination

You are the intelligence backend for the scouting pipeline. The pipeline (code) does the harvesting,
geocoding, de-duplication, scoring and all database writes. You do only the thinking it asks for,
one packet at a time. You never write to Firestore and you never see API keys.

## Start

1. Confirm the destination slug (e.g. `tuscany`). If it is not in the queue, say so and stop.
2. Run: `pnpm scout <slug> --backend agent`
   The CLI harvests places and then writes packets to `work/<slug>/packets/`.
3. Run `pnpm scout <slug> --status` whenever you want the progress board.

## The loop

Repeat until `--status` shows no pending packets and the stage is `done`:

1. Open the **oldest** `*.request.json` that has no `*.response.json`.
2. Read `instructions`, `schema` and `payload` in the file. Do exactly what `instructions` says.
3. Write your answer to the same path with `.response.json` instead of `.request.json`.
   The file must be valid JSON matching `schema` — nothing else, no comments, no markdown.
4. Run `pnpm scout <slug> --backend agent` again. The CLI validates your response and either
   advances (new packets appear) or writes `*.rejected.json` next to it.
5. If a packet was rejected, open the `.rejected.json`, fix **only** the listed items in your
   response file, and re-run. After three rejections of the same packet, stop and report.

You may process several `enrich-*` packets in parallel (they are independent). Never edit request
files, other packets' responses, or anything outside `work/<slug>/packets/`.

## Hard rules

- **Trends packets:** only report a place you found on a web page you actually opened. `sourceUrl`
  is that page. `evidenceQuote` is copied verbatim from it (≤ 240 characters). No paraphrasing.
  If your search finds nothing credible for a theme, return an empty `findings` array — that is a
  correct answer.
- **Never invent coordinates.** Only `areas` packets ask for coordinates, and the CLI re-verifies
  them. Everywhere else, leave location to the pipeline.
- **Echo ids exactly.** In `enrich` packets every `id` in your response must be one from the
  request, and every requested id must appear once.
- **Categories** come from the taxonomy enum listed in the packet. Pick the closest; never invent.
- **Be specific, be honest.** Prefer independent, local, currently-open places. Skip chains,
  closed places, and anything you cannot place in the right area. A shorter, correct answer beats a
  long, padded one.
- Language: English. Place names in their local form (Trattoria Sostanza, not a translation).

## Good answers (abridged)

`trends-07.response.json` (theme: dessert, area: Florence)
{
  "findings": [
    {
      "placeName": "Gelateria La Sorbettiera",
      "category": "food.dessert",
      "whyTrending": "Repeatedly named the best gelato in Oltrarno in 2026 posts; pistachio and
                      ricotta-fig flavours singled out",
      "sourceUrl": "https://example-blog.com/florence-gelato-2026",
      "platformMentioned": "tiktok",
      "evidenceQuote": "La Sorbettiera in Piazza Tasso is the one that went viral on TikTok this
                        spring, and it deserves it",
      "approxDate": "2026-05"
    }
  ]
}

`enrich-12.response.json` (one of 30)
{
  "id": "pl_3f9a…",
  "primaryCategory": "culture.museum",
  "secondary": ["history.landmark"],
  "dwellMin": 150,
  "dwellRange": [120, 210],
  "effort": 2,
  "indoor": true,
  "needsBooking": true,
  "queueBufferMin": 45,
  "bestTimeOfDay": ["morning"],
  "kidFriendly": "partial",
  "accessibility": "step-free entrance; lifts to all floors",
  "priceLevel": 2,
  "blurb": "The Medici's own collection: Botticelli, Leonardo and da Vinci's rooms in a
            16th-century office block turned world museum."
}

## Common mistakes (the CLI rejects these)

- A quote that is not on the cited page (`quote not found in cited page`).
- A well-known chain or a place outside the area's bbox (`coords outside bbox`).
- An id that was not in the request, or a missing id (`unknown id` / `missing id`).
- `dwellMin` of 10 for a major museum, or 180 for a gelato shop (`dwell implausible for category`).
- Markdown fences or comments in the JSON file (`invalid JSON`).

## Finish

1. Run `pnpm scout <slug> --report` and paste the summary to the owner: places written, trending
   with verified quotes, rejected packets and why, pending merges, budget.
2. Tell the owner to open Admin → Scouting → Review to judge the run.

## When stuck

Three rejections on one packet, a stage error in the CLI, or `work/` missing → stop, paste the
exact message, and wait. Do not work around the pipeline.
