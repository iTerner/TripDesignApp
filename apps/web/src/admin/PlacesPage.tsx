import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type BackendId,
  BackendIdSchema,
  type Evidence,
  type Place,
  type PlaceCategory,
  PlaceCategorySchema,
  PlaceHideRequestSchema,
  PlaceHideResponseSchema,
  type PlaceOverrideRequest,
  PlaceOverrideRequestSchema,
  PlaceOverrideResponseSchema,
  PlaceSchema,
  type PlaceStatus,
  PlaceStatusSchema,
  SELECTABLE_CATEGORIES,
} from "@wayfare/domain";
import { type FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { listEvidence, listPlaces, type PlaceFilters, type PlaceSort } from "../lib/adminFirestore";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/useAuth";
import { AdminError } from "./AdminError";
import { displayPlace, PlaceFacts } from "./PlaceFacts";

const inputClass = "mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm";
const BLOCKED_OVERRIDE_FIELDS = new Set([
  "id",
  "destSlug",
  "status",
  "adminOverrides",
  "mergedInto",
]);
const OVERRIDE_FIELDS = Object.keys(PlaceSchema.shape)
  .filter((field) => !BLOCKED_OVERRIDE_FIELDS.has(field))
  .sort();

function coerceOverrideValue(field: string, raw: string): unknown {
  const shape = PlaceSchema.shape[field as keyof typeof PlaceSchema.shape];
  const trimmed = raw.trim();
  const attempts: unknown[] = [];
  if (trimmed === "true") attempts.push(true);
  if (trimmed === "false") attempts.push(false);
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) attempts.push(Number(trimmed));
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) {
    try {
      attempts.push(JSON.parse(trimmed) as unknown);
    } catch {
      // The raw string is tried next.
    }
  }
  attempts.push(trimmed);
  for (const candidate of attempts) {
    if (shape.safeParse(candidate).success) return candidate;
  }
  return trimmed;
}

export function PlacesPage() {
  const { t } = useTranslation();
  const [area, setArea] = useState("");
  const [category, setCategory] = useState<PlaceCategory | "">("");
  const [status, setStatus] = useState<PlaceStatus | "">("");
  const [backend, setBackend] = useState<BackendId | "">("");
  const [hasTrend, setHasTrend] = useState(false);
  const [hasOverride, setHasOverride] = useState(false);
  const [possiblyClosed, setPossiblyClosed] = useState(false);
  const [sort, setSort] = useState<PlaceSort>("fame");
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filters = useMemo(() => {
    const next: PlaceFilters = {};
    const areaText = area.trim();
    if (areaText) next.area = areaText;
    if (category) next.category = category;
    if (status) next.status = status;
    if (backend) next.backend = backend;
    if (hasTrend) next.hasTrend = true;
    if (hasOverride) next.hasOverride = true;
    if (possiblyClosed) next.possiblyClosed = true;
    return next;
  }, [area, category, status, backend, hasTrend, hasOverride, possiblyClosed]);

  const cursor = cursors[page] ?? null;
  const places = useQuery({
    queryKey: ["admin", "places", filters, sort, cursor],
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: () => (cursor ? listPlaces(filters, sort, cursor) : listPlaces(filters, sort)),
  });
  const selected = places.data?.places.find((place) => place.id === selectedId) ?? null;
  const evidence = useQuery({
    queryKey: ["admin", "evidence", selectedId],
    enabled: selectedId !== null,
    retry: false,
    queryFn: () => (selectedId ? listEvidence(selectedId) : Promise.resolve([] as Evidence[])),
  });

  function resetPage() {
    setPage(0);
    setCursors([null]);
    setSelectedId(null);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{t("admin.places.heading")}</h2>
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="text-sm font-medium">{t("admin.places.filters")}</legend>
        <label className="block text-sm">
          {t("admin.places.area")}
          <input
            className={inputClass}
            value={area}
            onChange={(event) => {
              setArea(event.target.value);
              resetPage();
            }}
          />
        </label>
        <label className="block text-sm">
          {t("admin.places.category")}
          <select
            className={inputClass}
            value={category}
            onChange={(event) => {
              const value = event.target.value;
              setCategory(value === "" ? "" : PlaceCategorySchema.parse(value));
              resetPage();
            }}
          >
            <option value="">{t("admin.places.any")}</option>
            {SELECTABLE_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          {t("admin.places.status")}
          <select
            className={inputClass}
            value={status}
            onChange={(event) => {
              const value = event.target.value;
              setStatus(value === "" ? "" : PlaceStatusSchema.parse(value));
              resetPage();
            }}
          >
            <option value="">{t("admin.places.any")}</option>
            {PlaceStatusSchema.options.map((option) => (
              <option key={option} value={option}>
                {t(`admin.status.${option}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          {t("admin.places.backend")}
          <select
            className={inputClass}
            value={backend}
            onChange={(event) => {
              const value = event.target.value;
              setBackend(value === "" ? "" : BackendIdSchema.parse(value));
              resetPage();
            }}
          >
            <option value="">{t("admin.places.any")}</option>
            {BackendIdSchema.options.map((option) => (
              <option key={option} value={option}>
                {t(`admin.backend.${option}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hasTrend}
            onChange={(event) => {
              setHasTrend(event.target.checked);
              resetPage();
            }}
          />
          {t("admin.places.hasTrend")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hasOverride}
            onChange={(event) => {
              setHasOverride(event.target.checked);
              resetPage();
            }}
          />
          {t("admin.places.hasOverride")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={possiblyClosed}
            onChange={(event) => {
              setPossiblyClosed(event.target.checked);
              resetPage();
            }}
          />
          {t("admin.places.possiblyClosed")}
        </label>
        <label className="block text-sm">
          {t("admin.places.sort")}
          <select
            className={inputClass}
            value={sort}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "fame" || value === "trend" || value === "updated") setSort(value);
              resetPage();
            }}
          >
            <option value="fame">{t("admin.places.sortFame")}</option>
            <option value="trend">{t("admin.places.sortTrend")}</option>
            <option value="updated">{t("admin.places.sortUpdated")}</option>
          </select>
        </label>
      </fieldset>
      {places.isPending ? <p>{t("admin.loading")}</p> : null}
      <AdminError error={places.error} />
      {places.data && places.data.places.length === 0 ? <p>{t("admin.places.empty")}</p> : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-start">
                <th className="py-2 text-start">{t("admin.places.name")}</th>
                <th className="py-2 text-start">{t("admin.places.area")}</th>
                <th className="py-2 text-start">{t("admin.places.category")}</th>
                <th className="py-2 text-start">{t("admin.places.status")}</th>
                <th className="py-2 text-start">{t("admin.places.fame")}</th>
                <th className="py-2 text-start">{t("admin.places.trend")}</th>
                <th className="py-2 text-start">{t("admin.places.updated")}</th>
              </tr>
            </thead>
            <tbody>
              {places.data?.places.map((place) => {
                const shown = displayPlace(place);
                return (
                  <tr key={place.id} className="border-b">
                    <td className="py-2">
                      <button
                        type="button"
                        className="font-medium"
                        onClick={() => setSelectedId(place.id)}
                      >
                        {shown.name}
                      </button>
                      {place.notSeenSince ? (
                        <span className="ms-2 text-muted-foreground">
                          {t("admin.places.possiblyClosed")}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2">{shown.areaName}</td>
                    <td className="py-2">{shown.primaryCategory ?? "—"}</td>
                    <td className="py-2">{t(`admin.status.${shown.status}`)}</td>
                    <td className="py-2">{shown.fameScore}</td>
                    <td className="py-2">{shown.trendScore}</td>
                    <td className="py-2">{shown.firstSeenAt.slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              {t("admin.places.prev")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!places.data?.nextCursor}
              onClick={() => {
                const next = places.data?.nextCursor;
                if (!next) return;
                setCursors((prev) => {
                  const copy = prev.slice();
                  copy[page + 1] = next;
                  return copy;
                });
                setPage((current) => current + 1);
              }}
            >
              {t("admin.places.next")}
            </Button>
          </div>
        </div>
        {selected ? (
          <PlaceDrawer
            key={selected.id}
            place={selected}
            evidence={evidence.data ?? []}
            onClose={() => setSelectedId(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function PlaceDrawer({
  place,
  evidence,
  onClose,
}: {
  place: Place;
  evidence: readonly Evidence[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  const [field, setField] = useState(OVERRIDE_FIELDS[0] ?? "name");
  const [rawValue, setRawValue] = useState("");
  const [note, setNote] = useState("");
  const [hideReason, setHideReason] = useState("");
  const [invalid, setInvalid] = useState(false);

  const save = useMutation({
    mutationFn: async (body: PlaceOverrideRequest) => {
      const token = await getIdToken();
      return apiFetch(`/admin/places/${place.id}/overrides`, PlaceOverrideResponseSchema, {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "places"] });
    },
  });
  const hide = useMutation({
    mutationFn: async (reason: string) => {
      const token = await getIdToken();
      const body = PlaceHideRequestSchema.parse({ reason });
      return apiFetch(`/admin/places/${place.id}/hide`, PlaceHideResponseSchema, {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "places"] });
    },
  });

  function onSave(event: FormEvent) {
    event.preventDefault();
    setInvalid(false);
    const parsed = PlaceOverrideRequestSchema.safeParse({
      field,
      value: coerceOverrideValue(field, rawValue),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    save.mutate(parsed.data);
  }

  function onHide(event: FormEvent) {
    event.preventDefault();
    setInvalid(false);
    const parsed = PlaceHideRequestSchema.safeParse({ reason: hideReason.trim() });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    hide.mutate(parsed.data.reason);
  }

  return (
    <aside className="space-y-4 border-s ps-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("admin.places.heading")}</p>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("admin.places.close")}
        </Button>
      </div>
      <PlaceFacts place={place} evidence={evidence} />
      <form onSubmit={onSave} className="space-y-2">
        <label className="block text-sm">
          {t("admin.places.field")}
          <select
            className={inputClass}
            value={field}
            onChange={(event) => setField(event.target.value)}
          >
            {OVERRIDE_FIELDS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          {t("admin.places.value")}
          <input
            className={inputClass}
            value={rawValue}
            onChange={(event) => setRawValue(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          {t("admin.places.note")}
          <input
            className={inputClass}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={save.isPending}>
          {t("admin.places.save")}
        </Button>
      </form>
      <form onSubmit={onHide} className="space-y-2">
        <label className="block text-sm">
          {t("admin.places.hideReason")}
          <input
            className={inputClass}
            value={hideReason}
            onChange={(event) => setHideReason(event.target.value)}
          />
        </label>
        <Button type="submit" variant="destructive" disabled={hide.isPending}>
          {t("admin.places.hide")}
        </Button>
      </form>
      {invalid ? <p className="text-sm text-red-600">{t("admin.places.invalidValue")}</p> : null}
      <AdminError error={save.error ?? hide.error} />
    </aside>
  );
}
