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
- `src/lib/analytics/` sends Google Analytics 4 events through the Measurement Protocol from the background worker (MV3 forbids remote `gtag.js`). See [Analytics events](#analytics-events) for the tracking rules and event catalog.
- Biome is configured by `biome.jsonc`; package scripts `check`, `format`, and `lint` write fixes. Use the existing style and run `bun run typecheck` after implementation changes.

## API and offline data

`orval.config.ts` generates React Query endpoints and schemas into `src/api/generated/` from the running backend's `/openapi.json`. Import generated types and functions from those paths; do not edit generated files manually. The custom Axios client is `src/api/axios-instance.ts`. Use query hooks in React UI and the existing direct/proxied API flow in extension contexts.

Offline data spans `src/lib/offline/db.ts` (Dexie), `download.ts`, `hooks.ts`, `sync-engine.ts`, and `sync-storage.ts`. When changing a persisted field used by forms, lists, downloads, or API responses, check every affected layer and ask if intended offline behavior is unclear. Keep temporary IDs, queued operations, and downloaded novel data consistent. Background sync and badge behavior live alongside those layers. Count all unresolved operations, including in-flight writes. Manual sync must report failed or skipped uploads and failed pulls, retain unresolved writes, and explicitly retry exhausted operations; do not show success for incomplete sync. Aliases and versions have separate sync endpoints.

For a field that needs offline support, update its row type and store, download bundle, sync payload, mutation hooks, popup form/list, and localization as applicable. Check the queue and temporary ID mapping for writes. UI-only state does not need to enter the offline store.

## Analytics events

Popup and content scripts call `trackEvent()` from `src/lib/analytics/client.ts`, which forwards a typed `trackAnalyticsEvent` message; background code calls `trackAnalyticsEvent()` from `background.ts`. Do not call GA directly from UI code. Analytics is inactive unless `WXT_GA_MEASUREMENT_ID` and `WXT_GA_API_SECRET` are set at build time, users can opt out in General settings (`storylens-analytics-enabled`), and development builds post to GA's debug endpoint and log validation results.

Keep events in step with features as part of every task, without being asked:

- **Add** an event when a task adds a user-facing feature or a meaningful user action (a new screen or popup route, a new action button, a new AI or sync flow, a new setting). Track the action once, at the point it succeeds or is requested, not on every render or retry.
- **Update** an event's name or parameters when the tracked flow changes shape, and **delete** its `trackEvent()` call when the feature or action is removed. Do not leave calls for code paths that no longer exist.
- Use `snake_case` names of the form `<object>_<action>` (for example `novel_page_view`, `ai_summary_requested`); prefer GA4's recommended names (`page_view`, `login`, `sign_up`) when one fits. Keep names at most 40 characters and parameters at most 25 per event, with string, number, or boolean values.
- Only send anonymous, non-content parameters: never page text, selected text, novel or chapter titles, slugs, full URLs, keywords, prompts, emails, or account IDs. A hostname, route name, count, enum-like option, or boolean is fine.
- Update the catalog below in the same change as every added, renamed, or removed event. It must match the code; check with `rg "trackEvent\(|trackAnalyticsEvent\(" src`.

| Event | Parameters | Sent from |
| --- | --- | --- |
| `extension_install` | none | `background/index.ts` `runtime.onInstalled` |
| `extension_update` | `previous_version` | `background/index.ts` `runtime.onInstalled` |
| `page_view` | `page_title`, `page_location` (popup route), `embedded` | `popup/routers.tsx` on route change |
| `novel_page_view` | `website` (hostname), `has_chapter` | `content/main.ts` after reporting a detected novel |
| `ai_summary_requested` | `effort` | `content/main.ts` `summarizePage` handler |

Every event also carries `session_id`, `engagement_time_msec`, and `extension_version`, added in `background.ts`.

## Commands

From this directory: `bun run dev`, `bun run dev:firefox`, `bun run build`, `bun run build:firefox`, `bun run zip`, `bun run zip:firefox`, `bun run typecheck`, `bun run orval`, and `bun run i18n:parse`. Run the backend first for Orval and ensure `WXT_API_URL` points to it; the checked-in development example uses port 7001 while the backend default is 3000.

Keep this file and the [extension guide](../../docs/extension.md) current when extension rules, entry points, commands, or behavior change, following the root maintenance rule.
