import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { AdminPingResponseSchema, LlmPingResponseSchema } from "@wayfare/domain";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { ApiClientError, apiFetch } from "../lib/api";
import { useAuth } from "../lib/useAuth";

const tabClass = "text-sm";
const tabActive = "text-sm font-semibold underline";

export function AdminShell() {
  const { t } = useTranslation();
  const { user, getIdToken } = useAuth();
  const ping = useQuery({
    queryKey: ["admin-ping", user?.uid],
    enabled: !!user,
    retry: false,
    queryFn: async () =>
      apiFetch("/admin/ping", AdminPingResponseSchema, { token: await getIdToken() }),
  });
  const llm = useMutation({
    mutationFn: async () =>
      apiFetch("/admin/llm/ping", LlmPingResponseSchema, {
        method: "POST",
        token: await getIdToken(),
      }),
  });
  if (ping.error instanceof ApiClientError && ping.error.code === "forbidden") {
    return <p>{t("admin.forbidden")}</p>;
  }
  if (!user) return <p>{t("admin.signInRequired")}</p>;
  return (
    <section className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("admin.title")}</h1>
      {ping.data && (
        <p className="text-sm">
          {t("admin.ping")}: uid {ping.data.uid} · auth age {ping.data.authAgeSec}s
        </p>
      )}
      <Button onClick={() => llm.mutate()} disabled={!ping.data || llm.isPending}>
        {t("admin.llmPing")}
      </Button>
      {llm.data && (
        <pre className="rounded bg-muted p-3 text-xs">{JSON.stringify(llm.data, null, 2)}</pre>
      )}
      {llm.error && <p className="text-sm text-red-600">{llm.error.message}</p>}
      <nav aria-label={t("admin.tabsLabel")} className="flex flex-wrap gap-4 border-b pb-2">
        <Link to="/admin/scout" className={tabClass} activeProps={{ className: tabActive }}>
          {t("admin.tabs.scouting")}
        </Link>
        <Link to="/admin/places" className={tabClass} activeProps={{ className: tabActive }}>
          {t("admin.tabs.places")}
        </Link>
        <Link to="/admin/review" className={tabClass} activeProps={{ className: tabActive }}>
          {t("admin.tabs.review")}
        </Link>
        <Link to="/admin/merges" className={tabClass} activeProps={{ className: tabActive }}>
          {t("admin.tabs.merges")}
        </Link>
      </nav>
      <Outlet />
    </section>
  );
}
