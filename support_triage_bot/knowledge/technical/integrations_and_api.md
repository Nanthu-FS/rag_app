# Integrations, API & Troubleshooting

## API access

The Nimbus REST API is available on Growth and Enterprise plans. Create an API key
under **Settings → Developer → API keys**. Authenticate with a bearer token:

    Authorization: Bearer <your_api_key>

Rate limits: 600 requests/minute on Growth, 3,000/minute on Enterprise. Exceeding the
limit returns HTTP 429 with a `Retry-After` header. Base URL: `https://api.nimbus.io/v1`.

## Webhooks

Configure webhooks under **Settings → Developer → Webhooks**. We sign every payload
with an HMAC-SHA256 signature in the `X-Nimbus-Signature` header — verify it against
your signing secret. Failed deliveries are retried with exponential backoff for 24h.

## Native integrations

Slack, Microsoft Teams, Google Drive, GitHub, Jira, and Zapier are available under
**Settings → Integrations**. Each connection uses OAuth; a workspace Admin must
approve it the first time.

## Common errors

- **HTTP 401** — invalid or revoked API key. Regenerate the key.
- **HTTP 403** — the key lacks scope for that resource; check key permissions.
- **HTTP 429** — rate limited; back off per the `Retry-After` header.
- **Sync stuck** — disconnect and reconnect the integration; check the provider's
  status page; ensure the OAuth token hasn't been revoked upstream.

## Performance

If the app feels slow, check `status.nimbus.io` for incidents, then try a hard
refresh. Large workspaces (>100k records) should enable pagination in API calls.
