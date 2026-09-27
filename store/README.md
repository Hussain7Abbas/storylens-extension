# Chrome Web Store copy

Use the matching language files for each store localization. English files without a language suffix predate the Arabic set and remain the English dashboard drafts.

| Purpose | English | Arabic |
| --- | --- | --- |
| Name, short and detailed descriptions | [listing.en.txt](listing.en.txt) | [listing.ar.txt](listing.ar.txt) |
| Privacy policy draft | [privacy-policy.en.txt](privacy-policy.en.txt) | [privacy-policy.ar.txt](privacy-policy.ar.txt) |
| Data use fields | [data-disclosure.txt](data-disclosure.txt) | [data-disclosure.ar.txt](data-disclosure.ar.txt) |
| Permission explanations | [permission-justification.txt](permission-justification.txt) | [permission-justification.ar.txt](permission-justification.ar.txt) |
| Submission notes | [submission-package.txt](submission-package.txt) | [submission-package.ar.txt](submission-package.ar.txt) |

The public privacy policy URLs used in the store dashboard are [English](https://storylens.iscoded.com/en/privacy/) and [Arabic](https://storylens.iscoded.com/ar/privacy/). Keep those website pages and these drafts aligned. The extension's manifest short descriptions are in `public/_locales/en/messages.json` and `public/_locales/ar/messages.json`. The [store asset guide](../../../docs/chrome-store/README.md) documents screenshots and videos for both languages.

Usage analytics is conditional on build configuration and defaults to enabled when configured. A switch in General settings stops future events. Events are pseudonymous and a supported novel-page event includes the reading site's hostname. Review the [event catalog](../AGENTS.md#analytics-events) and release configuration before copying privacy answers into the dashboard.
