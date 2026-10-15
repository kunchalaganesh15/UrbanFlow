import { createFileRoute } from "@tanstack/react-router";
import { ControlView } from "@/components/traffic/Views";
import { meta } from "@/lib/traffic";
export const Route = createFileRoute("/")({ head:()=>meta("Traffic Control Center","Monitor live video-based vehicle counts, adaptive signals, and emergency response at UrbanFlow."),component:ControlView });
