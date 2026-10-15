# Changes in this version

## Look and feel
- New light theme (sky, mint and lavender gradients, glass cards, soft shadows). All colours are CSS variables at the top of `src/styles.css`; the theme block at the bottom holds the new component styling.
- 3D motion: cards tilt up into place on page load and lean toward the cursor on hover, the brand mark flips, buttons lift, background blobs drift. Motion is disabled for users who prefer reduced motion.
- New 3D hero on the Control center (`Hero.tsx`): a rotating model city with orbiting vehicles and a floating traffic-light tower.

## 3D scenes (`Junction.tsx`, `Vehicles3D.tsx`)
- Pastel city that rises out of the ground, swaying trees, drifting clouds, soft shadows, fog.
- Perspective camera with smooth preset transitions (Orbit, Top, North, East, South, West, Street) and optional auto-rotate.
- Signal masts with red/yellow/green lamps and glowing stop lines driven by the real phase.
- Proper low-poly cars, buses, trucks, motorcycles and ambulances (flashing beacons). Live vehicles now face the correct direction on every approach and glide between positions.

## 3D traffic simulation (`src/lib/sim.ts`, `SimPanel.tsx`)
- Car-following model, stop-line compliance, left/right turns, adaptive vs fixed-time signals, ambulance preemption, queue and wait statistics.
- Clearly labelled as simulated and kept separate from live detections (Auto / Live / Simulation switch).
- `src/test/sim.test.ts` covers approach geometry, one-green-at-a-time sequencing, no overlaps (including at 2.5x speed), no red-light running, and ambulance preemption.

## Not changed
The Python backend, API, data flow, settings, privacy and terms pages are untouched.

---

# Version 3: connection fixes + advanced 3D

## Fixed: "Failed to fetch" / ENGINE OFFLINE
- **CORS / host mismatch (backend/app.py).** The engine only allowed `http://localhost:<port>`. Opening the site at `http://127.0.0.1:8080` made the browser block every request. CORS now accepts `localhost`, `127.0.0.1` and `[::1]` on any port (plus optional `FRONTEND_ORIGIN`).
- **Frontend API address (src/lib/traffic.tsx).** The engine URL now follows the host the page was opened on instead of being fixed to `localhost`. `VITE_TRAFFIC_API_URL` still overrides it.
- **Engine froze while loading YOLO (backend/engine.py).** `start()` downloaded/loaded the model while holding the engine lock, so every status poll hung and the UI flipped to OFFLINE. The model now loads outside the lock.
- **Readable errors.** Raw browser messages are replaced with actionable text, requests have timeouts (180 s for Start, which may download the model), and upload is disabled while the engine is offline.
- **Connection banner** with a Retry button and the exact start command; error alerts can be dismissed.
- **One-click launchers:** `start-backend.bat`, `start-frontend.bat`, `start-all.bat`.

## New 3D features (Junction.tsx, Hero.tsx)
- Day / night cycle (moon button) easing sky, fog and sun; building windows light up from a generated window texture.
- Street lamps with additive light pools; vehicle headlight beams at night.
- Congestion heat ribbons on each approach: they lengthen and shift green to amber to red with the queue (simulation queue, or live density label).
- Pulse rings from the junction centre in the colour of the active signal; drifting firefly particles.
- Automatic camera tour (film button) cycling through the presets.
- Hero: radar rings, breathing data pillars, sparkles.
- Staggered 3D tile entrance animations on the dashboard (disabled for reduced-motion users).

---

# Version 4: crash fix + emergency vehicles

- **No more "This page didn't load".** Each page body and each 3D canvas now has its own error boundary that recovers on its own (sidebar and alerts stay up). The root error screen also retries automatically and shows the real error message. Engine payloads are normalised and live detections are validated before they reach the 3D scene; the shared headlight resource is no longer disposed when cars unmount.
- **Simulation:** an ambulance or fire truck is sent automatically every 20-40 s (first after ~7 s). Toggle it, or dispatch ambulances / a fire truck, in the Digital twin panel. Adaptive signals clear the approach.
- **Real videos:** emergency vehicles are detected from custom-model classes (`ambulance`, `fire truck`) or, with standard YOLO weights, by red/blue light-bar and body-colour analysis confirmed over several frames (disable with `EMERGENCY_HEURISTIC=0`). They get a red box in the annotated video.
- **Alerts:** a flashing pop-up with a snapshot and a siren beep (mute button included), a red banner on the video panel, and an alert log on the Control center. Endpoints: `GET /api/alerts`, `GET /api/alerts/{id}/image`.
