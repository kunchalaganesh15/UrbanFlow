import { createFileRoute } from "@tanstack/react-router";
import { AnalyticsView } from "@/components/traffic/Views";
import { meta } from "@/lib/traffic";
export const Route = createFileRoute("/analytics")({ head:()=>meta("Traffic Analytics","Explore live road counts, vehicle types, and density from tracked video detections."),component:AnalyticsView });
