import { readFileSync } from "node:fs";
import { join } from "node:path";

/* firebase.json stays the source of truth for headers while both hosts run, so
 * the CSP hash for the inline theme script is edited in one place. A change
 * there reaches AWS on the next `cdk deploy`; the CI deploy job fails if the
 * live AWS CSP and firebase.json disagree. */

type Rule = { source?: string; regex?: string; headers: { key: string; value: string }[] };
const hosting = (
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "firebase.json"), "utf8")) as {
    hosting: { headers: Rule[] };
  }
).hosting;

export const PARENT = "lucasfrasca.com";
export const HOST = `hscatarcalculator.${PARENT}`;
export const WWW_HOST = `www.${HOST}`;
export const ZONE_ID = "Z0988444QDQAP0YKUGS2";

/** Firebase's default when no rule sets Cache-Control, and its HSTS max-age (measured). */
export const DEFAULT_CACHE_CONTROL = "max-age=3600";
export const HSTS_MAX_AGE_SECONDS = 31556926;

/** The headers every response gets: the `**` rule, keys lower-cased. */
export function globalHeaders(): Record<string, string> {
  const rule = hosting.headers.find((r) => r.source === "**");
  if (!rule) throw new Error('firebase.json has no "**" header rule');
  return Object.fromEntries(rule.headers.map((h) => [h.key.toLowerCase(), h.value]));
}

/** Cache-Control rules in firebase.json order; later matches win, as on Firebase. */
export function cacheRules(): { regex: string; value: string }[] {
  return hosting.headers.flatMap((r) => {
    const cc = r.headers.find((h) => h.key.toLowerCase() === "cache-control");
    if (!cc) return [];
    if (!r.regex) throw new Error(`Cache-Control rule must use "regex": ${r.source}`);
    return [{ regex: r.regex, value: cc.value }];
  });
}

/** Viewer request: www goes to the main address, keeping path and query. */
export function viewerRequestCode(): string {
  return `var HOST=${JSON.stringify(HOST)};
function qs(q){var p=[];for(var k in q){var v=q[k];if(v.multiValue){v.multiValue.forEach(function(m){p.push(k+'='+m.value)})}else{p.push(v.value?k+'='+v.value:k)}}return p.length?'?'+p.join('&'):''}
function handler(event){var r=event.request,h=r.headers.host;
if(h&&h.value!==HOST&&h.value==='www.'+HOST)return{statusCode:301,statusDescription:'Moved Permanently',headers:{location:{value:'https://'+HOST+r.uri+qs(r.querystring)}}};
return r}`;
}

/** Viewer response: Cache-Control by path, from firebase.json. Errors are
 *  no-cache, as Firebase sends them (measured), so a 404 is never kept. */
export function viewerResponseCode(): string {
  const rules = cacheRules()
    .map((r) => `[new RegExp(${JSON.stringify(r.regex)}),${JSON.stringify(r.value)}]`)
    .join(",");
  return `var RULES=[${rules}];
function handler(event){var u=event.request.uri,v=${JSON.stringify(DEFAULT_CACHE_CONTROL)};
if(event.response.statusCode>=400)v='no-cache';
else for(var i=RULES.length-1;i>=0;i--){if(RULES[i][0].test(u)){v=RULES[i][1];break}}
event.response.headers['cache-control']={value:v};
return event.response}`;
}
