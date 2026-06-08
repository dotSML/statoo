# Statoo

A minimal, beautiful status page for your services. Deploy one instance per service on Vercel.

```
Service A → deploy statoo → status-a.vercel.app
Service B → deploy statoo → status-b.vercel.app
```

## Quick Start

```bash
npm install
npm run dev
```

## Configuration

Set these environment variables (in Vercel dashboard or `.env.local`):

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `SERVICE_NAME` | No | Display name | `Bangkok API` |
| `SERVICE_DESCRIPTION` | No | Short description | `Translation service` |
| `SERVICE_URL` | No | Health check endpoint | `https://api.example.com/health` |

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USER/statoo)

1. Push this repo to GitHub
2. Import it in Vercel
3. Set environment variables
4. Deploy

Each deployment is fully independent — deploy multiple instances for multiple services.

## API

`GET /api/status` — returns current status as JSON:

```json
{
  "service": "Bangkok API",
  "description": "Translation service",
  "status": "operational",
  "responseTime": 142,
  "statusCode": 200,
  "checkedAt": "2025-01-01T00:00:00.000Z",
  "url": "https://api.example.com/health"
}
```

## Roadmap

- [ ] Incident management with PostgreSQL
- [ ] Admin panel
- [ ] Email/webhook notifications
- [ ] Multiple endpoint monitoring
