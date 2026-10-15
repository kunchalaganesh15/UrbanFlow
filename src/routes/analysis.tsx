import { createFileRoute } from "@tanstack/react-router";
import { AnalysisView } from "@/components/traffic/Views";
import { meta } from "@/lib/traffic";
export const Route = createFileRoute("/analysis")({ head:()=>meta("AI Video Analysis","Upload four road videos and inspect real YOLO vehicle detections and tracking in UrbanFlow."),component:AnalysisView });
