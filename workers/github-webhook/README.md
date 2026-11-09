# Ask.Me GitHub webhook receiver

This is an isolated Cloudflare Worker for the Ask.Me GitHub App. It does not
reuse FreeApp-AI's Worker or credentials.

## Required GitHub Actions repository secrets

Add these under Ask.Me → Settings → Secrets and variables → Actions:

- CLOUDFLARE_API_TOKEN: Cloudflare API token permitted to deploy Workers.
- CLOUDFLARE_ACCOUNT_ID: Cloudflare account ID.
- ASKME_GITHUB_WEBHOOK_SECRET: the generated high-entropy secret supplied to the repository owner.

The deployment workflow uploads the webhook secret to Cloudflare as an encrypted
Worker secret, then deploys the Worker. Never commit the secret to Git.

## Endpoints

- Health check: /health
- GitHub App webhook: /webhook

The Worker verifies GitHub's X-Hub-Signature-256 HMAC-SHA256 signature before
acknowledging a delivery. It currently validates and acknowledges events; it
does not yet forward event payloads into Ask.Me's application backend or trigger
repository actions.

After deployment, use the exact hostname shown by Cloudflare. Expected URL form:

https://askme-github-webhook.<your-cloudflare-workers-subdomain>.workers.dev/webhook

Do not guess the account subdomain.
