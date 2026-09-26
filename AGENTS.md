# Extension instructions

Follow [shared repository rules](../../AGENTS.md). This submodule is the WXT browser extension for Chrome and Firefox. See the [extension guide](../../docs/extension.md) for its architecture and behavior.

## Structure and conventions

- `src/entrypoints/background/` owns service worker messaging, API proxying, and sync alarms. `src/entrypoints/content/` handles page detection, highlighting, and the novel-site popup launcher. `popup/`, `popup.home/`, `popup.profile/`, `popup.settings/`, and `options/` supply React UI entry points and screens.
- `src/lib/desktop-client/` owns local AI transport and in-page summaries. Keep this separate from the generated backend API client; background handles the network requests, while the popup gets model/effort choices from the client's capabilities response. Every desktop AI request carries the selected extension language as `responseLanguage`.
- `src/components/`, `src/hooks/`, `src/store/`, and `src/utils/` hold reusable UI, hooks, Jotai atoms, and utilities. Keep related components and styles together; use Mantine components and `@mantine/form` for existing form flows.
- Use `@/` for source imports. WXT entry points and framework configs may need default exports. `wxt.config.ts` sets `imports: false`, so import WXT helpers explicitly from `#imports` or WXT modules as the surrounding file does.
- React UI uses React Router, TanStack Query, Jotai, and i18next. Keep user-visible strings localized. `bun run i18n:parse` writes extracted messages to `src/i18n/messages/`; browser manifest messages live in `public/_locales/`.
- Content-script tooltip text is translated through `tt()` in `src/utils/keyword-tooltip.ts`. Use `getLocalizedName()` for category/nature locale pairs there. Content scripts read locale from `browser.storage.local` (`storylens-locale`), not page `localStorage`.
- The page popup launcher reuses the generated logo icon and saves its position in `browser.storage.local` (`storylens-page-launcher-position`), shared across sites. The General settings Show/Hide preference uses `storylens-page-popup-visible` and updates content scripts immediately. The launcher tucks to the nearest edge within 10 px, leaving 3 px visible, and reveals on pointer proximity or focus. Clamp restored/dragged positions and popup geometry on render and resize; the popup detects the launcher iframe (`window.parent !== window`) and fills it (`html[data-embedded]`) instead of the fixed toolbar size, so popup content must use fluid widths rather than `24rem`; do not use the site's local storage for extension preferences.
- The popup page picker uses typed `selectPageText` messaging and carries the selected text in the popup iframe search query parameter. Keep selection listeners disposable and Escape cancellable. The launcher's hover-revealed `+` action (0.2 s delay) calls the same `selectText()` and opens below the launcher in the top half of the viewport, above it in the bottom half; keep the launcher untucked while that action is visible. Character and replacement lists use `fuzzyMatches` for online and offline search; fetch every online catalogue page before local filtering. Creation forms seed Name/From from search text, and versions seed Description because they have no name field.
- Biome is configured by `biome.jsonc`; package scripts `check`, `format`, and `lint` write fixes. Use the existing style and run `bun run typecheck` after implementation changes.

## API and offline data

`orval.config.ts` generates React Query endpoints and schemas into `src/api/generated/` from the running backend's `/openapi.json`. Import generated types and functions from those paths; do not edit generated files manually. The custom Axios client is `src/api/axios-instance.ts`. Use query hooks in React UI and the existing direct/proxied API flow in extension contexts.

Offline data spans `src/lib/offline/db.ts` (Dexie), `download.ts`, `hooks.ts`, `sync-engine.ts`, and `sync-storage.ts`. When changing a persisted field used by forms, lists, downloads, or API responses, check every affected layer and ask if intended offline behavior is unclear. Keep temporary IDs, queued operations, and downloaded novel data consistent. Background sync and badge behavior live alongside those layers. Count all unresolved operations, including in-flight writes. Manual sync must report failed or skipped uploads and failed pulls, retain unresolved writes, and explicitly retry exhausted operations; do not show success for incomplete sync. Aliases and versions have separate sync endpoints.

For a field that needs offline support, update its row type and store, download bundle, sync payload, mutation hooks, popup form/list, and localization as applicable. Check the queue and temporary ID mapping for writes. UI-only state does not need to enter the offline store.

## Commands

From this directory: `bun run dev`, `bun run dev:firefox`, `bun run build`, `bun run build:firefox`, `bun run zip`, `bun run zip:firefox`, `bun run typecheck`, `bun run orval`, and `bun run i18n:parse`. `make release-chrome` builds the store zip and `make submit-chrome` uploads the current `package.json` version's zip through `wxt submit`. `.github/workflows/publish-chrome.yml` runs both on `v*` tags (the tag must match `package.json`) or by manual dispatch, then dispatches `extension-submitted` to the backend repo, whose workflow sets `Review_Version`. Bump the version before each release. Run the backend first for Orval and ensure `WXT_API_URL` points to it; the checked-in development example uses port 7001 while the backend default is 3000.

Keep this file and the [extension guide](../../docs/extension.md) current when extension rules, entry points, commands, or behavior change, following the root maintenance rule.

General settings exposes locale-matched website, privacy, and terms links on `storylens.iscoded.com`; keep these links and public locale strings synchronized.
