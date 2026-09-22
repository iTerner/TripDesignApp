import { useTranslation } from "react-i18next";
import { ApiClientError } from "../lib/api";

export function AdminError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (error instanceof ApiClientError && error.code === "reauth_required") {
    return <p className="text-sm text-red-600">{t("admin.reauth")}</p>;
  }
  if (error instanceof Error) {
    return <p className="text-sm text-red-600">{error.message}</p>;
  }
  return null;
}
