"""Run with: uvicorn app:app --reload --port 8000 (from backend/)."""
import asyncio
import json
import os
import tempfile
import time
import uuid
from pathlib import Path

import cv2
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel, Field, model_validator
from engine import engine, ROADS, CLASSES, DEFAULTS

app = FastAPI(title="UrbanFlow local analysis engine", version="1.0")
# Accept the frontend from localhost, 127.0.0.1 or [::1] on ANY port, so it works whichever
# address the browser uses. FRONTEND_ORIGIN adds one extra explicit origin (e.g. a LAN IP).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
    allow_origins=[os.environ["FRONTEND_ORIGIN"]] if os.getenv("FRONTEND_ORIGIN") else [],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
UPLOADS = Path(tempfile.gettempdir()) / "urbanflow-videos"
UPLOADS.mkdir(exist_ok=True)
class Settings(BaseModel):
    confidence: float = Field(ge=.25,le=.90)
    iou: float = Field(ge=.30,le=.80)
    resolution: int
    tracker: str
    min_green: int = Field(ge=5,le=120)
    max_green: int = Field(ge=5,le=180)
    yellow: int = Field(ge=2,le=10)
    all_red: int = Field(ge=1,le=10)
    emergency_priority: bool
    density_medium: int = Field(ge=1)
    density_high: int = Field(ge=2)
    density_critical: int = Field(ge=3)
    @model_validator(mode="after")
    def validate_order(self):
        if self.resolution not in (640,960,1280) or self.tracker not in ("bytetrack.yaml","botsort.yaml"): raise ValueError("Unsupported inference resolution or tracker")
        if self.min_green > self.max_green: raise ValueError("Minimum green cannot exceed maximum green")
        if not (self.density_medium < self.density_high < self.density_critical): raise ValueError("Density thresholds must increase")
        return self

@app.get("/")
def root(): return {"service":"UrbanFlow engine","ok":True,"docs":"/docs","health":"/api/health"}
@app.get("/api/health")
def health(): return {"ok":True,"status":engine.status,"model":engine.model_name}
@app.get("/api/analysis/status")
def status(): return {"status":engine.status,"error":engine.error}
@app.get("/api/traffic/live")
def live(): return engine.snapshot()
@app.get("/api/traffic/statistics")
def statistics(): return {r:{"count":v["count"],"total_unique":v["total_unique"],"classes":v["classes"],"density":v["density"]} for r,v in engine.snapshot()["roads"].items()}
@app.get("/api/signals")
def signals(): return engine.snapshot()["signal"]
@app.get("/api/emergency")
def emergency(): return engine.snapshot()["emergency_queue"]
@app.get("/api/model/info")
def model(): return {"model":engine.model_name,"classes":list(CLASSES),"emergency_classes":"Only if included in selected model"}
@app.post("/api/video/upload")
async def upload(road: str=Form(...),file: UploadFile=File(...)):
    if road not in ROADS: raise HTTPException(400,"Choose a valid road")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in (".mp4",".avi",".mov",".m4v"): raise HTTPException(400,"Upload MP4, AVI, MOV or M4V video")
    path = UPLOADS / f"{uuid.uuid4().hex}{suffix}"
    size = 0
    try:
        with path.open("wb") as output:
            while chunk := await file.read(1024*1024):
                size += len(chunk)
                if size > 500*1024*1024: raise HTTPException(413,"Video exceeds 500 MB")
                output.write(chunk)
        capture = cv2.VideoCapture(str(path)); ok, _ = capture.read(); capture.release()
        if not ok: raise HTTPException(400,"Video is empty or cannot be decoded by OpenCV")
        try: engine.set_video(road,path,file.filename)
        except ValueError as exc: raise HTTPException(409,str(exc)) from exc
        return {"road":road,"filename":file.filename,"size":size}
    except Exception:
        if road not in engine.paths or engine.paths[road] != str(path): path.unlink(missing_ok=True)
        raise
@app.post("/api/analysis/start")
def start():
    try: engine.start()
    except ValueError as exc: raise HTTPException(400,str(exc)) from exc
    return engine.snapshot()
@app.post("/api/analysis/stop")
def stop(): engine.stop(); return engine.snapshot()
@app.post("/api/analysis/pause")
def pause():
    if engine.status != "ANALYZING": raise HTTPException(409,"Analysis is not running")
    engine.pause_started=time.monotonic(); engine.paused_remaining=max(0,int(engine.controller.duration-(engine.pause_started-engine.controller.started))); engine.pause_event.set(); engine.status="PAUSED"; return engine.snapshot()
@app.post("/api/analysis/resume")
def resume():
    if engine.status != "PAUSED": raise HTTPException(409,"Analysis is not paused")
    engine.controller.started += time.monotonic() - engine.pause_started
    engine.status="ANALYZING"; engine.pause_event.clear(); return engine.snapshot()
@app.post("/api/settings")
def settings(value:Settings):
    with engine.lock:
        if engine.status in ("ANALYZING","PAUSED"): raise HTTPException(409,"Stop analysis before changing settings")
        engine.settings=value.model_dump()
    return engine.snapshot()
@app.post("/api/settings/reset")
def reset():
    with engine.lock:
        if engine.status in ("ANALYZING","PAUSED"): raise HTTPException(409,"Stop analysis before changing settings")
        engine.settings=DEFAULTS.copy()
    return engine.snapshot()
@app.get("/api/video/{road}/stream")
def stream(road:str):
    if road not in ROADS: raise HTTPException(404,"Unknown road")
    def frames():
        import time
        while True:
            with engine.lock: jpg=engine.frames.get(road)
            if jpg: yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"+jpg+b"\r\n"
            time.sleep(.15)
    return StreamingResponse(frames(),media_type="multipart/x-mixed-replace; boundary=frame")
@app.websocket("/api/ws")
async def websocket(socket:WebSocket):
    await socket.accept()
    try:
        while True:
            await socket.send_text(json.dumps(engine.snapshot()))
            await asyncio.sleep(.5)
    except (WebSocketDisconnect,RuntimeError): pass

@app.get("/api/alerts")
def alerts(): return engine.snapshot()["alerts"]
@app.get("/api/alerts/{alert_id}/image")
def alert_image(alert_id:str):
    with engine.lock: jpg = engine.alert_images.get(alert_id)
    if not jpg: raise HTTPException(404,"No snapshot for this alert")
    return Response(content=jpg,media_type="image/jpeg")
