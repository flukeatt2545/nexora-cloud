# NEXORA Audio VPS

Production: https://audio.nkn02.com

- VPS: 165.101.65.23
- Application: /opt/app/nexora/audio
- Compose project: nexora-audio
- Host proxy: /etc/caddy/sites/nexora-audio.caddy
- DNS: audio.nkn02.com A record to the VPS (DNS-only)
- API is private; web port 8092 is bound to loopback only.
- TLS certificates and HTTP redirects are managed automatically by host Caddy.

## Update

Upload only the audio project's source directories; do not include platform `.env`, binaries, node_modules or unrelated platform files. Keep production environment settings in `/opt/app/nexora/audio/.env`, based on `audio-production.env`.

The VPS uses `MEDIA_YTDLP_OFFLINE=1` and pre-downloaded Linux wheels in `backend/wheels/` because its connection to PyPI is slow. To refresh those packages, download compatible Python 3.13 musllinux wheels and upload them to that directory before rebuilding:

```sh
python -m pip download --dest .audio-build-wheels --only-binary=:all: --platform musllinux_1_2_x86_64 --python-version 313 --implementation cp --abi cp313 'yt-dlp[default]'
```

The wheels are ignored by Git. Normal local Docker builds default to online installation.

```sh
cd /opt/app/nexora/audio
docker compose -p nexora-audio -f docker-compose.media.yml up -d --build
docker compose -p nexora-audio -f docker-compose.media.yml ps
docker compose -p nexora-audio -f docker-compose.media.yml logs --tail=80
curl -fsS https://audio.nkn02.com/health
```

After replacing only `media-api`, reload the web container's Nginx so its upstream resolves the new API container address:

```sh
docker exec nexora-audio-media-web-1 nginx -s reload
```

The API image runs its Go tests before building. Run a real conversion/download check from the source checkout after deployment:

```sh
python deploy/audio-smoke.py
python deploy/audio-smoke.py --url 'https://youtu.be/skzzKFRn338' --original-tags
```

The second command covers a long Thai title. Output filenames are limited to 240 UTF-8 bytes before adding the extension, while the complete title remains in the audio tags. FFmpeg failures keep technical diagnostics in server logs, not public API errors.

The service restarts automatically. Jobs and temporary files live in a bounded 2 GiB tmpfs, expire two hours after completion and are lost if the API container restarts. One conversion worker is used in production. MP3, M4A and FLAC are supported, but actual audio quality depends on the source.

Nginx limits inspection requests to 12/minute per IP and job creation to 3/minute per IP, with small bursts. Request bodies are limited to 32 KiB; containers run unprivileged with dropped capabilities, read-only filesystems and resource limits.

## Proxy setup

`audio-install-proxy.py` preserves the existing host Caddyfile, installs the isolated site and creates a protected timestamped backup. Validate the host's custom Caddy binary before reloading. Restore that backup if validation fails. DNS management reads the existing platform credential only in memory; `audio-domain.py` refuses to replace a conflicting DNS record.

Only download media you have permission to use. YouTube may reject individual videos or requests from datacenter IPs; do not treat a successful health check as proof of conversion functionality.
