# EveRemapPlanner (EVE Remap Planner)

A single-page EVE Online skill-plan calculator. Paste a skill plan and it:

- finds the best attribute remap (0, 1 or 2 remaps, implants +0 to +5),
- orders the queue shortest-first while respecting prerequisites,
- lists missing prerequisites and suggests support skills,
- builds a skill list from an EFT fit (Minimum / Good / Elite),
- copies the result back to the game as a skill plan.

Skill data (ranks, attributes, prerequisites) comes from the EVE static data export (npm package `@eveshipfit/sde`). The UI is English by default with a flag button for Polish. All inputs are saved in the browser's localStorage.

## Files

- `remap-planner.html`: the full app in one file (open it in a browser).
- `engine.js`: the calculation engine (skill data, plan parsing, remap, ordering), no DOM.
- `exe-src/`: a Go wrapper that embeds the HTML, serves it on `127.0.0.1:47321` and opens it in Edge/Chrome `--app` mode. It closes when the window is closed or after 3 minutes without a ping.

## Tests

Needs Node.js 20 or newer, no packages:

```
node --test tests/engine.test.js
```

The tests load the skill data from `remap-planner.html` and the engine from `engine.js`. The page has its own copy of the engine, so after changing `engine.js` copy it into the page too (one test checks this).

## Building the exe

```
cd exe-src
cp ../remap-planner.html .
go install github.com/tc-hib/go-winres@v0.3.3
go-winres make --arch amd64
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H windowsgui -s -w" -o EveRemapPlanner.exe .
```
