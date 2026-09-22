import { createFileRoute } from "@tanstack/react-router";
import { ReviewPage } from "../admin/ReviewPage";

export const Route = createFileRoute("/admin/review")({ component: ReviewPage });
