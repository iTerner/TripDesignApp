# Trends packet

You are reporting places people are talking about for one area and one theme. The payload gives the area, the theme, suggested queries, `maxFindings`, and the year. Search, open pages, then answer. Return JSON only, matching the packet schema. No markdown fences and no comments.

## Hard rules

- Only report a place you found on a web page you actually opened. `sourceUrl` is that page. `evidenceQuote` is copied verbatim from it (≤ 240 characters). No paraphrasing. If your search finds nothing credible for a theme, return an empty `findings` array — that is a correct answer.
- Never invent coordinates. Only areas packets ask for coordinates, and the CLI re-verifies them. Everywhere else, leave location to the pipeline.
- `sourceUrl` must be a real http(s) URL of a page you opened. Do not cite a search-results page you did not read, and do not guess a URL.
- `evidenceQuote` is a verbatim quote from that page, at most 240 characters. Do not paraphrase, stitch two sentences, or tidy the wording.
- An empty `findings` array is allowed and is the correct answer when nothing credible turns up. Do not pad the list.
- Do not invent coordinates. This packet has no coordinate fields. Do not add any.
- `category` comes from the taxonomy. `platformMentioned` is the platform the page is actually talking about (`tiktok`, `instagram`, `reddit`, `blog`, or `news`).
- Stay at or under `maxFindings`. The same place name and `sourceUrl` twice is a duplicate and is rejected.
- Place names stay in their local form. `whyTrending` is English, specific, and honest.
- `approxDate`, when present, is `YYYY` or `YYYY-MM` taken from the page, not a guess.

## How to work

1. Run the payload queries. A close variant is fine when the template returns nothing.
2. Open the page behind each URL you might cite. If the page does not mention the place, drop it.
3. Copy `evidenceQuote` from the page text. If you cannot copy a real span of that page, do not emit the finding.
