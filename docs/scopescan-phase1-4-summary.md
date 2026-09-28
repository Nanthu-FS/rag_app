# ScopeScan: Phases 1–4 summary

Status: Phases 1–4 are complete. **153/153 tests pass** (`dotnet test`, about 3 s). Phases 5–8 have not been started.

## What was built

| Phase | Delivered |
|---|---|
| 1 | .NET 8 solution with 6 projects. C# record models. File-only storage (`IStorageService`, `IScanRepository`, `IScopeRepository`) with atomic temp-then-rename writes and a per-scan lock. Scope gate (exact host or explicit `*.domain` wildcard; a wildcard never matches the apex). SSRF `NetworkPolicy`. `SecretRedactor`. `SeverityScorer` (counts, 0–100 risk score, grade). `data/scope.json.example`. |
| 2 | `ScopedHttpClient`, the only path to a target. It runs the scope gate on every request and on every redirect hop. It resolves DNS once per scan, validates the address and pins it through `SocketsHttpHandler.ConnectCallback`. It refuses any non-public address, and also refuses a mixed public/private DNS answer. It limits each host to 2 req/s and applies a 10 s timeout. Response bodies are bounded, only GET/HEAD/OPTIONS are allowed, and Cookie and Authorization headers can't be set. It sets the ScopeScan User-Agent and keeps a request log. Also: `HostScanGuard` (1 concurrent scan per host) and a robots.txt evaluator. Checks: security headers, information-leaking headers, cookie flags, CORS (one benign Origin) and TLS (expiry, name mismatch, trust, key size, signature, TLS 1.0/1.1 probes). |
| 3 | Exposed-files check: a fixed list of 13 paths plus robots/sitemap/security.txt. It detects files by content signature (so soft-404 pages don't count), reads at most 4 KB and doesn't follow redirects. For `.env` it keeps only the key names. JS library check: a bundled offline advisory JSON covering jQuery, jQuery UI, Bootstrap, AngularJS, Lodash, Moment, Handlebars and DOMPurify. Third-party scripts are matched by URL only and never fetched. Reflected-parameter check: sends only an inert alphanumeric marker, classifies where it appears, and is capped at 8 requests. Open-redirect check: tests only existing redirect-style parameters, uses a reserved `.example` marker host and never follows the redirect. Fingerprint check: reads the baseline response only and sends no extra requests. |
| 4 | `PlaywrightScreenshotService` (headless Chromium, 1366×768, 20 s). **Every browser request is intercepted and fetched through `ScopedHttpClient`**, so scope, SSRF, pinning and rate limits all apply. Out-of-scope sub-resources are aborted, and redirects are re-checked on each hop. As a second layer, Chromium is launched with no DNS and a dead proxy. Set-Cookie is stripped. It produces a full-page capture, reflection screenshots with the marker highlighted, and a headers-summary panel rendered offline (values HTML-encoded, cookie values redacted). `EvidenceCapture` saves the PNGs and attaches them to findings. A failed capture is recorded but never fails the scan. |

## Test coverage (153)
- Scope gate: exact and wildcard matching, apex exclusion, IDN, invalid patterns, private IP literals, non-http schemes, embedded credentials.
- SSRF: private, loopback, metadata and IPv6 ranges. DNS resolving to a private address, mixed answers, one lookup per host, and the pinned IP present on every request. The handler refuses to connect without a pin.
- Redirects: out-of-scope hop, `file:` hop, redirect loops, in-scope chains.
- Storage: atomic writes, path traversal, id format, concurrent updates, listing, screenshots, scope CRUD and all-or-nothing import.
- Scoring and redaction.
- Every check, run against a mocked handler with recorded fixtures in `tests/ScopeScan.Tests/Fixtures/*.http`.
- Screenshots, run against the real headless Chromium with every response supplied by the mocked handler.

## Folder structure
```
ScopeScan.sln, Directory.Build.props
data/scope.json.example
src/ScopeScan.Core         Models/, Scope/, Storage/, Scoring/, Evidence/, Abstractions.cs
src/ScopeScan.Scanner      Http/ (ScopedHttpClient, rate limiter, DNS, TLS), Checks/ (10 checks), Data/js-vulnerabilities.json
src/ScopeScan.Screenshots  PlaywrightScreenshotService, HeadersPanelRenderer, EvidenceCapture
src/ScopeScan.Reporting    (empty, Phase 5)
src/ScopeScan.Api          /health only (Phase 6)
tests/ScopeScan.Tests      Core/, Scanner/, Screenshots/, Fixtures/
```

## Known gaps / caveats
- **Nothing runs a scan end to end yet.** There is no orchestrator that creates a `ScanResult`, takes `HostScanGuard`, runs the checks, calls `EvidenceCapture`, scores the results, saves them and emits `ScanProgress`. That belongs to Phase 6.
- The live network paths haven't been exercised against real hosts, because the sandbox has no direct egress. These are `PinnedSocketsHandlerFactory` connecting to a pinned IP and `SocketTlsHandshaker`. Tests cover the logic through mocks, and cover the handler's refusal when no pin is set.
- The TLS 1.0/1.1 probes depend on the local OpenSSL offering those protocols. Modern distros often disable them, which gives false negatives.
- A main-frame redirect during a screenshot is followed by re-navigating, so the browser URL is the final hop. Sub-resource redirects are followed inside the scoped client.
- HTML parsing uses regexes, which is enough for passive discovery. The JS advisory DB is a curated subset.
- Screenshot tests need Chromium. Here that is `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; CI and Docker must install it.
- The top-level `README.md` still describes the older RAG app. The ScopeScan README comes in Phase 8.

## What Phases 5–8 still need
- **5 – Reporting:** a Razor/Scriban HTML template covering cover page, executive summary, findings table, per-finding detail with screenshots, and an appendix of checks run and the request log. PDF via Playwright `page.PdfAsync`, with page numbers. `ILlmAdvisor` with `ClaudeAdvisor` (`ANTHROPIC_API_KEY`) and `NoopAdvisor`. Tests.
- **6 – API:** a scan orchestrator (see gaps above). `/api/scope` CRUD and import. `POST /api/scans`, which requires `permissionConfirmed=true` and validates the URL with SSRF checks. List, get, SSE progress, report download, screenshot serving. ProblemDetails errors, including a friendly "not in scope".
- **7 – Frontend:** React, TypeScript, Vite and Tailwind. Scan page with the permission checkbox and live progress, a Scope page, and a History page.
- **8 – Delivery:** Dockerfile on a Playwright base image, docker-compose mounting `./data`, a GitHub Actions workflow (build, test, frontend lint/build), an integration test (in-process misconfigured server → findings + PDF), and a README with a Mermaid diagram and the responsible-use section.

## Running
```bash
dotnet test                       # 153 tests; needs Chromium for the screenshot tests
cp data/scope.json.example data/scope.json   # then list ONLY hosts you are authorized to test
```
