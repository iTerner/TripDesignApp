import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type PendingMerge,
  type Place,
  type ResolveMergeRequest,
  ResolveMergeRequestSchema,
  ResolveMergeResponseSchema,
} from "@wayfare/domain";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { getPlace, listEvidence, listOpenMerges } from "../lib/adminFirestore";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/useAuth";
import { AdminError } from "./AdminError";
import { displayPlace, PlaceFacts } from "./PlaceFacts";

interface MergeRow {
  merge: PendingMerge;
  a: Place | null;
  b: Place | null;
  evidenceA: Awaited<ReturnType<typeof listEvidence>>;
  evidenceB: Awaited<ReturnType<typeof listEvidence>>;
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function MergesPage() {
  const { t } = useTranslation();
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  const merges = useQuery({
    queryKey: ["admin", "merges"],
    retry: false,
    queryFn: async (): Promise<MergeRow[]> => {
      const open = await listOpenMerges();
      return Promise.all(
        open.map(async (merge) => ({
          merge,
          a: await getPlace(merge.placeIdA),
          b: await getPlace(merge.placeIdB),
          evidenceA: await listEvidence(merge.placeIdA),
          evidenceB: await listEvidence(merge.placeIdB),
        })),
      );
    },
  });
  const resolve = useMutation({
    mutationFn: async (input: { id: string; body: ResolveMergeRequest }) => {
      const token = await getIdToken();
      const body = ResolveMergeRequestSchema.parse(input.body);
      return apiFetch(`/admin/merges/${input.id}`, ResolveMergeResponseSchema, {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "merges"] });
    },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{t("admin.merges.heading")}</h2>
      {merges.isPending ? <p>{t("admin.loading")}</p> : null}
      <AdminError error={merges.error ?? resolve.error} />
      {merges.data && merges.data.length === 0 ? <p>{t("admin.merges.empty")}</p> : null}
      {merges.data?.map((row) => (
        <article key={row.merge.id} className="space-y-4 border-b pb-6">
          <p className="text-sm">
            {row.merge.destSlug} · {t("admin.merges.score", { score: row.merge.score.toFixed(2) })}
          </p>
          <p className="text-sm">
            {t("admin.merges.reasons", {
              reasons: row.merge.reasons.join(", ") || "—",
            })}
          </p>
          {row.a && row.b ? (
            <p className="text-sm">
              {t("admin.merges.distance", {
                km: distanceKm(displayPlace(row.a), displayPlace(row.b)).toFixed(1),
              })}
            </p>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <section className="space-y-2">
              <h3 className="font-medium">{t("admin.merges.placeA")}</h3>
              {row.a ? (
                <PlaceFacts place={row.a} evidence={row.evidenceA} />
              ) : (
                <p>{t("admin.merges.missingPlace", { id: row.merge.placeIdA })}</p>
              )}
            </section>
            <section className="space-y-2">
              <h3 className="font-medium">{t("admin.merges.placeB")}</h3>
              {row.b ? (
                <PlaceFacts place={row.b} evidence={row.evidenceB} />
              ) : (
                <p>{t("admin.merges.missingPlace", { id: row.merge.placeIdB })}</p>
              )}
            </section>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={resolve.isPending}
              onClick={() =>
                resolve.mutate({ id: row.merge.id, body: { action: "merge", keep: "a" } })
              }
            >
              {t("admin.merges.keepA")}
            </Button>
            <Button
              type="button"
              disabled={resolve.isPending}
              onClick={() =>
                resolve.mutate({ id: row.merge.id, body: { action: "merge", keep: "b" } })
              }
            >
              {t("admin.merges.keepB")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ id: row.merge.id, body: { action: "keep_both" } })}
            >
              {t("admin.merges.keepBoth")}
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}
