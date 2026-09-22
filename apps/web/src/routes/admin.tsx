import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "../admin/AdminShell";

export const Route = createFileRoute("/admin")({ component: AdminShell });
