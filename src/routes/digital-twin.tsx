import { createFileRoute } from "@tanstack/react-router";
import { TwinView } from "@/components/traffic/Views";
import { meta } from "@/lib/traffic";
export const Route = createFileRoute("/digital-twin")({ head:()=>meta("3D Digital Twin","See tracked vehicles mapped onto the corresponding road of an interactive four-way junction."),component:TwinView });
