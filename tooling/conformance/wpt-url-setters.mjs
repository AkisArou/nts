// The Web Platform Tests URL setter corpus, against our `URL`.
//
// Each case starts from a URL, assigns to one property, and says what every
// property should read afterwards. That is the part of `URL` with the most
// room for error: a setter re-enters the parser part-way through, and getting
// the entry state wrong produces a URL that is wrong only sometimes.
//
//   node tooling/conformance/wpt-url-setters.mjs
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// `import.meta.dirname` rather than `new URL(import.meta.url)`: this file
// shadows the global `URL` with ours a few lines down, and reaching for it up
// here would be a temporal dead zone rather than a global.
const ROOT = resolve(import.meta.dirname, "../..");
const from = (relative) => join(ROOT, relative);
await import(from("runtime/node/punycode/bindings.node.mjs"));
const { domainToASCII } = await import(from("runtime/node/url/src/idna.ts"));
const P = await import(from("runtime/node/url/src/parser.ts"));
P.setDomainToAscii(domainToASCII);
const { URL } = await import(from("runtime/node/url/src/url.ts"));

const data = JSON.parse(readFileSync(
  from("third_party/node/test/fixtures/wpt/url/resources/setters_tests.json"), "utf8"));

let pass = 0, fail = 0; const failures = [];
for (const [attribute, cases] of Object.entries(data)) {
  if (attribute === "comment") continue;
  for (const c of cases) {
    let url;
    try { url = new URL(c.href); } catch (e) { fail++; failures.push([attribute, c, `construct: ${e.message}`]); continue; }
    try { url[attribute] = c.new_value; } catch (e) { fail++; failures.push([attribute, c, `set: ${e.message}`]); continue; }
    let ok = true, why = "";
    for (const [key, want] of Object.entries(c.expected)) {
      const got = url[key];
      if (got !== want) { ok = false; why += ` ${key}=${JSON.stringify(got)} want ${JSON.stringify(want)}`; }
    }
    if (ok) pass++; else { fail++; failures.push([attribute, c, why]); }
  }
}
console.log(`${pass} pass, ${fail} fail of ${pass + fail}`);
for (const [a, c, why] of failures.slice(0, 20)) {
  console.log(`  ${a}: ${JSON.stringify(c.href)} = ${JSON.stringify(c.new_value)} ::${why}`);
}
