# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Full rules live in [AGENTS.md](AGENTS.md). Read that file first — this is a thin Claude-specific wrapper.

## Quick Reference

This is the Storylens browser extension: **WXT** + **React 19** + **Mantine** + **Jotai**.

```bash
bun run dev               # Chrome dev server with hot reload
bun run dev:firefox       # Firefox dev server
bun run typecheck         # always run after changes
bun run orval             # regenerate API client (backend must be running)
bun run i18n:parse        # extract i18n keys after adding translations
bun run check             # Biome lint + format
```

See [AGENTS.md](AGENTS.md) for:
- WXT entry point patterns (globals, imports: false)
- React/Mantine/Jotai component conventions
- API hook usage (React Query, direct calls, mutations)
- Offline mode layers and when to ask the user
- Message passing between extension contexts
