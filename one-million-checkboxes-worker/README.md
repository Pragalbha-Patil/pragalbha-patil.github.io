# One Million Checkboxes Worker Backend

Cloudflare Worker + Durable Object backend for realtime checkbox state.

## Endpoints

- `GET /api/health`
- `GET /api/checked`
- `POST /api/update` with `{ "id": number, "checked": boolean }`
- `POST /api/batch` with `{ "updates": [[id, checked], ...] }`
- `GET /api/events` (SSE realtime stream)

## Setup

1. Install dependencies:
   - `npm install`
2. Authenticate Cloudflare:
   - `npx wrangler login`
3. Run locally:
   - `npm run dev`
4. Deploy:
   - `npm run deploy`

After deploy, set `window.CHECKBOX_API_BASE` in `one-million-checkboxes/index.html` to your Worker URL.
