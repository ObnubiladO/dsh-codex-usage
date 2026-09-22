# dsh-codex-usage

A read-only companion to `dsh-codex-provider`. Displays account-wide **remaining** five-hour and weekly Codex usage in DeepDive's sidebar and in **Settings → Codex usage**. Supports English and Chinese, automatic one-minute refresh while visible, reset timestamps, and separate additional model allowances such as Spark.

## Install

Download [the installable plugin package](https://github.com/ObnubiladO/dsh-codex-usage/releases/download/v0.1.2-preview.8/dsh-codex-usage-0.1.2-preview.8.tgz) from the [preview release](https://github.com/ObnubiladO/dsh-codex-usage/releases/tag/v0.1.2-preview.8).

Requires `dsh-codex-provider` installed and signed in on the same `web` profile. Tested with DeepDive `0.1.18` (DSH `0.1.7-alpha.1`) and provider `0.1.0`. DSH 0.1.7 projects a plugin's Config schema into settings forms and no longer exposes the earlier `settings.register` namespace API, so this release declares the sidebar height as its own Config field and requires that harness generation.

```sh
dsh plugin --profile web add /absolute/path/to/dsh-codex-usage-0.1.2-preview.8.tgz
```

Restart DeepDive after installation if the new sidebar entry does not appear. A desktop-only installation can use its bundled Node executable and `@deepseek-ai/dsh/lib/bin.js` to run the same plugin command; no new DeepDive build is needed.

To remove the companion:

```sh
dsh plugin --profile web remove dsh-codex-usage
```

## What the numbers mean

The expanded sidebar uses large percentages, labeled progress bars, and relative reset times on a neutral background. Each reported window shows “Low” at 10–25% remaining or “Critical” at 10% or less; percentages retain the theme's primary text color. The collapsed sidebar keeps a compact numerical display, with full details in its tooltip. This version is a preview release.

- Remaining percentage is `100 − used_percent`, clamped to 0–100. The display preserves one decimal place when supplied; it cannot recover fractional precision when the endpoint reports whole percentages.
- Windows are matched by their actual duration: 18,000 seconds for five hours and 604,800 seconds for a week. A weekly-only primary window is not mislabeled as five hours.
- Windows the account does not report are hidden in both the sidebar and Settings panel. A reported window whose snapshot has expired or is older than 90 seconds shows a dash until the next automatic refresh. Neither case means 0% or 100%.
- The sidebar follows the selected session's model: `openai-codex/gpt-5.3-codex-spark` shows the separate Spark allowance (`codex_bengalfox`); other models, or no selected session, show the main Codex allowance. Its label identifies the allowance, including in the collapsed sidebar. Switching models or sessions updates the indicator immediately through DSH's shared model-selection store. A missing Spark allowance displays an unavailable status, never the main allowance as a fallback.
- The Settings panel shows every allowance separately. These are account allowances, not session token counts or a promise that every model is available.
- Reset timestamps use the browser's local timezone. The backend caches reads for 30 seconds. HTTP 429 responses pause upstream reads for at least one minute.
- Network and sign-in errors clear the displayed numbers. The provider remains responsible for sign-in and access-token refresh; the companion retries automatically after the provider updates its credential.

## Credentials and transport

The host resolves `OPENAI_CODEX_API_KEY` through DSH's existing credentials service and reads `https://chatgpt.com/backend-api/wham/usage`, scoped by the token's account claim. It never reads or writes refresh tokens, changes model settings, calls an inference endpoint, or persists quota snapshots. The resize preference is this plugin's own `sidebarHeight` settings field on profile entry `codex-usage`, stored with the profile's user settings. Only normalized percentages, reset times, and allowance names reach the browser over DSH's authenticated Remote transport. Requests time out after 10 seconds and are aborted and awaited on unload. Redirects are rejected.

The response format follows [OpenAI Codex's backend client](https://github.com/openai/codex/blob/ac192cd7937b0d73edc6dffe009940ae53782dd4/codex-rs/backend-client/src/client.rs). This is an internal account endpoint and may change. Unsupported payloads display as unavailable.

## Development and validation

```sh
npm run check
npm test
npm pack
```

Validation includes normalization, missing/reordered windows, account changes, caching, HTTP failures, cancellation, and browser response handling. The package was also exercised through the actual bundled DeepDive loader, authenticated HTTP endpoint, browser manifest, sidebar, and Settings panel using a fixture for the external usage API. A separate live read verified the configured provider credential against the real usage endpoint without making an inference request.

This plugin does not modify Harness or `dsh-codex-provider` source. Credentials, conversations, model selection, and token usage are unaffected by the display itself.

Drag the indicator’s top grip upward to enlarge the percentages, bars, and spacing or downward for a compact layout. Focus the grip and use the arrow keys, Home, or End for keyboard resizing. The size persists across DeepDive restarts through DSH settings. The periods are labeled “remaining (5h)” and “remaining (weekly)” beneath the percentages, without separate limit headers. The smallest size ends after these complete labels and hides bars, warning labels, and reset details. Expanding reveals those details. There is no internal scrollbar or unused vertical space; the actual height adapts to labels and available limits. Older saved heights are clamped to the new size range.
