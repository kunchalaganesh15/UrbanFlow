"""Local CPU/GPU video inference and safe four-way traffic control."""
import os
import time
import threading
from collections import deque
import uuid
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

ROADS = ("North", "East", "South", "West")
CLASSES = ("car", "truck", "bus", "motorcycle", "bicycle", "ambulance", "fire truck")
DEFAULTS = dict(confidence=.4, iou=.5, resolution=640, tracker="bytetrack.yaml", min_green=10, max_green=60, yellow=3, all_red=2, emergency_priority=True, density_medium=11, density_high=21, density_critical=36)


EMERGENCY_NAMES = ("ambulance", "fire truck")
HEURISTIC_BASE = ("car", "truck", "bus")
USE_HEURISTIC = os.getenv("EMERGENCY_HEURISTIC", "1") != "0"

def normalize_name(raw):
    return raw.lower().replace("_", " ").replace("-", " ").replace("motorbike", "motorcycle").replace("firetruck", "fire truck").replace("fire engine", "fire truck").strip()

def emergency_hint(clean, box, name):
    """Colour heuristic for standard COCO models (which have no ambulance/fire-truck class).

    Looks for a red+blue light bar on the upper part of a car/truck/bus box (ambulance), or a
    mostly red body on a truck/bus (fire engine). It is a hint, not proof: a vehicle must be
    flagged on several frames before it is confirmed. Returns 'ambulance', 'fire truck' or None.
    """
    x1, y1, x2, y2 = box
    h_img, w_img = clean.shape[:2]
    x1, y1 = max(0, x1), max(0, y1); x2, y2 = min(w_img, x2), min(h_img, y2)
    if x2 - x1 < 28 or y2 - y1 < 24: return None
    crop = clean[y1:y2, x1:x2]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    vivid = (sat > 120) & (val > 140)
    red = vivid & ((hue < 8) | (hue > 172))
    blue = vivid & (hue > 100) & (hue < 130)
    white = (sat < 45) & (val > 185)
    top = slice(0, max(1, int(crop.shape[0] * .45)))
    top_area = red[top].size
    red_top = red[top].sum() / top_area
    blue_top = blue[top].sum() / top_area
    white_all = white.sum() / white.size
    red_all = red.sum() / red.size
    if name in ("truck", "bus") and red_all > .32: return "fire truck"
    if red_top > .012 and blue_top > .012: return "ambulance"
    if white_all > .45 and red_all > .04 and red_all < .3 and blue_top > .006: return "ambulance"
    return None

def density(count, settings):
    if count >= settings["density_critical"]: return "CRITICAL"
    if count >= settings["density_high"]: return "HIGH"
    if count >= settings["density_medium"]: return "MEDIUM"
    return "LOW"

def confirmed_emergencies(road, detections, seen):
    current = {(road,d["id"]) for d in detections if d["class_name"] in ("ambulance","fire truck")}
    for key in list(seen):
        if key[0] == road and key not in current:
            del seen[key]
    confirmed = []
    for d in detections:
        key = (road,d["id"])
        if key in current:
            seen[key] = seen.get(key,0)+1
            if seen[key] == 3:
                confirmed.append(dict(road=road,vehicle=d["class_name"],id=d["id"]))
    return current, confirmed

class SignalController:
    def __init__(self):
        self.road = None
        self.phase = "ALL_RED"
        self.started = time.monotonic()
        self.duration = 0
        self.next = None
        self.last = -1

    def choose(self, roads, emergencies, settings):
        if settings["emergency_priority"] and emergencies:
            return emergencies[0]["road"]
        candidates = [(roads[r]["count"] + min(roads[r]["total_unique"], 20) * .15, -((i-self.last-1)%4), r) for i,r in enumerate(ROADS)]
        return max(candidates)[2] if any(roads[r]["count"] for r in ROADS) else ROADS[(self.last+1)%4]

    def tick(self, roads, emergencies, settings, now=None):
        now = time.monotonic() if now is None else now
        elapsed = now - self.started
        if self.phase == "GREEN" and self.road:
            count = roads[self.road]["count"]
            wanted = min(settings["max_green"], settings["min_green"] + count * 1.5)
            urgent = bool(settings["emergency_priority"] and emergencies and emergencies[0]["road"] != self.road)
            if elapsed >= (settings["min_green"] if urgent else wanted):
                self.next = self.choose(roads, emergencies, settings)
                if self.next == self.road and not urgent:
                    self.started = now
                    self.duration = wanted
                else:
                    self.phase = "YELLOW"; self.started = now; self.duration = settings["yellow"]
            else: self.duration = wanted
        elif self.phase == "YELLOW" and elapsed >= self.duration:
            self.phase = "ALL_RED"; self.started = now; self.duration = settings["all_red"]; self.road = None
        elif self.phase == "ALL_RED" and elapsed >= self.duration:
            self.road = self.choose(roads, emergencies, settings)
            self.last = ROADS.index(self.road)
            self.phase = "GREEN"; self.started = now
            self.duration = min(settings["max_green"], settings["min_green"] + roads[self.road]["count"] * 1.5)
            self.next = None
        return dict(road=self.road, phase=self.phase, remaining=max(0, int(self.duration - (now-self.started))), next=self.next)

class Engine:
    def __init__(self):
        self.lock = threading.RLock()
        self.settings = DEFAULTS.copy()
        self.paths = {}
        self.frames = {}
        self.status = "READY"
        self.error = None
        self.model_name = "yolo11n.pt"
        self.roads = {r:self.empty_road() for r in ROADS}
        self.controller = SignalController()
        self.emergencies = deque()
        self.emergency_seen = {}
        self.seen_ids = {r:set() for r in ROADS}
        self.stop_event = threading.Event()
        self.pause_event = threading.Event()
        self.pause_started = 0
        self.threads = []
        self.scheduler = None
        self.updated_at = None
        self.paused_remaining = 0
        self.alerts = []
        self.alert_images = {}
        self.last_alert = {}

    @staticmethod
    def empty_road():
        return dict(count=0,total_unique=0,density="LOW",fps=0,frame=0,video_time=0,inference_ms=0,classes={},detections=[],uploaded=False,filename=None,processing=False)

    def snapshot(self):
        with self.lock:
            signal = self.controller.tick(self.roads,list(self.emergencies),self.settings) if self.status == "ANALYZING" else dict(road=self.controller.road,phase=self.controller.phase,remaining=self.paused_remaining if self.status == "PAUSED" else 0,next=self.controller.next)
            return dict(status=self.status, roads={r:{**v,"detections":list(v["detections"]),"classes":dict(v["classes"])} for r,v in self.roads.items()},signal=signal,emergency_queue=[dict(e,status="ACTIVE" if i==0 else "WAITING") for i,e in enumerate(self.emergencies)],settings=self.settings.copy(),model=self.model_name,error=self.error,updated_at=self.updated_at,alerts=list(self.alerts)[-20:])

    def set_video(self, road, path, filename):
        with self.lock:
            if self.status in ("ANALYZING","PAUSED"): raise ValueError("Stop analysis before replacing a video")
            old = self.paths.get(road)
            self.paths[road] = str(path)
            self.roads[road] = self.empty_road()
            self.roads[road].update(uploaded=True,filename=filename)
            if old and old != str(path): Path(old).unlink(missing_ok=True)

    def start(self):
        with self.lock:
            if self.status in ("ANALYZING","PAUSED"): raise ValueError("Analysis is already in progress")
            if not self.paths: raise ValueError("Upload at least one road video before starting")
        custom = os.getenv("MODEL_PATH", "")
        if custom and not Path(custom).is_file():
            raise ValueError("Custom YOLO model was not found. Check MODEL_PATH and try again.")
        name = custom or "yolo11n.pt"
        # Load (and, on first run, download) the weights OUTSIDE the lock. Holding the lock
        # here froze every status poll, which made the interface report the engine as OFFLINE.
        try: YOLO(name)
        except Exception as exc: raise ValueError("Could not load the YOLO model. Check its path, format, internet access for the first download, and installation.") from exc
        with self.lock:
            if self.status in ("ANALYZING","PAUSED"): raise ValueError("Analysis is already in progress")
            self.model_name = name
            self.stop_event.clear(); self.pause_event.clear(); self.error = None
            self.seen_ids = {r:set() for r in ROADS}; self.emergencies.clear(); self.emergency_seen.clear(); self.frames.clear(); self.alerts.clear(); self.alert_images.clear(); self.last_alert.clear()
            self.controller = SignalController()
            # Start every analysis with the configured all-red clearance interval.
            # This prevents the first signal from jumping directly to green.
            self.controller.duration = self.settings["all_red"]
            for road in ROADS:
                filename = self.roads[road]["filename"]
                self.roads[road] = self.empty_road()
                if road in self.paths: self.roads[road].update(uploaded=True,filename=filename)
            self.status = "ANALYZING"
            self.threads = [threading.Thread(target=self.process, args=(r,self.paths[r]), daemon=True) for r in self.paths]
            for thread in self.threads: thread.start()
            self.scheduler = threading.Thread(target=self.schedule, daemon=True); self.scheduler.start()

    def stop(self):
        with self.lock:
            self.stop_event.set(); self.pause_event.clear(); self.status = "STOPPED"
            for value in self.roads.values(): value["processing"] = False
        for thread in self.threads:
            if thread is not threading.current_thread(): thread.join(timeout=3)

    def schedule(self):
        while not self.stop_event.wait(.25):
            if self.pause_event.is_set(): continue
            with self.lock:
                self.controller.tick(self.roads,list(self.emergencies),self.settings)
                if self.threads and all(not t.is_alive() for t in self.threads):
                    self.status = "STOPPED"; self.stop_event.set(); break

    def process(self, road, path):
        capture = cv2.VideoCapture(path)
        if not capture.isOpened():
            with self.lock: self.error = f"Could not open {road} video"; self.status = "ERROR"; self.stop_event.set()
            return
        try:
            model = YOLO(self.model_name)
            fps_source = capture.get(cv2.CAP_PROP_FPS) or 30
            frame_number = 0
            hist = {}
            with self.lock: self.roads[road]["processing"] = True
            while not self.stop_event.is_set():
                if self.pause_event.is_set():
                    if self.stop_event.wait(.1): break
                    continue
                ok, frame = capture.read()
                if not ok: break
                frame_number += 1; tick = time.monotonic()
                result = model.track(frame, persist=True, tracker=self.settings["tracker"], conf=self.settings["confidence"], iou=self.settings["iou"], imgsz=self.settings["resolution"], verbose=False)[0]
                detections = []; counts = {}; h,w = frame.shape[:2]
                clean = frame.copy()
                boxes = result.boxes
                if boxes is not None:
                    for box in boxes:
                        name = normalize_name(result.names[int(box.cls[0])])
                        if name not in CLASSES: continue
                        if box.id is None: continue
                        track_id = int(box.id[0]); conf = float(box.conf[0]); x1,y1,x2,y2 = [int(v) for v in box.xyxy[0].tolist()]
                        suspected = False
                        if USE_HEURISTIC and name in HEURISTIC_BASE:
                            votes = hist.setdefault(track_id, deque(maxlen=12))
                            votes.append(emergency_hint(clean,(x1,y1,x2,y2),name))
                            flagged = [v for v in votes if v]
                            if len(flagged) >= 3:
                                name = max(set(flagged), key=flagged.count); suspected = True
                            if len(hist) > 600:
                                for k in list(hist)[:200]: hist.pop(k, None)
                        emergency = name in EMERGENCY_NAMES
                        detections.append(dict(id=track_id,class_name=name,confidence=round(conf,3),box=[x1,y1,x2,y2],position=[round((x1+x2)/2/w,3),round((y1+y2)/2/h,3)],emergency=emergency,suspected=suspected))
                        counts[name] = counts.get(name,0)+1
                        colour = (40,40,255) if emergency else (87,204,158)
                        cv2.rectangle(frame,(x1,y1),(x2,y2),colour,4 if emergency else 2)
                        label = f"EMERGENCY #{track_id} {name}" if emergency else f"#{track_id} {name} {conf:.2f}"
                        if emergency:
                            (tw,th),_ = cv2.getTextSize(label,cv2.FONT_HERSHEY_SIMPLEX,.6,2)
                            cv2.rectangle(frame,(x1,max(0,y1-th-12)),(x1+tw+8,max(th+12,y1)),colour,-1)
                            cv2.putText(frame,label,(x1+4,max(th+4,y1-6)),cv2.FONT_HERSHEY_SIMPLEX,.6,(255,255,255),2)
                        else:
                            cv2.putText(frame,label,(x1,max(18,y1-7)),cv2.FONT_HERSHEY_SIMPLEX,.55,colour,2)
                _,jpg = cv2.imencode(".jpg",frame,[cv2.IMWRITE_JPEG_QUALITY,78])
                with self.lock:
                    self.seen_ids[road].update(d["id"] for d in detections)
                    current, confirmed = confirmed_emergencies(road,detections,self.emergency_seen)
                    for e in confirmed:
                        now_m = time.monotonic()
                        if now_m - self.last_alert.get(road,-99) < 8: continue
                        self.last_alert[road] = now_m
                        det = next((d for d in detections if d["id"] == e["id"]), None)
                        aid = f"{int(time.time()*1000)}-{uuid.uuid4().hex[:6]}"
                        if det:
                            bx1,by1,bx2,by2 = det["box"]; pad = 20
                            crop = clean[max(0,by1-pad):min(h,by2+pad), max(0,bx1-pad):min(w,bx2+pad)]
                            if crop.size:
                                ok2,buf = cv2.imencode(".jpg",crop,[cv2.IMWRITE_JPEG_QUALITY,85])
                                if ok2: self.alert_images[aid] = buf.tobytes()
                        self.alerts.append(dict(id=aid,road=road,vehicle=e["vehicle"],track_id=e["id"],frame=frame_number,video_time=round(frame_number/fps_source,1),at=time.strftime("%H:%M:%S"),has_image=aid in self.alert_images,suspected=bool(det and det.get("suspected"))))
                        for old_id in list(self.alert_images)[:-30]: self.alert_images.pop(old_id,None)
                        self.alerts = self.alerts[-50:]
                    if self.settings["emergency_priority"]:
                        self.emergencies.extend(confirmed)
                    for e in list(self.emergencies):
                        if e["road"] == road and (road,e["id"]) not in current: self.emergencies.remove(e)
                    elapsed = max(.001,time.monotonic()-tick)
                    self.roads[road].update(count=len(detections),total_unique=len(self.seen_ids[road]),density=density(len(detections),self.settings),fps=round(1/elapsed,1),frame=frame_number,video_time=round(frame_number/fps_source,1),inference_ms=round(elapsed*1000,1),classes=counts,detections=detections)
                    if jpg[0]: self.frames[road] = jpg[1].tobytes()
                    self.updated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
        except Exception:
            with self.lock: self.error = f"{road} processing failed. Check the video codec and model compatibility."; self.status = "ERROR"; self.stop_event.set()
        finally:
            capture.release()
            with self.lock: self.roads[road]["processing"] = False

engine = Engine()
