import { createFileRoute } from "@tanstack/react-router";
import { MergesPage } from "../admin/MergesPage";

export const Route = createFileRoute("/admin/merges")({ component: MergesPage });
