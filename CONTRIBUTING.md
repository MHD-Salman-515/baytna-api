# Contributing

Internal conventions for working in this repo.

## Branching

- `main` is always deployable — no direct commits, changes land via PR.
- Branch names: `<type>/<short-description>`, e.g. `feat/worker-documents-upload`,
  `fix/city-index-migration`, `chore/bump-nestjs`.
- Keep branches scoped to one phase/feature; prefer several small PRs over one large one.

## Commits — Conventional Commits

Every commit message: `<type>(<optional scope>): <summary>`, imperative mood, no trailing period
on the summary line.

| Type | Use for |
|---|---|
| `feat` | A new feature or endpoint |
| `fix` | A bug fix |
| `chore` | Tooling, dependencies, CI, repo hygiene — no `src/` behavior change |
| `refactor` | Restructuring code with no behavior change |
| `docs` | Documentation only |
| `test` | Adding or fixing tests, no production code change |

Examples:

```
feat(cities): add 2dsphere geo query for nearby cities
fix(countries): allow re-creating a country code after soft delete
chore: pin Node version in engines + .nvmrc
```

Body (optional, blank line after the summary) explains *why*, not *what* — the diff already shows
what changed.

## Before opening a PR

```bash
npm run lint
npm run build
npm run test
```

CI (`.github/workflows/ci.yml`) runs the same three on every push and PR to `main` — fix locally
first, it's faster than round-tripping through CI.

## Code conventions

See the README's "Domain conventions" section — in short: money as integers with a currency code,
localized names as `{ ar, en }`, every collection gets timestamps + soft delete via the shared
`BaseSchema`, and nothing country/currency/phone-prefix-specific gets hardcoded (it comes from the
`countries` collection).
