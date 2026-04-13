# Cloud Run Deployment Guide

Deploy the MCP server to Google Cloud Run for team access using Streamable HTTP transport.

## Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk) installed
- A GCP project with billing enabled
- Docker installed (or use Cloud Build)
- OAuth credentials and tokens already generated locally

## 1. Store credentials in Secret Manager

First, authenticate locally and generate tokens:
```bash
npx @ibarcarty/mcp-server-google-drive auth
```

Then store both files as secrets:

```bash
# Store OAuth client credentials
gcloud secrets create gdrive-mcp-oauth \
  --data-file=$HOME/.config/mcp-server-google-drive/oauth-credentials.json \
  --replication-policy=user-managed \
  --locations=europe-west1

# Store tokens
gcloud secrets create gdrive-mcp-tokens \
  --data-file=$HOME/.config/mcp-server-google-drive/tokens.json \
  --replication-policy=user-managed \
  --locations=europe-west1
```

## 2. Create Artifact Registry repository

```bash
gcloud artifacts repositories create mcp-servers \
  --repository-format=docker \
  --location=europe-west1 \
  --description="MCP server images"
```

## 3. Build and push the image

```bash
# From the project root
gcloud builds submit \
  --tag europe-west1-docker.pkg.dev/YOUR_PROJECT_ID/mcp-servers/mcp-server-google-drive:latest \
  --region=europe-west1
```

## 4. Deploy to Cloud Run

```bash
gcloud run deploy mcp-server-google-drive \
  --image europe-west1-docker.pkg.dev/YOUR_PROJECT_ID/mcp-servers/mcp-server-google-drive:latest \
  --region europe-west1 \
  --platform managed \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --no-allow-unauthenticated \
  --set-env-vars "GDRIVE_MCP_TRANSPORT=http" \
  --set-secrets "GDRIVE_MCP_OAUTH_CREDENTIALS_JSON=gdrive-mcp-oauth:latest,GDRIVE_MCP_TOKENS_JSON=gdrive-mcp-tokens:latest"
```

## 5. Configure Claude Code to use the remote server

Get the service URL:
```bash
gcloud run services describe mcp-server-google-drive \
  --region europe-west1 \
  --format 'value(status.url)'
```

Add to your MCP configuration:
```json
{
  "mcpServers": {
    "google-drive-remote": {
      "url": "https://mcp-server-google-drive-XXXX-ew.a.run.app/mcp"
    }
  }
}
```

## Authentication for Cloud Run

The deployment above uses `--no-allow-unauthenticated`. To access it, you need to:

1. Grant your user the `roles/run.invoker` role
2. Use `gcloud auth print-identity-token` to get a bearer token
3. Or set up IAM-based authentication in your client

For simpler setups (internal team only), you can use `--allow-unauthenticated` but this is not recommended for production.

## Updating

To deploy a new version:

```bash
gcloud builds submit \
  --tag europe-west1-docker.pkg.dev/YOUR_PROJECT_ID/mcp-servers/mcp-server-google-drive:latest \
  --region=europe-west1

gcloud run services update mcp-server-google-drive \
  --region europe-west1 \
  --image europe-west1-docker.pkg.dev/YOUR_PROJECT_ID/mcp-servers/mcp-server-google-drive:latest
```

## Cost Estimate

Cloud Run bills per request and compute time:
- With `min-instances=0`, you pay nothing when idle
- Typical cost for light usage: < 5 EUR/month
- Free tier: 2 million requests/month, 360,000 vCPU-seconds
