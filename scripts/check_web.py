#!/usr/bin/env python3
"""One local HTTP smoke check; never submits paid generation."""
import argparse
import json
from pathlib import Path
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    base = f"http://127.0.0.1:{args.port}"

    def call(path, data=None, token=None, headers=None):
        headers = dict(headers or {})
        if data is not None:
            data = json.dumps(data).encode()
            headers["Content-Type"] = "application/json"
        if token:
            headers["X-Workbench-Token"] = token
        with urllib.request.urlopen(urllib.request.Request(base + path, data=data, headers=headers), timeout=30) as response:
            return response.status, response.read(), dict(response.headers)

    _, raw, _ = call("/api/state")
    state = json.loads(raw)
    token = state["token"]
    assert "fal_key" not in state["settings"]
    for path in ("/", "/assets/app.js", "/assets/app.css"):
        code, body, _ = call(path)
        assert code == 200 and body
    job = next(j for j in state["jobs"] if j["media"].get("image") and not j["busy"])
    code, _, _ = call("/api/jobs/" + job["id"] + "/dry-run", {}, token)
    assert code == 200
    code, body, _ = call(job["media"]["image"], headers={"Range": "bytes=0-127"})
    assert code == 206 and len(body) == 128
    try:
        call("/api/settings", {})
    except urllib.error.HTTPError as error:
        assert error.code == 403
    else:
        raise AssertionError("Missing local request token was accepted")
    for path in ("/.env", "/media/.local/settings.json"):
        try:
            call(path)
        except urllib.error.HTTPError as error:
            assert error.code == 404
        else:
            raise AssertionError("Private path was served")
    _, reference, _ = call(job["media"]["reference"])
    request = urllib.request.Request(base + "/api/upload?name=reference-upload-check.mp4", data=reference,
        headers={"Content-Type": "application/octet-stream", "X-Workbench-Token": token})
    with urllib.request.urlopen(request, timeout=30) as response:
        uploaded = json.load(response)
        assert uploaded["kind"] == "video" and uploaded["width"] == 720
    report = {"static_routes": "passed", "saved_profiles": [p["name"] for p in state["profiles"]],
        "native_codex_image_worker": state["settings"]["codex"], "video_upload": "passed",
        "media_range_requests": "passed", "local_request_validation": "passed", "private_files_not_served": "passed",
        "fal_dry_run": "passed", "fal_key_configured": state["settings"]["fal_configured"], "browser_preview_run": False}
    (Path(__file__).resolve().parents[1] / ".local/web-validation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
