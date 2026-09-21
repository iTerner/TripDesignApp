import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PingResponseSchema } from "@wayfare/domain";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/useAuth";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { t } = useTranslation();
  const { user, getIdToken } = useAuth();
  const ping = useMutation({
    mutationFn: async () => apiFetch("/ping", PingResponseSchema, { token: await getIdToken() }),
  });
  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("app.tagline")}</h1>
      <Button disabled={!user || ping.isPending} onClick={() => ping.mutate()}>
        {t("ping.call")}
      </Button>
      {ping.data && (
        <p className="text-sm">
          {t("ping.result", { time: ping.data.serverTime, uid: ping.data.uid })}
          {ping.data.firstSeen ? ` — ${t("ping.firstSeen")}` : ""}
        </p>
      )}
      {ping.error && <p className="text-sm text-red-600">{ping.error.message}</p>}
    </section>
  );
}
