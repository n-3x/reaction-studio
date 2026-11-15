#!/usr/bin/env python3
"""Local reaction-video workbench. Run: python3 app.py"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import threading
import time
import urllib.parse
import uuid
import zipfile
from array import array

import hook
import editing

ROOT = Path(__file__).resolve().parent
LOCAL = ROOT / ".local"
ASSETS = ROOT / "assets"
WEB = ROOT / "web"
# Optional: pre-register a demo/reference video via env vars (unset on a fresh install).
DEFAULT_DEMO = Path(os.environ["REACTION_DEFAULT_DEMO"]) if os.environ.get("REACTION_DEFAULT_DEMO") else None
DEFAULT_REFERENCE = Path(os.environ["REACTION_DEFAULT_REFERENCE"]) if os.environ.get("REACTION_DEFAULT_REFERENCE") else None
LOCK = threading.RLock()
IMAGE_LOCK = threading.Lock()
POOL = ThreadPoolExecutor(max_workers=2)
ACTIVE = set()
TOKEN = secrets.token_urlsafe(32)
STATE = {"assets": {}, "jobs": {}, "defaults": {}}
SETTINGS = {}
CODEX = {"available": False, "signed_in": False, "image_verified": False}
APP_CODEX_HOME = LOCAL / "chatgpt-home"
LOGIN = {"state": "idle", "url": None, "code": None, "message": "", "started": None, "proc": None}
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
DEFAULT_IMAGE_PROMPT = (
    "Create one photorealistic 9:16 starting image for motion transfer.\n"
    "Use the attached identity images for the influencer's recognizable face, hair, skin tone, and body identity. "
    "Use the last attached image for the exact starting pose, head angle, expression, gaze, hand positions, "
    "subject scale, camera angle, lighting, and environment. Match visible clothing from the frame unless "
    "the profile notes specify otherwise. Replace the reference performer with the influencer; do not blend "
    "their faces. Preserve the scene composition. Remove social captions and emoji overlays from the "
    "reference frame, reconstructing the underlying scene naturally. Output one image with a 9:16 canvas and no text."
)
MAX_UPLOAD = 512 * 1024 * 1024


def now():
    return datetime.now(timezone.utc).isoformat()


def persist():
    with LOCK:
        hook.save(LOCAL / "state.json", STATE)


def safe_error(error):
    if isinstance(error, subprocess.CalledProcessError):
        message = error.stderr or error.stdout or str(error)
    else:
        message = str(error)
    for key in (configured_key(), aiml_key()):
        if key:
            message = message.replace(key, "[redacted]")
    return message[-1800:]


def _secret(setting, env_name):
    key = SETTINGS.get(setting) or os.environ.get(env_name, "")
    if key:
        return key
    path = ROOT / ".env"
    if path.is_file():
        for line in path.read_text().splitlines():
            line = line.strip().removeprefix("export ")
            if line.startswith(env_name + "="):
                return line.split("=", 1)[1].strip().strip("\"'")
    return ""


def configured_key():
    return _secret("fal_key", "FAL_KEY")


def aiml_key():
    return _secret("aimlapi_key", "AIMLAPI_KEY")


def video_provider():
    return SETTINGS.get("video_provider") if SETTINGS.get("video_provider") in hook.PROVIDERS else "fal"


def video_ready():
    return bool(aiml_key() if video_provider() == "aimlapi" else configured_key())


def provider_label():
    return "AIMLAPI" if video_provider() == "aimlapi" else "fal"


def environment():
    result = os.environ.copy()
    if configured_key():
        result["FAL_KEY"] = configured_key()
    if aiml_key():
        result["AIMLAPI_KEY"] = aiml_key()
    return result


def cli(*args):
    result = subprocess.run(["python3", str(ROOT / "hook.py"), *map(str, args)], cwd=ROOT,
                            capture_output=True, text=True, env=environment())
    if result.returncode:
        raise ValueError(safe_error(result.stderr or result.stdout))
    return result.stdout


def update(job_id, step=None, message=None, **fields):
    with LOCK:
        job = STATE["jobs"][job_id]
        if step and step != job.get("step"):
            job.setdefault("phase_times", {})[step] = now()
            job["step"] = step
        if message and (not job["events"] or job["events"][-1]["message"] != message):
            job["events"].append({"at": now(), "step": job.get("step"), "message": message})
        job.update(fields, updated_at=now())
        persist()


def register_asset(path, name=None, kind=None):
    source = Path(path).expanduser().resolve(strict=True)
    mime = mimetypes.guess_type(source)[0] or ""
    if not mime.startswith(("video/", "image/")):
        raise ValueError("Choose a video or image file.")
    info = hook.probe(source)
    video = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    if not video:
        raise ValueError("The file does not contain a readable image or video.")
    asset_id = uuid.uuid4().hex
    target = ASSETS / (asset_id + source.suffix.lower())
    if source.parent != ASSETS:
        shutil.copy2(source, target)
    else:
        target = source
    entry = {"id": asset_id, "path": str(target), "name": name or source.name,
             "kind": kind or ("image" if mime.startswith("image/") else "video"),
             "width": video["width"], "height": video["height"],
             "duration": float(video.get("duration") or info.get("format", {}).get("duration") or 0)}
    with LOCK:
        STATE["assets"][asset_id] = entry
        persist()
    return entry


def source_path(value):
    if value in STATE["assets"]:
        if STATE["assets"][value]["kind"] != "video":
            raise ValueError("Choose a video for the motion reference.")
        return STATE["assets"][value]["path"]
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme in ("http", "https"):
        host = (parsed.hostname or "").lower()
        if host != "instagram.com" and not host.endswith(".instagram.com"):
            raise ValueError("Use an Instagram URL or upload a local MP4.")
        return value
    raise ValueError("Upload the reference video or provide an Instagram URL.")


def public_asset(asset):
    return {k: v for k, v in asset.items() if k != "path"} | {"url": "/media/assets/" + Path(asset["path"]).name}


def media_url(path):
    path = Path(path).resolve()
    relative = path.relative_to(ROOT)
    return "/media/" + urllib.parse.quote(str(relative))


def public_job(job):
    result = {k: v for k, v in job.items() if k not in ("run", "reference", "demo")}
    result["busy"] = job["id"] in ACTIVE
    result["media"] = {}
    if job.get("run"):
        run = Path(job["run"])
        for name, filename in [("reference", "reference.mp4"), ("frame", "first-frame.png"),
                               ("image", "starting-image.png"), ("generated", "generated.mp4"),
                               ("audio", "reel-audio-full.m4a"), ("soundtrack", "soundtrack.m4a"), ("bundle", "project.zip"), ("hook", "hook.mp4"), ("final", "final.mp4"), ("assembly", "edit.mp4")]:
            if (run / filename).is_file():
                result["media"][name] = media_url(run / filename) + "?v=" + str((run / filename).stat().st_mtime_ns)
        if (run / "image-prompt.txt").exists():
            result["image_prompt"] = (run / "image-prompt.txt").read_text()
        if (run / "job.json").exists():
            manifest = hook.read(run / "job.json")
            result["warnings"] = manifest.get("warnings", [])
            result["source_duration"] = manifest.get("reaction_duration")
            result["request_id"] = manifest.get("queue", {}).get("request_id")
            result["reference_seconds"] = manifest.get("reference_duration")
            result["generated_seconds"] = manifest.get("generated_duration")
            result["source_has_audio"] = manifest.get("source_has_audio")
            result["audio_seconds"] = manifest.get("audio_duration")
            result["source_start"] = manifest.get("source_start", 0)
            result["source_total_duration"] = manifest.get("source_total_duration")
            result["short_mode"] = manifest.get("short_mode", "original")
            result["export_report"] = manifest.get("export_report")
            result["motion_prompt_locked"] = bool(manifest.get("submission_attempted") or manifest.get("queue") or (run / "generated.mp4").exists())
            stored_prompt = manifest.get("motion_prompt", job.get("motion_prompt"))
            result["motion_prompt"] = manifest.get("submitted_prompt", stored_prompt) if result["motion_prompt_locked"] else stored_prompt
            if result["motion_prompt"] is None and not result["motion_prompt_locked"]:
                result["motion_prompt"] = hook.DEFAULT_MOTION_PROMPT
            source = saved_source(run, manifest)
            if source:
                result["media"]["source"] = media_url(source)
    if job.get("demo"):
        result["demo"] = public_asset(STATE["assets"][job["demo"]])
    return result


def public_state():
    profiles = []
    for path in sorted((ROOT / "profiles").glob("*/profile.json")):
        data = hook.read(path)
        profiles.append({"name": data["name"], "notes": data.get("notes", ""),
                         "images": [media_url(p) for p in data["images"]]})
    with LOCK:
        return {"token": TOKEN, "profiles": profiles,
                "assets": [public_asset(a) for a in STATE["assets"].values()],
                "jobs": [public_job(j) for j in sorted(STATE["jobs"].values(), key=lambda j: j["created_at"], reverse=True)],
                "defaults": STATE["defaults"], "settings": {"fal_configured": bool(configured_key()), "aimlapi_configured": bool(aiml_key()), "video_provider": video_provider(), "video_ready": video_ready(), "codex": CODEX, "chatgpt": chatgpt_public()},
                "saved_prompts": STATE.get("saved_prompts", []), "default_image_prompt": DEFAULT_IMAGE_PROMPT,
                "model": hook.MODEL, "default_motion_prompt": hook.DEFAULT_MOTION_PROMPT, "estimated_video_cost": 0.378}


def system_codex_home():
    return Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))


def codex_signed_in(home):
    """Ask the Codex CLI itself whether this home is signed in with ChatGPT. Tokens are never read here."""
    if not shutil.which("codex"):
        return False
    try:
        result = subprocess.run(["codex", "login", "status"], capture_output=True, text=True, timeout=10,
                                env=dict(os.environ, CODEX_HOME=str(home)))
        return result.returncode == 0 and "ChatGPT" in result.stdout + result.stderr
    except (subprocess.TimeoutExpired, OSError):
        return False


def refresh_chatgpt():
    CODEX["available"] = shutil.which("codex") is not None
    CODEX["app_signed_in"] = APP_CODEX_HOME.is_dir() and codex_signed_in(APP_CODEX_HOME)
    CODEX["system_signed_in"] = codex_signed_in(system_codex_home())
    CODEX["signed_in"] = CODEX["app_signed_in"] or CODEX["system_signed_in"]


def image_account():
    """Which ChatGPT sign-in creates images: the one connected inside this app, else the one already on this Mac."""
    choice = SETTINGS.get("image_account")
    if choice == "system" and CODEX.get("system_signed_in"):
        return "system"
    if CODEX.get("app_signed_in"):
        return "app"
    return "system" if CODEX.get("system_signed_in") else None


def image_home():
    return APP_CODEX_HOME if image_account() == "app" else system_codex_home()


def chatgpt_public():
    return {"available": CODEX.get("available", False), "app_signed_in": bool(CODEX.get("app_signed_in")),
            "system_signed_in": bool(CODEX.get("system_signed_in")), "active": image_account(),
            "image_verified": bool(CODEX.get("image_verified")),
            "login": {k: LOGIN[k] for k in ("state", "url", "code", "message", "started")}}


def _watch_login(proc):
    buffer = ""
    for line in proc.stdout:
        buffer += ANSI.sub("", line)
        url = re.search(r"https://\S+", buffer)
        code = re.search(r"\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b", buffer)
        with LOCK:
            if url and not LOGIN["url"]:
                LOGIN["url"] = url.group(0)
            if code and not LOGIN["code"]:
                LOGIN["code"] = code.group(0)
    proc.wait()
    with LOCK:
        cancelled = LOGIN["proc"] is not proc
    if cancelled:
        return
    refresh_chatgpt()
    with LOCK:
        LOGIN["proc"] = None
        if CODEX.get("app_signed_in"):
            SETTINGS["image_account"] = "app"
            hook.save(LOCAL / "settings.json", SETTINGS)
            LOGIN.update(state="connected", message="ChatGPT account connected.", url=None, code=None)
        else:
            LOGIN.update(state="error", message="Sign-in did not finish. The code expires after 15 minutes; start again for a new one.", url=None, code=None)


def start_chatgpt_login():
    if not shutil.which("codex"):
        raise ValueError("The Codex command-line tool is not installed. Use the ChatGPT website fallback instead.")
    with LOCK:
        proc = LOGIN.get("proc")
        if proc and proc.poll() is None:
            return
        APP_CODEX_HOME.mkdir(parents=True, exist_ok=True)
        os.chmod(APP_CODEX_HOME, 0o700)
        proc = subprocess.Popen(["codex", "login", "--device-auth"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, env=dict(os.environ, CODEX_HOME=str(APP_CODEX_HOME), NO_COLOR="1"))
        LOGIN.update(state="pending", url=None, code=None, message="Waiting for you to approve the sign-in.", started=now(), proc=proc)
    threading.Thread(target=_watch_login, args=(proc,), daemon=True).start()


def cancel_chatgpt_login():
    with LOCK:
        proc, LOGIN["proc"] = LOGIN.get("proc"), None
        LOGIN.update(state="idle", url=None, code=None, message="")
    if proc and proc.poll() is None:
        proc.terminate()


def disconnect_chatgpt():
    cancel_chatgpt_login()
    if APP_CODEX_HOME.is_dir():
        subprocess.run(["codex", "logout"], capture_output=True, text=True, timeout=20,
                       env=dict(os.environ, CODEX_HOME=str(APP_CODEX_HOME)))
    SETTINGS["image_account"] = "system"
    hook.save(LOCAL / "settings.json", SETTINGS)
    CODEX["image_verified"] = False
    refresh_chatgpt()


def explain_image_failure(text):
    """Turn Codex output into a recovery the owner can act on. Free plans may not include image generation."""
    low = (text or "").lower()
    if any(k in low for k in ("usage limit", "rate limit", "quota", "too many requests", "try again later", "limit reached")):
        return "ChatGPT's image allowance for this account is used up for now. Try again later or use the ChatGPT website with the reference pack."
    if any(k in low for k in ("upgrade", "not available on your plan", "not included", "plan does not", "requires a plus", "image_generation")):
        return "This ChatGPT account's plan doesn't include automatic image creation. Use the ChatGPT website with the reference pack — free accounts can generate images there."
    if any(k in low for k in ("401", "unauthorized", "not logged in", "log in", "sign in", "expired", "refresh token")):
        return "The ChatGPT sign-in expired. Reconnect your account in Connections, or use the ChatGPT website with the reference pack."
    return None


def tail(path, size=1500):
    try:
        return Path(path).read_text(errors="ignore")[-size:]
    except OSError:
        return ""


def generate_image(run):
    manifest = hook.read(run / "job.json")
    profile = manifest.get("profile")
    if not profile:
        raise ValueError("Save or select an influencer model first.")
    copies = []
    for i, image in enumerate(profile["images"], 1):
        target = run / (f"identity-input-{i}" + Path(image).suffix)
        shutil.copy2(image, target)
        copies.append(target)
    schema = {"type": "object", "properties": {
        "status": {"type": "string", "enum": ["created", "unavailable", "failed"]},
        "image_path": {"type": ["string", "null"]}, "message": {"type": "string"}},
        "required": ["status", "image_path", "message"], "additionalProperties": False}
    hook.save(run / "image-result-schema.json", schema)
    prompt = (
        "This is the image-creation backend of a local reaction-video application. Complete only this image task. "
        "Use your built-in image generation/editing tool with the attached identity and pose reference images. "
        "Use included ChatGPT/Codex image generation. Do not use an API key, a paid image API, a browser, "
        "fal, subagents, or any other workflow. Never inspect credentials. "
        "The first attached image(s) are the influencer identity; the LAST attached image is the pose/environment frame. "
        "Create exactly one image, inspect it, and copy the selected image into this working directory as "
        "recreated-native.png. Your built-in image tool may save elsewhere first; copy its actual result here. "
        "Do not claim success unless an actual generated image was saved. "
        "If your native image tool is unavailable, return status unavailable; do not substitute another provider. "
        "Return the required JSON with the absolute saved image_path.\n\n"
        + ("Profile notes: " + profile["notes"] + "\n" if profile.get("notes") else "")
        + (run / "image-prompt.txt").read_text()
    )
    (run / "image-prompt-used.txt").write_text(prompt)
    command = ["codex", "exec", "--json", "--ephemeral", "--skip-git-repo-check", "--sandbox", "workspace-write",
               "--disable", "multi_agent", "--enable", "image_generation", "-c", 'approval_policy="never"',
               "--cd", str(run), "--output-schema", str(run / "image-result-schema.json"),
               "--output-last-message", str(run / "image-result.json")]
    for image in [*copies, run / "first-frame.png"]:
        command += ["--image", str(image)]
    command.append("-")
    if not image_account():
        raise ValueError("Connect a ChatGPT account in Connections to create images automatically, or use the ChatGPT website with the reference pack.")
    home = image_home()
    env = {k: v for k, v in os.environ.items() if k not in ("FAL_KEY", "AIMLAPI_KEY", "OPENAI_API_KEY", "CODEX_API_KEY")}
    env["CODEX_HOME"] = str(home)
    with IMAGE_LOCK, (run / "codex-image-events.jsonl").open("w") as output, (run / "codex-image-stderr.log").open("w") as errors:
        try:
            result = subprocess.run(command, input=prompt, text=True, cwd=run, env=env,
                                    stdout=output, stderr=errors, timeout=900)
        except subprocess.TimeoutExpired:
            raise ValueError("Starting-image creation timed out. Check the image step before retrying; no video was submitted.") from None
    logs = tail(run / "codex-image-stderr.log") + tail(run / "codex-image-events.jsonl")
    if not (run / "image-result.json").exists():
        raise ValueError(explain_image_failure(logs) or "ChatGPT did not return a starting image. Reconnect your account in Connections, or use the ChatGPT website with the reference pack.")
    data = hook.read(run / "image-result.json")
    if result.returncode or data.get("status") != "created" or not data.get("image_path"):
        raise ValueError(explain_image_failure(logs + " " + str(data.get("message"))) or data.get("message") or "Automatic image creation is unavailable for this account. Use the ChatGPT website with the reference pack.")
    path = Path(data["image_path"]).resolve(strict=True)
    generated_root = home / "generated_images"
    if not path.is_relative_to(run) and not path.is_relative_to(generated_root):
        raise ValueError("Codex returned an image outside the job or generated-image folder.")
    cli("attach", run, path)
    CODEX["image_verified"] = True
    hook.save(LOCAL / "capabilities.json", CODEX)


def resolve_media(url_path):
    """Map a /media/... URL path to a file inside runs, profiles or assets."""
    file = (ROOT / urllib.parse.unquote(url_path).removeprefix("/media/")).resolve()
    if not any(file.is_relative_to(ROOT / folder) for folder in ("runs", "profiles", "assets")) or not file.is_file():
        raise ValueError("Media not found.")
    return file


def cache_key(file, *parts):
    return hashlib.sha1("|".join([str(file), str(file.stat().st_mtime_ns), *map(str, parts)]).encode()).hexdigest()[:24]


def filmstrip(file, count, height):
    """One JPEG with `count` evenly spaced frames, cached. Used as timeline clip backgrounds."""
    out = LOCAL / "strips" / (cache_key(file, count, height) + ".jpg")
    if not out.is_file():
        out.parent.mkdir(exist_ok=True)
        duration = max(hook.seconds(file), 0.1)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(file), "-an", "-vf",
                        f"fps={count}/{duration:.4f},scale=-2:{height},tile={count}x1", "-frames:v", "1", "-q:v", "5", str(out)],
                       check=True, capture_output=True, timeout=120)
    return out


def waveform(file, buckets):
    """Normalized peak envelope for the timeline soundtrack lane, cached as JSON."""
    out = LOCAL / "waves" / (cache_key(file, buckets) + ".json")
    if not out.is_file():
        out.parent.mkdir(exist_ok=True)
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(file), "-vn", "-ac", "1", "-ar", "2000", "-f", "s16le", "-"],
                             check=True, capture_output=True, timeout=120).stdout
        samples = array("h")
        samples.frombytes(raw[: len(raw) // 2 * 2])
        size = max(1, len(samples) // buckets)
        peaks = [max((abs(v) for v in samples[i * size:(i + 1) * size]), default=0) / 32768 for i in range(min(buckets, max(1, len(samples) // size)))]
        top = max(peaks, default=0) or 1
        hook.save(out, {"duration": len(samples) / 2000, "peaks": [round(p / top, 3) for p in peaks]})
    return hook.read(out)


def chatgpt_pack(job):
    """Everything needed to make the starting image in the ChatGPT website, including free accounts."""
    run = Path(job["run"])
    manifest = hook.read(run / "job.json")
    profile = manifest.get("profile") or {}
    target = run / "chatgpt-pack.zip"
    prompt = (run / "image-prompt.txt").read_text() if (run / "image-prompt.txt").exists() else DEFAULT_IMAGE_PROMPT
    notes = ("Profile notes: " + profile["notes"] + "\n\n") if profile.get("notes") else ""
    guide = ("HOW TO USE\n1. Open chatgpt.com and start a new chat.\n2. Attach every identity-*.png/jpg first, then reference-frame.png LAST.\n"
             "3. Paste the prompt below and send.\n4. Save the image ChatGPT makes and drop it into Content Tool.\n\nPROMPT\n\n")
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as bundle:
        for i, image in enumerate(profile.get("images", []), 1):
            if Path(image).is_file():
                bundle.write(image, f"identity-{i}{Path(image).suffix}")
        if (run / "first-frame.png").is_file():
            bundle.write(run / "first-frame.png", "reference-frame.png")
        bundle.writestr("prompt.txt", guide + notes + prompt)
    return target


def saved_source(run, manifest):
    candidates = [Path(manifest["source_file"])] if manifest.get("source_file") else []
    candidates += sorted(run.glob("source*"))
    return next((p for p in candidates if p.is_file() and p.resolve().is_relative_to(run.resolve())
                 and (mimetypes.guess_type(p)[0] or "").startswith("video/")), None)


def run_job(job_id):
    try:
        with LOCK:
            job = dict(STATE["jobs"][job_id])
        if not job.get("run"):
            update(job_id, "preparing", "Preparing your selected motion and its first frame. No generation is submitted.")
            args = ["prepare", source_path(job["reference"]), "--profile", job["profile"],
                    "--start", str(job.get("start", 0)), "--short-mode", job.get("short_mode", "original")]
            if job.get("duration") is not None:
                args += ["--duration", str(job["duration"])]
            prepared = json.loads(cli(*args))
            update(job_id, run=prepared["job"])
            job["run"] = prepared["job"]
            if job.get("image_prompt") is not None:
                (Path(job["run"]) / "image-prompt.txt").write_text(job["image_prompt"] or DEFAULT_IMAGE_PROMPT)
        run = Path(job["run"])
        manifest = hook.read(run / "job.json")
        # A saved generated result always wins over queue polling or submission on resume.
        if (run / "generated.mp4").is_file():
            update(job_id, "hook_review", "Review the generated motion beside the exact input. Export only when you are happy with it.", error=None)
            return
        if not job.get("reference_approved"):
            update(job_id, "reference_review", "Play and scrub the motion input. Approve this trim before creating the image.")
            return
        if abs(hook.seconds(run / "reference.mp4") - 3) > 0.02:
            update(job_id, "reference_review", "This input is shorter than three seconds. Revise the trim or explicitly choose slow motion.")
            return
        if not manifest.get("image"):
            if job.get("image_mode") == "manual":
                update(job_id, "needs_image", "Reference approved. Upload the starting image you created in ChatGPT.")
                return
            update(job_id, "creating_image", "Recreating your model in the approved reference pose using Codex.")
            try:
                generate_image(run)
            except Exception as exc:
                update(job_id, "needs_image", "Image creation needs attention. Upload a starting image or retry.", error=safe_error(exc))
                return
            update(job_id, "image_ready", "Starting image saved. Review identity, pose, hands and framing.", error=None)
        if not job.get("image_approved"):
            update(job_id, "image_review", "Review the starting image and motion reference before submitting a paid attempt.")
            return
        if not video_ready():
            update(job_id, "needs_key", f"Image approved. Add your {provider_label()} key in Connections to generate the hook.")
            return
        manifest = hook.read(run / "job.json")
        if not manifest.get("queue"):
            if manifest.get("submission_attempted"):
                raise ValueError("The previous submission has an uncertain result. Check fal request history before retrying.")
            manifest["motion_prompt"] = job.get("motion_prompt") or hook.DEFAULT_MOTION_PROMPT
            hook.save(run / "job.json", manifest)
            update(job_id, "submitting", "Sending your approved image, video prompt and exact motion reference to Kling.")
            cli("submit", run, "--provider", video_provider())
            manifest = hook.read(run / "job.json")
            update(job_id, "queued", f"Motion request accepted by {provider_label()}.", request_id=manifest["queue"]["request_id"])
        waited = 0
        while not (run / "generated.mp4").is_file():
            cli("status", run, "--download")
            manifest = hook.read(run / "job.json")
            remote = manifest.get("last_status", {})
            if remote.get("error") or remote.get("status") in ("FAILED", "CANCELLED"):
                raise ValueError(str(remote.get("error") or "The saved fal request failed or was cancelled. Review its request history before creating a revision."))
            if (run / "generated.mp4").is_file():
                break
            if remote.get("status") == "IN_PROGRESS":
                update(job_id, "generating", "Kling is generating your reaction hook. Your approved input remains playable.")
            elif remote.get("status") == "IN_QUEUE":
                update(job_id, "queued", f"Your motion request is in the {'AIMLAPI' if manifest.get('provider') == 'aimlapi' else 'fal'} queue.")
            if waited >= 1800:
                update(job_id, "pending", "The request is still running. Resume to check the same request.")
                return
            time.sleep(10)
            waited += 10
        update(job_id, "hook_review", "Generated motion is ready to review. Compare movement, continuity and identity before export.", error=None)
    except Exception as exc:
        update(job_id, "error", "This step needs attention. Your files and existing paid request are saved.", error=safe_error(exc))
    finally:
        with LOCK:
            ACTIVE.discard(job_id)
            persist()


def validate_motion_prompt(value):
    if not isinstance(value, str) or len(value) > 2000:
        raise ValueError("Use a video prompt of up to 2,000 characters.")
    return value.strip()


def save_motion_prompt(job_id, value):
    prompt = validate_motion_prompt(value)
    with LOCK:
        job = STATE["jobs"][job_id]
        if job_id in ACTIVE:
            raise ValueError("Wait for the current step to finish before editing the video prompt.")
        if job.get("run"):
            run = Path(job["run"])
            manifest = hook.read(run / "job.json")
            if manifest.get("submission_attempted") or manifest.get("queue") or (run / "generated.mp4").exists():
                raise ValueError("This attempt is already submitted. Create a revision to change its video prompt.")
            manifest["motion_prompt"] = prompt
            hook.save(run / "job.json", manifest)
        update(job_id, motion_prompt=prompt)
    return prompt


def validate_image_prompt(value):
    if not isinstance(value, str) or len(value) > 12000:
        raise ValueError("Use an image prompt of up to 12,000 characters.")
    return value.strip()


def save_image_prompt(job_id, value):
    prompt = validate_image_prompt(value) or DEFAULT_IMAGE_PROMPT
    with LOCK:
        job = STATE["jobs"][job_id]
        if job_id in ACTIVE:
            raise ValueError("Wait for the current step to finish before editing the image prompt.")
        if job.get("run"):
            run = Path(job["run"])
            manifest = hook.read(run / "job.json")
            if manifest.get("submission_attempted") or manifest.get("queue") or (run / "generated.mp4").exists():
                raise ValueError("Create a revision to change the image prompt after motion submission.")
            (run / "image-prompt.txt").write_text(prompt)
        update(job_id, image_prompt=prompt)
    return prompt


def save_prompt_template(data):
    kind = data.get("kind")
    if kind not in ("image", "motion"):
        raise ValueError("Choose an image or video prompt.")
    with LOCK:
        library = STATE.setdefault("saved_prompts", [])
        entry = next((item for item in library if item["id"] == data.get("id")), None)
        if data.get("id") and (not entry or entry["kind"] != kind):
            raise ValueError("Saved prompt not found. Choose it again.")
        if data.get("delete"):
            if not entry:
                raise ValueError("Choose a saved prompt to delete.")
            library.remove(entry)
        else:
            name = str(data.get("name", "")).strip()
            text = (validate_image_prompt if kind == "image" else validate_motion_prompt)(data.get("text", ""))
            if not name or len(name) > 80 or not text:
                raise ValueError("Enter a name (up to 80 characters) and prompt text.")
            if not entry:
                entry = {"id": uuid.uuid4().hex, "kind": kind}
                library.append(entry)
            entry.update(name=name, text=text)
        persist()
        return entry


def start_job(job_id, approve_reference=False, approve_image=False, motion_prompt=None, image_prompt=None):
    with LOCK:
        if job_id not in STATE["jobs"]:
            raise ValueError("Project not found.")
        if job_id in ACTIVE:
            return
        job = STATE["jobs"][job_id]
        if image_prompt is not None:
            save_image_prompt(job_id, image_prompt)
        if motion_prompt is not None:
            save_motion_prompt(job_id, motion_prompt)
        if approve_reference:
            if job["step"] != "reference_review" or not job.get("run"):
                raise ValueError("Review the prepared reference first.")
            if abs(hook.seconds(Path(job["run"]) / "reference.mp4") - 3) > 0.02:
                raise ValueError("Choose three seconds of continuous motion or explicitly select slow motion in a revised trim.")
            job["reference_approved"] = True
        if approve_image:
            if not job.get("reference_approved") or job["step"] not in ("image_review", "image_ready", "needs_key"):
                raise ValueError("Approve the reference and review the starting image first.")
            job["image_approved"] = True
        job["error"] = None
        ACTIVE.add(job_id)
        persist()
    POOL.submit(run_job, job_id)


def export_hook(job_id, retime, gain, include_hook_audio=False):
    try:
        job = STATE["jobs"][job_id]
        update(job_id, "exporting", "Exporting the three-second hook and the complete reel soundtrack.")
        hook.export_project(job["run"], retime=retime, gain=gain, include_hook_audio=include_hook_audio, title=job["title"])
        update(job_id, "complete", "Hook and full soundtrack are ready. Download the project assets.",
               error=None, output_seconds=3, finished_at=now())
    except Exception as exc:
        update(job_id, "hook_review", "Export needs attention. Your original generated motion is preserved.", error=safe_error(exc))
    finally:
        with LOCK:
            ACTIVE.discard(job_id)
            persist()


def edit_source(source):
    if not isinstance(source, dict):
        raise ValueError("Choose an uploaded clip or saved reaction.")
    if source.get("kind") == "asset":
        asset = STATE["assets"].get(source.get("id"))
        if not asset or asset["kind"] != "video":
            raise ValueError("A clip is missing. Upload it again.")
        return Path(asset["path"]), asset["duration"], asset["name"]
    if source.get("kind") == "job" and source.get("media") in ("hook", "generated"):
        job = STATE["jobs"].get(source.get("id"))
        if job and job.get("run"):
            path = Path(job["run"]) / (source["media"] + ".mp4")
            if path.is_file():
                return path, hook.seconds(path), job["title"]
    raise ValueError("This reaction clip is unavailable. Choose another clip.")


def validate_edit(data):
    if not isinstance(data, dict) or not isinstance(data.get("clips"), list) or len(data["clips"]) > 30:
        raise ValueError("Use a sequence of up to 30 clips.")
    clips, resolved, ids = [], [], set()
    for clip in data["clips"]:
        if not isinstance(clip, dict):
            raise ValueError("Choose a valid clip.")
        identity = clip.get("id")
        if not isinstance(identity, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", identity) or identity in ids:
            raise ValueError("Each timeline clip needs a unique identifier.")
        ids.add(identity)
        path, duration, name = edit_source(clip.get("source"))
        start = editing.number(clip.get("start", 0), "clip start", high=duration)
        end = editing.number(clip.get("end", duration), "clip end", high=duration + 0.00001)
        start_frame, end_frame = round(start * 30), min(round(end * 30), math.floor(duration * 30 + 0.001))
        if end_frame <= start_frame:
            raise ValueError("Each clip needs at least one frame between its in and out points.")
        volume = editing.number(clip.get("volume", 1), "clip volume", high=2)
        source = {k: clip["source"][k] for k in ("kind", "id", "media") if k in clip["source"]}
        item = {"id": identity, "source": source, "start": start_frame / 30, "end": end_frame / 30, "volume": volume}
        clips.append(item)
        resolved.append(dict(item, path=str(path), name=name, start_frame=start_frame, end_frame=end_frame))
    mode = data.get("audio_mode", "reel")
    if mode not in ("reel", "clips", "mix", "silent"):
        raise ValueError("Choose a supported soundtrack mode.")
    result = {"clips": clips, "audio_mode": mode,
              "audio_gain": editing.number(data.get("audio_gain", 1), "soundtrack volume", high=2),
              "audio_start": editing.number(data.get("audio_start", 0), "soundtrack start"),
              "keep_full_audio": bool(data.get("keep_full_audio", True))}
    return result, resolved


def save_edit(job_id, data, version):
    with LOCK:
        job = STATE["jobs"][job_id]
        if job_id in ACTIVE:
            raise ValueError("Wait for the current operation to finish before editing the sequence.")
        if version != job.get("edit_version", 0):
            raise ValueError("This edit changed in another window. Reload the project before saving.")
        document, resolved = validate_edit(data)
        update(job_id, edit=document, edit_version=job.get("edit_version", 0) + 1, edit_status="draft", edit_error=None)
        return document, resolved


def assemble_job(job_id, document, resolved, version):
    try:
        job = STATE["jobs"][job_id]
        run = Path(job["run"])
        soundtrack = run / "reel-audio-full.m4a"
        if document["audio_mode"] in ("reel", "mix") and not soundtrack.is_file():
            raise ValueError("This reel has no audio. Choose clip audio or silent output.")
        report = editing.render(resolved, run / "edit.mp4", soundtrack=soundtrack,
                                audio_mode=document["audio_mode"], audio_gain=document["audio_gain"],
                                audio_start=document["audio_start"], keep_full_audio=document["keep_full_audio"])
        update(job_id, edit_status="ready", edit_error=None, assembly_report=report, rendered_edit_version=version)
    except Exception as exc:
        update(job_id, edit_status="error", edit_error=safe_error(exc))
    finally:
        with LOCK:
            ACTIVE.discard(job_id)
            persist()


def revise_job(job, data):
    reference = job.get("reference")
    if job.get("run"):
        run = Path(job["run"])
        source = saved_source(run, hook.read(run / "job.json"))
        if source:
            reference = register_asset(source, name=job["title"] + " source")["id"]
    return create_job({"reference": reference, "profile": job["profile"], "demo": job.get("demo"),
                       "start": data.get("start", job.get("start", 0)),
                       "duration": data.get("duration", job.get("duration")),
                       "short_mode": data.get("short_mode", job.get("short_mode", "original")),
                       "image_mode": data.get("image_mode", job.get("image_mode", "codex")),
                       "image_prompt": data.get("image_prompt", job.get("image_prompt", DEFAULT_IMAGE_PROMPT)),
                       "motion_prompt": data.get("motion_prompt", job.get("motion_prompt", hook.DEFAULT_MOTION_PROMPT)),
                       "title": data.get("title") or job["title"][:109] + " · revision",
                       "request_key": data.get("request_key", "")})


def create_job(data):
    request_key = str(data.get("request_key", ""))
    if request_key and not re.fullmatch(r"[a-zA-Z0-9_-]{8,80}", request_key):
        raise ValueError("Refresh the page before creating a new video.")
    with LOCK:
        previous = next((j for j in STATE["jobs"].values() if request_key and j.get("request_key") == request_key), None)
        if previous:
            return previous["id"]
    profile = data.get("profile", "")
    if not (hook.profile_path(profile) / "profile.json").is_file():
        raise ValueError("Select a saved influencer model.")
    reference = str(data.get("reference", ""))
    source_path(reference)
    demo = data.get("demo") or None
    if demo and (demo not in STATE["assets"] or STATE["assets"][demo]["kind"] != "video"):
        raise ValueError("Upload the demo video again.")
    start = float(data.get("start") or 0)
    duration = float(data["duration"]) if data.get("duration") not in (None, "") else None
    if not 0 <= start < 86400 or (duration is not None and not 0.2 <= duration <= 3):
        raise ValueError("Select a valid start time and a reaction length between 0.2 and 3 seconds.")
    if data.get("short_mode", "original") not in ("original", "slow") or data.get("image_mode", "codex") not in ("codex", "manual"):
        raise ValueError("Choose a supported image and duration mode.")
    image_prompt = validate_image_prompt(data.get("image_prompt", DEFAULT_IMAGE_PROMPT)) or DEFAULT_IMAGE_PROMPT
    motion_prompt = validate_motion_prompt(data.get("motion_prompt", hook.DEFAULT_MOTION_PROMPT))
    job_id = uuid.uuid4().hex
    source_label = STATE["assets"].get(reference, {}).get("name") or "Instagram reference"
    title = str(data.get("title") or f"{profile} · {Path(source_label).stem} · {datetime.now().strftime('%b %d %H:%M')}").strip()
    if not title or len(title) > 120:
        raise ValueError("Use a project title between 1 and 120 characters.")
    job = {"id": job_id, "title": title, "profile": profile, "reference": reference,
           "demo": demo, "start": start, "duration": duration, "short_mode": data.get("short_mode", "original"),
           "image_mode": data.get("image_mode", "codex"), "image_prompt": image_prompt, "motion_prompt": motion_prompt, "review_image": bool(data.get("review_image")),
           "step": "created", "events": [], "created_at": now(), "updated_at": now(), "run": None,
           "request_key": request_key}
    with LOCK:
        # Check again inside the insertion lock for simultaneous duplicate clicks.
        previous = next((j for j in STATE["jobs"].values() if request_key and j.get("request_key") == request_key), None)
        if previous:
            return previous["id"]
        STATE["jobs"][job_id] = job
        persist()
    start_job(job_id)
    return job_id


def initialize():
    global STATE, SETTINGS
    LOCAL.mkdir(exist_ok=True)
    ASSETS.mkdir(exist_ok=True)
    if (LOCAL / "state.json").exists():
        STATE = hook.read(LOCAL / "state.json")
    if (LOCAL / "settings.json").exists():
        SETTINGS = hook.read(LOCAL / "settings.json")
    if (LOCAL / "capabilities.json").exists():
        CODEX.update(hook.read(LOCAL / "capabilities.json"))
    refresh_chatgpt()
    for role, path in [("demo", DEFAULT_DEMO), ("reference", DEFAULT_REFERENCE)]:
        if path and not STATE["defaults"].get(role) and path.is_file():
            STATE["defaults"][role] = register_asset(path)["id"]
    for job in STATE["jobs"].values():
        if job.get("edit_status") == "rendering":
            job.update(edit_status="draft", edit_error="Rendering was interrupted. Your saved sequence is ready to export again.")
        old_title = job.get("title", "")
        if old_title == "Instagram reference" or Path(old_title).suffix.lower() in (".mp4", ".mov", ".webm", ".m4v"):
            label = Path(old_title).stem
            if old_title == "Instagram reference":
                label = "Instagram hook"
                if job.get("run") and (Path(job["run"]) / "job.json").exists():
                    original = hook.read(Path(job["run"]) / "job.json").get("source", "")
                    match = re.search(r"/(?:reel|reels|p)/([A-Za-z0-9_-]+)", original)
                    if match:
                        label += " " + match.group(1)
            stamp = datetime.fromisoformat(job["created_at"]).astimezone().strftime("%b %d %H:%M")
            job["title"] = f"{job['profile']} · {label} · {stamp}"[:120]
        if job["step"] in ("preparing", "creating_image", "submitting", "queued", "generating", "assembling", "exporting"):
            job["step"] = "interrupted"
            job["events"].append({"at": now(), "step": "interrupted", "message": "App restarted. Resume to continue from saved files and request history."})
        if job.get("run") and not job.get("reference_approved") and job["step"] in ("image_ready", "image_review", "needs_key"):
            job["step"] = "reference_review"
        # Recover the already-paid 2.933s result directly into a usable review step.
        if job.get("run"):
            run = Path(job["run"])
            try:
                manifest = hook.read(run / "job.json")
                source = saved_source(run, manifest)
                if source and "audio_duration" not in manifest:
                    duration = hook.extract_full_audio(source, run / "reel-audio-full.m4a")
                    manifest.update(audio_duration=duration, source_has_audio=duration is not None,
                                    source_total_duration=hook.seconds(source))
                    hook.save(run / "job.json", manifest)
            except (ValueError, OSError, subprocess.CalledProcessError):
                pass
            if (run / "generated.mp4").is_file() and job["step"] != "complete":
                try:
                    manifest = hook.read(run / "job.json")
                    manifest["generated_duration"] = hook.seconds(run / "generated.mp4")
                    manifest["stage"] = "generated_review"
                    source = saved_source(run, manifest)
                    if source:
                        manifest["source_has_audio"] = any(s["codec_type"] == "audio" for s in hook.probe(source)["streams"])
                        manifest["source_total_duration"] = hook.seconds(source)
                    hook.save(run / "job.json", manifest)
                    if job["step"] != "hook_review" or not job["events"] or job["events"][-1]["step"] != "hook_review":
                        job["events"].append({"at": now(), "step": "hook_review", "message": "Recovered the saved generated motion for review. No new paid request was submitted."})
                    job.update(step="hook_review", error=None)
                except (ValueError, OSError, subprocess.CalledProcessError):
                    pass
    persist()


class Handler(BaseHTTPRequestHandler):
    server_version = "ReactionWorkbench/1.0"

    def log_message(self, format, *args):
        # No request bodies, user paths, or credentials are logged.
        pass

    def permitted(self, mutation=False):
        host = self.headers.get("Host", "")
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if host not in allowed:
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in {"http://" + h for h in allowed}:
            return False
        return not mutation or secrets.compare_digest(self.headers.get("X-Workbench-Token", ""), TOKEN)

    def respond(self, data, code=200):
        content = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 65536:
            raise ValueError("The request body is too large or empty.")
        return json.loads(self.rfile.read(length))

    def file(self, path, head=False, attachment=False):
        size = path.stat().st_size
        start, end = 0, size - 1
        partial = self.headers.get("Range")
        if partial:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", partial)
            if not match or (not match[1] and not match[2]):
                self.respond({"error": "Unsupported media range."}, 416)
                return
            if not match[1]:
                start = max(0, size - int(match[2]))
            else:
                start = int(match[1])
                end = min(end, int(match[2])) if match[2] else end
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", mimetypes.guess_type(path)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'")
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        if attachment:
            filename = path.name
            if path.name == "project.zip":
                project = next((j for j in STATE["jobs"].values() if j.get("run") and Path(j["run"]).resolve() == path.parent), None)
                if project:
                    filename = (re.sub(r"[^a-zA-Z0-9_-]+", "-", project["title"]).strip("-")[:90] or "project") + ".zip"
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        if head:
            return
        with path.open("rb") as src:
            src.seek(start)
            remaining = end - start + 1
            while remaining:
                block = src.read(min(1024 * 1024, remaining))
                if not block:
                    break
                self.wfile.write(block)
                remaining -= len(block)

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_GET(self, head=False):
        if not self.permitted():
            self.respond({"error": "This app is available only from its local address."}, 403)
            return
        url = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(url.path)
        try:
            if path == "/api/state":
                self.respond(public_state())
            elif path.startswith("/media/"):
                file = resolve_media(path)
                mime = mimetypes.guess_type(file)[0] or ""
                is_bundle = file.name in ("project.zip", "chatgpt-pack.zip") and file.is_relative_to(ROOT / "runs")
                if not (mime.startswith(("image/", "video/", "audio/")) or is_bundle):
                    raise ValueError("Media not found.")
                self.file(file, head, "download" in urllib.parse.parse_qs(url.query, keep_blank_values=True))
            elif path in ("/api/filmstrip", "/api/waveform"):
                query = urllib.parse.parse_qs(url.query)
                source = resolve_media(query.get("src", [""])[0])
                if path == "/api/waveform":
                    self.respond(waveform(source, max(50, min(1200, int(query.get("buckets", ["400"])[0])))))
                else:
                    self.file(filmstrip(source, max(2, min(48, int(query.get("n", ["12"])[0]))), max(32, min(160, int(query.get("h", ["72"])[0])))), head)
            elif re.fullmatch(r"/api/jobs/[a-f0-9]+/chatgpt-pack", path):
                job = STATE["jobs"].get(path.split("/")[3])
                if not job or not job.get("run"):
                    raise ValueError("Prepare the reference first.")
                self.file(chatgpt_pack(job), head, True)
            elif path in ("/third-party-licenses.txt",):
                self.file(WEB / "dist" / "THIRD_PARTY_LICENSES.txt", head)
            elif path == "/" or path == "/index.html":
                self.file(WEB / "index.html", head)
            elif path.startswith("/assets/"):
                file = (WEB / "dist" / path.removeprefix("/assets/")).resolve()
                if not file.is_file() or not file.is_relative_to(WEB / "dist"):
                    raise ValueError("Not found.")
                self.file(file, head)
            else:
                self.respond({"error": "Not found."}, 404)
        except (ValueError, OSError) as exc:
            self.respond({"error": safe_error(exc)}, 404)

    def do_POST(self):
        if not self.permitted(mutation=True):
            self.respond({"error": "Refresh the local app and try again."}, 403)
            return
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/upload":
                query = urllib.parse.parse_qs(parsed.query)
                name = Path(query.get("name", ["upload.mp4"])[0]).name
                suffix = Path(name).suffix.lower()
                if suffix not in (".mp4", ".mov", ".m4v", ".webm", ".png", ".jpg", ".jpeg", ".webp"):
                    raise ValueError("Upload an MP4, MOV, WebM, PNG, JPG, or WebP file.")
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_UPLOAD:
                    raise ValueError("Choose a file smaller than 512 MB.")
                target = ASSETS / (uuid.uuid4().hex + suffix)
                try:
                    with target.open("xb") as dest:
                        remaining = length
                        while remaining:
                            block = self.rfile.read(min(1024 * 1024, remaining))
                            if not block:
                                raise ValueError("Upload interrupted. Choose the file again.")
                            dest.write(block)
                            remaining -= len(block)
                    entry = register_asset(target, name=name)
                except Exception:
                    target.unlink(missing_ok=True)
                    raise
                self.respond(public_asset(entry))
                return
            data = self.body()
            if path == "/api/chatgpt":
                action = data.get("action")
                if action == "connect":
                    start_chatgpt_login()
                elif action == "cancel":
                    cancel_chatgpt_login()
                elif action == "disconnect":
                    disconnect_chatgpt()
                elif action == "check":
                    refresh_chatgpt()
                elif action == "use":
                    if data.get("account") not in ("app", "system"):
                        raise ValueError("Choose a ChatGPT sign-in to use.")
                    SETTINGS["image_account"] = data["account"]
                    hook.save(LOCAL / "settings.json", SETTINGS)
                else:
                    raise ValueError("Unknown connection action.")
                self.respond(chatgpt_public())
            elif path == "/api/settings":
                if "fal_key" in data:
                    key = str(data["fal_key"]).strip()
                    if key and (len(key) < 8 or "\n" in key or "\r" in key):
                        raise ValueError("Enter the complete fal API key.")
                    SETTINGS["fal_key"] = key
                    hook.save(LOCAL / "settings.json", SETTINGS)
                    os.chmod(LOCAL / "settings.json", 0o600)
                if "aimlapi_key" in data:
                    key = str(data["aimlapi_key"]).strip()
                    if key and (len(key) < 8 or "\n" in key or "\r" in key):
                        raise ValueError("Enter the complete AIMLAPI key.")
                    SETTINGS["aimlapi_key"] = key
                    hook.save(LOCAL / "settings.json", SETTINGS)
                    os.chmod(LOCAL / "settings.json", 0o600)
                if "video_provider" in data:
                    if data["video_provider"] not in hook.PROVIDERS:
                        raise ValueError("Choose fal or AIMLAPI.")
                    SETTINGS["video_provider"] = data["video_provider"]
                    hook.save(LOCAL / "settings.json", SETTINGS)
                    os.chmod(LOCAL / "settings.json", 0o600)
                self.respond({"fal_configured": bool(configured_key()), "aimlapi_configured": bool(aiml_key()),
                              "video_provider": video_provider(), "video_ready": video_ready()})
            elif path == "/api/prompts":
                self.respond(save_prompt_template(data))
            elif path == "/api/profiles":
                ids = data.get("images", [])
                if not ids or len(ids) > 5 or any(i not in STATE["assets"] or STATE["assets"][i]["kind"] != "image" for i in ids):
                    raise ValueError("Upload one to five influencer images.")
                cli("profile", data.get("name", ""), *[STATE["assets"][i]["path"] for i in ids], "--notes", data.get("notes", ""))
                self.respond({"saved": True})
            elif path == "/api/jobs":
                self.respond({"id": create_job(data)}, 201)
            elif re.fullmatch(r"/api/jobs/[a-f0-9]+/(run|attach|dry-run|export|revise|rename|archive|regenerate|prompt|edit|assemble)", path):
                _, _, _, job_id, action = path.split("/")
                if job_id not in STATE["jobs"]:
                    raise ValueError("Video not found.")
                job = STATE["jobs"][job_id]
                if action == "run":
                    start_job(job_id, approve_reference=bool(data.get("approve_reference")), approve_image=bool(data.get("approve_image")), motion_prompt=data.get("motion_prompt"), image_prompt=data.get("image_prompt"))
                elif action in ("edit", "assemble"):
                    with LOCK:
                        if not job.get("run"):
                            raise ValueError("Prepare the project reference before editing.")
                        document, resolved = save_edit(job_id, data.get("edit"), data.get("version"))
                        version = job["edit_version"]
                        if action == "assemble":
                            if not resolved:
                                raise ValueError("Add at least one clip to the sequence.")
                            ACTIVE.add(job_id)
                            update(job_id, edit_status="rendering", edit_error=None)
                            POOL.submit(assemble_job, job_id, document, resolved, version)
                    self.respond({"version": version, "edit": document})
                    return
                elif action == "prompt":
                    if "image_prompt" in data:
                        save_image_prompt(job_id, data["image_prompt"])
                    if "motion_prompt" in data:
                        save_motion_prompt(job_id, data["motion_prompt"])
                elif action == "rename":
                    title = str(data.get("title", "")).strip()
                    if not title or len(title) > 120:
                        raise ValueError("Use a title between 1 and 120 characters.")
                    update(job_id, title=title)
                elif action == "archive":
                    if job_id in ACTIVE:
                        raise ValueError("Wait for the current step to finish before archiving.")
                    update(job_id, archived=bool(data.get("archived")))
                elif action == "revise":
                    if job_id in ACTIVE:
                        raise ValueError("Wait for the current step to finish before revising.")
                    self.respond({"id": revise_job(job, data)}, 201)
                    return
                elif action == "export":
                    gain = float(data.get("audio_gain", 1))
                    if not math.isfinite(gain) or not 0 <= gain <= 2:
                        raise ValueError("Audio volume must be between 0 and 200%.")
                    with LOCK:
                        if job_id in ACTIVE:
                            raise ValueError("Wait for the current step to finish.")
                        if job["step"] not in ("hook_review", "complete"):
                            raise ValueError("Review generated motion before exporting.")
                        ACTIVE.add(job_id)
                    POOL.submit(export_hook, job_id, bool(data.get("retime")), gain, bool(data.get("include_hook_audio")))
                elif action == "regenerate":
                    if "image_prompt" in data:
                        save_image_prompt(job_id, data["image_prompt"])
                    if job_id in ACTIVE or not job.get("run"):
                        raise ValueError("Wait for the current step to finish.")
                    run = Path(job["run"])
                    manifest = hook.read(run / "job.json")
                    if manifest.get("submission_attempted"):
                        raise ValueError("Create a revision to change inputs after submission.")
                    if (run / "starting-image.png").exists():
                        (run / "starting-image.png").replace(run / ("starting-image.previous-" + uuid.uuid4().hex[:6] + ".png"))
                    manifest.update(image=None, stage="awaiting_image")
                    hook.save(run / "job.json", manifest)
                    update(job_id, image_approved=False, image_mode="codex")
                    start_job(job_id)
                elif action == "attach":
                    if job_id in ACTIVE:
                        raise ValueError("Wait for the current step to finish before replacing its image.")
                    asset = STATE["assets"].get(data.get("asset"))
                    if not asset or asset["kind"] != "image" or not job.get("run"):
                        raise ValueError("Upload a starting image after preparing the reference.")
                    cli("attach", job["run"], asset["path"])
                    update(job_id, "image_review" if job.get("reference_approved") else "reference_review",
                           "Starting image attached. Review it before generating motion.", image_approved=False, error=None)
                else:
                    if job_id in ACTIVE:
                        raise ValueError("Wait for the current step to finish before checking the request.")
                    cli("submit", job["run"], "--dry-run")
                self.respond({"ok": True})
            else:
                self.respond({"error": "Not found."}, 404)
        except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
            self.respond({"error": safe_error(exc)}, 400)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    initialize()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Reaction workbench ready: http://127.0.0.1:{args.port}", flush=True)
    print("Stop with Ctrl+C. Your videos and progress are saved locally.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
