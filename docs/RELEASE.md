# Lynvo Release Checklist

Use this checklist before publishing a VS Code Marketplace or Open VSX build.

## Preflight

```bash
npm ci
npm test
npm run package
npx --no-install vsce package --no-dependencies
```

Expected result:

- TypeScript passes in strict mode.
- ESLint passes for `src`.
- Persistence, Git sync, skill installer, and webview regression checks pass using isolated fixtures.
- The smoke test reports `Lynvo smoke checks passed.`
- `lynvo-1.0.2.vsix` is generated.
- The VSIX contents include only metadata, the bundled `SKILL.md`, `dist/`, and `media/`.

## Optional Browser Integration Check

```bash
npm run test:ui:browser
```

This runs the current React source in Chrome/Chromium headless using a temporary browser profile and synthetic in-memory boards. It checks cancellation, save acknowledgements and errors, stale drafts, project switching, renamed workflow metrics, and maps with 657 and 1,200 tasks. It does not modify bundled `dist/` files or user boards and is separate from `npm test`. If Chrome is unavailable, the check reports a skip; set `LYNVO_CHROME_BIN` to an installed Chrome/Chromium executable to run it. Sandboxed environments may need permission to start the isolated browser process.

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
- On a task with more than three checklist items, expand the preview, toggle a hidden item, and collapse again. Expansion survives data refreshes without writing UI state to task files.
- In Conflicts, Keep all retains local values; Discard all applies remote values. Both clear the displayed unresolved conflicts and preserve individual resolution actions.
- While Conflicts is open, change an existing conflict from another client. A stale resolution must fail visibly and refresh the displayed values without applying the unseen version.
- Create concurrent conflicts for checklist, relation, column, and label changes, then validate local and remote choices. Partial resolution must retain the conflict status until all conflicts are resolved.
- In Table → Map, test a board with at least 650 tasks. All tasks appear on entry and after Fit, without overlap in the default layout. Verify filtering, selection, dragging, linking, zoom/pan, and window resizing.
- Open an existing modular board after updating and verify `.vscode/lynvo/` retains its paths and schema, without creating `.vscode/lynvo.json` or legacy backups.
- In a disposable copy of a board, corrupt `board.json`, a task file, or `tombstones.json`. Loading must stop with an error, preserve the existing files, and never replace them with a default board or an old legacy file. Restore the affected file manually before continuing.
- In a disposable board, use a malformed task ID or invalid field shape. Validation must reject it before writing outside the board or updating existing files.
- Table, Activity, Conflict, Label, and Insight views open.
- Markdown descriptions render lists, code, links, and quotes.
- Edit checklist and relations in a task editor, then Cancel: no changes should be saved. Save applies all draft fields together. A failed save or a stale draft leaves the editor open with an error.
- Rename the default Done and In Progress columns; Insights must retain their default workflow meaning.
- Hide and reveal the panel while editing; the draft remains available. Open another workspace and verify that the previous draft is not applied to it.
- `Lynvo: Create Task from Selection` stores file and line references.
- `Lynvo: Sync Team Board` writes only to `lynvo-sync`.
- The active Git branch is unchanged after sync.
- With two isolated clients, edit different fields of the same task and synchronize: both changes survive. Edit the same field incompatibly: both versions are available in Conflicts. Repeat for checklist/relation items and columns/labels.
- Edit while a sync is fetching and while it is pushing: the edit survives, and any change not included in the successful push remains pending.
- Simulate a concurrent remote push: Lynvo fetches and merges before retrying. A hanging Git process times out, and deactivating the extension cancels active sync work.
- Delete a populated column and synchronize with an older client: the deleted tasks must not reappear and references to them are removed.
- Verify that updates do not rewrite unchanged task files or overwrite existing `settings.json` contents.
- Use disposable agent instruction directories to test installation and upgrade. Existing Copilot/Cursor/Windsurf project instructions and customized Lynvo skills must survive both automatic and manual installation. Open a second project and verify its instructions are installed independently.
- In a multi-root workspace, verify each enabled folder receives its skills while a folder with automatic installation disabled stays untouched. Open the same board through a directory symlink in another window and verify their writes share one lock.

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

## Dependency Review

When the registry is reachable, run `npm audit --audit-level=high`, review runtime and development findings, and verify the contents of the packaged VSIX. Record any unresolved advisories alongside the release validation.
