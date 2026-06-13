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
| `VAPID_PUBLIC_KEY` | For push | Server-side VAPID public key |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | For push | Browser-visible copy of the same public key |
| `VAPID_PRIVATE_KEY` | For push | VAPID private key |
| `VAPID_SUBJECT` | For push | `mailto:` or `https://` contact URI |

Generate VAPID keys with:

```bash
node -e "const webpush=require('web-push'); console.log(webpush.generateVAPIDKeys())"
```

## Commands

```bash
npm run dev
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
