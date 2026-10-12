# jeffw16.github.io
## Pages

- [CoastFIRE Calculator](https://jeffw16.github.io/coastfire-calculator/) — `coastfire-calculator/`

Run `npm install` once, then:

- `npm test` runs the unit tests (Node 22+; the page itself has no runtime dependencies).
- `npm run test:e2e` runs the Playwright browser tests against a local server. Chart.js is served from
  `node_modules`, so no network is needed. Set `PW_CHROMIUM=/path/to/chrome` to use an existing Chromium
  instead of Playwright's download (`npx playwright install chromium`).
- `npm run serve` serves the site at http://localhost:8765/ (override with `PORT`).

After editing anything in `coastfire-calculator/`, run `npm run stamp` to refresh the `?v=` cache-busting
hashes on its CSS/JS URLs (CI fails if they're stale), so browsers never mix cached and new files after a deploy.
