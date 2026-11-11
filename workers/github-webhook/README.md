# Ask.Me GitHub coding-agent API and webhook

This is an isolated Cloudflare Worker for Ask.Me. It does not reuse the
FreeApp-AI Worker, owner key, or credentials. It exposes authenticated GitHub
repository operations. It does not yet generate code with an LLM or run arbitrary
shell commands.

## Required encrypted Worker secrets

- GITHUB_WEBHOOK_SECRET: GitHub webhook signing secret.
- GITHUB_APP_ID: numeric GitHub App ID.
- GITHUB_APP_INSTALLATION_ID: installation ID for the Ask.Me GitHub App.
- GITHUB_APP_PRIVATE_KEY: full PEM private key for that GitHub App.
- ASKME_AGENT_API_KEY: long random key used by the Ask.Me app at runtime.
- ASKME_ALLOWED_ORIGIN: exact HTTPS origin of the deployed Ask.Me app.

## Optional Worker variable

- ALLOWED_REPOSITORIES: optional comma-separated repository allowlist. If
  omitted, only blvckson/Ask.Me is allowed.

The GitHub App needs Contents read/write and Pull requests read/write permissions,
plus Metadata read. Install it only on intended repositories. The Worker obtains
short-lived installation tokens; no long-lived GitHub token is placed in browser
source.

## Endpoints

- GET /health: public health check.
- POST /webhook: verifies X-Hub-Signature-256 and acknowledges a delivery.
- GET /api/github/repo?owner=blvckson&repo=Ask.Me: repository metadata.
- GET /api/github/file?owner=blvckson&repo=Ask.Me&path=README.md&ref=main:
  reads a file.
- POST /api/github/branch?owner=blvckson&repo=Ask.Me:
  JSON {"branch":"askme/task-name","base":"main"}.
- PUT /api/github/file?owner=blvckson&repo=Ask.Me:
  JSON {"path":"file.txt","branch":"askme/task-name","content":"...","message":"..."}.
- POST /api/github/pull-request?owner=blvckson&repo=Ask.Me:
  JSON {"head":"askme/task-name","base":"main","title":"...","body":"...","draft":true}.

All /api/github endpoints require Authorization: Bearer ASKME_AGENT_API_KEY.
Writes are restricted to askme/* branches; the default branch is not directly
writable. Requests are limited to 1 MB and the repository allowlist is enforced
server-side. The browser must request the key at runtime; do not hard-code it in
public assets.

## Deployment

The GitHub Actions workflow uploads configured secrets to this Worker and
deploys it. Configure Cloudflare account deployment secrets in the Ask.Me
repository before running the workflow. After deployment, use the exact hostname
shown in Cloudflare; do not guess the account subdomain.

## Current boundary

This provides secure repository operations for a coding agent to call. The
Ask.Me chat UI still needs model/tool orchestration to inspect a task, generate a
patch, run tests, repair failures, and request approval before PR creation.
No existing chat, research, OCR, narrator, or voice-cloning code is changed.
