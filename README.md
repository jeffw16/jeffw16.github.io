# jeffw16.github.io
## Pages

- [CoastFIRE Calculator](https://jeffw16.github.io/coastfire-calculator/) — `coastfire-calculator/`

### CoastFIRE calculator

Finds when you can stop contributing to your 401(k) and coast to retirement ("When can I retire?"), or the
contribution needed to retire by a given age ("What should I contribute?"). Inputs are remembered in your
browser, and **Copy link** shares the exact scenario in the URL (a link with parameters defines the whole scenario).

Model assumptions: every amount is in today's dollars and every return is real (after inflation), compounded
monthly, with contributions at month end. FIRE number = spending grossed up for one effective tax rate, less
any Social Security / pension (which offsets spending dollar for dollar from its start age; retiring earlier
needs extra to bridge the gap), divided by the safe withdrawal rate. Contributions can be dollars or a percent
of salary, with yearly real raises and an employer match; your own contributions are checked against the 2026
IRS limits (the match isn't). Optionally, returns are simulated (1,000 seeded lognormal paths whose median
matches the chosen rate; per-portfolio volatility) for a likely range and chances of success. Early-withdrawal
penalties are not modeled.

Code layout: pure, unit-tested modules (`calc.js`, `retirement.js`, `limits.js`, `scenario.js`,
`montecarlo.js`, `risk.js`, `format.js`, `persist.js`) and `app.js` for all DOM, storage and URL wiring; the
Monte Carlo work runs in `mc-worker.js`.

Run `npm install` once, then:

- `npm test` runs the unit tests (Node 22+; the page itself has no runtime dependencies).
- `npm run test:e2e` runs the Playwright browser tests against a local server. Chart.js is served from
  `node_modules`, so no network is needed. Set `PW_CHROMIUM=/path/to/chrome` to use an existing Chromium
  instead of Playwright's download (`npx playwright install chromium`).
- `npm run serve` serves the site at http://localhost:8765/ (override with `PORT`).

After editing anything in `coastfire-calculator/`, run `npm run stamp` to refresh the `?v=` cache-busting
hashes on its CSS/JS URLs (CI fails if they're stale), so browsers never mix cached and new files after a deploy.
