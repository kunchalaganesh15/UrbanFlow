# UrbanFlow — Intelligent Traffic Optimization

UrbanFlow is a React/TanStack Start control room paired with a **locally run Python FastAPI computer-vision engine**. Counts, classifications, tracked IDs, and digital-twin vehicles come from uploaded video processed by Ultralytics YOLO11 and ByteTrack; no sample vehicle data is injected. The website alone cannot analyze video: start the Python service on the same computer as the browser. The Lovable-hosted preview shows the interface but cannot reach your computer's `localhost:8000` service from another visitor's browser.

> Research/prototype software, **not** a certified physical traffic-signal controller. Do not connect to real signal hardware or rely on it for emergency dispatch. Emergency classes are recognized only when a custom model actually includes them; standard YOLO11 COCO weights do not distinguish ambulances and fire trucks. No accuracy figure is claimed without evaluation.

## Windows + VS Code: run the complete project

1. Open this project folder in **VS Code**. Install [Python 3.11](https://www.python.org/downloads/) and [Node.js 20 or newer](https://nodejs.org/). The first model download needs internet access. Prefer a machine with a supported NVIDIA GPU for four simultaneous feeds; CPU works but can be slow.
2. Open a VS Code terminal, then create and activate a Python environment:
   ```powershell
   cd backend
   py -3.11 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```
   If PowerShell blocks activation, run `Set-ExecutionPolicy -Scope Process Bypass` in that terminal, then activate again.
3. Install backend dependencies: `python -m pip install -r requirements.txt`.
4. Download/place a YOLO model: by default Ultralytics downloads `yolo11n.pt` automatically on the first start. For a custom traffic model, create `backend/models`, place it at `backend/models/custom_traffic.pt`, and set `$env:MODEL_PATH="models/custom_traffic.pt"` in the same terminal **before** starting the backend. An invalid/unavailable custom path is reported on Start rather than silently using another model.
5. Start the FastAPI backend **from the backend folder**: `uvicorn app:app --reload --host 127.0.0.1 --port 8000`. Visit `http://localhost:8000/docs` for the API. Leave this terminal running.
6. Open a **second VS Code terminal** in the project root, then install frontend dependencies: `npm install`.
7. Start React: `npm run dev -- --host 127.0.0.1 --port 8080`.
8. Open `http://localhost:8080` in your browser. A green **ENGINE ONLINE** label confirms the connection. If using another backend host, set `VITE_TRAFFIC_API_URL` to its browser-reachable origin before launching the frontend; also set the backend `FRONTEND_ORIGIN` to the frontend origin.
9. Open **Video analysis** and upload traffic videos for North, East, South, and West. MP4, AVI, MOV, and M4V are accepted (up to 500 MB each); OpenCV must be able to decode the codec. At least one feed is required; all four are recommended.
10. Click **Start analysis**. The backend extracts frames, runs YOLO and ByteTrack, filters supported vehicle classes, and sends actual detections and tracked positions to the interface. The first run may take time while YOLO downloads weights.
11. Watch the annotated video on **Video analysis**. Each tracked detection has a bounding box, class, confidence, and ID. Counts are current objects in frame; **unique tracks** count an ID only once per road per analysis session.
12. Open **Control center** to view density and the adaptive signal. Only one road gets green at a time, with yellow and all-red transitions.
13. If a custom model detects ambulance or fire truck consistently across three frames, the **emergency queue** shows first-come-first-served priority. Standard COCO weights will not trigger this behavior.
14. Open **Digital twin** to see detected vehicles on their matching approach; drag to orbit and scroll to zoom. In **Live** mode, no vehicles are rendered without detections. Use the **Auto / Live / Simulation** switch on the 3D view to choose the source (see *3D traffic simulation* below).
15. Click **Stop** to end processing; the last statistics remain visible. **Pause** and **Resume** preserve the current session. Press Ctrl+C in both terminals when finished.

### API and operation

- Health: `GET /api/health`; state: `GET /api/traffic/live`; status: `GET /api/analysis/status`
- Upload: `POST /api/video/upload` (multipart `road`, `file`); control: `POST /api/analysis/start|stop|pause|resume`
- Statistics: `GET /api/traffic/statistics`; signals: `GET /api/signals`; emergency: `GET /api/emergency`; model: `GET /api/model/info`
- Configuration: `POST /api/settings` and `POST /api/settings/reset` (configuration changes require analysis to be stopped)
- Annotated MJPEG: `GET /api/video/{road}/stream`; live state WebSocket: `ws://localhost:8000/api/ws`. The interface polls `/api/traffic/live` once per second; the socket is also available to other clients.
- Temporary video files are held in your OS temp folder (`urbanflow-videos`); replacing a road video removes its previous temporary file. Delete this folder to clean up after use.

### 3D traffic simulation and light theme

The interface now uses a light, glass-style theme, and the 3D scenes are animated: buildings rise on load, trees sway, clouds drift, camera presets glide smoothly, signal masts and stop lines glow with the current phase, and live vehicles slide between positions instead of jumping. The Control center opens with a 3D hero scene.

The 3D junction has a traffic-source switch (top-right of the scene):

- **Live** shows only tracked detections from your uploaded video, exactly as before.
- **Simulation** shows a built-in synthetic traffic model. It is labelled *SIMULATED TRAFFIC · NOT LIVE DATA* wherever it appears and never mixes with live detections.
- **Auto** (default) shows live detections while the engine is analysing and the simulation otherwise, so the site is useful before any video is uploaded.

The simulation (`src/lib/sim.ts`, pure TypeScript) drives cars, buses, trucks and motorcycles on four single-lane approaches (left-hand traffic). Vehicles follow the one ahead, stop at red, may turn left or right, and the signal gives green to one approach at a time with yellow and all-red between phases. The **Digital twin** page has a control panel for traffic demand, playback speed, **adaptive vs fixed-time** signals, an **ambulance dispatch** button per road (adaptive mode preempts the signal for it), live queues, average wait, and trips completed. It is an illustrative model for exploring signal logic. It is not calibrated to real intersections and never actuates hardware. Run its tests with `npm test`.

### Notes and limitations

The model is configurable through `MODEL_PATH`; the default YOLO11 nano model favors speed. Its default COCO classes include car, truck, bus, motorcycle, and bicycle, **not** ambulance or fire truck. Detection quality varies with camera geometry, occlusion, frame resolution, and training data. Tracking IDs are deduplicated per feed; repeated or lost IDs can still affect totals. The digital twin maps each tracked object's normalized vertical frame position to its approach, rather than reconstructing calibrated real-world coordinates. A single server process holds analysis in memory; this local research setup is not a durable multi-user deployment. Video streaming shows processed frames, while a local preview appears before processing starts. Signal timing is illustrative logic for the visualization and never actuates hardware.

To run backend logic tests from `backend`: `python -m pytest tests` (install `pytest` if necessary). Frontend tests: `npm test` from the project root.

### Release checklist

Do not publish yet. Connect the intended custom domain in Project Settings → Project → Domains, then verify that it resolves to this application. The project has an UrbanFlow favicon and `/privacy` and `/terms` pages, but those legal disclosures are prototype drafts and must be completed with the operator's identity, contact information, retention policy, and jurisdiction-specific terms. Hiding the platform's published badge is not currently available to this project; it requires an editor on a Pro plan or higher. The hosted preview cannot process footage from a visitor's machine via `localhost:8000`; a public deployment also requires a separately secured, browser-reachable analysis service. Do not represent the local prototype as a production emergency signal controller.

### Troubleshooting: "Failed to fetch" or ENGINE OFFLINE

1. Start the engine first (`start-backend.bat`, or `uvicorn app:app --host 127.0.0.1 --port 8000` in `backend`). Open `http://127.0.0.1:8000/api/health`; it should return `{"ok":true,...}`.
2. Then open the site at `http://127.0.0.1:8080` or `http://localhost:8080`; both work. The site talks to the engine on the same hostname, port 8000.
3. The first **Start analysis** downloads the YOLO model and can take a minute or two. The site stays connected meanwhile.
4. Using another machine or port? Set `VITE_TRAFFIC_API_URL` for the frontend and `FRONTEND_ORIGIN` for the backend (see `.env.example`).
5. The 3D simulation works with no engine at all.
