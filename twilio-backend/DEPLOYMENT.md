# Deployment Guide

This project is prepared for containerized deployment to Google Cloud Run.

## Prerequisites

- Google Cloud SDK (`gcloud`) installed and authenticated
- Docker installed locally
- A Google Cloud project with billing enabled
- Artifact Registry or Container Registry access

## Local Docker Test

Build the image:

```bash
docker build -t twilio-backend:local .
```

Run the container on port `8080`:

```bash
docker run --rm -p 8080:8080 \
  -e SUPABASE_URL="your_supabase_url" \
  -e SUPABASE_SERVICE_ROLE_KEY="your_service_role_key" \
  -e GEMINI_API_KEY="your_gemini_api_key" \
  twilio-backend:local
```

Then verify:

```bash
curl http://localhost:8080/
```

## Cloud Run Deployment

Set your project and build/push the container image:

```bash
gcloud config set project PROJECT_ID
gcloud builds submit --tag gcr.io/PROJECT_ID/twilio-backend
```

### Option A: Use Cloud Run environment variables (`--set-env-vars`)

```bash
gcloud run deploy twilio-backend \
  --image gcr.io/PROJECT_ID/twilio-backend \
  --platform managed \
  --region REGION \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars "SUPABASE_URL=...,SUPABASE_SERVICE_ROLE_KEY=...,GEMINI_API_KEY=..."
```

### Option B: Use Secret Manager (`--add-secrets`) for sensitive values

This mode keeps secrets out of deployment command history and plain text environment configs.

```bash
gcloud run deploy twilio-backend \
  --image gcr.io/PROJECT_ID/twilio-backend \
  --platform managed \
  --region REGION \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars "SUPABASE_URL=..." \
  --add-secrets "SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest"
```

## Environment Variables and Secrets

| Name | Service | Required | Suggested Cloud Run configuration |
| --- | --- | --- | --- |
| `SUPABASE_URL` | Supabase | Yes | `--set-env-vars` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Yes | `--add-secrets` (recommended) |
| `GEMINI_API_KEY` | Gemini API | Yes | `--add-secrets` (recommended) |

## Important Notes

- `.env` is excluded from container builds via `.dockerignore`.
- Do not copy local `.env` into the image.
- In production, prefer Secret Manager for API keys and service role credentials.
