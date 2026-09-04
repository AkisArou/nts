// The Web Platform Tests URL corpus, against our parser.
//
// `urltestdata.json` is the same file node checks `ada` against: some nine
// hundred cases, each an input, a base, and either the expected serialisation
// or a note that parsing must fail. It is the oracle for `runtime/node/url`,
// and a better one than node's own tests -- those check the module's surface,
// this checks the algorithm.
//
//   node tooling/conformance/wpt-url.mjs
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

const data = JSON.parse(readFileSync(
  from("third_party/node/test/fixtures/wpt/url/resources/urltestdata.json"), "utf8"));

let pass = 0, fail = 0, failures = [];
for (const c of data) {
  if (typeof c === "string") continue;
  if (c.base === null && c.input === undefined) continue;
  let record = null, threw = false;
  try {
    const base = c.base == null ? null : P.basicUrlParse(c.base);
    if (c.base != null && base === null) { threw = true; }
    else record = P.basicUrlParse(c.input, base);
    if (record === null) threw = true;
  } catch { threw = true; }

  if (c.failure) {
    if (threw) pass++; else { fail++; failures.push([c, "expected failure, parsed"]); }
    continue;
  }
  if (threw) { fail++; failures.push([c, "expected success, failed"]); continue; }
  const href = P.serializeUrl(record);
  if (href === c.href) pass++;
  else { fail++; failures.push([c, `href ${JSON.stringify(href)} != ${JSON.stringify(c.href)}`]); }
}
console.log(`${pass} pass, ${fail} fail of ${pass + fail}`);
for (const [c, why] of failures.slice(0, 25)) {
  console.log(`  ${JSON.stringify(c.input)} base=${JSON.stringify(c.base)} :: ${why}`);
}
