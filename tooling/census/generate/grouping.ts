import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { parse, tokenizer } from "acorn";

interface SyntaxNode {
  type: string;
  start: number;
  end: number;
  [field: string]: unknown;
}
interface Binding { id: number; name: string; kind: string }
interface Scope {
  parent?: Scope;
  functionScope: boolean;
  start: number;
  end: number;
  bindings: Map<string, Binding>;
}

function node(value: unknown): value is SyntaxNode {
  return typeof value === "object" && value !== null && "type" in value
    && "start" in value && "end" in value && typeof value.type === "string"
    && typeof value.start === "number" && typeof value.end === "number";
}

function children(value: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (const field of Object.values(value)) {
    if (node(field)) result.push(field);
    else if (Array.isArray(field)) for (const item of field) if (node(item)) result.push(item);
  }
  return result;
}

function nodes(value: unknown): SyntaxNode[] {
  return Array.isArray(value) ? value.filter(node) : [];
}

/**
 * Canonical token stream, preserving TypeScript types, literals, property names
 * and free/intrinsic identifiers. The stripped copy supplies same-offset runtime
 * syntax only: hashing that copy would erase compiler-relevant type information.
 * Type-only declarations are deliberately left spelled as written. Missing a
 * duplicate there is preferable to grouping different type layouts together.
 */
export function normalizeNames(source: string): string {
  const stripped = stripTypeScriptTypes(source, { mode: "strip" });
  const syntax: unknown = parse(stripped, { ecmaVersion: "latest", sourceType: "module" });
  if (!node(syntax)) throw new Error("source parser returned no program");
  const scopes: Scope[] = [];
  const scopeOf = new WeakMap<object, Scope>();
  const declarations = new Map<number, Binding>();
  const replacements = new Map<number, string>();
  let nextBinding = 0;

  function newScope(at: SyntaxNode, parent?: Scope, functionScope = false): Scope {
    const scope = { parent, functionScope, start: at.start, end: at.end, bindings: new Map<string, Binding>() };
    scopes.push(scope);
    return scope;
  }
  function declare(identifier: SyntaxNode, scope: Scope, kind: string): void {
    if (identifier.type !== "Identifier" || typeof identifier.name !== "string") return;
    let binding = scope.bindings.get(identifier.name);
    if (binding === undefined) {
      binding = { id: nextBinding++, name: identifier.name, kind };
      scope.bindings.set(identifier.name, binding);
    }
    declarations.set(identifier.start, binding);
  }
  function bindPattern(pattern: SyntaxNode, scope: Scope, kind: string): void {
    if (pattern.type === "Identifier") declare(pattern, scope, kind);
    else if (pattern.type === "AssignmentPattern" && node(pattern.left)) bindPattern(pattern.left, scope, kind);
    else if (pattern.type === "RestElement" && node(pattern.argument)) bindPattern(pattern.argument, scope, kind);
    else if (pattern.type === "ArrayPattern") for (const element of nodes(pattern.elements)) bindPattern(element, scope, kind);
    else if (pattern.type === "ObjectPattern") for (const property of nodes(pattern.properties)) {
      if (property.type === "RestElement" && node(property.argument)) bindPattern(property.argument, scope, kind);
      else if (node(property.value)) bindPattern(property.value, scope, kind);
    }
  }
  function visit(at: SyntaxNode, inherited: Scope): void {
    let scope = inherited;
    scopeOf.set(at, scope);
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(at.type)) {
      if (at.type === "FunctionDeclaration" && node(at.id)) declare(at.id, inherited, "function");
      scope = newScope(at, inherited, true);
      scopeOf.set(at, scope);
      if (at.type === "FunctionExpression" && node(at.id)) declare(at.id, scope, "function");
      for (const parameter of nodes(at.params)) bindPattern(parameter, scope, "parameter");
      for (const child of children(at)) visit(child, scope);
      return;
    }
    if (at.type === "ClassDeclaration" || at.type === "ClassExpression") {
      if (at.type === "ClassDeclaration" && node(at.id)) declare(at.id, inherited, "class");
      scope = newScope(at, inherited);
      if (node(at.id) && typeof at.id.name === "string") {
        const existing = declarations.get(at.id.start);
        if (existing !== undefined) scope.bindings.set(at.id.name, existing);
        else declare(at.id, scope, "class");
      }
      scopeOf.set(at, scope);
      for (const child of children(at)) visit(child, scope);
      return;
    }
    if (["BlockStatement", "ForStatement", "ForInStatement", "ForOfStatement", "SwitchStatement", "CatchClause"].includes(at.type)) {
      scope = newScope(at, inherited);
      scopeOf.set(at, scope);
    }
    if (at.type === "CatchClause" && node(at.param)) bindPattern(at.param, scope, "catch");
    if (at.type === "VariableDeclaration") {
      let target = scope;
      if (at.kind === "var") while (!target.functionScope && target.parent !== undefined) target = target.parent;
      for (const declaration of nodes(at.declarations)) if (node(declaration.id)) bindPattern(declaration.id, target, "variable");
    }
    if (at.type === "ImportDeclaration") for (const specifier of nodes(at.specifiers)) {
      if (node(specifier.local)) declare(specifier.local, scope, "import");
    }
    for (const child of children(at)) visit(child, scope);
  }
  const root = newScope(syntax, undefined, true);
  visit(syntax, root);

  function lookup(name: string, scope: Scope | undefined): Binding | undefined {
    for (let current = scope; current !== undefined; current = current.parent) {
      const binding = current.bindings.get(name);
      if (binding !== undefined) return binding;
    }
    return undefined;
  }
  function bindingAt(at: SyntaxNode): Binding | undefined {
    return declarations.get(at.start) ?? (typeof at.name === "string" ? lookup(at.name, scopeOf.get(at)) : undefined);
  }
  function references(at: SyntaxNode): void {
    if (at.type === "Identifier") {
      const binding = bindingAt(at);
      if (binding !== undefined) replacements.set(at.start, `@${binding.id}`);
      return;
    }
    if (at.type === "MemberExpression") {
      if (node(at.object)) references(at.object);
      if (at.computed === true && node(at.property)) references(at.property);
      return;
    }
    if (at.type === "Property") {
      if (at.computed === true && node(at.key)) references(at.key);
      if (node(at.value)) references(at.value);
      if (at.shorthand === true && node(at.key) && typeof at.key.name === "string") {
        const value = node(at.value) && at.value.type === "AssignmentPattern" && node(at.value.left) ? at.value.left : at.value;
        const binding = node(value) ? bindingAt(value) : undefined;
        if (binding !== undefined) replacements.set(at.key.start, `${at.key.name}:@${binding.id}`);
      }
      return;
    }
    if (at.type === "MethodDefinition" || at.type === "PropertyDefinition") {
      if (at.computed === true && node(at.key)) references(at.key);
      if (node(at.value)) references(at.value);
      return;
    }
    if (at.type === "LabeledStatement") {
      if (node(at.body)) references(at.body);
      return;
    }
    if (at.type === "BreakStatement" || at.type === "ContinueStatement") return;
    if (at.type === "ImportDeclaration") {
      for (const specifier of nodes(at.specifiers)) if (node(specifier.local)) {
        references(specifier.local);
        if (node(specifier.imported) && specifier.imported.start === specifier.local.start) {
          const binding = bindingAt(specifier.local);
          if (binding !== undefined) replacements.set(specifier.local.start,
            `${source.slice(specifier.imported.start, specifier.imported.end)}:import@${binding.id}`);
        }
      }
      return;
    }
    if (at.type === "ExportSpecifier") {
      if (node(at.local)) references(at.local);
      // Preserve an explicit exported alias, which is not a lexical reference.
      return;
    }
    for (const child of children(at)) references(child);
  }
  references(syntax);

  // Tokenizing, unlike parsing, accepts annotations such as `x: number[]`.
  // Tokens keep punctuation and type syntax, and discard only trivia.
  const tokens = [...tokenizer(source, { ecmaVersion: "latest", sourceType: "module" })];
  const canonical: string[][] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    let spelling = replacements.get(token.start);
    if (spelling === undefined && token.type.label === "name"
      && stripped.slice(token.start, token.end).trim() === "") {
      // Class types are references to the runtime binding too. Retain type-field
      // keys and qualified members; never treat an arbitrary type word as a var.
      const containing = scopes.filter(scope => scope.start <= token.start && scope.end >= token.end);
      const scope = containing[containing.length - 1];
      const binding = lookup(source.slice(token.start, token.end), scope);
      if (binding?.kind === "class" && tokens[index + 1]?.type.label !== ":" && tokens[index - 1]?.type.label !== ".") {
        spelling = `@${binding.id}`;
      }
    }
    canonical.push([token.type.label, spelling ?? source.slice(token.start, token.end)]);
  }
  return JSON.stringify(canonical);
}

export function hashProgram(source: string): string {
  return createHash("sha256").update(normalizeNames(source)).digest("hex");
}

export interface Finding {
  cell: string;
  template: string;
  kind: string;
  backends: string[];
  source: string;
}
export interface GroupingSignature {
  cell: string;
  template: string;
  kind: string;
  backends: string[];
  programHash: string;
}
export interface FindingGroup<T extends Finding> {
  key: string;
  signature: GroupingSignature;
  findings: T[];
}

export function findingSignature(finding: Finding): GroupingSignature {
  return {
    cell: finding.cell, template: finding.template, kind: finding.kind,
    backends: [...new Set(finding.backends)].sort(), programHash: hashProgram(finding.source),
  };
}

export function groupFindings<T extends Finding>(findings: T[]): FindingGroup<T>[] {
  const groups = new Map<string, FindingGroup<T>>();
  for (const finding of findings) {
    const signature = findingSignature(finding);
    const key = createHash("sha256").update(JSON.stringify(signature)).digest("hex");
    const existing = groups.get(key);
    if (existing !== undefined) existing.findings.push(finding);
    else groups.set(key, { key, signature, findings: [finding] });
  }
  return [...groups.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}
