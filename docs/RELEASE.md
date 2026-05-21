# Lynvo Release Checklist

Use this checklist before publishing a VS Code Marketplace or Open VSX build.

## Preflight

```bash
npm install
npm test
npm run package
npx --no-install vsce package --no-dependencies
```

Expected result:

- TypeScript passes in strict mode.
- ESLint passes for `src`.
- The smoke test reports `Lynvo smoke checks passed.`
- `lynvo-0.0.1.vsix` is generated.
- The VSIX contents include only metadata, `dist/`, and `media/`.

## GitHub CI

The repository includes:

- `.github/workflows/ci.yml` for pull request and branch validation.
- `.github/workflows/package.yml` for manually generating a VSIX artifact from GitHub Actions.

Before publishing from GitHub, confirm the CI workflow is green on the release branch.

## Manual Smoke Test

Install the generated VSIX in a clean VS Code window and validate:

- Lynvo appears in the Activity Bar.
- `Lynvo: Open Project Board` opens the board.
- Creating, editing, moving, and deleting tasks updates the UI.
- Checklists and task relations render on task cards.
- Table, Activity, Conflict, Label, and Insight views open.
- Markdown descriptions render lists, code, links, and quotes.
- `Lynvo: Create Task from Selection` stores file and line references.
- `Lynvo: Sync Team Board` writes only to `lynvo-sync`.
- The active Git branch is unchanged after sync.

## GitHub Repository Hygiene

- Do not commit `node_modules/`.
- Do not commit generated `.vsix` files.
- Keep `package-lock.json` committed.
- Keep generated `dist/` committed if publishing directly from the repository.
- Keep `.vscode/lynvo/` out of normal source branches; Lynvo sync owns it through `lynvo-sync`.

## Marketplace Notes

- `package.json` must include `publisher`, `repository`, `license`, `icon`, `keywords`, and command metadata.
- Marketplace icon should remain PNG.
- README images must remain PNG or another Marketplace-supported raster format.
- README must describe Shadow Branch Sync and modular persistence accurately.
- Changelog must include the version being published.

## Known Follow-Up

`npm audit` can report a dev-only transitive `minimatch` advisory through `@typescript-eslint` on older dependency trees. This does not ship in the VSIX runtime bundle. Upgrade `@typescript-eslint/*` once the registry is reachable and rerun `npm audit --audit-level=high`.
