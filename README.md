# Story Lens Extension

Browser extension for Story Lens, built with [WXT](https://wxt.dev/) and React.

## Getting Started

Complete the monorepo setup first from the repository root:

```bash
make init-env
make setup
make dev
```

Or run the extension on its own after dependencies and the database are ready:

```bash
# From the monorepo root
make dev-extension        # Chrome
make dev-firefox          # Firefox
```

You can also run targets directly from this directory:

```bash
cd apps/extension
make dev                  # Chrome
make dev-firefox          # Firefox
```

## Development Commands

Run from `apps/extension/` or use the root Makefile aliases (`make dev-extension`, `make dev-firefox`, etc.).

| Command | Description |
| --- | --- |
| `make dev` | Start the Chrome extension dev server (WXT) |
| `make dev-firefox` | Start the Firefox extension dev server |
| `make build` | Production build for Chrome |
| `make build-firefox` | Production build for Firefox |
| `make zip` | Build and zip the Chrome extension for distribution |
| `make zip-firefox` | Build and zip the Firefox extension for distribution |
| `make typecheck` | Type-check the extension |
| `make i18n-parse` | Extract i18n keys from source files |
| `make help` | Show all extension Make targets |

From the monorepo root, `make i18n-parse` and `make zip` / `make zip-firefox` delegate to this Makefile.
