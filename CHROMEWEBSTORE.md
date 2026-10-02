# Chrome Web Store Listing — StoryLens

Last updated: 2026-10-02

## Store listing

**Extension name:** StoryLens (the English manifest name).

**Short description:** Track characters, aliases, and chapter notes while reading web novels. Highlight terms, replace names, and build your glossary.

**Detailed descriptions:** Copy the current text from [English](store/listing.en.txt) or [Arabic](store/listing.ar.txt). Those files also hold the localized short descriptions, support details, and single-purpose text.

**Category draft:** Productivity. **Primary language:** English; Arabic localization is also available.

**Single purpose:** Improve web-novel reading through character reference highlighting, replacement rules, chapter recognition and user-requested summaries.

## Graphics and assets

The umbrella repository's [asset guide](../../docs/chrome-store/README.md) documents the original sample chapter, isolated profile, reproduction commands and verified live behavior.

| Asset | Dimensions | File | Status |
| --- | --- | --- | --- |
| Store icon | 128 × 128 PNG | `.output/chrome-mv3/icons/128.png` after build | Available |
| Screenshot 1 | 1280 × 800 RGB PNG | `../../docs/chrome-store/assets/01-character-highlighting.png` | Ready |
| Screenshot 2 | 1280 × 800 RGB PNG | `../../docs/chrome-store/assets/02-character-aliases.png` | Ready |
| Screenshot 3 | 1280 × 800 RGB PNG | `../../docs/chrome-store/assets/03-chapter-versions.png` | Ready |
| Screenshot 4 | 1280 × 800 RGB PNG | `../../docs/chrome-store/assets/04-text-replacement.png` | Ready |
| Screenshot 5 | 1280 × 800 RGB PNG | `../../docs/chrome-store/assets/05-character-editor.png` | Ready |
| Promotional video | 1280 × 800 H.264 MP4 | `../../docs/chrome-store/assets/storylens-demo.mp4` | Upload to YouTube; enter URL in dashboard |
| Small promotional tile | 440 × 280 | Not prepared in this task | Required for a new listing |
| Marquee tile | 1400 × 560 | Not prepared in this task | Optional |

### Arabic localized assets

The matching Arabic set is in `../../docs/chrome-store/assets/ar/`, using the same five PNG filenames, `storylens-demo.mp4` and `storylens-demo.srt`. The interface, original chapter, sample reference entries and video captions are Arabic, with right-to-left layout. Upload these to the Arabic localization and use a separate Arabic YouTube video URL. The English set remains available in `assets/`. The umbrella asset guide documents separate and bilingual ZIP downloads and the `--ar` reproduction commands.

Screenshots are direct captures of the production build from the working tree using fictional local catalogue entries. The video demonstrates a real offline edit and refreshed tooltip. AI results are not shown.

## Permissions justification

| Permission or scope | Reason |
| --- | --- |
| `tabs` | Detect the active reading page and chapter, refresh highlights and open account pages on the website. |
| `storage` | Keep preferences, session, desktop pairing settings, selector cache and sync state. |
| `alarms` | Schedule synchronization of downloaded reference data and queued edits. |
| `unlimitedStorage` | Keep downloaded novel reference catalogues without the standard extension storage quota. |
| `https://storylens-api.iscoded.com/*` | Load references/selectors, account and lens billing services, cloud AI requests and sync edits. |
| `http://127.0.0.1/*` | Connect to the user's authenticated local desktop companion for requested AI actions. |
| `https://www.google-analytics.com/*` | Send anonymous usage events when analytics is configured and enabled. |
| HTTP(S) page content scripts | Detect supported reading pages and apply highlights, replacements and the in-page launcher. The account bridge is limited to the configured website origin. |

These are the production scopes. Development also grants localhost access. The manifest uses no remotely hosted extension scripts; companion/provider output is data. Match disclosures to the actual release configuration.

## Privacy and data use

Use the [English](store/data-disclosure.txt) or [Arabic](store/data-disclosure.ar.txt) dashboard draft and the matching [public English](https://storylens.iscoded.com/en/privacy/) or [public Arabic](https://storylens.iscoded.com/ar/privacy/) policy when completing the dashboard. The matching store policy drafts are [English](store/privacy-policy.en.txt) and [Arabic](store/privacy-policy.ar.txt). Owner review remains necessary before submission.

| Data category | Use and transmission |
| --- | --- |
| Account identifiers and authentication | Session stored locally; account services on the Story Lens API. Website handles sign-in. |
| Reference content | Catalogue data downloaded locally; contributed keywords, notes and replacements synchronize to the shared API. |
| Website content | Requested Cloud actions send relevant page/chapter text, names, descriptions, prompts and page outlines through the developer API to OpenRouter/providers; novel research uses Exa. Desktop uses the paired companion. Cloud content is not retained in usage records; separately saved references/images are. |
| User activity and supported-site hostnames | Pseudonymous feature events and detected reading-site hostnames can reach Google Analytics if configured; the user preference controls analytics. Disclose web history because a hostname identifies a visited site. |
| Billing contacts and transactions | Lens requests store email, WhatsApp/Telegram contact, amounts, quotes and review status; Resend sends account/billing emails. Direct operator payment; no card/bank credentials. |
| Uploaded images | User-requested images use the service's image upload provider. |
| Security and network diagnostics | Necessary service operation as described by the privacy policy. |

Do not claim that all data stays local: account, shared catalogue, analytics, image upload and requested AI flows have different transmission paths. Existing policy states that data is not sold, used for ads or used for credit/lending purposes. No store certifications have been submitted by this asset task.

## Links and distribution

**Privacy:** https://storylens.iscoded.com/en/privacy/

**Homepage and support:** https://storylens.iscoded.com

Publisher identity, contact email, visibility and regions must match the owner account's dashboard settings; this task did not change them.

## Version history and review notes

The original captured build was version 2.0.3. On 2026-09-27, screenshots and a demonstration video were prepared; the extension version was unchanged; local database reads and mutations were fixed to run while offline. Store submission/review status was not checked or changed.

On 2026-09-28, a matching Arabic screenshot and video set was added. No additional extension behavior changed for this localization task.

On 2026-09-28, the English and Arabic listing and privacy drafts were aligned with the extension's configured Google Analytics flow and linked public privacy policies. The extension behavior and version did not change.

For release steps see [the publishing runbook](../../docs/publishing.md). New listings still require the small promotional tile and completion of owner/dashboard fields. The AI companion is a separate installation; supported-page detection depends on available site selectors.

3.4.0 preparation — 2026-10-02: Story Lens Cloud and non-expiring lenses, the free desktop alternative, source selection, balance/menu UI and install sign-in handoff. Bilingual store drafts and privacy mirrors updated; no release or store submission performed. Both language store and website captures were refreshed from the current production build (package version 3.3.1) on 2026-10-02, showing the new navbar and priced image action. Owner review and store form submission remain pending.
