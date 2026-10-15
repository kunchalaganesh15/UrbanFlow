import { createFileRoute } from "@tanstack/react-router";
import { SettingsView } from "@/components/traffic/Views";
import { meta } from "@/lib/traffic";
export const Route = createFileRoute("/settings")({ head:()=>meta("System Settings","Configure UrbanFlow model thresholds, tracking, adaptive signals, and emergency priority."),component:SettingsView });
