"""End-to-end deployment check without credentials or saved cookies."""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE = "https://audio.nkn02.com"
VIDEO = "https://www.youtube.com/watch?v=jNQXAC9IVRw"

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default=VIDEO)
parser.add_argument("--formats", nargs="+", choices=("mp3", "m4a", "flac"), default=("mp3", "m4a", "flac"))
parser.add_argument("--original-tags", action="store_true", help="Keep the source title and artist, including long Unicode titles")
options = parser.parse_args()
VIDEO = options.url

def request(path, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=65) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        message = error.read().decode(errors="replace")
        raise SystemExit(f"HTTP {error.code}: {message}") from None

assert request("/health")["status"] == "ok"
inspection = request("/api/media/inspect", {"url": VIDEO})
assert inspection["count"] == 1 and inspection["entries"][0]["title"]
print("Inspection: " + inspection["title"], flush=True)
for output_format in options.formats:
    quality = {"mp3": 320, "m4a": 256, "flac": 0}[output_format]
    payload = {"url": VIDEO, "format": output_format, "quality": quality}
    if not options.original_tags:
        payload.update(title="ทดสอบระบบ", artist="NEXORA", album="VPS")
    job = request("/api/jobs", payload)
    print(f"Job {output_format}: {job['id']}", flush=True)
    deadline = time.monotonic() + 600
    previous = None
    while time.monotonic() < deadline:
        job = request("/api/jobs/" + job["id"])
        state = (job["status"], job["stage"], int(job["progress"]))
        if state != previous:
            print(f"{output_format}: {state}", flush=True)
            previous = state
        if job["status"] == "failed":
            raise SystemExit(job.get("error", "Conversion failed"))
        if job["status"] == "completed":
            break
        time.sleep(2)
    else:
        raise SystemExit("Conversion timed out")
    assert len(job["filename"].encode("utf-8")) <= 255
    with urllib.request.urlopen(BASE + "/api/jobs/" + job["id"] + "/download", timeout=120) as response:
        data = response.read()
        assert len(data) > 10000
        assert "attachment" in response.headers.get("Content-Disposition", "")
        print(f"Download {output_format}: {len(data)} bytes, {response.status}, {response.headers.get('Content-Type')}", flush=True)
print("All production format checks passed", flush=True)
