# Fortissimus — Google Apps Script web app

Standalone (not container-bound) HtmlService web app, managed with
[clasp](https://github.com/google/clasp). Assets (PNG/STL) are served from the
repo root over `raw.githubusercontent.com`, not bundled into the script.

## IDs

- **Script ID:** `1zgsfikErFvWthNIOv7mauEfhedj_Kfm9g_fVaEgI2VpUoOdkyy3a-YI0`
- **Deployment ID (stable — redeploy in place):**
  `AKfycbw3EScITGpaqFkDNS-KtsAIDdEpGx9opD5jpHe6E8TBEXRY8pP8y4AP9BMO66ogui8F`
- **Web app URL:**
  `https://script.google.com/macros/s/AKfycbw3EScITGpaqFkDNS-KtsAIDdEpGx9opD5jpHe6E8TBEXRY8pP8y4AP9BMO66ogui8F/exec`

## Workflow

clasp is run via npx (no global install needed); you must be logged in
(`~/.clasprc.json`).

```bash
cd gas
npx @google/clasp@2.4.2 push --force        # upload local changes

# Redeploy the SAME deployment so the web app URL never changes:
npx @google/clasp@2.4.2 deploy \
  --deploymentId AKfycbw3EScITGpaqFkDNS-KtsAIDdEpGx9opD5jpHe6E8TBEXRY8pP8y4AP9BMO66ogui8F \
  --description "<what changed>"
```

**Do not** run a bare `clasp deploy` — that creates a *new* deployment with a
new URL and leaves the published one stale.

## Files

- `Main.js` — `doGet`, `include()`, and `assetUrl()` (builds raw asset URLs)
- `Index.html` — page template
- `Stylesheet.html` — CSS partial, pulled in via `include()`
- `appsscript.json` — manifest (web app: execute as deploying user, DOMAIN access)

## Notes

- Web app access is currently **DOMAIN** (org only). To let anyone play, change
  `webapp.access` in `appsscript.json` to `ANYONE` or `ANYONE_ANONYMOUS`, then
  push + redeploy.
- `Config.js` is gitignored by convention — keep any secrets there, never in a
  tracked file.
