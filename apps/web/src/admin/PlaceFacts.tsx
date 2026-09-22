import { type Evidence, effectivePlace, type Place } from "@wayfare/domain";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { openStreetMapUrl } from "../lib/osmUrl";

export function displayPlace(place: Place): Place {
  try {
    return effectivePlace(place);
  } catch {
    return place;
  }
}

function fieldText(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function PlaceFacts({ place, evidence }: { place: Place; evidence: readonly Evidence[] }) {
  const { t } = useTranslation();
  const shown = displayPlace(place);
  const overrideFields = Object.keys(place.adminOverrides);
  const entries = Object.entries(shown).filter(([key]) => key !== "adminOverrides");
  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-base font-semibold">{shown.name}</h3>
      <p>{t("admin.places.coordinates", { lat: shown.lat, lon: shown.lng })}</p>
      <a href={openStreetMapUrl(shown.lat, shown.lng)} target="_blank" rel="noreferrer">
        {t("admin.places.map")}
      </a>
      {overrideFields.length > 0 ? (
        <p>{t("admin.places.overrides", { fields: overrideFields.join(", ") })}</p>
      ) : null}
      <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-3 gap-y-1">
        {entries.map(([key, value]) => (
          <Fragment key={key}>
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="break-words">{fieldText(value)}</dd>
          </Fragment>
        ))}
      </dl>
      <h4 className="font-medium">{t("admin.places.evidence")}</h4>
      {evidence.length === 0 ? (
        <p>{t("admin.places.noEvidence")}</p>
      ) : (
        <ul className="space-y-2">
          {evidence.map((item) => (
            <li key={item.id} className="space-y-1">
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.quote}
              </a>
              <p>
                {item.quoteVerified
                  ? t("admin.places.quoteVerified")
                  : t("admin.places.quoteUnverified")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
