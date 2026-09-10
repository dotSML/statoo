# Statoo

A self-hosted status page for monitoring multiple services, publishing incidents,
tracking uptime, and sending web push outage alerts.

## Quick Start

1. Copy `.env.example` to `.env.local` and configure PostgreSQL and the admin
   password.
2. Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open `/admin` to add services and incidents. The public status page is available
at `/`.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DATABASE_SSL` | No | Set to `false` for a local database; cloud databases use SSL by default |
| `ADMIN_PASSWORD` | Yes | Password for the admin dashboard |
| `PAGE_TITLE` | No | Public status page title |
| `PAGE_DESCRIPTION` | No | Public status page description |
| `HEALTH_CHECK_BUFFER_LIMIT` | No | Max health-check results to keep in memory while PostgreSQL is unavailable; defaults to `5000` |
| `SERVICE_UPDATE_BUFFER_LIMIT` | No | Max service status updates to keep in memory while PostgreSQL is unavailable; defaults to `1000` |
| `VAPID_PUBLIC_KEY` | For push | Server-side VAPID public key |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | For push | Browser-visible copy of the same public key |
| `VAPID_PRIVATE_KEY` | For push | VAPID private key |
| `VAPID_SUBJECT` | For push | `mailto:` or `https://` contact URI |

Generate VAPID keys with:

```bash
node -e "const webpush=require('web-push'); console.log(webpush.generateVAPIDKeys())"
```

### Jellyfin playback probing

When adding a service in the admin dashboard, choose `Jellyfin Playback` as the
check type. Provide the Jellyfin base URL, monitor username, monitor password,
and a known-good media URL or item id. Statoo authenticates with Jellyfin, checks
playback info, and reads a small byte range from the media endpoint so the check
proves that files can actually be opened and streamed.

Jellyfin passwords are stored server-side and are never returned by the public
status APIs.

### Slow responses and outage alerts

“Slow Responses” means a health check succeeded but took longer than the warning
limit. It does not mean the service is down. HTTP checks warn above **5 seconds**
and time out after **10 seconds**. Jellyfin playback checks warn above **10 seconds**
and time out after **20 seconds**, allowing time for authentication and media reads.

Automatic slow-response warnings are recorded in status and uptime history but do
not send push notifications. Automatic push alerts require **three consecutive
failed checks**, spaced at least **60 seconds** apart. A single timeout or brief
network glitch is still visible in the raw status/history but does not page you.
An outage alerts once, and only **two consecutive successful checks** (including
slow but successful responses) rearm notifications. Unknown results do not count
as recovery. Gaps longer than five minutes reset pending confirmation counts.

PostgreSQL coordinates checks and stores confirmation state across concurrent
page loads, server instances, and restarts. If PostgreSQL is unavailable, new
checks pause and no uncoordinated alerts are sent; the page can show cached data.
An abandoned check lease expires after 90 seconds. Checks remain request-driven:
three failed checks normally need at least two minutes, and take longer without
regular status-page requests. Push claims are persisted before delivery to avoid
duplicates; a process failure during delivery can lose that notification.

Jellyfin retries authentication once when a playback request rejects its cached
token, within the existing 20-second probe timeout.
Manually published incidents can still send slow-response alerts, with wording
that describes slowness instead of saying the service is down.

## Commands

```bash
npm run dev
npm test
npm run lint
npm run build
npm start
```

## API

Public endpoints:

- `GET /api/status`
- `GET /api/services`
- `GET /api/incidents`
- `POST /api/push/subscribe`
- `POST /api/push/unsubscribe`

Admin mutations require an authenticated admin session:

- `POST /api/services`
- `PATCH|DELETE /api/services/:id`
- `POST /api/services/check`
- `POST /api/incidents`
- `PATCH|DELETE /api/incidents/:id`
- `POST /api/push/test`
- `POST /api/push/clear`
