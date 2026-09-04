#!/usr/bin/env node
// Audit runtime/node TypeScript for constructs excluded by
// docs/conformance/typescript.md section 13.
//
//   node tooling/conformance/check-nongoals.mjs
//   node tooling/conformance/check-nongoals.mjs async_hooks
//
// This deliberately parses TypeScript instead of grepping it: upstream names
// and rationale in comments mention prototypes and Proxy frequently, and those
// mentions are not runtime dependencies.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import {
  computeLineStarts,
  createScanner,
  LanguageVariant,
  SyntaxKind,
} from "typescript/unstable/ast";

const ROOT = resolve(import.meta.dirname, "../..");
const PROFILE = join(ROOT, "runtime/node");

const objectMetaOperations = new Set([
  "create",
  "defineProperties",
  "defineProperty",
  "freeze",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "getOwnPropertyNames",
  "getOwnPropertySymbols",
  "getPrototypeOf",
  "isExtensible",
  "isFrozen",
  "isSealed",
  "preventExtensions",
  "seal",
  "setPrototypeOf",
]);

const symbolHooks = new Set([
  "asyncDispose",
  "dispose",
  "hasInstance",
  "species",
  "toPrimitive",
  "unscopables",
]);

function tsFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") files.push(...tsFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function scan(text) {
  // TypeScript 7.0.2's unstable scanner can stop advancing on a `#` inside a
  // backtick in JSDoc, returning an empty PrivateIdentifier forever. Private
  // names are irrelevant to this audit, and replacing the character preserves
  // every source offset used below.
  const scanner = createScanner(true, LanguageVariant.Standard, text.replaceAll("#", "_"));
  const tokens = [];
  // The scanner is lower-level than the parser: after a template expression it
  // needs to be told that the closing brace may begin a TemplateMiddle/Tail.
  // Track nested braces and nested templates so code after a template does not
  // disappear into one giant literal token.
  const templateBraceDepths = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile;) {
    if (kind === SyntaxKind.TemplateHead) {
      templateBraceDepths.push(0);
    } else if (templateBraceDepths.length > 0 && kind === SyntaxKind.OpenBraceToken) {
      templateBraceDepths[templateBraceDepths.length - 1]++;
    } else if (templateBraceDepths.length > 0 && kind === SyntaxKind.CloseBraceToken) {
      const template = templateBraceDepths.length - 1;
      if (templateBraceDepths[template] === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === SyntaxKind.TemplateTail) templateBraceDepths.pop();
      } else {
        templateBraceDepths[template]--;
      }
    }
    tokens.push({
      kind,
      text: scanner.getTokenText(),
      value: scanner.getTokenValue(),
      start: scanner.getTokenStart(),
    });
    kind = scanner.scan();
  }
  return tokens;
}

function isIdentifier(token, expected) {
  return token?.kind === SyntaxKind.Identifier && token.text === expected;
}

/** Return the statically named member after tokens[index], if there is one. */
function member(tokens, index) {
  if (tokens[index + 1]?.kind === SyntaxKind.DotToken &&
      tokens[index + 2]?.kind === SyntaxKind.Identifier) {
    return tokens[index + 2].text;
  }
  if (tokens[index + 1]?.kind === SyntaxKind.OpenBracketToken &&
      tokens[index + 2]?.kind === SyntaxKind.StringLiteral &&
      tokens[index + 3]?.kind === SyntaxKind.CloseBracketToken) {
    return tokens[index + 2].value;
  }
  return null;
}

function reason(tokens, index) {
  const token = tokens[index];
  if (isIdentifier(token, "__proto__")) {
    return "__proto__ depends on prototype mutation";
  }

  const name = member(tokens, index);
  if (isIdentifier(token, "Reflect") && name !== null) {
    return `Reflect.${name} requires the metaobject protocol`;
  }
  if (isIdentifier(token, "Object") && objectMetaOperations.has(name)) {
    return `Object.${name} requires dynamic object metadata`;
  }
  if (isIdentifier(token, "Symbol") && symbolHooks.has(name)) {
    return `Symbol.${name} is a runtime operation hook`;
  }
  if (isIdentifier(token, "prototype") &&
      tokens[index - 1]?.kind === SyntaxKind.DotToken) {
    return "runtime access to a prototype object";
  }

  if (token.kind === SyntaxKind.NewKeyword &&
      (isIdentifier(tokens[index + 1], "Proxy") || isIdentifier(tokens[index + 1], "Function"))) {
    return `${tokens[index + 1].text} construction is not part of the compiled object model`;
  }

  if ((isIdentifier(token, "eval") || isIdentifier(token, "Function")) &&
      tokens[index + 1]?.kind === SyntaxKind.OpenParenToken) {
    return `${token.text} requires a compiler at runtime`;
  }

  return null;
}

function lineAndColumn(lineStarts, position) {
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (lineStarts[middle] <= position) low = middle;
    else high = middle;
  }
  return { line: low + 1, column: position - lineStarts[low] + 1 };
}

const requested = process.argv.slice(2);
const roots = requested.length === 0
  ? [PROFILE]
  : requested.map((name) => join(PROFILE, name));

for (const root of roots) {
  if (!existsSync(root)) {
    console.error(`no such node module: ${relative(ROOT, root)}`);
    process.exitCode = 2;
  }
}
if (process.exitCode) process.exit();

const findings = [];
for (const file of roots.flatMap(tsFiles).sort()) {
  const text = readFileSync(file, "utf8");
  const tokens = scan(text);
  const lineStarts = computeLineStarts(text);
  for (let index = 0; index < tokens.length; index++) {
    const why = reason(tokens, index);
    if (why) {
      const start = lineAndColumn(lineStarts, tokens[index].start);
      findings.push({
        file: relative(ROOT, file),
        line: start.line,
        column: start.column,
        why,
      });
    }
  }
}

for (const finding of findings) {
  console.log(`${finding.file}:${finding.line}:${finding.column}: ${finding.why}`);
}

if (findings.length === 0) {
  console.log(`section 13 audit passed for ${requested.length === 0 ? "runtime/node" : requested.join(", ")}`);
} else {
  console.error(`${findings.length} section 13 violation(s)`);
  process.exitCode = 1;
}
