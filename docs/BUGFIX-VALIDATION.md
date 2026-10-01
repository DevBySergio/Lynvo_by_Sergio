# Bug fix validation — 1.0.2

Validated locally on 2026-10-01. The board schema remains `2.0.0` and the existing `.vscode/lynvo/` layout is unchanged. Opening an older modular board does not rewrite it or create a legacy file. Genuine legacy-only boards retain the existing migration behavior.

## Audit closure

| Audit item | Result | Regression coverage |
| --- | --- | --- |
| 1. Edits lost during fetch/push | Reload before merge; newer edits remain pending after push | Sync, persistence |
| 2. Damaged board replaced by legacy/default | Loading fails and preserves originals; no fallback from an existing modular root | Persistence |
| 3. Whole-task timestamp merge loses fields | Merge task fields and checklist/relation items against the shared Git baseline | Sync |
| 4. Deleted column tasks reappear | Task tombstones and reference cleanup; honor older column deletions | Persistence, sync |
| 5. Agent instructions overwritten | Preserve unrelated/customized content; update only owned content | Skills |
| 6. IDs write outside board | Validate paths, reserved names, collisions and UTF-8 filenames before saving | Persistence, sync |
| 7. False/reopened conflicts | Shared baseline, stable resolutions, pending alternatives and reversed-pair handling | Sync |
| 8. Bulk accepts an unseen conflict version | Validate every full snapshot before applying any decision | Persistence, UI |
| 9. Remote columns/labels overwritten | Merge their fields and expose incompatible changes | Sync |
| 10. Secondary edits lack timestamps | Touch every task affected by reorder/reference/label cleanup | Persistence |
| 11. Partial resolution reports wrong status | Remain in conflict status until all open conflicts are resolved | Persistence, UI |
| 12. Invalid JSON crashes UI or deletes files | Normalize older optional values; reject damaged shapes and preserve files | Persistence |
| 13. Stale editor/save failure loses draft | Expected task version and operation acknowledgement; preserve failed drafts | Persistence, UI, browser |
| 14. Renamed workflow columns break metrics | Recognize default workflow IDs before title aliases | UI, browser |
| 15. Cancel saves checklist/relations | Keep editor changes in the draft; Save writes fields together | UI, browser |
| 16. Skills missing in other projects | Inspect each destination and each enabled workspace folder | Skills |
| 17. Partial reads and whole-board rewrites | Serialize reads/writes across hosts; write changed files only; preserve competing external edits | Persistence, locks |
| 18. Hanging Git/rejected push | Timeout, cancellation and fetch/merge/recommit before retry | Sync |
| 19. Initial navigation sent too early | Deliver requested view after the webview readiness message | UI, VS Code host |
| 20. Multi-folder code/board mismatch | Capture operation origin, use the selected file's folder, and refresh the active board | Persistence, UI, VS Code host |
| 21. Documentation promises missing features | Correct table ordering, label management and Markdown descriptions | README, SKILL |

Additional cases found during integration include equivalent NFC/NFD filenames, malformed UTF-16 IDs, duplicate Git tree entries, schema metadata validation, and conflicts changing during subsequent syncs. These have regression coverage. Backend cloning avoids requiring newer globals than the declared VS Code minimum; VS Code moved its Node runtime from 16 to 18 in [version 1.82](https://code.visualstudio.com/updates/v1_82).

## Completed checks

- `npm run check`: strict TypeScript, ESLint, test compilation, development/production bundles, all five regression suites, and activation smoke checks.
- Persistence fixtures: corrupted and older boards, legacy-only migration, IDs and Unicode, external edits, stale drafts/conflicts, workspace capture, 1,200-task changed-file writes, cross-process locks and crash recovery.
- Real Git with two isolated clones: independent and incompatible edits, pending resolutions, deletions, edits during fetch/push, rejected pushes, rewritten remote history, Unicode blobs/filenames, timeouts and cancellation.
- Skill fixtures: shared/customized instructions, upgrades, force mode, uninstall, retries, external changes and multiple workspace folders.
- Chrome headless with an isolated profile: 16 real DOM assertions for drafts, Save/Cancel/errors, metrics, project changes and maps containing all 657/1,200 tasks within the viewport.
- VS Code 1.140.0 with an isolated profile and two synthetic folders: seven host assertions covering activation, Table from folder B, folder-local code references/data, webview readiness and initial Conflicts, and modular boards without legacy creation.

The interactive `Create Task from Selection` prompt was verified with a controlled VS Code API adapter; the native host test verified its folder/reference persistence path without interacting with that modal prompt. Tests ran on macOS; native Windows behavior has not been exercised.

Browser checks are repeatable with `npm run test:ui:browser`. The standard suite runs with `npm test` and does not require a browser. No real user board was used for these fixtures. No Marketplace publishing or Git commit was performed.
