# Formal V9 browser smoke

Formal V9 browser smoke uses Playwright's bundled Chromium on the dedicated origin
`http://127.0.0.1:41739`. The configuration does not select an installed Chrome or Edge channel,
does not use `launchPersistentContext`, and does not provide a user data directory.
The suite remains fully parallel with four workers; eight concurrent Chromium workers exceeded the
verified Windows runner capacity and caused scattered default-timeout terminations without a shared
product path, while the same batches passed at one to four workers. Assertions and timeouts are unchanged.

Every test receives a newly created `BrowserContext`. Test setup proves context isolation by writing
a non-product sentinel in a separate disposable context and confirming it is absent from the test
context at the same origin. The test then confirms that no `aster-timetable-*` or `toki-v9-*`
evidence exists before the Formal V9 flow begins. Tests never clear or remove LocalStorage.

The fixture follows the production contracts:

1. Open the formal entry with `?runtime=formal` on the test-only origin.
2. Confirm the existing Fresh Modal, which calls `initializeFreshV9` and re-runs the Runtime Gate.
3. Build a legal document with the existing V9 domain builders and validator.
4. Persist it with `persistAppDataV9`, retaining the real activation attempt ID and revision receipt.
5. Reload and require the production Runtime Gate and V9 Host to become active again.

The initial smoke covers OneOff create, reload, edit, reload, high-risk delete, reload, exact
pre-mutation backup evidence, and active Runtime Gate evidence. The regression suite additionally covers:

- fixed, moved, cancelled and OneOff conflict previews and submissions;
- all three OneOff purposes, period/custom time, and non-blocking Meeting/Activity overlap;
- two-page stale revision protection inside one disposable context;
- EVERY/A/B anchor resolution, cross-year term boundaries and Timetable isolation;
- permanent-update history, future override rebinding and high-risk backup evidence; and
- permanent-end history, inclusive cessation, future-override rejection, stale editor protection,
  exact high-risk backup evidence and active Runtime Gate after reload; and
- permanent A/B swap history/future resolution, safe future-override rebinding, unsafe rebind
  rejection, exact high-risk backup failure behavior, reload and stale editor protection; and
- Recovery exact-raw export, focus, cross-page storage events and snapshot invalidation.

R4-1D-3B adds `formal-v9-swap.spec.ts` on the same isolated fixture. It proves same-day UI
swap → reload → grouped revoke, one revision per atomic operation, card-to-card cross-date intent
in the displayed resolved week, OneOff fail-closed preview, verified V9 readback/Runtime Gate
evidence, and a stale swap editor after another page commits. R4-1D-3C reuses the existing
LessonEditor target-date field to add cross-A/B selection without changing the drag interaction.
The isolated browser spec additionally proves A→B swap → reload → grouped revoke → reload, B→A,
cross-A/B OneOff rejection, stale-page fail-closed behavior, reciprocal overrides, exact +1 revisions,
verified persistence evidence and an active Runtime Gate.

R4-1D-4B adds `formal-v9-permanent-end.spec.ts` without changing the fixture or browser profile.
It proves the existing LessonEditor end flow writes exactly one revision, retains a resolvable
historical occurrence, removes occurrences from the inclusive end date, reloads with valid write
evidence and active Runtime Gate, and records the exact old V9 raw under
`permanently-end-lesson`. Separate cases prove that a future Override is rejected at preview with
no revision or backup, and that a preview opened before another page's verified mutation becomes
read-only without overwriting the newer document.

R4-1D-4C adds `formal-v9-permanent-swap.spec.ts` on the same disposable fixture and existing
LessonEditor. It proves an A/B permanent swap from a date that is not either lesson's occurrence,
history and future resolution after reload, unchanged series patterns, revision +1, exact old raw
under `permanently-swap-lessons`, verified persistence evidence and an active Runtime Gate. Separate
cases prove safe future Override weekday/version rebinding, rejection when a OneOff makes that
rebind unsafe, no document mutation when pre-backup persistence fails, and two-page stale-editor
fail-closed behavior.

Run all browser tests with:

```sh
npm run test:browser
```

Playwright closes only its disposable contexts and temporary browser profile. Generated traces,
screenshots and reports are ignored by Git. Live Subject/Class resource editing, corrupted or
ambiguous Recovery evidence, and legacy-browser compatibility remain separate follow-up coverage.
