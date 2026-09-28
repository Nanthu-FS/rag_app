# ScopeScan data directory

ScopeScan uses no database. Everything is stored here:

- `scope.json`: the allowlist. **Add ONLY assets you are explicitly authorized to test** under a written agreement or a bug-bounty program's rules. ScopeScan refuses to send any request to a host that is not listed here.
- `scans/{yyyy-MM-dd}_{host}_{shortid}/`: `scan.json`, `screenshots/*.png` and `report.pdf`.

Start from the example:

```bash
cp data/scope.json.example data/scope.json
```

Patterns take one of two forms:
- An exact host: `app.example.com`.
- An explicit wildcard, `*.example.com`. It matches subdomains only, never `example.com` itself.

Schemes, paths, ports and bare TLD wildcards are rejected. Private, loopback and link-local addresses are always blocked, even if they are listed.
