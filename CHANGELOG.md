# Changelog

All notable changes to Remap Planner. Adding a new version at the top publishes a GitHub release for it.

## [Unreleased]

- Suggestions (Plan and Fit tabs) go up to IV in one step; V is offered on its own once you have IV. A skill at III is now suggested as IV, not V.
- Fit tab suggestions also offer the next skill level: at Minimum what Good adds, at Good what Elite adds, and at Elite the fit's skills still below V. Before this, Good and Elite usually showed "Nothing to add".
- Fit tab: a "You may be missing" panel suggests support skills (fitting, navigation, targeting, weapon and drone support, Cybernetics) for the fit, using the same rules as the Plan tab. Click + to add one to the fit; added skills appear in an "Added by you" group with their prerequisites and are cleared when another fit is pasted.
- Pages workflow: upload and deploy run in separate jobs, so the deploy no longer fails with "No artifacts named github-pages".
- Fit tab: implants and boosters from an EFT or Pyfa fit (1,308 types, category 20 from the SDE) are now recognised instead of being listed as "Not recognised". Their required skills, such as Cybernetics and Biology, show in a new "Implants and boosters" group, with a test.
- "Export plan" button next to "Copy whole plan": downloads the plan as `remap-plan.txt` (in the page language, Windows line endings).
- `planText()` in the engine: the plan as plain text (plan time, each remap with its attributes, then the numbered queue as `Skill level` lines that can be pasted back), with tests.
- Tests for `engine.js` with Node's built-in test runner (`tests/engine.test.js`): remap results, queue order with prerequisites, shortest-first order, Cybernetics first, implant limit while training Cybernetics, plan parsing, and a check that the engine copy inside `remap-planner.html` matches `engine.js`.
- GitHub Actions workflow running the tests on Node 20 and 22 on every push.
- Fixed: choosing 2 remaps for a plan where every skill uses the same attribute pair crashed; it now falls back to a single remap.
- The Windows wrapper only answers requests addressed to `127.0.0.1:47321` (DNS-rebinding protection).
- CI also vets and builds the Windows wrapper; a Pages workflow publishes a live demo.
- MIT license, screenshots and a rewritten README.

## [1.1.0] - 2026-10-28

- English first: the window title, code comments and the Windows app are now in English; Polish stays available with the flag button.
- The page is now `remap-planner.html` and the Windows app is `EveRemapPlanner.exe`.

## [1.0.0] - 2026-10-14

- Paste an EVE skill plan and get the best remap (0, 1 or 2 remaps, implants +0 to +5).
- Orders the queue shortest-first while keeping prerequisites and lists missing prerequisites.
- Fit tab: paste an EFT fit and get the skill list for Minimum, Good or Elite.
- English and Polish UI; Windows app wrapper in exe-src/.
