// Which declared classes share a layout, from `nts hir`'s own printing.
//
//   node tooling/conformance/merged-layouts.mjs runtime/node/*/tsconfig.json
//
// Two classes sharing a layout share a descriptor, and `instance_of` compares
// descriptors -- so `new B() instanceof A` answers `true`. Nothing refuses.
// `blockers/two-classes-one-descriptor` holds the rule and its controls.
//
// # It under-reports, and only under-reports
//
// The signal is the `this` parameter of a lowered method, so **a class with no
// constructor and no methods emits no line at all** and is invisible here. Two
// field-less siblings are exactly that shape, and they are one of the two ways
// a layout gets shared -- so an empty result is not "no pairs".
//
// It does not over-report: every group it has named, a differential probe
// confirmed. One-sided in the safe direction, which is the only reason it is
// worth running before the question is settled.
//
// The complementary instrument is the Node lane's shaped-surface sweep, which
// compares own enumerable keys of a no-argument instance. That one *sees*
// field-less siblings and is blind to `#private` fields and to the base. Blind
// in opposite directions, neither a superset of the other.
//
//   func A#constructor(this: managed<obj#1>, ...)
//   func B#constructor(this: managed<obj#1>, ...)
//
// Two class names against one `obj#N` is a merged layout, which is the exact
// condition `instance_of` cannot see past.
import { execFileSync } from "node:child_process";
const [, , ...configs] = process.argv;
for (const config of configs) {
  let out = "";
  try {
    out = execFileSync(process.env.NTS_BIN ?? "./target/release/nts", ["hir", config], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 900_000,
      env: { NTS_TSGO: `${process.cwd()}/target/tsgo`, ...process.env },
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) { out = e.stdout ?? ""; }
  const byLayout = new Map();
  for (const m of out.matchAll(/^func ([A-Za-z_$][\w$]*)#[^(]*\(this: managed<obj#(\d+)>/gm)) {
    const [, cls, layout] = m;
    if (!byLayout.has(layout)) byLayout.set(layout, new Set());
    byLayout.get(layout).add(cls);
  }
  const merged = [...byLayout].filter(([, s]) => s.size > 1);
  const name = config.replace(/.*\/(runtime|blockers)\//, "").replace(/\/tsconfig.json/, "");
  if (!byLayout.size) { console.log(`${name}: no class reached lowering`); continue; }
  console.log(`${name}: ${byLayout.size} layout(s), ${merged.length} shared by more than one class`);
  for (const [layout, set] of merged) console.log(`    obj#${layout}  ${[...set].sort().join(", ")}`);
}
