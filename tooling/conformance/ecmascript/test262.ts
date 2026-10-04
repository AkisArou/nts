// Host validation of shared ECMAScript builtins using the pinned Test262
// corpus. This does not claim compiled builtin conformance: the compiler lane's
// ordinary Test262 runner owns that. Regexp literals are adapted so they
// construct our implementation instead of silently exercising Node's engine.
//
// node tooling/conformance/ecmascript/test262.ts [--under test/built-ins/RegExp]
//      [--filter substring] [--limit N] [--rows target/regexp-test262.jsonl]
//      [--sabotage]
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { Parser } from "acorn";
import { icuHost } from "./icu-host.ts";

// Each candidate module must execute in the test's realm. Otherwise captures
// have Node's Array.prototype and host-thrown TypeErrors have the wrong brand.
if (typeof vm.SourceTextModule !== "function") {
  const child = spawnSync(
    process.execPath,
    ["--experimental-vm-modules", process.argv[1]!, ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  process.exit(child.status ?? 2);
}

const root = resolve(import.meta.dirname, "../../..");
const suite = resolve(root, "third_party/test262");
const argv = process.argv.slice(2);
function option(name: string, fallback: string): string {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : (argv[index + 1] ?? fallback);
}
const under = option("--under", "test/built-ins/RegExp");
const profile = option(
  "--profile",
  under.includes("/intl402/")
    ? "intl"
    : under.includes("/Temporal")
      ? "temporal"
      : under.includes("/Date")
        ? "date"
        : "regexp",
);
if (profile !== "date" && profile !== "regexp" && profile !== "temporal" && profile !== "intl")
  throw new Error("Unknown candidate profile: " + profile);
const filter = option("--filter", "");
const limit = Number(option("--limit", "0"));
const rowsPath = option("--rows", "target/" + profile + "-test262.jsonl");
const sabotage = argv.includes("--sabotage");
const timeout = Number(option("--timeout", "30000"));
const intlProvider = profile === "intl" || argv.includes("--icu") ? icuHost(root) : undefined;
if (intlProvider) process.on("exit", () => intlProvider.close());
const sources = new Map<string, string>();
async function candidate(context: vm.Context): Promise<vm.Module["namespace"]> {
  const modules = new Map<string, vm.SourceTextModule>();
  function moduleFor(path: string): vm.SourceTextModule {
    const cached = modules.get(path);
    if (cached) return cached;
    let source = sources.get(path);
    if (source === undefined) {
      source = stripTypeScriptTypes(readFileSync(path, "utf8"));
      sources.set(path, source);
    }
    const module = new vm.SourceTextModule(source, { context, identifier: path });
    modules.set(path, module);
    return module;
  }
  const builtins = moduleFor(resolve(root, "runtime/ecmascript/src/" + profile + "/builtins.ts"));
  await builtins.link((specifier, importer) =>
    moduleFor(resolve(dirname(importer.identifier), specifier)),
  );
  await builtins.evaluate({ timeout });
  if (profile === "temporal" && intlProvider) {
    const time = moduleFor(resolve(root, "runtime/ecmascript/src/time/zone-source.ts"));
    await time.link((specifier, importer) =>
      moduleFor(resolve(dirname(importer.identifier), specifier)),
    );
    await time.evaluate({ timeout });
    context.__time = {
      TimeZoneContext: time.namespace.TimeZoneContext,
      TimeZoneRegistry: moduleFor(resolve(root, "runtime/ecmascript/src/time/zone-id.ts")).namespace
        .TimeZoneRegistry,
    };
  }
  if (profile === "intl")
    context.__temporal = moduleFor(
      resolve(root, "runtime/ecmascript/src/temporal/builtins.ts"),
    ).namespace;
  return builtins.namespace;
}

// Acorn decides lexical boundaries (division, comments, strings, templates).
// Candidate syntax acceptance is exclusively decided by our parser. Acorn's
// optional native Literal.value is ignored; it is never used as a matcher.
class LiteralTokenizer extends Parser {
  validateRegExpFlags(): void {}
  validateRegExpPattern(): void {}
}
interface Literal {
  start: number;
  end: number;
  pattern: string;
  flags: string;
}
function literals(text: string): Literal[] {
  const found: Literal[] = [];
  const tokenizer = LiteralTokenizer.tokenizer(text, { ecmaVersion: "latest" });
  for (const token of tokenizer) {
    if (token.type.label === "regexp") {
      const value = (token as typeof token & { value: { pattern: string; flags: string } }).value;
      found.push({
        start: token.start,
        end: token.end,
        pattern: value.pattern,
        flags: value.flags,
      });
    }
  }
  return found;
}
function adapt(text: string): { text: string; literals: Literal[] } {
  if (profile !== "regexp") return { text, literals: [] };
  const found = literals(text);
  let from = 0;
  let result = "";
  for (const literal of found) {
    result +=
      text.slice(from, literal.start) +
      "new __NtsRegExp(" +
      JSON.stringify(literal.pattern) +
      "," +
      JSON.stringify(literal.flags) +
      ")";
    from = literal.end;
  }
  return { text: result + text.slice(from), literals: found };
}

interface Selection {
  path: string;
  schedule: string;
  reason?: string;
  variant_id?: string;
  strict_prefix?: string;
  includes: string[];
  features: string[];
  source_hash: string;
  negative?: { phase: string; error_type: string };
}
interface Row {
  path: string;
  variant?: string;
  sourceHash: string;
  verdict: string;
  reason?: string;
  literalCount?: number;
  constructions?: number;
  executions?: number;
}
const selection: Selection[] = execFileSync(
  resolve(root, "target/release/nts-test262-protocol"),
  ["select", suite, under],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Selection);
const rows: Row[] = [];
let attempted = 0;
for (const selected of selection) {
  if (!selected.path.includes(filter)) continue;
  if (limit > 0 && attempted >= limit) break;
  const row: Row = {
    path: selected.path,
    variant: selected.variant_id,
    sourceHash: selected.source_hash,
    verdict: "unsupported",
  };
  rows.push(row);
  if (selected.schedule !== "planned") {
    row.verdict = selected.schedule;
    row.reason = selected.reason;
    continue;
  }
  if (selected.variant_id?.endsWith("#module")) {
    row.reason = "adapter:module";
    continue;
  }
  if (selected.includes.includes("detachArrayBuffer.js")) {
    row.reason = "adapter:host-facility";
    continue;
  }
  attempted++;
  const stats = { constructions: 0, executions: 0 };
  const context = vm.createContext({
    __stats: stats,
    __sabotage: sabotage,
    console,
    print: () => {},
    __clock: () => Date.now(),
    __intlData: intlProvider?.data,
    __intlNumberOpen: intlProvider?.openNumber,
    __intlCollatorOpen: intlProvider?.openCollator,
    __intlPatternOpen: intlProvider?.openPatterns,
    __intlDateOpen: intlProvider?.openDate,
    __intlRelativeOpen: intlProvider?.openRelative,
    __intlPluralOpen: intlProvider?.openPlural,
    __intlDisplayOpen: intlProvider?.openDisplay,
    __intlSegmentOpen: intlProvider?.openSegmenter,
    __timeZoneOpen: intlProvider?.openTimeZone,
  });
  context.__impl = await candidate(context);
  if (profile === "intl") {
    intlProvider!.reset();
    new vm.Script(`
      (() => {
      const resolver = new __impl.LocaleResolver(__intlData);
      const timeZones = new __impl.TimeZoneRegistry(__intlData);
      const values = new __impl.SupportedValues(__intlData, timeZones);
      class NumberFormat extends __impl.NtsNumberFormat {
        constructor(locales, options) { super(resolver, __intlNumberOpen, locales, options); }
        static supportedLocalesOf(locales, options) { return __impl.supportedLocalesOf(resolver, locales, options); }
      }
      class Locale extends __impl.NtsLocale {
        constructor(tag, options) { super(__intlData, tag, options); }
      }
      class Collator extends __impl.NtsCollator {
        constructor(locales, options) { super(resolver, __intlCollatorOpen, locales, options); }
        static supportedLocalesOf(locales, options) { return __impl.supportedLocalesOf(resolver, locales, options); }
      }
      class DateTimeFormat extends __impl.NtsDateTimeFormat {
        constructor(locales, options) { super(resolver, timeZones, __intlPatternOpen, __intlDateOpen, __clock, locales, options); }
        static supportedLocalesOf(locales, options) { return __impl.supportedLocalesOf(resolver, locales, options); }
      }
      class ListFormat extends __impl.NtsListFormat {
        constructor(locales = undefined, options) { super(resolver, locales, options); }
        static supportedLocalesOf(locales, options = undefined) { return __impl.supportedLocalesOf(resolver, locales, options); }
      }
      class RelativeTimeFormat extends __impl.NtsRelativeTimeFormat {
        constructor(locales = undefined, options) { super(resolver, __intlRelativeOpen, locales, options); }
        static supportedLocalesOf(locales, options = undefined) { return __impl.supportedLocalesOf(resolver, locales, options); }
      }
      class PluralRules extends __impl.NtsPluralRules {
        constructor(locales = undefined, options) { super(resolver, __intlPluralOpen, locales, options); }
        static supportedLocalesOf(locales, options = undefined) { return __impl.supportedLocalesOf(resolver, locales, options); }
      }
      class DurationFormat extends __impl.NtsDurationFormat {
        constructor(locales = undefined, options) { super(resolver, __intlNumberOpen, locales, options); }
        static supportedLocalesOf(locales, options = undefined) { return __impl.supportedLocalesOf(resolver, locales, options); }
      }
      class DisplayNames extends __impl.NtsDisplayNames {
        constructor(locales, options) { super(resolver, __intlDisplayOpen, locales, options); }
        static supportedLocalesOf(locales, options = undefined) { return __impl.supportedLocalesOf(resolver, locales, options); }
      }
      class Segmenter extends __impl.NtsSegmenter {
        constructor(locales = undefined, options) { super(resolver, __intlSegmentOpen, locales, options); }
        static supportedLocalesOf(locales, options = undefined) { return __impl.supportedLocalesOf(resolver, locales, options); }
      }
      globalThis.Intl = {
        NumberFormat, Locale, Collator, DateTimeFormat, ListFormat, RelativeTimeFormat, PluralRules, DurationFormat, DisplayNames, Segmenter,
        getCanonicalLocales(locales) { return __impl.getCanonicalLocales(__intlData, locales); },
        supportedValuesOf(key) { return values.of(key); },
      };
      globalThis.Temporal = __temporal;
      if (__sabotage) {
        NumberFormat.prototype.formatToParts = function() { return []; };
        const originalSegment = Segmenter.prototype.segment;
        Segmenter.prototype.segment = function(input) { return originalSegment.call(this, ""); };
      }
      })();
    `).runInContext(context, { timeout });
  } else if (profile === "temporal") {
    intlProvider?.reset();
    new vm.Script(`
      Object.defineProperty(globalThis, "Temporal", { value: __impl, writable: true, configurable: true });
      if (__timeZoneOpen) {
        const timeZones = new __time.TimeZoneContext(new __time.TimeZoneRegistry(__intlData), __timeZoneOpen);
        const original = Temporal.Instant.prototype.toString;
        // Host-only binding of the same explicit environment argument used by
        // compiled standard integration; no process-global production state.
        Temporal.Instant.prototype.toString = {
          toString(options = undefined) { return original.call(this, options, timeZones); },
        }.toString;
      }
      if (__sabotage) Temporal.Instant.prototype.equals = function equals() { return false; };
    `).runInContext(context, { timeout });
  } else if (profile === "date") {
    new vm.Script(`
      // Host-only wiring of the typed candidate. There is no native Date
      // constructor or parser fallback; missing APIs remain visible failures.
      class Date extends __impl.NtsDate {
        constructor(value, month, day, hour, minute, second, millisecond) {
          const count = arguments.length;
          super(count === 0 ? __clock() : count > 1 ?
            __impl.NtsDate.UTC(Number(value), Number(month), count > 2 ? Number(day) : 1,
              count > 3 ? Number(hour) : 0, count > 4 ? Number(minute) : 0,
              count > 5 ? Number(second) : 0, count > 6 ? Number(millisecond) : 0) :
            value instanceof __impl.NtsDate ? value.getTime() :
            typeof value === "string" ? __impl.NtsDate.parse(value) : Number(value));
        }
        static now() { return __clock(); }
      }
      globalThis.Date = Date;
      if (__sabotage) Date.prototype.getTime = function getTime() { return 123; };
    `).runInContext(context, { timeout });
  } else
    new vm.Script(`
    "use strict";
    const ImplRegExp = __impl.NtsRegExp;
    const originalExec = ImplRegExp.prototype.exec;
    function RegExp(pattern, flags) {
      ++__stats.constructions;
      const regexpInput = __impl.isRegExp(pattern);
      if (!new.target && regexpInput && flags === undefined && pattern.constructor === RegExp) return pattern;
      return Reflect.construct(ImplRegExp, [pattern, flags, regexpInput], new.target || RegExp);
    }
    Object.defineProperty(RegExp, 'prototype', { value: ImplRegExp.prototype, writable: false });
    Object.defineProperty(RegExp.prototype, 'constructor', { configurable: true, writable: true, value: RegExp });
    Object.defineProperty(RegExp, 'escape', Object.getOwnPropertyDescriptor(ImplRegExp, 'escape'));
    Object.defineProperty(RegExp, Symbol.species, Object.getOwnPropertyDescriptor(ImplRegExp, Symbol.species));
    RegExp.prototype.exec = { exec(input) {
      ++__stats.executions;
      return __sabotage ? null : Reflect.apply(originalExec, this, [input]);
    } }.exec;
    Object.defineProperties(String.prototype, {
      match: { configurable: true, writable: true, value: { match(regexp) { return __impl.stringMatch(this, regexp); } }.match },
      matchAll: { configurable: true, writable: true, value: { matchAll(regexp) { return __impl.stringMatchAll(this, regexp); } }.matchAll },
      search: { configurable: true, writable: true, value: { search(regexp) { return __impl.stringSearch(this, regexp); } }.search },
      replace: { configurable: true, writable: true, value: { replace(search, replacement) { return __impl.stringReplace(this, search, replacement); } }.replace },
      replaceAll: { configurable: true, writable: true, value: { replaceAll(search, replacement) { return __impl.stringReplaceAll(this, search, replacement); } }.replaceAll },
      split: { configurable: true, writable: true, value: { split(separator, limit) { return __impl.stringSplit(this, separator, limit); } }.split },
    });
    const __NtsRegExp = RegExp;
  `).runInContext(context, { timeout });
  // eval tests can contain regexp literals too. This adapter supports global
  // eval only; it does not pretend to reproduce direct-eval lexical scope.
  context.eval = (text: unknown) => {
    if (typeof text !== "string") return text;
    try {
      return new vm.Script(adapt(text).text).runInContext(context, { timeout });
    } catch (error) {
      // Tokenizer and Script-construction errors originate in the driver.
      // Deliver the equivalent error in the caller's realm, as eval does.
      if (error instanceof SyntaxError) {
        context.__syntaxErrorMessage = error.message;
        throw new vm.Script("new SyntaxError(__syntaxErrorMessage)").runInContext(context);
      }
      throw error;
    }
  };
  try {
    const source = readFileSync(resolve(suite, selected.path), "utf8");
    const adapted = adapt(source);
    row.literalCount = adapted.literals.length;
    if (selected.negative?.phase === "parse") {
      // A literal's early syntax error belongs to candidate compilation, not
      // the host parser. No assertions or test statements run for this arm.
      if (adapted.literals.length === 0) {
        row.reason = "adapter:non-regexp-parse-negative";
        continue;
      }
      try {
        new vm.Script((selected.strict_prefix ?? "") + adapted.text);
      } catch {
        row.reason = "adapter:javascript-lexical-or-parse-negative";
        continue;
      }
      let rejected = false;
      for (const literal of adapted.literals) {
        try {
          new vm.Script(
            "new __NtsRegExp(" +
              JSON.stringify(literal.pattern) +
              "," +
              JSON.stringify(literal.flags) +
              ")",
          ).runInContext(context, { timeout });
        } catch (error) {
          if (
            (error as Error).name === "SyntaxError" &&
            selected.negative.error_type === "SyntaxError"
          )
            rejected = true;
          else throw error;
        }
      }
      row.verdict = rejected ? "host-pass" : "fail";
      if (!rejected) row.reason = "candidate accepted invalid regexp literal";
    } else {
      for (const include of ["sta.js", "assert.js", ...selected.includes]) {
        const harness = readFileSync(resolve(suite, "harness", include), "utf8");
        new vm.Script(adapt(harness).text, { filename: include }).runInContext(context, {
          timeout,
        });
      }
      let thrown: unknown;
      try {
        new vm.Script((selected.strict_prefix ?? "") + adapted.text, {
          filename: selected.path,
        }).runInContext(context, { timeout });
      } catch (error) {
        thrown = error;
      }
      if (selected.negative) {
        row.verdict =
          thrown !== undefined && (thrown as Error).name === selected.negative.error_type
            ? "host-pass"
            : "fail";
      } else row.verdict = thrown === undefined ? "host-pass" : "fail";
      if (row.verdict === "fail")
        row.reason = thrown === undefined ? "expected an exception" : String(thrown);
    }
  } catch (error) {
    row.verdict = selected.negative?.phase === "parse" ? "unsupported" : "fail";
    row.reason =
      (selected.negative?.phase === "parse" ? "adapter:literal-lexing: " : "") + String(error);
  } finally {
    row.constructions = stats.constructions;
    row.executions = stats.executions;
  }
  if (attempted % 100 === 0)
    process.stderr.write(`Test262 host adapter: ${attempted} attempted (${selected.path})\n`);
}
mkdirSync(dirname(resolve(root, rowsPath)), { recursive: true });
writeFileSync(resolve(root, rowsPath), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
const counts: Record<string, number> = {};
intlProvider?.close();
for (const row of rows) counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
console.log(
  JSON.stringify({
    mode: "adapted-Test262-host",
    suiteRevision: execFileSync("git", ["-C", suite, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    under,
    profile,
    sabotage,
    counts,
    rows: rowsPath,
  }),
);
for (const row of rows.filter((row) => row.verdict === "fail").slice(0, 20))
  console.log(`${row.path}: ${row.reason}`);
process.exitCode = counts.fail ? 1 : 0;
