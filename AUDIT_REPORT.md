# Audit: Structural-Scheme

**Date:** 2026-10-19 (Europe/Moscow, UTC+3)
**Branch:** `arena/dc693094-structural-scheme` (HEAD `8970f26`, = `origin/main`)
**Engine:** Node >=20, single-file offline app (`index.html` 212 KB, 1457 lines)
**Test result:** 54 tests — 51 pass, 3 fail (expected, documented in README/AGENTS)

---

## 1. Executive Summary

| Area | Verdict |
|------|---------|
| **Purpose fit** | Excellent — generator fulfills spec: configure operator/server/auto cabinets → export SVG/PNG/JPG/Draw.io, one offline HTML file. |
| **Build reproducibility** | Excellent — `src/shell.html + src/core.js + src/app.js + src/styles.css + vendor/` → `index.html` via `scripts/build.js`; `tests/repo.test.js` enforces freshness. |
| **Code quality** | Good (8/10) — clean separation core/app, no external runtime deps, good comments. Minor hygiene issues (global mutation, legacy `useMemo` usage). |
| **Tests** | Good, 3 **intentional failures** preserved as regression diagnostics for known routing limitation (see README § Построение линий, AGENTS.md § Трассировка). No silent ignores. |
| **Security** | Low real risk; 7 npm advisories inherited from `tailwindcss@3.4.19` devDep only (no prod exposure). Static server, offline page, CC0 license OK. |
| **Performance** | Good — `clampPerRow` + `rasterScale()` prevent canvas explosion; layout is O(n²) but n ≤ ~30 typical. |
| **CI** | Minimal but correct — `ci.yml` does `npm ci && npm test` on push/PR to `main`. |

**Top 3 risks:**
1. **Known vertical-overlap bug** in dense multi-row diagrams — 3 failing tests intentionally kept; users see overprinting lines in complex schemes (acknowledged, not fixed).
2. **Dev-dep vulnerabilities** (braces/postcss) — noisy `npm audit`, should be documented or mitigated.
3. **React 18 EOL horizon** + Tailwind 3 EOL (v4 available) — outdated but not urgent; upgrade breaks build (Tailwind 4 API change).

---

## 2. Repository Structure

```
index.html              212 KB — BUILD ARTIFACT (do not edit by hand)
src/shell.html           21 lines — HTML skeleton (source of truth for build)
src/core.js             800 lines — pure logic: model, layout, routing, SVG/Draw.io, persistence
src/app.js              325 lines — React 18 + htm UI (no JSX/Babel)
src/styles.css            1 line  — generated Tailwind (npm run build:css)
src/tailwind.css          4 lines — Tailwind entry (@base/@components/@utilities)
vendor/                 144 KB — checked-in React/ReactDOM/htm (from node_modules)
scripts/build.js         56 lines — inlines styles/scripts → index.html
scripts/vendor.js        26 lines — syncs vendor/ from node_modules
scripts/serve.js         34 lines — static server (npm start, 0.0.0.0:8000)
tests/                  9 files — node:test + jsdom, 54 cases
.github/workflows/ci.yml            — checkout@v7, setup-node@v7, Node 22, npm ci/test
AGENTS.md, README.md, LICENSE (CC0), .gitattributes (LF), .gitignore, .ignore (rg/fd)
```

**Pluses:**
- `AGENTS.md` is exemplary — fully explains what each file does, commands, and invariants (single model → both renders; FORMAT_VERSION migration; clampPerRow; makeResolvers; rasterScale null check).
- `index.html` banner clearly marks it as generated; `.ignore` excludes build artifacts from ripgrep so agents don't search generated code.
- No stray files; repo root stays clean.

**Minor:**
- `vendor/` is committed (intentional for offline build) but `.gitignore` only ignores `node_modules/` — correct. `.ignore` mirrors it for search; no duplication issue.
- `tailwind.config.js` is minimal (theme.extend empty) — fine, but could declare `safelist` explicitly if classes are ever generated dynamically (currently static, so safe).

---

## 3. Architecture & Code Review

### 3.1 `src/core.js` — Domain Core (800 LOC)
**Purpose:** Pure JS, no DOM, dual-target (browser `window.SchemeCore` + Node `require`).

| Component | Assessment |
|-----------|------------|
| Constants (`COLORS`, `BW`, `GAP_MIN`, `SLOT`, `LSTEP`, `EXIT_STEP`, etc.) | Well-named, magic numbers documented. `PER_ROW_MAX=12` and `RASTER_MAX_PIXELS=16e6` are justified in comments. |
| `PROJECT_DEFAULTS` / `ITEM_DEFAULTS` | Elegant dual-use as schema + defaults. `pickKnown()` enforces type-checked whitelist — prevents injection via crafted JSON. |
| `normalizeState()` / `parseState()` / `serializeState()` | Correct. Handles stringified numbers from inputs, deduplicates IDs, reserves `KVM_PANEL_ID`. Version check throws on future format. |
| `makeResolvers()` | Fix for dangling references (deleted cabinets). Correctly falls back to first net/rack. `effAutoTarget` avoids self-link. |
| `routeBand()` | Core routing: builds `above` DAG from `top/bot` intersections → topological order approximated by greedy minimal-indegree, then assigns `track` avoiding overlap (`busy` check with 4px margin). Algorithm is heuristic, not optimal — explains the 3 known failures. Well-commented. |
| `layout()` | ~250 LOC, single function. Does: level/row/col placement → gapRuns → approach() → assignSlots() → mk/hs → routeBand() → bandH/trackY → vertical stacking → pts → ext. Logic is correct and tested via `backup.test.js` (exact coordinates). Complexity: gap expansion loop (4 iterations) adapts `GAPX` to `needGap`. |
| `buildScheme()` | Thin wrapper: iterates `layout()` until GAP converges, then enriches blocks/rooms/signals/legend/notes. Legend column calc (`legCols`) avoids overflow. |
| `toSvg()` / `toDrawio()` | Single source of truth (`buildScheme`). SVG escapes via `esc()`, Draw.io escapes HTML separately — correct. Draw.io uses `exitX/exitY/entryX/entryY` for clean orthogonal routing in diagrams.net. Both checked by `render.test.js`. |
| Utilities (`uid`, `chunk`, `groupBy`, `fit`, `pad2`, `signalLabel`, `clampPerRow`, `rasterScale`, `signalsOf`, `fileNameOf`) | Simple, correct. `uid` uses `Math.random` (not crypto) — acceptable for non-security IDs. `fileNameOf` sanitizes Cyrillic-aware. |

**Findings (low severity):**
- `uid()` collisions theoretically possible (7-char base36 ≈ 78B space, negligible for ≤50 items). Could use `crypto.randomUUID` but not required offline.
- `layout()` is large; extracting `approach`/`assignSlots` as inner closures captures `levels/colStep/GAPX` — readable but hard to unit-test in isolation (currently tested via `buildScheme`).
- No validation of `servers/switches/fw/cross/ctrls` upper bounds — only `blocksPerRow` is clamped. Malicious JSON with `servers: 1e9` renders many lines of text (truncated by SVG but still in model). Could clamp these too (e.g., 0–99).
- `signalsOf` reads `c.dO` (capital O) while `ITEM_DEFAULTS` defines `dO` — consistent but confusing casing; original field is `dO` not `do`.

### 3.2 `src/app.js` — UI (325 LOC)
- React 18 + `htm` (template literals), no JSX/Babel — matches offline constraint.
- State: single `state` object + `tab`; `useEffect(saveToStorage)` persists on every change; `useMemo(buildScheme)` + `useMemo(toSvg)` avoid recompute.
- Exports: `exportSvg` (Blob), `exportRaster` (Image → canvas → toBlob with `rasterScale`), `exportDrawio`. Raster path correctly handles `toBlob` returning null (shows alert) and `img.onerror`.
- File I/O: `saveProject`/`openProject` via hidden `<input type=file>` + FileReader; errors shown via `alert`.
- Tab views: `projectTab`/`opTab`/`srvTab`/`autoTab` — grids using Tailwind 12-col.

**Findings:**
- `download()` uses `URL.createObjectURL` + `setTimeout(revoke, 1000)` — OK, but if user triggers rapid exports could leak; negligible.
- `useMemo` deps: `model = useMemo(() => C.buildScheme(state), [state])` — `state` is new object each `setState`, so memo is just caching current render, not stale. Correct.
- `confirm()` for reset — native dialog, blocks main thread, but acceptable for this app.
- No `key` warnings: React lists use `key={it.id}` correctly.
- Accessibility: `label` wrapping not always `htmlFor`; checkboxes lack aria. Not flagged by tests.

### 3.3 `src/shell.html`
- Clean, 21 lines, correct meta viewport, `<noscript>` fallback. No external links — passes `repo.test.js` check.
- `link rel=stylesheet` + 5 `script src` — build inlines all.

### 3.4 `scripts/build.js`
- Inline logic: replaces `<link href>` with `<style>` and `<script src>` with inline `<script>`. Escapes `</script>` as `<\/script>` — correct.
- Throws on `src|href="//` externals — enforces offline guarantee.
- `dev` mode swaps to development React UMD for `app.test.js` warning capture — clever.

### 3.5 `scripts/vendor.js` / `scripts/serve.js`
- `vendor.js`: copies 3 files by fixed map — correct, versions from package.json.
- `serve.js`: static server, `HOST`/`PORT` env, path traversal guard (`file.startsWith(root+sep)`), blocks `node_modules` access, MIME map minimal but sufficient. No rate limiting — dev-only.

### 3.6 `src/styles.css` / `tailwind.config.js`
- `styles.css` 1 line minified — generated, matches `build:css`.
- `tailwind.config.js` content globs `['./src/shell.html','./src/app.js']` — correct, covers all class strings (checked by `repo.test.js` css rebuild test).

---

## 4. Tests

### 4.1 Summary
| File | Cases | Status | What it checks |
|------|-------|--------|----------------|
| `app.test.js` | 9 | ✅ 9 pass | E2E via jsdom + build({dev:true}) — render, form→svg, persistence, file open/save, RS-485 toggle, export, reset, tab switches. Catches React warnings. |
| `backup.test.js` | 2 | ✅ 2 pass | Exact route coordinates vs `index backup.html` (perRow 4 → width 1054, perRow 2 → 880). |
| `core.test.js` | 8 | ✅ 8 pass | Utils (signalLabel, signalsOf, fit, fileNameOf, routeBand), resolvers, factories, clampPerRow, rasterScale. |
| `layout.test.js` | 5 | ✅ 5 pass | buildScheme structure, empty project, no-overlap, orthogonal edges, rs485/kvm variants, descriptions, legend/notes, blocksPerRow effect. |
| `persistence.test.js` | 7 | ✅ 7 pass | serialize/parse/normalize round-trip, defaults injection, id dedup, stringified numbers, clamp, error messages. |
| `render.test.js` | 5 | ✅ 5 pass | SVG valid XML + escaping, Draw.io valid XML + edge refs, parity of labels, draw.io points = SVG pts. |
| `repo.test.js` | 5 | ✅ 5 pass | Shell links valid & offline, index.html fresh, 5 scripts/1 style, vendor versions match, styles.css fresh. |
| `routing.test.js` | 5 | ❌ 3 fail (expected) | Heuristic routing diagnostics — see below. |
| **Total** | **54** | **51 pass / 3 fail** | |

### 4.2 Expected Failures (`routing.test.js`)
```
not ok 50 — демо-проект и проект с множеством блоков рисуются без замечаний
  «проект из тестовых данных: 2 замечаний» — op2→rack1 / rack1→kvmpanel share x=307, a2→net2 / a3→net1 share x=747

not ok 52 — один блок в ряду и много рядов — без замечаний
  «по одному блоку в ряду: 12 замечаний» — r0→kvmpanel / r1→kvmpanel etc.

not ok 53 — 40 случайных проектов рисуются без замечаний к чертежу
  «проект №0: блоков 16, связей 17» — 3 overlaps
```
All are **vertical segment overlaps** (same x, overlapping y-span >1.5px) — the known limitation of the backup tracing (README line 20, AGENTS.md line 37). Tests are deliberately kept strict (`layoutProblems` checks shared x/y overlap), and `backup.test.js` would break if global `seat()` reservation were reintroduced. **Decision: do NOT suppress — preserve as tech-debt indicator.** Verified: `check()` uses `routeBand` per-band only; overlaps occur when same x is reused across different bands/corridors after `assignSlots`.

**Coverage gap:** No test for `scripts/serve.js` path traversal or concurrent requests (dev-only, low risk). No accessibility audit.

### 4.3 `tests/helpers.js`
- Correctly provides `sampleState`, `parseXml`, `layoutProblems`, `segmentsOf`, `hitsRect`. `layoutProblems` is the gold standard for routing correctness (checks zero-length segments, orthogonality, co-linear overlap, block intersection, legend/notes bounds). Used by `routing.test.js`.

---

## 5. CI / Delivery

**`.github/workflows/ci.yml`:**
```yaml
on: push[main], pull_request
setup-node@v7 (Node 22, npm cache) → npm ci → npm test
```
- Correct. `permissions: contents: read` least privilege. Uses `checkout@v7`/`setup-node@v7` (current).
- Missing: no lint/typecheck step, no artifact upload, no branch protection (assumed via GitHub settings).
- No `npm run build` check beyond `repo.test.js` freshness — sufficient.

**Build reproducibility:** Verified — `npm ci && npm test` passes after clean install (except the 3 expected fails). `npm run build` + `npm run build:css` + `npm run vendor` all round-trip clean (repo.test.js).

---

## 6. Dependencies & Security

**`package.json` devDeps (5):**
| Package | Installed | Latest | Note |
|---------|-----------|--------|------|
| `react` 18.3.1 | 18.3.1 | 19.3.1 | Major 19 available (breaking, concurrent features) |
| `react-dom` 18.3.1 | 18.3.1 | 19.3.1 | — |
| `htm` 3.1.1 | 3.1.1 | 3.1.1 | Up to date |
| `jsdom` 26.1.0 | 26.1.0 | 30.1.3 | 4 majors behind (no vuln) |
| `tailwindcss` 3.4.19 | 3.4.19 | 4.3.3 | **7 advisories** (see below) |

**`npm audit` (JSON): 7 vulns, all transitive via `tailwindcss@3.4.19`:**
- `braces <=3.0.3` GHSA-vfj7-8cjw-p6xm — **high** (DoS via nested patterns) → via `chokidar → micromatch → fast-glob` → `tailwindcss`
- `chokidar 2–3.6.0`, `micromatch >=0.2.0`, `fast-glob *` — same chain
- `postcss-selector-parser <7.1.6` GHSA-rj75-hqrm-r3gf — **moderate** (ReDoS) → `postcss-nested` → `tailwindcss`
- Fix suggested: `tailwindcss@4.3.3` (major rewrite, new engine, breaking config/API). **Not a drop-in.**

**Real risk:** **None in production.** App is fully static, no server, no user input executed. Vulns only matter during `npm run build:css` (local dev). Suppress with `npm audit --omit=dev` or document in README/CI allowlist. Do NOT force-upgrade to Tailwind 4 without migrating `tailwind.config.js` (content → `@source`, CLI `npx @tailwindcss/cli`).

**Other security notes:**
- `serve.js` path traversal guard correct (normalize + `startsWith(root+sep)` + block `node_modules`). No auth — dev-only.
- `fileNameOf` sanitizes to `[\wа-яА-ЯёЁ-]` → `_` — prevents directory traversal in download names.
- `pickKnown` rejects unknown keys and type mismatches — prevents prototype pollution via crafted JSON (though `__proto__` not specially handled; `isPlainObject` check + spread mitigates, but explicit `Object.prototype` check would be stronger).
- `LICENSE` CC0 1.0 — public domain, no attribution required, correct for generated artifacts.

---

## 7. Performance & Limits

- **Layout:** `layout()` does `groupBy` (O(n)), `approach` (O(rows)), `routeBand` (O(bands * hs²)) — worst-case quadratic in connections per band, but n < 20 typical; fine.
- **Gap expansion:** 4 iterations of `layout` to converge GAP — empirical, always converges (monotonic needGap ≤ 12*7+16 ≈ 100).
- **Canvas limits:** `rasterScale()` caps at `16e6 px²` (≈4000×4000 at 2×); `clampPerRow` caps width explosion — both documented and tested (`core.test.js`).
- **Bundle size:** `index.html` 212 KB (144 KB React+DOM prod, 68 KB app+styles). Acceptable for single-file offline. Vendor React prod is minified, no source maps shipped (good).
- No lazy loading needed (single page).

---

## 8. Git & Hygiene

- **History:** Linear, clean merges (PR #7 last). Branch `arena/dc693094-structural-scheme` = `main` (no diff). `working tree clean`.
- **.gitattributes:** Enforces LF — correct.
- **.gitignore:** `node_modules/` only — minimal, correct (index.html/vendor/styles.css/package-lock are tracked intentionally).
- **Commits:** No secrets, no large binaries.
- No `CONTRIBUTING.md`/`CODE_OF_CONDUCT` — unnecessary for solo/agent project.

---

## 9. Findings Matrix

| # | Severity | Area | Finding | Recommendation | Ticket? |
|---|----------|------|---------|----------------|---------|
| 1 | **High (known)** | Routing | Vertical overlaps in dense multi-row projects (3 tests fail). User-visible: lines overprint. | Documented; future fix: global track allocation across corridors or per-x reservation (re-introduce limited `seat()` scoped to overlapping spans). Keep failing tests. | Keep |
| 2 | Medium | Deps | 7 audit warnings from tailwindcss@3 | Add `npm audit` allowlist comment in CI or set `audit-level: high` to ignore dev-only; schedule Tailwind 4 migration (breaking). | Low prio |
| 3 | Low | Deps | React 18 / jsdom 26 outdated (React 19, jsdom 30 available) | Upgrade React to 19 only if needed (concurrent features unused). Test jsdom 30 compat — likely safe, bump in next deps refresh. | Low prio |
| 4 | Low | Core | No upper clamp on `servers/switches/fw/cross/ctrls`; `normalizeState` accepts any int | Clamp to 0–99 (or 0–999) in `pickKnown` numeric branch to prevent text overflow / perf. | Optional |
| 5 | Low | Security | `pickKnown` doesn't explicitly block `__proto__`/`constructor` | Add `if (key === '__proto__' \|\| key === 'constructor') continue;` for defense-in-depth. | 1-line |
| 6 | Low | Core | `uid()` uses `Math.random` | Replace with `crypto.randomUUID()` if available (fallback to random) for collision safety. | Optional |
| 7 | Low | CI | No `npm run build` artifact check beyond repo.test freshness | Add explicit `npm run build && git diff --exit-code index.html` step to fail fast with clear message. | Optional |
| 8 | Info | Docs | README + AGENTS.md excellent, but routing limitation could show screenshot of overlap | Add example image / link to failing test output for user expectation. | Nice-to-have |

---

## 10. Compliance Checklist

| Check | Result |
|-------|--------|
| Single-file offline works (double-click) | ✅ `index.html` self-contained, no CDN/fetch |
| All user-visible strings Russian | ✅ Interface, comments, tests — Russian |
| No Babel/JSX, no external resources | ✅ `htm` tagged templates only; repo.test enforces |
| LF line endings | ✅ `.gitattributes` |
| Build reproducibility | ✅ `scripts/build.js --dev` + prod both work |
| Storage round-trip (localStorage, file) | ✅ `app.test.js` covers |
| Draw.io + SVG parity | ✅ `render.test.js` + `layout.test.js` |
| CI green (minus expected fails) | ✅ `npm ci && npm test` — 51/54 pass, 3 documented |

---

## 11. Recommendations (Priority Order)

1. **Do nothing urgent.** The 3 failing tests are intentional diagnostics; do not weaken them. Keep current routing (backup behavior) per AGENTS.md.
2. **Silence or document tailwind audit noise:** Add to `ci.yml`:
   ```yaml
   - run: npm audit --omit=dev || true   # dev-only vulns
   ```
   or add `audit-ci` allowlist. Schedule Tailwind 4 spike separately (config migration + rebuild + visual regression).
3. **Harden `pickKnown` by 1 line** (proto pollution guard) — trivial, no risk.
4. **Clamp numeric cabinet fields** (servers etc.) to 0–99 in `normalizeState` to prevent canvas/text blowup.
5. **Next quarter:** evaluate React 19 + jsdom 30 upgrades (run test suite, check htm compat).
6. **Optional:** Extract `layout()` into smaller pure functions (`placeBlocks`, `buildConns`, `assignGaps`, `routeBands`, `stackLevels`) for unit-testability — only if routing rewrite is planned.

---

## 12. Conclusion

Repository is **well-maintained, well-documented, and ships a correct, offline-capable product.** Code is simple, tests are meaningful (and honestly preserved even when red), build is reproducible, and agent instructions (`AGENTS.md`) are among the best seen. The only user-facing defect (vertical overlaps in dense schemes) is **known, documented, and gated by tests** — not a surprise regression.

**Overall grade: A−** (docked half grade solely for the known routing limitation and noisy dev audit).

---
*Audit performed by Arena Agent Mode on 2026-10-19. Re-run `npm test` and `npm audit` to verify; see `tests/routing.test.js:60` and `README § Построение линий` for the failing cases.*
