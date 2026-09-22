import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Place, PlaceSchema, type ScoutRun } from "@wayfare/domain";
import type { ReactElement, ReactNode } from "react";
import { AdminShell } from "../admin/AdminShell";
import { MergesPage } from "../admin/MergesPage";
import { PlacesPage } from "../admin/PlacesPage";
import { ReviewPage } from "../admin/ReviewPage";
import { ScoutingPage } from "../admin/ScoutingPage";
import { initI18n } from "../i18n";
import {
  type DestinationRead,
  getPlace,
  getReviewSession,
  listDestinations,
  listEvidence,
  listOpenMerges,
  listPlaces,
  listScoutRuns,
} from "../lib/adminFirestore";
import { ApiClientError } from "../lib/api";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, apiFetch };
});

vi.mock("../lib/useAuth", () => ({
  useAuth: () => ({
    user: { uid: "owner" },
    loading: false,
    getIdToken: async () => "fake-token",
  }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    Link: (props: { children?: ReactNode }) =>
      createElement("a", { href: "/admin" }, props.children),
    Outlet: () => null,
  };
});

vi.mock("../lib/adminFirestore", () => ({
  listDestinations: vi.fn(),
  listScoutRuns: vi.fn(),
  listPlaces: vi.fn(),
  listEvidence: vi.fn(),
  listOpenMerges: vi.fn(),
  getPlace: vi.fn(),
  getReviewSession: vi.fn(),
}));

function renderAdmin(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function hasKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasKey(item, key));
  return Object.entries(value).some(([entry, child]) => entry === key || hasKey(child, key));
}

function samplePlace(): Place {
  return PlaceSchema.parse({
    id: "pl_1",
    destSlug: "tuscany",
    name: "Museo Galileo",
    normalizedName: "galileo",
    geohash7: "spz7x8k",
    lat: 43.7678,
    lng: 11.2559,
    areaName: "Florence",
    secondary: [],
    bestTimeOfDay: [],
    hoursStatus: "known",
    fameScore: 55,
    trendScore: 0,
    sources: [],
    source: "scout",
    runId: "run_1",
    packetIds: [],
    aliases: [],
    externalIds: {},
    verification: { geocoded: true, sourcesCount: 0, quoteVerified: false },
    adminOverrides: {},
    status: "active",
    firstSeenAt: "2026-09-21T10:00:00.000Z",
    lastSeenRunId: "run_1",
    timesFlagged: 0,
    primaryCategory: "culture.museum",
  });
}

const tuscany: DestinationRead = {
  slug: "tuscany",
  name: "Tuscany",
  kind: "region",
  queueOrder: 0,
  status: "queued",
  requestedBy: "admin",
  counts: { scouted: 0, userFound: 0, trending: 0, hidden: 0 },
};

beforeEach(() => {
  initI18n("en");
  apiFetch.mockReset();
  vi.mocked(listDestinations).mockReset();
  vi.mocked(listScoutRuns).mockReset();
  vi.mocked(listPlaces).mockReset();
  vi.mocked(listEvidence).mockReset();
  vi.mocked(listOpenMerges).mockReset();
  vi.mocked(getPlace).mockReset();
  vi.mocked(getReviewSession).mockReset();
  vi.mocked(listDestinations).mockResolvedValue([]);
  vi.mocked(listScoutRuns).mockResolvedValue([]);
  vi.mocked(listPlaces).mockResolvedValue({ places: [], nextCursor: null });
  vi.mocked(listEvidence).mockResolvedValue([]);
  vi.mocked(listOpenMerges).mockResolvedValue([]);
  vi.mocked(getPlace).mockResolvedValue(null);
  vi.mocked(getReviewSession).mockResolvedValue(null);
});

test("a forbidden admin ping replaces the shell", async () => {
  apiFetch.mockRejectedValue(new ApiClientError("forbidden", 403, "Admin only"));
  renderAdmin(<AdminShell />);
  expect(await screen.findByText("This area is for the owner only.")).toBeInTheDocument();
});

test("scouting shows an empty queue", async () => {
  renderAdmin(<ScoutingPage />);
  expect(await screen.findByText("No destinations in the queue.")).toBeInTheDocument();
});

test("places shows an empty table", async () => {
  renderAdmin(<PlacesPage />);
  expect(await screen.findByText("No places match these filters.")).toBeInTheDocument();
});

test("review shows an empty session", async () => {
  renderAdmin(<ReviewPage />);
  expect(await screen.findByText("No review in progress.")).toBeInTheDocument();
});

test("merges shows an empty queue", async () => {
  renderAdmin(<MergesPage />);
  expect(await screen.findByText("No open merges.")).toBeInTheDocument();
});

test("a scout report is text, not HTML", async () => {
  const report = '<img src="x" onerror="alert(1)">';
  const run: ScoutRun = {
    runId: "run_1",
    destSlug: "tuscany",
    backend: "agent",
    startedBy: "cursor",
    startedAt: "2026-09-21T10:00:00.000Z",
    stages: {},
    budget: { llmCalls: 0, searches: 0 },
    rejectedPackets: [],
    errors: [],
    reportMarkdown: report,
  };
  vi.mocked(listDestinations).mockResolvedValue([tuscany]);
  vi.mocked(listScoutRuns).mockResolvedValue([run]);
  renderAdmin(<ScoutingPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Tuscany" }));
  const node = await screen.findByText(report);
  expect(node.tagName).toBe("PRE");
  expect(document.querySelector("img")).toBeNull();
});

test("the place drawer links to OpenStreetMap and shows quote verification", async () => {
  vi.mocked(listPlaces).mockResolvedValue({ places: [samplePlace()], nextCursor: null });
  vi.mocked(listEvidence).mockResolvedValue([
    {
      id: "e1",
      placeId: "pl_1",
      url: "https://example.com/a",
      platform: "blog",
      quote: "a short quote",
      quoteVerified: true,
      fetchedAt: "2026-09-21T10:00:00.000Z",
      backend: "agent",
      runId: "run_1",
    },
  ]);
  renderAdmin(<PlacesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Museo Galileo" }));
  const map = await screen.findByRole("link", { name: "Open in OpenStreetMap" });
  expect(map).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/?mlat=43.7678&mlon=11.2559#map=17/43.7678/11.2559",
  );
  expect(document.querySelector("iframe")).toBeNull();
  expect(screen.getByRole("link", { name: "a short quote" })).toHaveAttribute(
    "href",
    "https://example.com/a",
  );
  expect(screen.getByText("Quote verified")).toBeInTheDocument();
});

test("an override submit does not send by", async () => {
  vi.mocked(listPlaces).mockResolvedValue({ places: [samplePlace()], nextCursor: null });
  renderAdmin(<PlacesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Museo Galileo" }));
  await userEvent.selectOptions(screen.getByLabelText("Field"), "dwellMin");
  await userEvent.type(screen.getByLabelText("Value"), "120");
  await userEvent.click(screen.getByRole("button", { name: "Save override" }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalled());
  const call = apiFetch.mock.calls[0];
  expect(call?.[0]).toBe("/admin/places/pl_1/overrides");
  const init = call?.[2] as { method?: string; token?: string; body?: string };
  expect(init.method).toBe("POST");
  expect(init.token).toBe("fake-token");
  const body = JSON.parse(init.body ?? "{}") as unknown;
  expect(body).toEqual({ field: "dwellMin", value: 120 });
  expect(hasKey(body, "by")).toBe(false);
});
