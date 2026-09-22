import { createFileRoute } from "@tanstack/react-router";
import { ScoutingPage } from "../admin/ScoutingPage";

export const Route = createFileRoute("/admin/scout")({ component: ScoutingPage });
