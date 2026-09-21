import { LOCALES } from "@wayfare/domain";
import { useTranslation } from "react-i18next";
import { applyLocale } from "../i18n";

export function LanguageSelect() {
  const { i18n, t } = useTranslation();
  return (
    <select
      aria-label={t("lang.label")}
      className="rounded-md border bg-background px-2 py-1 text-sm"
      value={i18n.language}
      onChange={(e) => applyLocale(e.target.value)}
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code} disabled={!l.enabled}>
          {l.native}
          {l.enabled ? "" : ` · ${t("lang.soon")}`}
        </option>
      ))}
    </select>
  );
}
