// The one reader of a launch row's marker, `launch.json` beside its case.ts
// (tooling/bench/README.md, "Launch rows" and "Peak-RSS rows"). nts-bench
// routes a case with the file here; what it says is checked only here:
//
//   {"metric":"launch-to-exit"}
//     a startup row: case.ts is the whole program, timed from launch to exit.
//   {"metric":"peak-rss","case":"<case>","function":"<name>","input":<number>}
//     a peak-RSS row: case.ts is exactly peakRssProgram()'s text, calling that
//     case's workload once at an input inside its declared domain
//     (case.domains.json), and its cells rank by peak resident set.
//
// Anything else, a stray field, an input outside the domain, or a case.ts
// that is not the derived program, is a ToolingInstrumentError: the row is
// not measured, rather than measured as something else.
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { domainDeclaration } from "../differential/oracle-records.ts";
import { dataDirectory } from "../gate/reader-inputs/main.ts";
import { ToolingInstrumentError } from "../gate/step-result.ts";

const SOURCE = fileURLToPath(new URL("../..", import.meta.url));
const CASES = relative(SOURCE, fileURLToPath(dataDirectory(new URL("../../benchmarks/cases/", import.meta.url))));

/** Which case's workload a peak-RSS row calls once, and at what input. */
export type Sized = { case: string; function: string; input: number };

export type LaunchMarker = { metric: "launch-to-exit" } | ({ metric: "peak-rss" } & Sized);

const refuse = (name: string, message: string): never => {
  throw new ToolingInstrumentError("tooling-setup", `${CASES}/${name}/launch.json: ${message}`);
};
const CASE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** The whole program a peak-RSS row runs: its case's workload, called once at its input, the result printed. */
export function peakRssProgram(sized: Sized): string {
  return [
    `// The peak-RSS row of ${sized.case} at ${sized.function}(${sized.input}): the whole program,`,
    "// derived from launch.json by tooling/bench/launch-marker.ts, which refuses",
    "// any other text. tooling/bench/README.md, \"Peak-RSS rows\", says how it is measured.",
    `import { ${sized.function} } from "../${sized.case}/case.ts";`,
    `console.log(${sized.function}(${String(sized.input)}));`,
    "",
  ].join("\n");
}

/** The case's declared domain for its function's one parameter, or the reason there is none. */
function checkDomain(root: string, name: string, sized: Sized): void {
  const path = join(root, CASES, sized.case, "case.domains.json");
  if (!existsSync(path)) refuse(name, `${sized.case} declares no input domain (case.domains.json)`);
  let declaration: ReturnType<typeof domainDeclaration>;
  try {
    declaration = domainDeclaration(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    return refuse(name, `${sized.case}'s case.domains.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parameters = declaration.functions[sized.function];
  if (!parameters) refuse(name, `${sized.case} declares no domain for ${sized.function}`);
  const domains = Object.entries(parameters!);
  if (domains.length !== 1) refuse(name, `${sized.case}'s ${sized.function} declares ${domains.length} parameters; a peak-RSS row calls a one-argument workload`);
  const [parameter, domain] = domains[0]!;
  const at = `${sized.function}(${parameter} = ${sized.input})`;
  if (domain.min !== undefined && sized.input < domain.min) refuse(name, `${at} is below ${sized.case}'s declared minimum ${domain.min}`);
  if (domain.max !== undefined && sized.input > domain.max) refuse(name, `${at} is above ${sized.case}'s declared maximum ${domain.max}`);
  if (domain.integer && !Number.isInteger(sized.input)) refuse(name, `${at} is not an integer, which ${sized.case}'s domain requires`);
}

/**
 * The marker of the benchmark case that repository path `source` lies in, or
 * null when it lies in none or its case has no marker: the file's presence
 * routes a case, as nts-bench's is_launch_case does, and its content is
 * checked whole by readLaunchMarker.
 */
export function launchMarkerOf(root: string, source: string): LaunchMarker | null {
  const prefix = `${CASES}/`;
  if (!source.startsWith(prefix)) return null;
  const name = source.slice(prefix.length).split("/", 1)[0]!;
  if (!CASE_NAME.test(name) || !existsSync(join(root, CASES, name, "launch.json"))) return null;
  return readLaunchMarker(root, name);
}

/** The marker of launch case `name`, checked whole. */
export function readLaunchMarker(root: string, name: string): LaunchMarker {
  const directory = join(root, CASES, name), path = join(directory, "launch.json");
  if (!existsSync(path)) refuse(name, "missing");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return refuse(name, "is not JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return refuse(name, "is not an object");
  const o = value as Record<string, unknown>, keys = Object.keys(o).sort();
  if (o.metric === "launch-to-exit") {
    if (keys.length !== 1) refuse(name, 'a startup row\'s marker is exactly {"metric":"launch-to-exit"}');
    return { metric: "launch-to-exit" };
  }
  if (o.metric !== "peak-rss") return refuse(name, `unknown metric ${JSON.stringify(o.metric)}`);
  if (keys.join(",") !== "case,function,input,metric") refuse(name, 'a peak-RSS row\'s marker is exactly {"metric":"peak-rss","case":…,"function":…,"input":…}');
  if (typeof o.case !== "string" || !CASE_NAME.test(o.case) || o.case === name) refuse(name, "case must name another benchmark case");
  if (typeof o.function !== "string" || !IDENTIFIER.test(o.function)) refuse(name, "function must be an identifier");
  if (typeof o.input !== "number" || !Number.isFinite(o.input)) refuse(name, "input must be a finite number");
  const sized: Sized = { case: o.case as string, function: o.function as string, input: o.input as number };
  if (!existsSync(join(root, CASES, sized.case, "case.ts"))) refuse(name, `${sized.case} is not a benchmark case`);
  if (existsSync(join(root, CASES, sized.case, "launch.json"))) refuse(name, `${sized.case} is itself a launch row`);
  checkDomain(root, name, sized);
  const program = join(directory, "case.ts");
  if (!existsSync(program) || readFileSync(program, "utf8") !== peakRssProgram(sized))
    refuse(name, "case.ts is not the program its marker derives (launch-marker.ts, peakRssProgram)");
  return { metric: "peak-rss", ...sized };
}
