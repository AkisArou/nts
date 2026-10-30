import type { DomainsFile, FunctionSpec, Policies, PrintedProgram, ProgramModel } from "./model.ts";
import { numberSource, validateModel } from "./model.ts";

/** All text below comes from this whitelist; the persisted model contains no source fragments. */
class Lines {
  readonly lines: string[] = [];
  private level = 0;
  line(text = ""): void { this.lines.push("  ".repeat(this.level) + text); }
  block(head: string, body: () => void): void {
    this.line(`${head} {`);
    this.level++;
    body();
    this.level--;
    this.line("}");
  }
  branch(test: string, yes: () => void, no: () => void, swapped: boolean): void {
    this.line(`if (${swapped ? `(${test}) === false` : test}) {`);
    this.level++;
    (swapped ? no : yes)();
    this.level--;
    this.line("} else {");
    this.level++;
    (swapped ? yes : no)();
    this.level--;
    this.line("}");
  }
  toString(): string { return this.lines.join("\n") + "\n"; }
}

function mutation(out: Lines, target: string, p: Policies): void {
  const value = numberSource(p.value);
  switch (p.mutation) {
    case "pop": out.line(`${target}.pop();`); break;
    case "shift": out.line(`${target}.shift();`); break;
    case "splice": out.line(`${target}.splice(1);`); break;
    case "length-zero": out.line(`${target}.length = 0;`); break;
    case "push": out.line(`${target}.push(${value});`); break;
    case "unshift": out.line(`${target}.unshift(${value});`); break;
    case "append": out.line(`${target}[${target}.length] = ${value};`); break;
  }
}

/** Alias declarations are part of the route: controls omit the entire route. */
function aliases(out: Lines, model: ProgramModel, target: string, body: (target: string) => void): void {
  const p = model.policies;
  const length = Math.max(model.cell.endsWith(":alias") ? 1 : 0, p.chainLength);
  function step(at: number, previous: string): void {
    if (at === length) { body(previous); return; }
    const name = `alias${at}`;
    switch (p.container) {
      case "variable":
        out.line(`const ${name}: number[] = ${previous};`);
        step(at + 1, name);
        break;
      case "field":
        out.line(`const link${at}: { items: number[] } = { items: ${previous} };`);
        out.line(`const ${name}: number[] = link${at}.items;`);
        step(at + 1, name);
        break;
      case "array":
        out.line(`const link${at}: number[][] = [${previous}];`);
        out.line(`const ${name}: number[] = link${at}[0];`);
        step(at + 1, name);
        break;
      case "map":
        out.line(`const link${at} = new Map<string, number[]>([["value", ${previous}]]);`);
        out.line(`const ${name} = link${at}.get("value");`);
        out.block(`if (${name} !== undefined)`, () => step(at + 1, name));
        break;
    }
  }
  step(0, target);
}

function invoke(out: Lines, model: ProgramModel, target: string, forceCall: boolean): void {
  const p = model.policies;
  if (p.indirection === "direct" && !forceCall) { mutation(out, target, p); return; }
  if (p.indirection === "closure") {
    out.block("const effect = (): void =>", () => mutation(out, target, p));
    out.line("effect();");
    return;
  }
  out.block("function effect(items: number[]): void", () => mutation(out, "items", p));
  let callee = "effect";
  const depth = p.indirection === "nested" ? Math.max(1, p.nestingDepth) : 0;
  for (let i = 0; i < depth; i++) {
    const previous = callee;
    callee = `call${i}`;
    out.block(`function ${callee}(items: number[]): void`, () => out.line(`${previous}(items);`));
  }
  out.line(`${callee}(${target});`);
}

function callback(out: Lines, model: ProgramModel, target: string): void {
  const effect = () => invoke(out, model, target, false);
  // Each driver invokes the callback once. Mutation affects a separate target,
  // and neither callback count nor order is implementation-defined.
  switch (model.policies.callback) {
    case "forEach":
      out.block("[n].forEach((value: number): void =>", effect); out.line(");"); break;
    case "map":
      out.block("[n].map((value: number): number =>", () => { effect(); out.line("return value;"); }); out.line(");"); break;
    case "filter":
      out.block("[n].filter((value: number): boolean =>", () => { effect(); out.line("return value > 0;"); }); out.line(");"); break;
    case "reduce":
      out.block("[n].reduce((sum: number, value: number): number =>", () => { effect(); out.line("return sum + value;"); }); out.line(", 0);"); break;
    case "arrayFrom":
      out.block("Array.from([n], (value: number): number =>", () => { effect(); out.line("return value;"); }); out.line(");"); break;
    case "mapForEach":
      out.block("new Map<number, number>([[0, n]]).forEach((value: number): void =>", effect); out.line(");"); break;
    case "setForEach":
      out.block("new Set<number>([n]).forEach((value: number): void =>", effect); out.line(");"); break;
  }
}

function arraySetup(out: Lines, model: ProgramModel, prefix: string): string {
  const literal = `[11, 22, 33, ${numberSource(model.policies.value)}]`;
  if (model.policies.container === "field") {
    out.block(`class ${prefix}Holder`, () => out.line(`items: number[] = ${literal};`));
    out.line(`const holder = new ${prefix}Holder();`);
    return "holder.items";
  }
  out.line(`const xs: number[] = ${literal};`);
  return "xs";
}

function scenario(out: Lines, model: ProgramModel, prefix: string, control: boolean, swapped: boolean): void {
  if (model.template === "index-range-join" || model.template === "string-range-join") {
    const target = model.template === "index-range-join" ? arraySetup(out, model, prefix) : '"abcd"';
    out.line("let j: number = 0;");
    // The exact source of PR #123's range-join witness: one arm proves 0..3,
    // the other writes 7, then both reach the same indexed use.
    out.branch("n >= 0 && n < 4", () => out.line("j = n | 0;"), () => {
      if (!control) out.line("j = 7;");
    }, swapped);
    let index = "j";
    for (let i = 0; i < model.policies.chainLength; i++) {
      out.line(`const index${i}: number = ${index};`);
      index = `index${i}`;
    }
    if (model.template === "string-range-join") out.line(`result = ${target}.charCodeAt(${index});`);
    else out.line(`result = ${target}[${index}];`);
    return;
  }
  const target = arraySetup(out, model, prefix);
  const length = model.template === "known-length";
  if (!length) out.line("let i: number = 3;");
  const read = length ? `${target}.length` : `${target}[i]`;
  const route = () => {
    if (control) return;
    aliases(out, model, target, (alias) => {
      if (model.cell.endsWith(":callback")) callback(out, model, alias);
      else invoke(out, model, alias, model.cell.endsWith(":call"));
    });
  };
  const body = () => {
    if (model.cell.endsWith(":loop")) {
      out.line(`result = ${read};`);
      out.block("for (let turn: number = 0; turn < 2; turn++)", () => {
        const nested = (depth: number): void => {
          if (depth < model.policies.nestingDepth) {
            out.block(`for (let layer${depth}: number = 0; layer${depth} < 1; layer${depth}++)`, () => nested(depth + 1));
          } else {
            // The second read is reached through the back edge, after the first
            // iteration's mutation. All loops have literal finite budgets.
            out.line(`result = ${read};`);
            out.branch("n > 0 && turn === 0", route, () => {}, swapped);
          }
        };
        nested(0);
      });
    } else {
      out.branch("n > 0", route, () => {
        if (model.cell.endsWith(":merge")) out.line(`${target}[0] = n;`);
      }, swapped);
      out.line(`result = ${read};`);
    }
  };
  if (length) body();
  else out.block(`if (i >= 0 && i < ${target}.length)`, body);
}

function shortcut(model: ProgramModel, name: string): string {
  if (model.template === "string-range-join") return `all: ${name} returns integer`;
  return model.template === "known-length" ? `all: count array.len in ${name} == 0`
    : `all: count array.get.checked in ${name} == 0`;
}

/** Literal observation encoding is independent of Node answers and preserves all scalar distinctions. */
function describe(out: Lines): void {
  out.block("function describe(value: number | undefined): string", () => {
    out.line('if (value === undefined) return "undefined";');
    out.line('if (value !== value) return "NaN";');
    out.line('if (value === 0 && 1 / value < 0) return "-0";');
    out.line('return "" + value;');
  });
}

export function printProgram(input: ProgramModel): PrintedProgram {
  const model = validateModel(input);
  const p = model.policies;
  const out = new Lines();
  const functions: FunctionSpec[] = [];
  const literal = p.inputSource === "literal";
  const resultType = model.template === "known-length" || model.template === "string-range-join"
    ? "number" : "number | undefined";
  const swapped = p.armOrder === "else";
  const domains: DomainsFile = { version: 1, functions: {} };
  out.line("// run: check");
  out.line(`// census generator ${model.version}; ${model.cell}; ${model.template}`);
  out.line("// Establish a fact, cross one invalidating route, then observe its use.");
  if (p.context.includes("unrelated-array")) {
    out.line(`const unrelated: number[] = [${numberSource(p.value)}, 0.5];`);
  }
  if (literal) describe(out);

  const spec = (name: string, role: FunctionSpec["role"], counterpart?: string, expectedShortcut?: string): void => {
    const entry: FunctionSpec = { name, role, parameters: literal ? [] : ["number"],
      inputs: literal ? [[]] : model.inputs.map((value) => [value]) };
    if (counterpart !== undefined) entry.counterpart = counterpart;
    if (expectedShortcut !== undefined) entry.shortcut = expectedShortcut;
    if (literal) {
      entry.scenarioInputs = model.inputs.map((value) => [value]);
      entry.observationEncoding = "number-list-v1";
    } else {
      domains.functions[name] = { n: {
        min: -9007199254740992, max: 9007199254740992, allowNaN: true,
        reason: "stage-1 numeric boundaries; allocation and loop budgets are independent of this input",
      } };
    }
    functions.push(entry);
  };
  const literalBody = (name: string, control: boolean, reverse: boolean, resultName: string): void => {
    // Unroll the literal list, keeping the established fact inside the named
    // control rather than hiding it behind a test-only probe function.
    for (const value of model.inputs) {
      out.block("", () => {
        out.line(`let n: number = ${numberSource(value)};`);
        out.line(`let result: ${resultType} = -1;`);
        scenario(out, model, name, control, reverse);
        out.line(`${resultName} += describe(result) + ";";`);
      });
    }
  };
  const fn = (name: string, role: FunctionSpec["role"], control: boolean, reverse: boolean, counterpart?: string): void => {
    const fact = control ? shortcut(model, name) : undefined;
    if (fact !== undefined) out.line(`// expect-ir: ${fact}`);
    out.block(`export function ${name}(${literal ? "" : "n: number"}): ${literal ? "string" : resultType}`, () => {
      if (literal) {
        out.line('let observations: string = "";');
        literalBody(name, control, reverse, "observations");
        out.line("return observations;");
      } else {
        out.line(`let result: ${resultType} = -1;`);
        scenario(out, model, name, control, reverse);
        out.line("return result;");
      }
    });
    spec(name, role, counterpart, fact);
  };
  const moduleObservation = (name: string, role: FunctionSpec["role"], control: boolean, reverse: boolean, counterpart: string): void => {
    const stored = `${name}Observations`;
    out.line(`let ${stored}: string = "";`);
    literalBody(name, control, reverse, stored);
    out.block(`export function ${name}(): string`, () => out.line(`return ${stored};`));
    spec(name, role, counterpart);
  };

  if (p.placement === "module") {
    out.line("// Module witnesses execute establish/route/use during initialization.");
    moduleObservation("subject", "subject", false, swapped, "control");
    moduleObservation("controlModule", "twin", true, swapped, "control");
    if (p.twins) moduleObservation("twin", "twin", false, !swapped, "subject");
    out.line("// This identical function control is the named shortcut witness.");
    out.line("// controlModule must equal it under Node and on every oracle backend.");
    fn("control", "control", true, swapped);
  } else {
    fn("subject", "subject", false, swapped, "control");
    fn("control", "control", true, swapped);
    if (p.twins) {
      fn("twin", "twin", false, !swapped, "subject");
      fn("controlTwin", "twin", true, !swapped, "control");
    }
  }
  if (p.context.includes("second-caller")) {
    out.block(`export function contextCaller(): ${literal ? "string" : resultType}`, () => {
      out.line(`return subject(${literal ? "" : numberSource(p.value)});`);
    });
    functions.push({ name: "contextCaller", role: "context", parameters: [], inputs: [[]] });
  }
  return literal ? { source: out.toString(), functions } : { source: out.toString(), functions, domains };
}
