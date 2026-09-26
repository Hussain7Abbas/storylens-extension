# Story Lens Extension

Browser extension for Story Lens, built with [WXT](https://wxt.dev/) and React.

The popup's Desktop client panel can pair with the local [Story Lens Client](../../docs/client.md). Once paired, choose a Claude/Codex model and click **Summarize page** to show the answer on the active website in the extension's selected language. This action works without novel detection or backend login. On a configured novel-site domain, a circular logo button opens the same popup in an overlay. Drag the button to reposition it; its saved position and the popup stay within the viewport.

## Getting Started

Complete the monorepo setup first from the repository root:

```bash
make install
cp apps/backend/.env.example apps/backend/.env
cp apps/extension/.env.example apps/extension/.env
make setup
make dev-backend
make dev-extension
```

The backend defaults to port 3000, while the extension's development API URL
example uses port 7001. Configure `WXT_API_URL` or the backend `PORT` so they
match. See the umbrella [development guide](../../docs/development.md).

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
| `make release-chrome` | Production Chrome Web Store zip |
| `make submit-chrome` | Upload the current version's zip with `wxt submit` (needs `CHROME_*` credentials) |
| `make typecheck` | Type-check the extension |
| `make i18n-parse` | Extract i18n keys from source files |
| `make help` | Show all extension Make targets |

From the umbrella repo root, `make i18n-parse` and `make zip` / `make zip-firefox` delegate to this Makefile.

## License

This project is source available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).

You may use, modify, and share it for **non-commercial purposes** only. Commercial use requires separate permission from the author.

## Website and legal information

[Website](https://storylens.iscoded.com) · [Privacy Policy](https://storylens.iscoded.com/en/privacy/) · [Terms](https://storylens.iscoded.com/en/terms/). Settings → General links to the same pages in the selected extension language.
