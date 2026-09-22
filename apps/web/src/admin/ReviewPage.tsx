import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreateReviewRequestSchema,
  CreateReviewResponseSchema,
  type ReviewVerdictRequest,
  ReviewVerdictRequestSchema,
  ReviewVerdictResponseSchema,
  type ReviewWrongReason,
  ReviewWrongReasonSchema,
} from "@wayfare/domain";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { getPlace, getReviewSession, listEvidence } from "../lib/adminFirestore";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/useAuth";
import { AdminError } from "./AdminError";
import { PlaceFacts } from "./PlaceFacts";

const inputClass = "mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm";

export function ReviewPage() {
  const { t } = useTranslation();
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  const [destSlug, setDestSlug] = useState("");
  const [runId, setRunId] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [reason, setReason] = useState<ReviewWrongReason | "">("");

  const session = useQuery({
    queryKey: ["admin", "review", sessionId],
    enabled: sessionId !== null,
    retry: false,
    queryFn: () => (sessionId ? getReviewSession(sessionId) : Promise.resolve(null)),
  });
  const current = session.data?.sample.find(
    (item) => session.data?.verdicts[item.placeId] === undefined,
  );
  const place = useQuery({
    queryKey: ["admin", "review-place", current?.placeId],
    enabled: current !== undefined,
    retry: false,
    queryFn: () => (current ? getPlace(current.placeId) : Promise.resolve(null)),
  });
  const evidence = useQuery({
    queryKey: ["admin", "review-evidence", current?.placeId],
    enabled: current !== undefined,
    retry: false,
    queryFn: () => (current ? listEvidence(current.placeId) : Promise.resolve([])),
  });

  const start = useMutation({
    mutationFn: async (body: { destSlug: string; runId: string }) => {
      const token = await getIdToken();
      return apiFetch("/admin/reviews", CreateReviewResponseSchema, {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
    },
    onSuccess: async (response) => {
      setSessionId(response.id);
      await queryClient.invalidateQueries({ queryKey: ["admin", "review", response.id] });
    },
  });
  const verdict = useMutation({
    mutationFn: async (body: ReviewVerdictRequest) => {
      if (!sessionId) throw new Error("missing review");
      const token = await getIdToken();
      return apiFetch(`/admin/reviews/${sessionId}/verdict`, ReviewVerdictResponseSchema, {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "review", sessionId] });
    },
  });

  function onStart(event: FormEvent) {
    event.preventDefault();
    setInvalid(false);
    const parsed = CreateReviewRequestSchema.safeParse({
      destSlug: destSlug.trim(),
      runId: runId.trim(),
    });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    start.mutate({ destSlug: parsed.data.destSlug, runId: parsed.data.runId });
  }

  function send(body: ReviewVerdictRequest) {
    const parsed = ReviewVerdictRequestSchema.safeParse(body);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    verdict.mutate(parsed.data);
  }

  const accuracy = verdict.data?.accuracy ?? session.data?.accuracy ?? 0;
  const answered = session.data ? Object.keys(session.data.verdicts).length : 0;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h2 className="text-xl font-semibold">{t("admin.review.heading")}</h2>
      {sessionId === null ? <p>{t("admin.review.empty")}</p> : null}
      <form onSubmit={onStart} className="grid gap-3">
        <label className="block text-sm">
          {t("admin.review.destSlug")}
          <input
            className={inputClass}
            value={destSlug}
            onChange={(event) => setDestSlug(event.target.value)}
            pattern="[a-z0-9-]{2,64}"
            required
          />
        </label>
        <label className="block text-sm">
          {t("admin.review.runId")}
          <input
            className={inputClass}
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
            required
          />
        </label>
        <Button type="submit" disabled={start.isPending}>
          {t("admin.review.start")}
        </Button>
      </form>
      {invalid ? <p className="text-sm text-red-600">{t("admin.invalid")}</p> : null}
      <AdminError error={start.error ?? session.error ?? verdict.error} />
      {sessionId !== null && session.isPending ? <p>{t("admin.loading")}</p> : null}
      {sessionId !== null && session.data === null && !session.isPending ? (
        <p>{t("admin.review.missing")}</p>
      ) : null}
      {session.data ? (
        <p>{t("admin.review.accuracy", { pct: Math.round(accuracy * 100) })}</p>
      ) : null}
      {session.data && !current ? <p>{t("admin.review.done")}</p> : null}
      {session.data && current ? (
        <article className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("admin.review.progress", { n: answered + 1, total: session.data.sample.length })}
            {" · "}
            {t(`admin.review.bucket.${current.bucket}`)}
          </p>
          {place.isPending ? <p>{t("admin.loading")}</p> : null}
          {place.data ? (
            <PlaceFacts place={place.data} evidence={evidence.data ?? []} />
          ) : place.isSuccess ? (
            <p>{t("admin.review.missingPlace")}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={verdict.isPending}
              onClick={() => send({ placeId: current.placeId, verdict: "correct" })}
            >
              {t("admin.review.correct")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={verdict.isPending}
              onClick={() => send({ placeId: current.placeId, verdict: "hide" })}
            >
              {t("admin.review.hide")}
            </Button>
          </div>
          <label className="block text-sm">
            {t("admin.review.reason")}
            <select
              className={inputClass}
              value={reason}
              onChange={(event) => {
                const value = event.target.value;
                setReason(value === "" ? "" : ReviewWrongReasonSchema.parse(value));
              }}
            >
              <option value="">{t("admin.review.pickReason")}</option>
              {ReviewWrongReasonSchema.options.map((option) => (
                <option key={option} value={option}>
                  {t(`admin.review.reasons.${option}`)}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={verdict.isPending || reason === ""}
            onClick={() => {
              if (reason === "") return;
              send({ placeId: current.placeId, verdict: "wrong", reason });
            }}
          >
            {t("admin.review.wrong")}
          </Button>
        </article>
      ) : null}
    </div>
  );
}
