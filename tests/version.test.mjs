// The app's expected script version must match apps-script/Api.gs, or the self-update would loop or never run.
import fs from 'fs';
const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const gs = fs.readFileSync(new URL('../apps-script/Api.gs', import.meta.url), 'utf8');
const a = +/const SCRIPT_LATEST = (\d+);/.exec(app)[1];
const g = +/var SCRIPT_VERSION = (\d+);/.exec(gs)[1];
const mf = JSON.parse(fs.readFileSync(new URL('../apps-script/appsscript.json', import.meta.url), 'utf8'));
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok  :', m); };
ok(a === g, `app expects script v${a}, Api.gs is v${g}`);
ok(/var UPDATE_URL = 'https:\/\/cc-expenses\.pages\.dev\/apps-script\/Api\.gs';/.test(gs), 'updates come from the public Cloudflare address');
ok(['script.projects', 'script.deployments', 'script.external_request'].every((x) => mf.oauthScopes.some((s) => s.endsWith(x))), 'appsscript.json has the self-update permissions');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
