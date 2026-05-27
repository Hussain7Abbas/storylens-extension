# AGENTS.md — Storylens Extension

Generic AI agent rules for `apps/extension` (WXT + React browser extension). Also see the [root AGENTS.md](../../AGENTS.md) for monorepo-wide rules.

## Self-Maintenance Rule

**Whenever you add entry points, change state management patterns, add offline layers, or alter conventions, update this file before finishing the task.**

---

## Overview

Browser extension built with **WXT** framework and **React 19**. Targets Chrome and Firefox. UI uses **Mantine** components, global state via **Jotai**, routing via **React Router**, and API calls via **Orval-generated React Query hooks**.

```
src/
├── entrypoints/
│   ├── background.ts         # service worker
│   ├── content.ts            # content script (page injection)
│   ├── popup/                # main popup shell + routing
│   ├── popup.home/           # home tab with coloring/replacing sub-tabs
│   ├── popup.profile/        # profile page
│   └── popup.settings/       # settings page
├── components/               # shared React components
├── hooks/                    # shared React hooks
└── lib/
    └── offline/              # offline mode: download, sync-engine, hooks
        ├── download.ts
        ├── sync-engine.ts
        └── hooks.ts

public/
└── _locales/                 # i18n message files (en, ar, ...)
```

---

## Commands (run from `apps/extension/`)

```bash
bun run dev               # Chrome development with hot reload
bun run dev:firefox       # Firefox development
bun run build             # Chrome production build
bun run build:firefox     # Firefox production build
bun run zip               # build + zip for Chrome
bun run zip:firefox       # build + zip for Firefox
bun run typecheck         # TypeScript check
bun run orval             # regenerate API client from backend OpenAPI spec
bun run i18n:parse        # extract i18n keys from source
bun run check             # Biome lint + format
```

---

## WXT Framework Patterns

### Entry Points

WXT globals (`defineBackground`, `defineContentScript`, `browser`) are **available without imports**.

```typescript
// background.ts
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message) => { ... });
});

// content.ts
export default defineContentScript({
  matches: ["*://*/*"],
  main() { /* DOM manipulation */ },
});
```

Popup entry points are regular React apps mounted with `createRoot`.

### Imports Disabled

`wxt.config.ts` sets `imports: false` — all imports must be written explicitly. There is no auto-import magic.

---

## React Component Patterns

- **Named exports only** — `export function ComponentName()`, no default exports except WXT entry points
- Co-locate styles: `component.tsx` + `component.module.css` + `index.ts` (re-export)
- Use `useForm` from `@mantine/form` for all form state
- Use `useState` / `useCallback` / `useMemo` for local component state

### Mantine UI

```typescript
import { Button, Stack, Group, TextInput, Select } from "@mantine/core";

// Vertical layout
<Stack gap="xs">...</Stack>

// Horizontal layout  
<Group mt="md" grow>...</Group>

// Colors: color="green.7", color="red.7"
```

### Global State (Jotai)

Use Jotai atoms for state shared across components or entry points. Prefer atomic state over large global stores. Persist cross-session state via `browser.storage`.

### Internationalization

```typescript
import { useTranslation } from "react-i18next";
const { t } = useTranslation();

// Nested keys: t('coloring.name'), t('coloring.category')
// Common actions: t('_.add'), t('_.delete'), t('_.search')
```

Translation files live in `public/_locales/`. After adding keys, run `bun run i18n:parse`.

---

## API Integration

The `@repo/api` package contains **Orval-generated React Query hooks** from the backend's OpenAPI spec. Regenerate with `bun run orval` (backend must be running).

### In Popup Components (React Query hooks)

```typescript
import { useGetKeywords } from "@repo/api/keywords.js";
import type { Keyword } from "@prisma/client";

const { isLoading, data, error } = useGetKeywords<{ data: { data: Keyword[] } }>({
  page: "1",
  limit: "10",
  search: debouncedSearch,
});

// Safe access
const items = data?.data?.data ?? [];
```

### In Content Scripts / Background (direct API calls)

```typescript
import { getNovels } from "@repo/api/novels.ts";

const response = await getNovels();
```

### Mutations

```typescript
import { usePostKeywords } from "@repo/api/keywords.js";

const mutation = usePostKeywords({
  mutation: {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["keywords"] }),
  },
});

mutation.mutate({ data: { name, categoryId, natureId } });
```

### QueryClient Setup

Create `QueryClient` inside the App component (not module scope) to avoid cross-popup state leakage.

---

## Offline Mode

When adding or changing a **persisted field** (Prisma schema, API body/response, extension forms, list cards), **ask the user** before implementing:

> Should this field support **offline mode** (download bundles, offline edits, pending-ops sync queue)?

### If yes — update all offline layers:

1. **Dexie row type / store** — usually automatic if using full generated API types
2. **Download bundle** — `src/lib/offline/download.ts`
3. **Sync payload** — `src/lib/offline/sync-engine.ts` push handlers
4. **Offline mutation hooks** — `src/lib/offline/hooks.ts`
5. **Popup form + list UI** — show/hide field appropriately offline
6. **i18n labels** — add translation keys if user-facing

Run `bun run typecheck` after completing offline changes.

### Triggers (always ask)

- New column on `Keyword`, `Replacement`, `Novel`, or related models
- New form input in coloring/replacing tabs or novel CRUD
- New nested object on API list/detail responses used by the extension
- New filter/sort field on offline-backed lists

### Triggers (offline usually not needed)

- Backend-only admin fields never shown in the extension
- Ephemeral UI state (search text, tab selection)

---

## Message Passing

```typescript
// popup → background
const response = await browser.runtime.sendMessage({ type: "FETCH_DATA", params });

// background listener
browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === "FETCH_DATA") {
    const data = await getResource(message.params);
    sendResponse({ success: true, data });
  }
});
```

---

## Routing

React Router handles navigation within the popup. Route config is in `src/entrypoints/popup/routers.tsx`. Custom routing hook: `src/hooks/useRoutes.tsx`.

---

## Build & Distribution

- Chrome: standard extension format
- Firefox: `-b firefox` flag in WXT commands
- Icons processed by `@wxt-dev/auto-icons`
- Static assets + locales from `public/` are automatically included
