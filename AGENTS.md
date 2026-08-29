# Repository Guidelines

## Project Structure & Module Organization

The Vite/React application lives in `src/`. `App.tsx` owns controls and growth state; `PlantSvg.tsx` renders the tree. Procedural generation, persistence, rendering, camera logic, and shared types live in `src/plant/`. Invariant checks and performance probes are in `scripts/`. Reference images belong in `assets/`; never edit generated `dist/` output.

## Build, Test, and Development Commands

- `npm ci` installs the locked dependency set.
- `npm run dev` starts the Vite development server with hot reload.
- `npm run build` runs strict TypeScript checking, then creates the production bundle in `dist/`.
- `npm run check` executes deterministic growth and renderer invariants with Node assertions.
- `npm run benchmark:growth` profiles generation and rendering at 10–10,000 epochs.
- `npm run preview` serves the production bundle locally.
- `docker compose up --build` builds and serves the app through nginx on `${PLANT_PORT:-8080}`.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, and React function components. Follow existing style: two-space indentation, single quotes, no semicolons, and trailing commas in multiline structures. Use `PascalCase` for components, classes, and types; `camelCase` for functions and values. Import local modules with `.ts`/`.tsx` extensions. No formatter or linter is configured, so match nearby code.

## Growth Engine Invariants

Treat generated history as immutable: existing branches and leaves retain IDs, geometry, parents, and random traits. Derive randomness from stable keys, not traversal order. Fractional updates should touch only the active epoch, and commits must preserve `(N, 1) == (N+1, 0)`. Renderer budgets must not evict visible structural branches.

## Testing Guidelines

Add focused `node:assert/strict` cases to `scripts/check.ts`. Use fixed seeds and stable signatures. Run `npm run check` and `npm run build`; also benchmark changes to growth storage, iteration, culling, or budgets. There is no coverage threshold, so prioritize behavioral invariants.

## Commit & Pull Request Guidelines

History uses short Russian imperative subjects, for example `Добавить эпохальный рост зрелого дерева`. Keep each commit to one logical change. Pull requests should describe behavior and impact, link an issue when available, list checks run, and include screenshots or a short capture for visual changes. Include benchmark results for performance-sensitive work.
