# CoastFIRE calculator v2: implementation handoff

This is a complete spec for an implementer. The product decisions are already made, so don't reopen them. If something here is truly ambiguous or impossible, ask the user and don't guess.

Repo: `jeffw16/jeffw16.github.io`. Live page: `https://jeffw16.github.io/coastfire-calculator/`. Start from `main` at or after commit `001e96c`.

---

## 1. What exists today (read this before touching code)

It's a static site served by GitHub Pages. There is no build step, no framework and no runtime dependencies. The JavaScript is vanilla ES modules.

| Path | Role |
|---|---|
| `coastfire-calculator/index.html` | The page. Chart.js 4.4.1 is loaded from `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js` with `defer`. |
| `coastfire-calculator/calc.js` | **Pure** math: `PORTFOLIOS`, `resolveReturn`, `monthlyRate`, `fireNumber`, `spendingFromFire`, `coastTarget`, `balanceNoContrib`, `balanceWithContrib`, `isCoastReached`, `findCoastAge`, `findFireAge`, `requiredMonthlyContribution`, `chartEndAge`, `buildSeries`, `splitAge`. |
| `coastfire-calculator/format.js` | **Pure** display helpers: `parseAmount`, `groupDigits`, `formatWithCaret`, `deleteAcrossComma`, `formatAge` ("40 years, 1 month"), `formatAgeParts`. |
| `coastfire-calculator/persist.js` | **Pure** localStorage helpers: `STORAGE_KEY`, `serializeState`, `parseSavedState(text, defaults, allowed)`, `isDefaultState`. |
| `coastfire-calculator/app.js` | The only module that touches the DOM, storage or Chart.js. It holds the `FIELDS`/`ALLOWED`/`DEFAULTS` lists, `readInputs`, `validate`, `setCard`, `update`, `drawChart` (with a milestone plugin) and `fillTable`. |
| `coastfire-calculator/style.css` | CSS variables, with light and dark themes via `prefers-color-scheme`. |
| `scripts/assets.mjs`, `scripts/stamp-assets.mjs` | Cache busting. |
| `tests/*.test.js` | `node:test` unit tests, 128 of them. They also cover the markup and the asset stamps. |
| `.github/workflows/test.yml` | CI that runs `npm test` on Node 22. |

### How the current model works
- All amounts are in today's dollars and all returns are real (after inflation). Compounding is monthly: `r_m = (1+r)^(1/12) − 1`.
- FIRE number = spending ÷ withdrawal rate. Coast target at age a = FIRE ÷ (1+r)^(R − a), where R is the "Traditional retirement age" (`retirementAge`, default 65).
- **Mode `contribution`** ("When can I retire?") shows the full retirement age and the coast age, or "Reached ✓".
- **Mode `target`** ("What should I contribute?") takes `targetAge` (default 55) and shows the monthly contribution needed to reach FIRE at `targetAge`, plus the coast age that contribution produces.
- Spending, withdrawal rate and FIRE number stay in sync: editing spending or the rate recomputes FIRE, and editing FIRE recomputes spending.

### House rules (these are non-negotiable)
1. **Calculations live in pure functions** with no DOM, globals, randomness or mutation of arguments. Every exported pure function gets unit tests: normal cases, boundaries and edge cases, with frozen inputs to prove nothing is mutated. Side effects belong only in `app.js`.
2. **Unit tests use `node:test` and `node:assert/strict`.** They run with `npm test` (`node --test`). Name files `tests/*.test.js`.
3. **Cache-busting stamps.** Every local CSS/JS reference and every relative module import carries `?v=<hash>`. After **any** change in `coastfire-calculator/`, run `npm run stamp`. A unit test fails CI if the stamps are stale. New modules must be imported as `./x.js?v=…`; running the stamp script fills in the hash.
4. **Dollar inputs** are `type="text" inputmode="decimal" autocomplete="off" data-amount`. `app.js` attaches the comma formatting and caret handling to these automatically. Parse them with `parseAmount`.
5. **Every input needs a `<label>`**, and every id `app.js` uses must exist in the page; `tests/markup.test.js` checks both. Add new fields to `FIELDS` (and to `ALLOWED` for select and radio values) so they're saved and reset.
6. **Ages are shown with `formatAge`/`formatAgeParts`.** Never write "X and Y months".
7. **Chart colors** come from CSS variables with light and dark values. Before choosing any new color, load the **`dataviz` skill** and run its palette check. The current series colors are: contributions `#2a78d6`/`#3987e5`, current balance only `#eb6834`/`#d95926`, coast target `#1baf7a`/`#199e70`.
8. **Verify in a real browser before every push.** Take screenshots in light mode, dark mode and at phone width (390px), check for no console errors, and look at the screenshots yourself.
9. **No model names** in commits, PR titles or PR bodies. Use the attribution trailers your session tells you to use.

### Environment notes (Claude Code cloud container)
- The outbound proxy blocks jsdelivr and github.io, but the npm registry works.
- Chromium is at `/opt/pw-browsers`. If the pinned `@playwright/test` version doesn't match it, launch with `executablePath: '/opt/pw-browsers/chromium'`. Don't run `playwright install` locally.
- GitHub access is through the GitHub MCP tools, not the `gh` CLI.

---

## 2. Decisions already made

1. **What the FIRE number field means.** It shows the full **adjusted** amount needed (after tax and Social Security) for retiring at the traditional retirement age R.
   - Typing into it back-solves spending (formula in §4, PR 3).
   - If the benefit fully covers spending and starts at or before R, the needed amount is 0. In that case the field is read-only and shows a note.
2. **Defaults.**
   - Effective tax rate on withdrawals: **10%**. This raises the default FIRE number from $1,000,000 to $1,111,111.
   - Everything else new defaults to a neutral value: match 0, raises 0, Social Security benefit 0 (start age 67), salary blank, contribution unit `$`, return model `fixed`.
3. **Historical data is included.** If the container can't download it, stop and ask the user for the data file. Don't make up numbers.
4. **Delivery is a stack of 8 PRs** using GitHub's stacked pull requests (§3).

---

## 3. Stacked PR workflow

GitHub's native stacked PRs (in public preview since mid-2026) show a stack map on each PR. Check GitHub's current docs for exactly how to create a stack: the `gh stack` CLI extension, the UI or the API. You likely only have the GitHub MCP tools and not `gh`. In that case, build the stack the standard way below. If the MCP tools can't link the PRs as a native stack, tell the user exactly which PRs to link in the UI. It's a few clicks.

**Branches.** Each one is cut from the one before it:

| # | Branch | PR base |
|---|---|---|
| 1 | `coastfire-v2/01-e2e-sri` | `main` |
| 2 | `coastfire-v2/02-sim-engine` | `coastfire-v2/01-e2e-sri` |
| 3 | `coastfire-v2/03-retirement-need` | `coastfire-v2/02-sim-engine` |
| 4 | `coastfire-v2/04-contributions` | `coastfire-v2/03-retirement-need` |
| 5 | `coastfire-v2/05-coast-path-sensitivity` | `coastfire-v2/04-contributions` |
| 6 | `coastfire-v2/06-monte-carlo` | `coastfire-v2/05-coast-path-sensitivity` |
| 7 | `coastfire-v2/07-historical` | `coastfire-v2/06-monte-carlo` |
| 8 | `coastfire-v2/08-share-explain` | `coastfire-v2/07-historical` |

The user has approved these branch names. If your session only lets you push to one designated branch, ask the user before creating them.

**Rules**
- Every PR has to work as a release on its own. CI must pass, the page must work, and the tests (unit and end-to-end) must be green at that layer. Each PR also re-runs `npm run stamp`.
- Open every PR as a **draft**. Each title starts with `[n/8]`. Each body has:
  - a "Stack" section listing all 8 PRs with links, marking which one this is;
  - a Summary, a Testing section, and screenshots where the UI changes;
  - the attribution footer.
  
  Once all 8 exist, go back and fill in the links on the earlier ones.
- Subscribe to activity on all 8 PRs and drive each to green yourself.
- **Changing a lower PR:** commit the change on its branch, then merge it upward through each branch above (`git checkout 03 && git merge 02`, and so on). Don't rebase branches that have already been pushed.
- **Stamp conflicts are expected.** The `?v=` hash changes in every PR, so merges conflict on those lines. Resolve by taking either side, run `npm run stamp`, then `npm test`, and commit.
- **When a lower PR merges:** this repo squash-merges (see the `(#3)` subjects on `main`). So:
  1. Rebase the next branch onto `main`: `git rebase --onto origin/main <old-base-branch-tip> <branch>`.
  2. Push it with `--force-with-lease`. This is acceptable because these are branches you created.
  3. Retarget its PR base to `main`, unless the native stack does this for you.
  4. Merge the change upward through the remaining branches.

---

## 4. The PRs

### PR 1: End-to-end tests and Chart.js integrity (no visible changes)
**Goal:** pin today's behavior in a real browser before anything is refactored, and harden the CDN script.

- `package.json`:
  - Add the dev dependencies `@playwright/test` (pinned) and `chart.js` at exactly `4.4.1`.
  - Add the scripts `"test:e2e": "playwright test"` and `"serve": "node scripts/serve.mjs"`.
  - Commit `package-lock.json`.
- `scripts/serve.mjs`: a dependency-free static file server (`node:http`). It serves the repo root on a port from `PORT` (default 8765), with correct MIME types for html, css, js, mjs, json, svg and png, and `Cache-Control: no-store`.
- `playwright.config.js`:
  - `testDir: 'e2e'`;
  - a `webServer` that runs `npm run serve`;
  - a `chromium` project. Use `executablePath` from `process.env.PW_CHROMIUM` when it's set, for the container.
- `e2e/fixtures.js`: route `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/**` to `node_modules/chart.js/dist/chart.umd.js`, so the tests are hermetic. Fail any test that logs a console error or a page error.
- `e2e/calculator.spec.js`. Read the expected values from `calc.js` where possible rather than hard-coding them.
  - Default load shows coast at "40 years, 1 month", FIRE at "60 years, 6 months", a coast target of $93,663 and a FIRE number of $1,000,000. (These four numbers change in PR 3, when the 10% tax default lands. Update them there.)
  - Switching to mode `target` shows $931/mo for retiring at 55.
  - Comma typing:
    - Typing `1234567` into the balance field shows `1,234,567`.
    - Backspace and Delete right next to a comma each remove a digit; neither gets stuck.
    - Typing in the middle keeps the caret where it was.
  - Spending → FIRE sync, and FIRE → spending sync.
  - Choosing the custom portfolio shows the custom return field.
  - Reset restores the defaults and disables the reset button.
  - Inputs survive a reload (localStorage).
  - Repeat the default-load test in dark mode (`colorScheme: 'dark'`) and at a 390×844 viewport, and assert there's no horizontal scrolling.
- Chart.js integrity:
  - Add `integrity="sha384-<hash>" crossorigin="anonymous"` to the CDN script tag. Compute the hash from `node_modules/chart.js/dist/chart.umd.js`.
  - A new `tests/sri.test.js` hashes that file and checks that it equals the attribute. It also fails if any external `<script>` or stylesheet has no `integrity`.
  - In `app.js`: if `window.Chart` is still undefined after `load`, show a "Chart unavailable" message in the chart area. The cards and table must still work.
- CI (`.github/workflows/test.yml`):
  - Add `npm ci` before `npm test`.
  - Add a second job, `e2e`: `npm ci`, then `npx playwright install --with-deps chromium`, then `npm run test:e2e`. Upload `playwright-report` when it fails.
- README: document `npm run test:e2e` and `npm run serve`.

### PR 2: Simulation engine refactor (no visible changes)
**Goal:** make month-by-month simulation the core, so later PRs can vary contributions, needs and returns.

Add these pure functions to `calc.js`:
- `simulate({ balance, contributions, monthlyReturns })` returns a `Float64Array` of length `contributions.length + 1`.
  - `out[0] = balance`.
  - `out[n+1] = out[n] * (1 + monthlyReturns[n]) + contributions[n]`, so contributions land at the end of each month, matching `balanceWithContrib`.
  - `monthlyReturns` is an array, or a number meaning the same rate every month.
- `constantSchedule(monthly, months)` returns a `Float64Array` filled with `monthly`.
- `firstMonthAtOrAbove(balances, targetFn)` returns the first index n where `isCoastReached(balances[n], targetFn(n))`, or `null`.
- Make `findCoastAge`, `findFireAge` and `buildSeries` use `simulate` internally, keeping the same signatures and results.
  - `findFireAge` gains an optional `requiredAt(age)` parameter; by default it returns a constant `fire`.
  - `findCoastAge` gains an optional `contributions` schedule; by default it's constant.

Tests:
- `simulate` matches `balanceWithContrib` to within 1e-6 relative error for r ∈ {0, 0.04, 0.07, −0.02} and n ∈ {0, 1, 12, 420}.
- **Regression pins:** for age 30, $50k, $500/mo, 7%, $40k at 4%, the coast age is 30 + 121/12, the FIRE age is 30 + 366/12, and the required contribution for retiring at 55 rounds to $931.
- Every existing test still passes unchanged.

### PR 3: Retirement need (taxes, Social Security, early-access note, form regrouping)
New module `coastfire-calculator/retirement.js`, all pure:
- `grossWithdrawal(spending, taxRate)` = `spending / (1 − taxRate)`. It returns NaN when `taxRate` ≥ 1 or < 0.
- `annuityFactor(annualReturn, months)` = the present value of $1 a year paid monthly (1/12 per month) for `months` months: `(1/12) * (1 − (1+r_m)^−m) / r_m`, or `m/12` when r = 0.
- `requiredBalance({ spending, taxRate, swr, benefit, benefitAge, retireAge, annualReturn })`:
  - `wPre = gross(spending)` and `wPost = gross(max(0, spending − benefit))`.
  - `m = round(max(0, benefitAge − retireAge) * 12)`.
  - Result = `wPost / swr + (wPre − wPost) * annuityFactor(r, m)`.
  - The benefit offsets spending dollar for dollar. Tax applies only to the 401(k) withdrawals.
- `spendingFromRequired({ required, taxRate, swr, benefit, benefitAge, retireAge, annualReturn })` is the exact inverse:
  - Let `a = annuityFactor(r, m)` and `k = 1 − taxRate`.
  - If `k·required ≥ benefit·a`, then `spending = benefit + (k·required − benefit·a)·swr`.
  - Otherwise, if `a > 0`, then `spending = k·required / a`. If `a = 0`, return NaN; the field is read-only in that case.
  - Test round trips across a grid of inputs.
- `earlyAccessGuidance(retireAge)` returns `"none"` at 59.5 and up, `"rule-of-55"` from 55 up to 59.5, and `"before-55"` below 55.

Model changes in `app.js`:
- Pass `requiredAt(age)` = `requiredBalance({ …, retireAge: age })` to `findFireAge`.
- The coast target uses `requiredBalance` at R.
- Mode `target` solves for `requiredBalance` at `targetAge`. `requiredMonthlyContribution` already accepts a `fire` value, so pass that.
- The FIRE card label becomes "FIRE number (retire at {age})", using the age that matters for the mode and showing a whole year. The card's subtext breaks the number down: "covers $X/yr after 10% tax" plus a line about the Social Security bridge when there is one.

Inputs (all in a new "Retirement" section; see the regrouping below):
- `taxRate`: number, %, default 10, range 0–60.
- `benefit`: dollar field, "Social Security / pension (per year)", default 0.
- `benefitAge`: number, default 67, range 50–100.
- Syncing:
  - Editing spending, withdrawal rate, tax, benefit, benefit age or R recomputes `fire`.
  - Editing `fire` recomputes spending with `spendingFromRequired`.
  - When the result is NaN, i.e. the benefit covers everything from R onward, `fire` is set to `readonly` with a hint: "Your benefit covers your spending from age R."

Early-access note: a `<p class="note">` under the cards. It appears when the full retirement age (mode `contribution`) or `targetAge` (mode `target`) is below 59.5.
- `rule-of-55`: "Retiring at 55–59½? The Rule of 55 lets you withdraw from the 401(k) of the employer you leave in or after the year you turn 55, without the 10% penalty."
- `before-55`: "Retiring before 55 means bridging to 59½ — e.g. 72(t) substantially equal payments, a Roth conversion ladder, or taxable savings. This calculator doesn't model early-withdrawal penalties."

Form regrouping: done now, because this is the first PR to add several fields.
- **Basics** is always visible: mode, age, balance, contribution or target age.
- Three `<details>` sections, each with an `id`, which stays stable for later PRs:
  - **Contributions**: empty until PR 4. Don't render it until it has fields.
  - **Retirement** (`open` by default): traditional retirement age, spending, withdrawal rate, tax, benefit, benefit age, FIRE number.
  - **Investments**: portfolio and custom return.

Tests: unit tests for every function above. Update the end-to-end default values to the 10% tax results, read from the calc functions. Add end-to-end tests for the readonly FIRE case and both early-access notes.

### PR 4: Contributions (salary, $ or %, match, raises, IRS limits)
New module `coastfire-calculator/limits.js`, pure:
- `IRS_LIMITS = { year: 2026, deferral: 24500, catchUp50: 8000, catchUp60to63: 11250 }`. **Check these against the current IRS notice before committing,** and cite the source in a comment. They're treated as real dollars, since the limits are indexed to inflation.
- `deferralLimit(age)`:
  - below 50: deferral;
  - 50–59 and 64+: deferral + catchUp50;
  - 60–63: deferral + catchUp60to63.
  - Use whole-year age (floor).
- `firstAgeOverLimit({ age, employeeSchedule })` returns the first whole age at which the employee's own 12-month contributions exceed `deferralLimit` for that age, or `null`. Test it at ages 49/50, 59/60, 63/64.

Add `contributionSchedule({ months, unit, amount, salary, raise, matchRate, matchCap })` to `calc.js`. It returns `{ employee: Float64Array, total: Float64Array }`.
- The employee contribution for month n:
  - when `unit === "$"`: `amount · (1+raise)^floor(n/12)`;
  - when `unit === "%"`: `amount/100 · salary/12 · (1+raise)^floor(n/12)`.
- The match for month n: `matchRate · min(employee_n, matchCap · salary_n / 12)`. It's 0 when salary is blank or 0.
- `total = employee + match`.
- Tests:
  - With no raise, no match and unit `$`, it equals `constantSchedule`.
  - The match stops growing at the cap.
  - Raises step up at months 12, 24 and so on.
  - Results are identical whether you start from a dollar amount or the matching % of salary.

Generalize mode `target` with a pure `solveEmployeeAmount({ …schedule params without amount, target, months, annualReturn, balance })`.
- It bisects on `amount`, in the selected unit, so that `simulate(...)` at `months` reaches `target`.
- Search bounds: 0 up to whatever amount overshoots, found by doubling.
- Precision: $0.01 for dollars, 0.01 for %.
- It returns 0 if the current balance is already enough, or `null` if `months ≤ 0`.
- Test: with neutral inputs it matches `requiredMonthlyContribution`. Round trips land on the target.

Inputs, in the **Contributions** section:
- `salary`: dollar field, optional, "Annual salary".
- `contributionUnit`: a radio or segmented `$ / %` control next to the contribution field. Add it to `ALLOWED`.
  - Switching units converts the current value using the salary when one is set; otherwise it resets to the default for that unit (500 for $, 6 for %).
  - Choosing `%` without a salary shows a validation message.
- `matchRate`: %, default 0. `matchCap`: % of salary, default 0. When either is above 0 and there's no salary, show the hint "Enter salary to include the match".
- `raise`: % per year after inflation, default 0, range −5 to 10.

Results:
- Mode `target` shows the solved **employee** amount in the selected unit, with a subtext like "+ $X/mo employer match" when there is one.
- An IRS warning line appears on the contribution card when `firstAgeOverLimit` isn't null: "Exceeds the 2026 401(k) limit ($24,500/yr at your age) — consider an IRA or taxable account for the rest." It's informational only; nothing is capped.

Tests: unit tests for everything above. End-to-end tests for the match subtext, the limit warning appearing in each mode, and unit conversion.

### PR 5: Coast path line and sensitivity strip
- `buildSeries` gains `coastPath`: contribute through the deterministic coast age, then put in nothing. Pure helper: `coastPathSchedule(schedule, coastMonth)` zeroes every month from `coastMonth` onward.
  - If coast is already reached, the coast path is the same as the "current balance only" line. Show it anyway, but put it **after** the "current balance only" line in the legend and draw it on top so it stays visible.
  - If coast is never reached, leave the series out.
- Chart: add the fourth line "Contribute until coast, then stop", dashed `[6,4]` to set it apart. Pick a new color variable `--series-coastpath` with the `dataviz` skill, for both themes.
  - Add a table column for it.
  - Update the summary sentence: "…stop contributing at 40 years, 1 month and still reach $1.11M by 65."
- Sensitivity:
  - Pure function `sensitivity(params, deltas = [-0.01, 0, 0.01])` runs the deterministic model at each shifted return.
    - Mode `contribution`: returns `[{ rate, coastAge, fireAge }]`.
    - Mode `target`: returns `[{ rate, employeeAmount }]`.
  - Show it as a small 3-column table under the cards, titled "If returns are 1% lower / as chosen / 1% higher". Format ages with `formatAge`, and show "Not by 100" or "Reached" where they apply.
- Tests: unit tests (for an already-coasted input the coast path equals the no-contribution line; the coast path reaches `requiredBalance(R)` at R; sensitivity is monotonic in the rate). End-to-end: the legend shows 4 entries, and the sensitivity table renders in both modes.

### PR 6: Monte Carlo
New module `coastfire-calculator/montecarlo.js`, all pure. Randomness comes in only through a seed.
- `mulberry32(seed)` returns a function that gives numbers in [0,1).
- `normalPair(rand)` uses Box–Muller.
- `lognormalMonthlyReturns({ annualReturn, volatility, months, rand })`:
  - `ln(1+R_m) ~ N(ln(1+r)/12, σ/√12)`;
  - this makes the **median** annual return equal the stated compound rate.
  - It returns a `Float64Array`.
- `runPaths({ paths = 1000, seed = 1, months, …, simulateFn })` returns `Float64Array[]` of balances.
- `percentilesByYear(paths, [0.1, 0.5, 0.9])`.
- `successRate(paths, month, target)`.
- `fireAgeDistribution(paths, requiredAt, age)` returns the 10th, 50th and 90th percentile ages, counting `null` as "not by 100".
- `coastConfidenceAge({ …, confidence = 0.9 })`: the earliest stop month at which `successRate` of the coast path at R is at least `confidence`. Bisect on the month and reuse the same random paths every time.
- `contributionForConfidence({ …, confidence = 0.9 })`: bisect `amount` using the same random paths each time.
- Tests:
  - The same seed gives identical output.
  - The median of 5,000 paths of 30-year growth is within 2% of the deterministic result.
  - Volatility 0 gives exactly the deterministic result.
  - Success rate is non-decreasing in contribution.
  - `coastConfidenceAge` ≥ the deterministic coast age.

Add `volatility` to each `PORTFOLIOS` entry:

| Preset | Volatility |
|---|---|
| sp500 | 0.17 |
| total-market | 0.17 |
| global-80-20 | 0.14 |
| target-date | 0.11 |
| balanced-60-40 | 0.10 |
| conservative-40-60 | 0.07 |

Add a `customVolatility` input (%, default 15), shown only with a custom return.

Add a `returnModel` select in **Investments**: `fixed` (default), `montecarlo` or `historical` (wired up in PR 7). Add it to `ALLOWED`.
- With `fixed`, the page looks exactly as it does today.
- With `montecarlo`:
  - **Chart:** a shaded 10–90% band around the contribution line. Use the contribution color at about 15% opacity, set through a CSS variable for each theme. The median line replaces the deterministic one, and the legend entry reads "With contributions (median)".
  - **New card, "With market ups and downs":**
    - mode `contribution`: "FIRE between {p10}–{p90} (80% range)", "Coasting from {coast age}: {X}% chance", "Coast with 90% confidence: {age}";
    - mode `target`: "Contribute {amount} for 90% confidence".
  - Add a hint under the card: "Coasting exactly on the line works about half the time — markets don't move in straight lines."
- Performance:
  - Debounce recalculation by 150 ms while in Monte Carlo mode.
  - Measure. If one update takes more than 30 ms on a desktop machine, move the work into a module Web Worker (`mc-worker.js`, stamped like any other module) that imports the same pure functions, and show "Calculating…".
- Tests: end-to-end checks that the band appears, the card fills in, and switching back to `fixed` restores the original cards.

### PR 7: Historical backtest
- Data module `coastfire-calculator/history.js`:
  - Annual returns from 1928 through the latest full year for:
    - S&P 500 including dividends;
    - US 10-year Treasury bond;
    - CPI inflation.
  - Source: Aswath Damodaran's "Historical Returns on Stocks, Bonds and Bills" (NYU Stern, `histret` data). Put the source URL and the date you retrieved it in a comment.
  - Store the nominal values exactly as published, as `{ year, stocks, bonds, cpi }`.
  - Real return = `(1+nominal)/(1+cpi) − 1`; compute it in a pure function, not by hand.
  - **If you can't download the data from the container, stop and ask the user for the file.** Never type numbers from memory.
- Pure functions:
  - `realSeries(rows, mix)`: rebalanced every year.
    - Stock shares by preset: sp500 and total-market 1.0; global-80-20 0.8; target-date 0.7 (the code comment should note this is a simplification of a glide path); balanced-60-40 0.6; conservative-40-60 0.4.
  - `shiftToRate(series, rate)` shifts the log returns so the geometric mean equals `rate`. Use it for custom returns, applied to the S&P series.
  - `historicalPaths({ series, months, … })`: one path per starting year.
    - It wraps around to the start of the data when it runs out.
    - Each annual return is spread over 12 equal monthly steps: `(1+R)^(1/12) − 1`.
  - The result plugs into the same `percentilesByYear`, `successRate` and other functions as Monte Carlo, so the cards and chart code are shared.
- UI: the card title becomes "Across historical markets ({firstYear}–{lastYear})". The hint names the worst starting year.
- Tests:
  - Real-return math.
  - Mix blending.
  - The number of paths equals the number of years.
  - Wrap-around indexing.
  - After `shiftToRate`, the geometric mean matches to within 1e-9.
  - Spot-check a published year against its exact value.
  - End-to-end: switching to the historical mode works.

### PR 8: Shareable links, explanations, polish
- `persist.js` gets pure functions:
  - `encodeQuery(values, defaults)` includes only values that differ from the defaults. Dollar values are stored without commas.
  - `decodeQuery(search, defaults, allowed)` uses the same validation as `parseSavedState`: unknown keys are dropped, allow-lists are enforced and `?v=` is ignored. Dollar values are re-grouped on the way in.
  - Tests: round trips, rejected values, empty query, URL-encoded characters.
- `app.js`:
  - On load, the priority is URL query, then saved values, then defaults.
  - After each update, call `history.replaceState` with the encoded query (debounced 300 ms). At the defaults, the URL has no query string.
  - A "Copy link" button sits next to Reset. It uses `navigator.clipboard.writeText` with a fallback that selects the text, and shows "Copied" for 2 seconds.
- Explanations in place:
  - Add ⓘ `<button type="button" popovertarget="…" aria-label="What is …?">` buttons with native `popover` elements for: CoastFIRE, FIRE number, withdrawal rate, real return, tax rate, Social Security bridge, coast path, and success chance (only shown in the uncertainty modes). Each is 1–3 sentences.
  - Style them to match the theme in both modes, and make them reachable by keyboard.
  - Markup test: every `popovertarget` points to an element that exists.
- End-to-end tests:
  - A link opened in a fresh browser context reproduces the cards.
  - A tampered query (`?mode=evil&age=abc`) falls back safely.
  - Reset clears the query.
  - Popovers open and close with keyboard and mouse.
- README: describe the new features and model assumptions (real dollars, tax simplification, benefit offset, the target-date approximation, data source).

---

## 5. Definition of done (for each PR)
- [ ] `npm test` and `npm run test:e2e` pass locally, `npm run stamp` has been run, and the stamp test passes.
- [ ] Every new exported pure function has unit tests, including edge cases and frozen-input checks.
- [ ] Screenshots in light mode, dark mode and at 390px wide, with no console errors and no horizontal scroll, checked by eye.
- [ ] When the PR adds no new inputs, the default view's numbers are unchanged. PR 3, which adds the tax default, is the only exception. When it does add inputs, their neutral values reproduce the previous numbers.
- [ ] A draft PR with the correct base, the stack list and screenshots. It's subscribed to, and CI is green.
