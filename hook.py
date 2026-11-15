#!/usr/bin/env python3
"""Local preparation and fal queue operations for a three-second reaction hook.

Image creation stays in ChatGPT/Codex; this program never calls an image API.
Requires Python 3.10+, ffmpeg, ffprobe, and yt-dlp for URL input.
"""
import argparse
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

ROOT = Path(__file__).resolve().parent
MODEL = "fal-ai/kling-video/v3/standard/motion-control"
AIML_MODEL = "klingai/video-v3-motion-control"
AIML_BASE = "https://api.aimlapi.com/v2/video/generations"
PROVIDERS = ("fal", "aimlapi")
DOWNLOADER = ROOT / ".local" / "downloader"
DEFAULT_MOTION_PROMPT = 'Preserve the character identity, clothing and scene from the image. Follow the reference performance naturally in one continuous shot. Keep facial features, hands and background stable. Avoid flicker, sudden jumps and identity changes.'


class RemoteAPIError(ValueError):
    def __init__(self, code, detail, provider="fal"):
        self.code = code
        super().__init__(f"{provider} returned HTTP {code}: {detail}")


def run(args):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, text=True).stdout


def read(path):
    return json.loads(Path(path).read_text())


def save(path, data):
    path = Path(path)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, indent=2) + "\n")
    temp.replace(path)


def probe(path):
    return json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path]))


def seconds(path):
    info = probe(path)
    stream = next(s for s in info["streams"] if s["codec_type"] == "video")
    return float(stream.get("duration") or info["format"]["duration"])


def video_size(path):
    return next(s for s in probe(path)["streams"] if s["codec_type"] == "video")


def valid_video(path, expected_duration=None):
    """Validate persisted exports before reusing them after an interruption."""
    try:
        if not Path(path).is_file():
            return False
        duration = seconds(path)
        if not math.isfinite(duration) or duration <= 0:
            return False
        if expected_duration is not None and abs(duration - expected_duration) > 0.04:
            return False
        run(["ffmpeg", "-v", "error", "-xerror", "-i", path, "-f", "null", "-"])
        return True
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError):
        return False


def normalize_hook(source, target, *, retime=False, audio_source=None, audio_start=0, audio_gain=1):
    """Export reviewed motion; short outputs require explicit speed correction, never a freeze."""
    target = Path(target)
    partial = target.with_name(target.stem + ".partial.mp4")
    duration = seconds(source)
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Generated video has no usable motion.")
    if duration < 3 and not retime:
        raise ValueError(f"Generated motion is {duration:.3f}s. Review it and explicitly choose retiming to export three seconds.")
    if not math.isfinite(audio_gain) or not 0 <= audio_gain <= 2:
        raise ValueError("Audio volume must be between 0 and 200%.")
    speed = 3 / duration if duration < 3 else 1
    inputs = ["-i", source]
    filters = [f"[0:v:0]setpts={speed:.12f}*(PTS-STARTPTS),fps=30,trim=duration=3,"
               "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1[v]"]
    audio = audio_source and any(s["codec_type"] == "audio" for s in probe(audio_source)["streams"])
    mapping = ["-map", "[v]"]
    if audio and audio_gain > 0:
        inputs += ["-ss", str(audio_start), "-i", audio_source]
        filters.append(f"[1:a:0]asetpts=PTS-STARTPTS,aresample=48000,volume={audio_gain},"
                       "apad,atrim=duration=3[a]")
        mapping += ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"]
    else:
        mapping += ["-an"]
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filters), *mapping,
         "-frames:v", "90", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", partial])
    if not valid_video(partial, 3):
        raise ValueError("The reviewed hook did not pass export verification.")
    partial.replace(target)
    return {"generated_seconds": duration, "export_seconds": seconds(target), "retimed": speed != 1,
            "playback_speed": 1 / speed, "video_freeze_added": False,
            "audio": "source_reel" if audio and audio_gain > 0 else "silent",
            "audio_start": audio_start, "audio_gain": audio_gain}


def audio_seconds(path):
    info = probe(path)
    stream = next(s for s in info["streams"] if s["codec_type"] == "audio")
    return float(stream.get("duration") or info["format"]["duration"])


def extract_full_audio(source, target, gain=1):
    """Keep the whole source soundtrack, independent of the hook trim."""
    if not math.isfinite(gain) or not 0 <= gain <= 2:
        raise ValueError("Audio volume must be between 0 and 200%.")
    if not any(s["codec_type"] == "audio" for s in probe(source)["streams"]):
        return None
    target = Path(target)
    partial = target.with_name(target.stem + ".partial.m4a")
    codec = ["-c:a", "copy"] if gain == 1 and next(s for s in probe(source)["streams"] if s["codec_type"] == "audio")["codec_name"] == "aac" else ["-af", f"volume={gain}", "-c:a", "aac", "-b:a", "192k"]
    run(["ffmpeg", "-v", "error", "-y", "-i", source, "-vn", "-map", "0:a:0", *codec, "-movflags", "+faststart", partial])
    duration = audio_seconds(partial)
    expected = audio_seconds(source)
    if abs(duration - expected) > 0.15:
        raise ValueError("The full soundtrack export has an unexpected duration.")
    partial.replace(target)
    return duration


def export_project(run_dir, *, retime=False, gain=1, include_hook_audio=False, title=None):
    job, manifest = load_job(run_dir)
    source = Path(manifest["source_file"]) if manifest.get("source_file") else next((p for p in job.glob("source*") if (mimetypes.guess_type(p)[0] or "").startswith("video/")), None)
    report = normalize_hook(job / "generated.mp4", job / "hook.mp4", retime=retime,
                            audio_source=source if include_hook_audio else None,
                            audio_start=manifest.get("source_start", 0), audio_gain=gain)
    soundtrack = job / "soundtrack.m4a"
    duration = extract_full_audio(source, soundtrack, gain) if source else None
    report.update(title=title or manifest.get("title") or job.name, soundtrack_seconds=duration, soundtrack_start=0, soundtrack_gain=gain,
                  full_soundtrack=duration is not None, include_hook_audio=include_hook_audio,
                  assembly="Hook and full soundtrack are separate assets; no video extension or stitching applied.")
    partial = job / "project.partial.zip"
    with zipfile.ZipFile(partial, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.write(job / "hook.mp4", "hook.mp4")
        if duration is not None:
            archive.write(soundtrack, "soundtrack.m4a")
        archive.writestr("project.json", json.dumps(report, indent=2))
    partial.replace(job / "project.zip")
    manifest.update(stage="complete", export_report=report, generated_duration=report["generated_seconds"])
    save(job / "job.json", manifest)
    return report


def profile_path(name):
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", name):
        raise ValueError("Use only letters, numbers, underscores, or hyphens in a profile name.")
    return ROOT / "profiles" / name


def profile(args):
    target = profile_path(args.name)
    if target.exists():
        raise ValueError("Profile already exists. Choose a new name to preserve the saved references.")
    inputs = [Path(p).expanduser().resolve(strict=True) for p in args.images]
    for path in inputs:
        if not (mimetypes.guess_type(path)[0] or "").startswith("image/"):
            raise ValueError(f"Not a recognized image file: {path.name}")
        video_size(path)
    target.mkdir(parents=True)
    images = []
    for i, source in enumerate(inputs, 1):
        dest = target / f"identity-{i}{source.suffix.lower()}"
        shutil.copy2(source, dest)
        images.append(str(dest))
    save(target / "profile.json", {"name": args.name, "images": images, "notes": args.notes})
    print(f"Saved {len(images)} reference images to {target}")


def detect_cut(source, start, duration):
    result = subprocess.run([
        "ffmpeg", "-hide_banner", "-ss", str(start), "-i", str(source),
        "-t", str(duration), "-an", "-vf", "scale=320:-2,select=gt(scene\\,0.35),showinfo",
        "-f", "null", "-"
    ], capture_output=True, text=True, check=True)
    cuts = [float(n) for n in re.findall(r"pts_time:([0-9.]+)", result.stderr)]
    return next((n for n in cuts if 0.2 < n < duration), None)


def download_reference(url, job, cookies_from_browser=None):
    """Try the current project-local extractor, then Instagram's post extractor."""
    env = os.environ.copy()
    env["PYTHONPATH"] = str(DOWNLOADER) + os.pathsep + env.get("PYTHONPATH", "")
    executable = [sys.executable, "-m", "yt_dlp"] if (DOWNLOADER / "yt_dlp").is_dir() else ["yt-dlp"]
    cmd = executable + ["--ignore-config", "--no-playlist", "--no-warnings", "--socket-timeout", "20",
                        "--retries", "1", "-f", "best[ext=mp4]/best", "-o",
                        str(job / "source.%(ext)s"), "--print", "after_move:filepath"]
    if cookies_from_browser:
        cmd += ["--cookies-from-browser", cookies_from_browser]
    try:
        result = subprocess.run(cmd + ["--", url], check=True, capture_output=True, text=True, env=env, timeout=120)
        source = Path(result.stdout.strip().splitlines()[-1]).resolve()
        if not valid_video(source):
            raise ValueError("The downloaded file is not a valid video.")
        return source
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, ValueError, IndexError) as exc:
        detail = (getattr(exc, "stderr", None) or str(exc)).strip()

    parsed = urllib.parse.urlparse(url)
    match = re.search(r"/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)", parsed.path)
    host = (parsed.hostname or "").lower()
    if not cookies_from_browser and (host == "instagram.com" or host.endswith(".instagram.com")) and match and (DOWNLOADER / "instaloader").is_dir():
        try:
            result = subprocess.run([sys.executable, str(ROOT / "scripts" / "instagram_download.py"),
                                     match.group(1), str(job / "source-instagram.mp4")],
                                    check=True, capture_output=True, text=True, env=env, timeout=120)
            source = Path(result.stdout.strip()).resolve()
            if valid_video(source):
                return source
            detail = "The Instagram fallback returned an invalid video."
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
            detail = (getattr(exc, "stderr", None) or str(exc)).strip()
    raise ValueError("Could not download this Instagram video. It may be unavailable, rate-limited, or require a login. "
                     "Upload the video as an MP4, or try again later. " + "Details: " + detail[-500:])


def prepare(args):
    if not math.isfinite(args.start) or args.start < 0:
        raise ValueError("Start must be a finite, nonnegative number.")
    if args.duration is not None and (not math.isfinite(args.duration) or not 0.2 <= args.duration <= 3):
        raise ValueError("Reaction duration must be between 0.2 and 3 seconds.")
    identity = read(profile_path(args.profile) / "profile.json") if args.profile else None
    job = ROOT / "runs" / (time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6])
    job.mkdir(parents=True)
    if urllib.parse.urlparse(args.source).scheme in ("http", "https"):
        source = download_reference(args.source, job, args.cookies_from_browser)
    else:
        original = Path(args.source).expanduser().resolve(strict=True)
        source = job / ("source" + original.suffix)
        shutil.copy2(original, source)
    available = seconds(source) - args.start
    duration = min(args.duration or 3.0, available)
    if duration < 0.2:
        raise ValueError("There is less than 0.2 seconds of video after the selected start.")
    warnings = []
    cut = detect_cut(source, args.start, duration)
    if cut:
        warnings.append(f"Possible shot change at {args.start + cut:.3f}s in the source. Choose a continuous section before approving; cut detection is a heuristic. The selected length was not changed.")
    dims = video_size(source)
    if abs(dims["width"] / dims["height"] - 9 / 16) > 0.025:
        warnings.append("Source is not 9:16. It will be fitted inside a portrait canvas without cutting off the subject.")
    if duration < 2.95:
        warnings.append("The selected motion is shorter than three seconds. Choose a longer continuous section, or explicitly select slow motion before generation.")
    if args.short_mode == "slow":
        warnings.append(f"Explicit slow motion: {duration:.3f}s is retimed to 3s. Inspect for choppy movement before approving.")
    elif args.short_mode == "hold":
        warnings.append("Legacy hold mode repeats the last frame. Revise this reference to use continuous motion.")
    temporal = f"setpts={3.0 / duration:.12f}*(PTS-STARTPTS)" if args.short_mode == "slow" else "setpts=PTS-STARTPTS"
    filters = temporal + ",fps=30"
    if args.short_mode == "hold":
        filters += ",tpad=stop_mode=clone:stop_duration=3"
    filters += ",trim=duration=3"
    filters += ",scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1"
    run(["ffmpeg", "-v", "error", "-y", "-ss", args.start, "-t", duration, "-i", source,
         "-an", "-vf", filters, "-frames:v", "90", "-c:v", "libx264",
         "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", job / "reference.mp4"])
    run(["ffmpeg", "-v", "error", "-y", "-i", job / "reference.mp4", "-frames:v", "1", job / "first-frame.png"])
    audio_present = any(s["codec_type"] == "audio" for s in probe(source)["streams"])
    if audio_present:
        audio_duration = extract_full_audio(source, job / "reel-audio-full.m4a")
    else:
        warnings.append("This source has no audio track. The hook will be silent; upload the reel with its original audio to include it.")
    identity_text = "\n".join(f"Identity reference {i}: {p}" for i, p in enumerate(identity["images"], 1)) if identity else "No identity profile yet. Add the influencer reference images."
    prompt = (
        "Create one photorealistic 9:16 starting image for motion transfer.\n"
        + identity_text + "\nPose and environment reference: " + str(job / "first-frame.png") + "\n\n"
        "Use the identity images for the influencer's recognizable face, hair, skin tone, and body identity. "
        "Use the video frame for the exact starting pose, head angle, expression, gaze, hand positions, "
        "subject scale, camera angle, lighting, and environment. Match visible clothing from the frame unless "
        "the profile notes specify otherwise. Replace the reference performer with the influencer; do not blend "
        "their faces. Preserve the scene composition. Remove social captions and emoji overlays from the "
        "reference frame, reconstructing the underlying scene naturally; captions are a separate finishing layer. "
        "Output one image with a 9:16 canvas and no text.\n"
        + ("Profile notes: " + identity["notes"] + "\n" if identity and identity["notes"] else "")
    )
    (job / "image-prompt.txt").write_text(prompt)
    state = {"stage": "awaiting_image", "source": args.source, "source_start": args.start,
             "reaction_duration": duration, "detected_cut": cut, "short_mode": args.short_mode,
             "profile": identity, "model": MODEL, "warnings": warnings,
             "reference_duration": seconds(job / "reference.mp4"), "source_file": str(source),
             "source_total_duration": seconds(source), "source_has_audio": audio_present,
             "audio_duration": audio_duration if audio_present else None, "image": None}
    save(job / "job.json", state)
    print(json.dumps({"job": str(job), "stage": state["stage"], "warnings": warnings}, indent=2))


def load_job(path):
    job = Path(path).expanduser().resolve(strict=True)
    return job, read(job / "job.json")


def attach(args):
    job, state = load_job(args.job)
    if state.get("submission_attempted"):
        raise ValueError("This job has a submission recorded. Prepare a new job to change its image.")
    source = Path(args.image).expanduser().resolve(strict=True)
    dims = video_size(source)
    if abs(dims["width"] / dims["height"] - 9 / 16) > 0.025:
        raise ValueError("Starting image must be 9:16. Regenerate or reframe it before attaching.")
    target = job / "starting-image.png"
    partial = job / "starting-image.partial.png"
    run(["ffmpeg", "-v", "error", "-y", "-i", source, "-vf",
         "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1",
         "-frames:v", "1", partial])
    if target.exists():
        target.replace(job / ("starting-image.previous-" + uuid.uuid4().hex[:6] + ".png"))
    partial.replace(target)
    state.update(image=str(target), stage="ready_to_generate")
    save(job / "job.json", state)
    print(f"Starting image attached: {target}")


def request(url, method="GET", payload=None):
    key = os.environ.get("FAL_KEY")
    if not key:
        raise ValueError("Set FAL_KEY locally. Never paste the key into chat.")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "queue.fal.run":
        raise ValueError("Unexpected fal queue URL. Refusing to send credentials.")
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Authorization": "Key " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raw = exc.read(65536).decode("utf-8", errors="replace")
        try:
            parsed_error = json.loads(raw)
            details = parsed_error.get("detail", [])
            detail = "; ".join(str(item.get("msg", "Request rejected")) for item in details if isinstance(item, dict)) if isinstance(details, list) else str(details)
        except (ValueError, AttributeError):
            detail = "Request failed; see fal request history for details."
        raise RemoteAPIError(exc.code, detail.replace(key, "[redacted]")[:1500]) from None


def aiml_request(url, method="GET", payload=None):
    key = os.environ.get("AIMLAPI_KEY")
    if not key:
        raise ValueError("Set AIMLAPI_KEY locally. Never paste the key into chat.")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "api.aimlapi.com":
        raise ValueError("Unexpected AIMLAPI URL. Refusing to send credentials.")
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json",
                                          "User-Agent": "reaction-studio/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raw = exc.read(65536).decode("utf-8", errors="replace")
        try:
            data = json.loads(raw)
            detail = str(data.get("message") or data.get("error") or data.get("detail") or "Request rejected")
        except (ValueError, AttributeError):
            detail = raw.strip()[:300] or "Request failed; check your AIMLAPI dashboard for details."
        raise RemoteAPIError(exc.code, detail.replace(key, "[redacted]")[:1500], "AIMLAPI") from None


def data_uri(path):
    import base64
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return f"data:{mime};base64," + base64.b64encode(Path(path).read_bytes()).decode()


AIML_STATUS = {"queued": "IN_QUEUE", "generating": "IN_PROGRESS", "completed": "COMPLETED", "error": "FAILED"}


def submit(args):
    job, state = load_job(args.job)
    provider = getattr(args, "provider", None) or "fal"
    if provider not in PROVIDERS:
        raise ValueError("Unknown video provider.")
    if not state.get("image"):
        raise ValueError("Attach the recreated starting image first.")
    if abs(seconds(job / "reference.mp4") - 3) > 0.02:
        raise ValueError("Motion reference must contain three seconds before submission. Review and revise the trim or explicitly choose slow motion.")
    dims = video_size(state["image"])
    if (dims["width"], dims["height"]) != (720, 1280):
        raise ValueError("Attach a normalized 720x1280 starting image before submission.")
    payload = {"character_orientation": args.orientation, "keep_original_sound": False,
               "prompt": state.get("motion_prompt") or DEFAULT_MOTION_PROMPT}
    if args.dry_run:
        summary = dict(payload)
        for key, path in (("image_url", Path(state["image"])), ("video_url", job / "reference.mp4")):
            summary[key] = {"upload": "fal storage" if provider == "fal" else "inline base64", "content_type": mimetypes.guess_type(path)[0], "bytes": path.stat().st_size}
        if provider == "aimlapi":
            summary.update(model=AIML_MODEL, endpoint=AIML_BASE, provider=provider)
        else:
            summary.update(model=state["model"], endpoint="https://queue.fal.run/" + state["model"], provider=provider)
        summary.update(network_called=False, paid_generation_submitted=False)
        save(job / "request-check.json", summary)
        print(json.dumps(summary, indent=2))
        return
    if state.get("submission_attempted"):
        raise ValueError("Submission already attempted. Recover/check the existing request instead of risking duplicate billing.")
    if provider == "aimlapi":
        return submit_aiml(job, state, payload)
    if not os.environ.get("FAL_KEY"):
        raise ValueError("Set FAL_KEY locally. Never paste the key into chat.")
    # An exclusive on-disk claim also prevents two concurrent processes from submitting.
    with (job / "submission.lock").open("x") as claim:
        claim.write("Do not remove without checking the fal request history.\n")
    try:
        sys.path.insert(0, str(ROOT / ".local" / "fal"))
        import fal_client
        client = fal_client.SyncClient(key=os.environ["FAL_KEY"])
        payload["image_url"] = client.upload_file(str(state["image"]))
        payload["video_url"] = client.upload_file(str(job / "reference.mp4"))
    except Exception as exc:
        (job / "submission.lock").unlink(missing_ok=True)
        state.update(stage="ready_to_generate", submission_attempted=False)
        save(job / "job.json", state)
        raise ValueError("Could not upload the reference files to fal storage. Check your connection and fal key, then retry. "
                         "No video generation request was submitted.") from exc
    state.update(stage="submitting", submission_attempted=True, orientation=args.orientation,
                 submitted_prompt=payload["prompt"])
    save(job / "job.json", state)
    try:
        response = request("https://queue.fal.run/" + state["model"], "POST", payload)
    except RemoteAPIError as exc:
        if 400 <= exc.code < 500 and exc.code != 408:
            state.update(stage="submission_rejected", submission_attempted=False, last_error=str(exc))
            (job / "submission.lock").unlink(missing_ok=True)
        else:
            state["stage"] = "submission_unknown"
        save(job / "job.json", state)
        raise
    except Exception:
        state["stage"] = "submission_unknown"
        save(job / "job.json", state)
        raise
    if not response.get("request_id") or not response.get("status_url") or not response.get("response_url"):
        state.update(stage="submission_unknown", queue=response)
        save(job / "job.json", state)
        raise ValueError("fal returned an incomplete submission response. Check request history before retrying.")
    state.update(stage="queued", queue=response)
    save(job / "job.json", state)
    print(json.dumps({"stage": state["stage"], "request_id": response["request_id"]}, indent=2))


def submit_aiml(job, state, payload):
    if not os.environ.get("AIMLAPI_KEY"):
        raise ValueError("Set AIMLAPI_KEY locally. Never paste the key into chat.")
    with (job / "submission.lock").open("x") as claim:
        claim.write("Do not remove without checking the AIMLAPI dashboard.\n")
    body = {"model": AIML_MODEL, "image_url": data_uri(state["image"]), "video_url": data_uri(job / "reference.mp4"),
            "prompt": payload["prompt"], "character_orientation": payload["character_orientation"],
            "keep_audio": False, "mode": "std"}
    state.update(stage="submitting", submission_attempted=True, provider="aimlapi",
                 orientation=payload["character_orientation"], submitted_prompt=payload["prompt"])
    save(job / "job.json", state)
    try:
        response = aiml_request(AIML_BASE, "POST", body)
    except RemoteAPIError as exc:
        if 400 <= exc.code < 500 and exc.code != 408:
            state.update(stage="submission_rejected", submission_attempted=False, last_error=str(exc))
            (job / "submission.lock").unlink(missing_ok=True)
        else:
            state["stage"] = "submission_unknown"
        save(job / "job.json", state)
        raise
    except Exception:
        state["stage"] = "submission_unknown"
        save(job / "job.json", state)
        raise
    gen_id = response.get("id") or response.get("generation_id")
    if not gen_id:
        state.update(stage="submission_unknown", queue=response)
        save(job / "job.json", state)
        raise ValueError("AIMLAPI returned an incomplete submission response. Check your dashboard before retrying.")
    queue = {"request_id": gen_id, "provider": "aimlapi"}
    state.update(stage="queued", queue=queue)
    save(job / "job.json", state)
    print(json.dumps({"stage": state["stage"], "request_id": gen_id}, indent=2))


def status(args):
    job, state = load_job(args.job)
    if not state.get("queue"):
        print(json.dumps(state, indent=2))
        return
    queue = state["queue"]
    if state.get("provider") == "aimlapi":
        return status_aiml(job, state, queue, args)
    response = request(queue["status_url"])
    state["last_status"] = response
    state["stage"] = response.get("status", "unknown").lower()
    save(job / "job.json", state)
    print(json.dumps(response, indent=2))
    if args.download and response.get("status") == "COMPLETED":
        result = request(queue["response_url"])
        save(job / "result.json", result)
        url = result.get("video", {}).get("url")
        parsed = urllib.parse.urlparse(url or "")
        if parsed.scheme != "https" or not (parsed.hostname or "").endswith(".fal.media"):
            raise ValueError("No expected fal.media video URL in result. Inspect result.json.")
        target = job / "generated.mp4"
        if not valid_video(target):
            partial = job / "generated.partial.mp4"
            with urllib.request.urlopen(url, timeout=60) as src, partial.open("wb") as dest:
                shutil.copyfileobj(src, dest)
            if not valid_video(partial):
                raise ValueError("The downloaded result is unreadable. Resume to download the same request again.")
            partial.replace(target)
        duration = seconds(target)
        state.update(stage="generated_review", generated_duration=duration)
        save(job / "job.json", state)
        print(f"Saved {duration:.3f}s generated motion for review. No freeze or automatic retiming applied.")


def status_aiml(job, state, queue, args):
    raw = aiml_request(AIML_BASE + "?" + urllib.parse.urlencode({"generation_id": queue["request_id"]}))
    mapped = AIML_STATUS.get(str(raw.get("status", "")).lower(), "IN_QUEUE")
    response = {"status": mapped}
    if raw.get("error"):
        err = raw["error"]
        response["error"] = (err.get("message") or err.get("name") or "Generation failed") if isinstance(err, dict) else str(err)
        response["status"] = "FAILED"
    state["last_status"] = response
    state["stage"] = response["status"].lower()
    save(job / "job.json", state)
    print(json.dumps(response, indent=2))
    if args.download and mapped == "COMPLETED":
        save(job / "result.json", raw)
        url = (raw.get("video") or {}).get("url")
        if urllib.parse.urlparse(url or "").scheme != "https":
            raise ValueError("No https video URL in result. Inspect result.json.")
        target = job / "generated.mp4"
        if not valid_video(target):
            partial = job / "generated.partial.mp4"
            with urllib.request.urlopen(url, timeout=60) as src, partial.open("wb") as dest:
                shutil.copyfileobj(src, dest)
            if not valid_video(partial):
                raise ValueError("The downloaded result is unreadable. Resume to download the same request again.")
            partial.replace(target)
        duration = seconds(target)
        state.update(stage="generated_review", generated_duration=duration)
        save(job / "job.json", state)
        print(f"Saved {duration:.3f}s generated motion for review. No freeze or automatic retiming applied.")


def finish(args):
    report = export_project(args.job, retime=args.retime, gain=args.audio_gain,
                            include_hook_audio=args.include_hook_audio)
    print(json.dumps(report, indent=2))


def stitch(args):
    hook = Path(args.hook).expanduser().resolve(strict=True)
    demo = Path(args.demo).expanduser().resolve(strict=True)
    output = Path(args.output).expanduser().resolve()
    partial = output.with_name(output.stem + ".partial.mp4")
    if output.exists():
        raise ValueError("Output already exists. Choose another filename to preserve previous exports.")
    if partial.exists():
        partial.replace(partial.with_name(partial.stem + ".interrupted-" + uuid.uuid4().hex[:6] + ".mp4"))
    hook_info, demo_info = probe(hook), probe(demo)
    hook_duration, demo_duration = seconds(hook), seconds(demo)
    if abs(hook_duration - 3) > 0.04:
        raise ValueError("Stitch expects a finished three-second hook. Prepare or finish the hook first.")
    # A small tail hold aligns the complete demo to the export frame grid.
    demo_target = math.ceil(demo_duration * 30 - 0.00001) / 30
    filters = []
    for index, info, duration in [(0, hook_info, 3.0), (1, demo_info, demo_target)]:
        filters.append(
            f"[{index}:v:0]setpts=PTS-STARTPTS,"
            "scale=1080:1920:force_original_aspect_ratio=decrease,"
            "pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,"
            f"tpad=stop_mode=clone:stop_duration=0.04,trim=duration={duration:.9f},settb=AVTB[v{index}]"
        )
        if any(s["codec_type"] == "audio" for s in info["streams"]):
            audio = f"[{index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad"
        else:
            audio = "anullsrc=r=48000:cl=stereo"
        filters.append(f"{audio},atrim=duration={duration:.9f},asetpts=PTS-STARTPTS[a{index}]")
    filters.append("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]")
    output.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-v", "error", "-i", hook, "-i", demo,
         "-filter_complex", ";".join(filters), "-map", "[v]", "-map", "[a]",
         "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", partial])
    actual = seconds(partial)
    if abs(actual - 3 - demo_target) > 0.04:
        raise ValueError(f"Unexpected assembly duration: {actual:.3f}s. Inspect {partial}.")
    if not valid_video(partial, 3 + demo_target):
        raise ValueError(f"Assembly did not pass export verification. Inspect {partial}.")
    partial.replace(output)
    report = {"hook": str(hook), "demo": str(demo), "output": str(output),
              "hook_seconds": 3.0, "demo_source_seconds": demo_duration,
              "demo_export_seconds": demo_target, "output_seconds": actual,
              "width": 1080, "height": 1920, "demo_starts_at_seconds": 3.0,
              "audio": "Existing audio is retained; missing tracks receive silence. No gain changes.",
              "ai_generation": False}
    save(output.with_suffix(".json"), report)
    print(json.dumps(report, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("profile", help="Save influencer images once")
    p.add_argument("name")
    p.add_argument("images", nargs="+")
    p.add_argument("--notes", default="")
    p.set_defaults(func=profile)
    p = commands.add_parser("prepare", help="Download/import, detect an early cut, and prepare 3s reference + first frame")
    p.add_argument("source")
    p.add_argument("--profile")
    p.add_argument("--start", type=float, default=0)
    p.add_argument("--duration", type=float, help="Override automatic first-cut detection, from 0.2 to 3 seconds")
    p.add_argument("--short-mode", choices=["original", "slow", "hold"], default="original")
    p.add_argument("--cookies-from-browser", help="Explicit opt-in to yt-dlp browser cookies, e.g. chrome")
    p.set_defaults(func=prepare)
    p = commands.add_parser("attach", help="Attach an image made by either Codex or manual ChatGPT")
    p.add_argument("job")
    p.add_argument("image")
    p.set_defaults(func=attach)
    p = commands.add_parser("submit", help="Submit ONE paid fal video generation")
    p.add_argument("job")
    p.add_argument("--orientation", choices=["video", "image"], default="video")
    p.add_argument("--provider", choices=list(PROVIDERS), default="fal", help="Video backend: fal or aimlapi")
    p.add_argument("--dry-run", action="store_true", help="Validate the actual request locally; no network or generation")
    p.set_defaults(func=submit)
    p = commands.add_parser("status", help="Check the existing fal request, optionally download a finished result")
    p.add_argument("job")
    p.add_argument("--download", action="store_true")
    p.set_defaults(func=status)
    p = commands.add_parser("finish", help="Export reviewed hook and complete reel soundtrack, without a video freeze")
    p.add_argument("job")
    p.add_argument("--retime", action="store_true", help="Explicitly retime a short result to three seconds")
    p.add_argument("--audio-gain", type=float, default=1, help="Full soundtrack volume from 0 to 2; default 1")
    p.add_argument("--include-hook-audio", action="store_true", help="Also put an audio excerpt in the hook MP4; full soundtrack is always separate")
    p.set_defaults(func=finish)
    p = commands.add_parser("stitch", help="Append the finished demo after an existing three-second hook, locally")
    p.add_argument("hook")
    p.add_argument("demo")
    p.add_argument("--output", required=True)
    p.set_defaults(func=stitch)
    args = parser.parse_args()
    try:
        args.func(args)
    except subprocess.CalledProcessError as exc:
        print((exc.stderr or str(exc)).strip(), file=sys.stderr)
        return 1
    except (ValueError, OSError, KeyError, urllib.error.URLError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
