# Formal V9 browser smoke

Formal V9 browser smoke uses Playwright's bundled Chromium on the dedicated origin
`http://127.0.0.1:41739`. The configuration does not select an installed Chrome or Edge channel,
does not use `launchPersistentContext`, and does not provide a user data directory.

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
pre-mutation backup evidence, and active Runtime Gate evidence. Run it with:

```sh
npm run test:browser
```

Playwright closes only its disposable contexts and temporary browser profile. Generated traces,
screenshots and reports are ignored by Git. Recovery, multi-tab revision conflicts, conflict policy,
term boundaries, all OneOff purposes/time modes, live resource editing, and comprehensive A/B
resolution remain separate follow-up coverage.
