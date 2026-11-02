# Changelog

All notable changes to Remap Planner. Adding a new version at the top publishes a GitHub release for it.

## [Unreleased]

- Tests for `engine.js` with Node's built-in test runner (`tests/engine.test.js`): remap results, queue order with prerequisites, shortest-first order, Cybernetics first, implant limit while training Cybernetics, plan parsing, and a check that the engine copy inside `remap-planner.html` matches `engine.js`.
- GitHub Actions workflow running the tests on Node 20 and 22 on every push.
- Known issue, kept as a todo test: choosing 2 remaps for a plan where every skill uses the same attribute pair fails (`bestTwo()` finds no pair of remaps).

## [1.1.0] - 2026-10-28

- English first: the window title, code comments and the Windows app are now in English; Polish stays available with the flag button.
- The page is now `remap-planner.html` and the Windows app is `EveRemapPlanner.exe`.

## [1.0.0] - 2026-10-14

- Paste an EVE skill plan and get the best remap (0, 1 or 2 remaps, implants +0 to +5).
- Orders the queue shortest-first while keeping prerequisites and lists missing prerequisites.
- Fit tab: paste an EFT fit and get the skill list for Minimum, Good or Elite.
- English and Polish UI; Windows app wrapper in exe-src/.
