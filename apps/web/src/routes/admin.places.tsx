import { createFileRoute } from "@tanstack/react-router";
import { PlacesPage } from "../admin/PlacesPage";

export const Route = createFileRoute("/admin/places")({ component: PlacesPage });
