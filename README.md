# B&B Hotels Availability Scraper

This service runs the browser-based availability checks for the dashboard.
The dashboard stays lightweight and manual; this service opens real browser
pages with Playwright, applies the hotel/date/source parameters, and returns
only the three required statuses: `available`, `unavailable`, `not checked`.

## Endpoints

- `GET /health` returns service health.
- `POST /check` launches one manual verification run.

Request body:

```json
{
  "hotelIds": ["bb-paris-porte-des-lilas"],
  "dateOffsets": ["D", "D+1", "D+3", "D+30", "D+365"],
  "sources": ["hotelbb.com", "booking.com", "expedia"]
}
```

If `SCRAPER_SERVICE_TOKEN` is set, the dashboard must call the service with:

```text
Authorization: Bearer <token>
```

## Local Run

```bash
npm install
npm start
```

Then test:

```bash
curl -X POST http://localhost:8788/check \
  -H "content-type: application/json" \
  -d '{"hotelIds":["bb-paris-porte-des-lilas"],"dateOffsets":["D+3"],"sources":["booking.com"]}'
```

## Deployment

Use a host that supports long-running Node processes and bundled browsers:

- Render Web Service with Docker
- Railway with Docker
- Fly.io with Docker
- Google Cloud Run with Docker

For Render, this service includes a `render.yaml` blueprint. Create a new
Blueprint from the repository.

After deployment, configure these runtime variables on the dashboard:

- `SCRAPER_SERVICE_URL`: public HTTPS URL of this service
- `SCRAPER_SERVICE_TOKEN`: same token as the scraper service, optional but recommended
