/**
 * Expense Log loader: paste this ONCE into the sheet's Apps Script project (Extensions > Apps Script), replacing the
 * old code, and deploy a new version of the existing deployment. From then on every request runs the newest script
 * published at cc-expenses.pages.dev, so there is nothing to update or redeploy again.
 *
 * Your key stays where it already is (Script Properties). On a brand-new sheet, put it on the API_KEY line below once.
 */
var API_KEY = 'PASTE-YOUR-SECRET-KEY-HERE';
var CORE_URL = 'https://cc-expenses.pages.dev/apps-script/Api.gs';

function doGet(e) { return core_().doGet(e); }
function doPost(e) { return core_().doPost(e); }

// The published script, kept for 5 minutes. If the site can't be reached, the last copy that worked is used.
function core_() {
  var cache = CacheService.getScriptCache();
  var src = cache.get('core');
  if (!src) {
    try {
      var res = UrlFetchApp.fetch(CORE_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
      var text = res.getResponseCode() === 200 ? res.getContentText() : '';
      if (text.indexOf('function doPost') >= 0 && /var SCRIPT_VERSION = \d+;/.test(text)) {
        src = text;
        cache.put('core', src, 300);
        cache.put('core_last', src, 21600);
      }
    } catch (err) { /* offline: fall back below */ }
    if (!src) src = cache.get('core_last');
    if (!src) throw new Error('Could not load the Expense Log script from ' + CORE_URL);
  }
  if (API_KEY && API_KEY !== 'PASTE-YOUR-SECRET-KEY-HERE') {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('API_KEY') !== API_KEY) props.setProperty('API_KEY', API_KEY);
  }
  return new Function('LOADED_BY_LOADER', src + '\nreturn { doGet: doGet, doPost: doPost };')(true);
}
