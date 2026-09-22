import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreateDestinationRequestSchema,
  CreateDestinationResponseSchema,
  DeleteDestinationResponseSchema,
  type DestinationKind,
  DestinationKindSchema,
  ReorderDestinationsRequestSchema,
  ReorderDestinationsResponseSchema,
} from "@wayfare/domain";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "../components/ui/button";
import { listDestinations, listScoutRuns } from "../lib/adminFirestore";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/useAuth";
import { AdminError } from "./AdminError";

const inputClass = "mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm";

const RunScoutResponseSchema = z.strictObject({
  ok: z.literal(true),
  slug: z.string().regex(/^[a-z0-9-]{2,64}$/),
});

export function ScoutingPage() {
  const { t } = useTranslation();
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState<DestinationKind>("city");
  const [invalid, setInvalid] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const destinations = useQuery({
    queryKey: ["admin", "destinations"],
    retry: false,
    queryFn: listDestinations,
  });
  const runs = useQuery({
    queryKey: ["admin", "runs", selected],
    enabled: selected !== null,
    retry: false,
    queryFn: () => listScoutRuns(selected ?? ""),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin", "destinations"] });
  };

  const add = useMutation({
    mutationFn: async (body: { slug: string; name: string; kind: DestinationKind }) => {
      const token = await getIdToken();
      return apiFetch("/admin/scout/destinations", CreateDestinationResponseSchema, {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      setName("");
      setSlug("");
      setKind("city");
      await refresh();
    },
  });
  const reorder = useMutation({
    mutationFn: async (slugs: string[]) => {
      const token = await getIdToken();
      const body = ReorderDestinationsRequestSchema.parse({ slugs });
      return apiFetch("/admin/scout/destinations/reorder", ReorderDestinationsResponseSchema, {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (destSlug: string) => {
      const token = await getIdToken();
      return apiFetch(`/admin/scout/destinations/${destSlug}`, DeleteDestinationResponseSchema, {
        method: "DELETE",
        token,
      });
    },
    onSuccess: async (_data, destSlug) => {
      if (selected === destSlug) setSelected(null);
      await refresh();
    },
  });
  const runGemini = useMutation({
    mutationFn: async (destSlug: string) => {
      const token = await getIdToken();
      return apiFetch("/admin/scout/run", RunScoutResponseSchema, {
        method: "POST",
        token,
        body: JSON.stringify({ slug: destSlug }),
      });
    },
  });

  function onAdd(event: FormEvent) {
    event.preventDefault();
    setInvalid(false);
    const parsed = CreateDestinationRequestSchema.safeParse({
      slug: slug.trim(),
      name: name.trim(),
      kind,
    });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    add.mutate({ slug: parsed.data.slug, name: parsed.data.name, kind: parsed.data.kind });
  }

  function move(index: number, direction: -1 | 1) {
    const rows = destinations.data;
    if (!rows) return;
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const slugs = rows.map((row) => row.slug);
    const from = slugs[index];
    const to = slugs[target];
    if (!from || !to) return;
    const next = slugs.slice();
    next[index] = to;
    next[target] = from;
    reorder.mutate(next);
  }

  const rows = destinations.data ?? [];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">{t("admin.scouting.heading")}</h2>
      <form onSubmit={onAdd} className="grid gap-3 sm:grid-cols-4">
        <label className="block text-sm">
          {t("admin.scouting.name")}
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          {t("admin.scouting.slug")}
          <input
            className={inputClass}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            pattern="[a-z0-9-]{2,64}"
            required
          />
        </label>
        <label className="block text-sm">
          {t("admin.scouting.kind")}
          <select
            className={inputClass}
            value={kind}
            onChange={(event) => setKind(DestinationKindSchema.parse(event.target.value))}
          >
            {DestinationKindSchema.options.map((option) => (
              <option key={option} value={option}>
                {t(`admin.kind.${option}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <Button type="submit" disabled={add.isPending}>
            {t("admin.scouting.add")}
          </Button>
        </div>
      </form>
      {invalid ? <p className="text-sm text-red-600">{t("admin.invalid")}</p> : null}
      <AdminError error={add.error ?? reorder.error ?? remove.error ?? runGemini.error} />
      {destinations.isPending ? <p>{t("admin.loading")}</p> : null}
      <AdminError error={destinations.error} />
      {destinations.data && rows.length === 0 ? <p>{t("admin.scouting.empty")}</p> : null}
      <ol className="space-y-3">
        {rows.map((dest, index) => (
          <li key={dest.slug} className="flex flex-wrap items-center gap-2 border-b pb-3">
            <button
              type="button"
              className="font-medium"
              aria-pressed={selected === dest.slug}
              onClick={() => {
                runGemini.reset();
                setSelected(dest.slug);
              }}
            >
              {dest.name}
            </button>
            <span className="text-sm text-muted-foreground">
              {t(`admin.kind.${dest.kind}`)} · {t(`admin.status.${dest.status}`)}
            </span>
            <span className="text-sm">
              {t("admin.scouting.counts", {
                scouted: dest.counts.scouted,
                trending: dest.counts.trending,
                hidden: dest.counts.hidden,
              })}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={index === 0 || reorder.isPending}
              onClick={() => move(index, -1)}
            >
              {t("admin.scouting.moveUp")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={index === rows.length - 1 || reorder.isPending}
              onClick={() => move(index, 1)}
            >
              {t("admin.scouting.moveDown")}
            </Button>
            {dest.status === "queued" ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate(dest.slug)}
              >
                {t("admin.scouting.remove")}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      <section className="space-y-2">
        <Button
          type="button"
          disabled={selected === null || runGemini.isPending}
          onClick={() => {
            if (selected) runGemini.mutate(selected);
          }}
        >
          {t("admin.scouting.runGemini")}
        </Button>
        <p className="text-sm text-muted-foreground">{t("admin.scouting.agentInCursor")}</p>
        {runGemini.isSuccess ? <p className="text-sm">{t("admin.scouting.runQueued")}</p> : null}
      </section>
      {selected ? (
        <section className="space-y-3">
          <h3 className="font-medium">{t("admin.scouting.runs")}</h3>
          {runs.isPending ? <p>{t("admin.loading")}</p> : null}
          <AdminError error={runs.error} />
          {runs.data && runs.data.length === 0 ? <p>{t("admin.scouting.noRuns")}</p> : null}
          {runs.data?.map((run) => (
            <article key={run.runId} className="space-y-2">
              <h4 className="text-sm font-medium">
                {run.runId} · {t(`admin.backend.${run.backend}`)} · {run.startedAt}
              </h4>
              {run.reportMarkdown ? (
                <pre className="whitespace-pre-wrap break-words font-sans text-sm">
                  {run.reportMarkdown}
                </pre>
              ) : (
                <p className="text-sm">{t("admin.scouting.noReport")}</p>
              )}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
