/**
 * Fortissimus — standalone web app entry point.
 *
 * Assets (boards, event cards, tokens, dice, STLs) live in the GitHub repo
 * and are served over raw.githubusercontent.com so the client can load them
 * directly without bundling anything into the Apps Script project.
 */

// Base URL for the repo's asset files. Change the branch here if needed.
var ASSET_BASE = 'https://raw.githubusercontent.com/lanseroo/Fortissimus/main/';

/** Serve the web app. */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Fortissimus')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Include another HTML file's contents (for CSS/JS partials). */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Full raw-URL for a named asset, e.g. assetUrl('ColosseumBoard.png'). */
function assetUrl(name) {
  return ASSET_BASE + name;
}
