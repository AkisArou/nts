import {gitArguments} from "../gate/git-arguments/main.ts";
import {fixtureEnvironment} from "../gate/test-environment.ts";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {gitSource, imports, workLists, type Source} from "./node-work-list.ts";

function source(commit: string, text: Record<string, string>): Source {
  return {
    identity: {commit},
    files: new Map(Object.entries(text).map(([path, body]) => [path, createHash("sha256").update(body).digest("hex")])),
    read(path) { assert.ok(path in text, path); return text[path]; },
  };
}

test("literal imports follow syntax and leave computed imports for judgment", () => {
  const got = imports("lib/zlib.js", `
    // require('invented-comment')
    const text = "require('invented-string')";
    require('node:buffer'); import './helper.js';
    export {x} from './other.js'; import('internal/zip');
    require(name); internalBinding('zlib');
  `);
  assert.deepEqual(got.edges.map(edge => edge.specifier), ["node:buffer", "./helper.js", "./other.js", "internal/zip"]);
  assert.deepEqual(got.dynamic.map(edge => edge.expression), ["require(name)"]);
  assert.deepEqual(got.nativeBindings.map(edge => edge.specifier), ["zlib"]);
});

test("the new import closure discovers ZIP and partitions shared work only once", () => {
  const old = source("old", {
    "lib/zlib.js": "require('internal/errors');", "lib/util.js": "require('internal/errors');",
    "lib/internal/errors.js": "exports.x = 1;", "src/node_zlib.cc": "// old seam",
  });
  const now = source("new", {
    "lib/zlib.js": "require('internal/errors'); require('internal/zip');",
    "lib/util.js": "require('internal/errors');", "lib/internal/errors.js": "exports.x = 2;",
    "lib/internal/zip.js": "require('./zip/entry');",
    "lib/internal/zip/entry.js": "require('../zip'); require(archiveKind);",
    "src/node_zlib.cc": "// new seam",
  });
  const ports = source("ports", {
    "runtime/node/zlib/tsconfig.json": "{}", "runtime/node/util/tsconfig.json": "{}",
    "runtime/node/zlib/src/main.ts": "// From Node lib/zlib.js.\nexport {};",
    "runtime/node/zlib/zlib.c": "/* From src/node_zlib.cc. */\n#include <stdio.h>",
    "runtime/node/util/src/main.ts": "// From Node lib/util.js.\nexport {};",
    "runtime/node/internal/errors.ts": "// From lib/internal/errors.js.\nexport {};",
  });
  const report = workLists(old, now, ports);
  const zlib = report.modules.find(row => row.module === "zlib")!;
  assert.deepEqual(zlib.imports.added, ["lib/internal/zip.js", "lib/internal/zip/entry.js"]);
  assert.deepEqual(zlib.partition.own, ["lib/zlib.js", "src/node_zlib.cc"]);
  assert.deepEqual(zlib.partition.shared, ["lib/internal/errors.js"]);
  assert.deepEqual(zlib.partition.unported, ["lib/internal/zip.js", "lib/internal/zip/entry.js"]);
  assert.equal(report.workItems.filter(row => row.path === "lib/internal/errors.js").length, 1);
  assert.equal(zlib.imports.after.dynamic[0].expression, "require(archiveKind)");
  assert.equal(report.workItems.find(row => row.path === "src/node_zlib.cc")?.change, "changed");
  assert.equal(JSON.parse(JSON.stringify(report)).workItems.length, report.examined.distinctWorkFiles);
});

test("test population uses inline extra reasons and immediate suite tests, retaining removals", () => {
  const common = {"lib/zlib.js": "", "test/parallel/test-zlib.js": "a", "test/parallel/test-zlib.txt": "not selected", "test/parallel/test-mixed.js": "mixed", "test/zip/test-extra.mjs": "extra", "test/zip/fixtures/test-hidden.js": "fixture"};
  const old = source("old", {...common, "test/parallel/test-zlib-old.js": "old"});
  const now = source("new", {...common, "test/parallel/test-zlib-new.js": "new"});
  const ports = source("ports", {
    "runtime/node/zlib/tsconfig.json": "{}", "runtime/node/zlib/src/main.ts": "// lib/zlib.js\nexport {};",
    "runtime/node/zlib/extra-tests": "# mixed file\ntest-mixed.js: supported assertions\n",
    "runtime/node/zlib/test-suites": "zip\n",
  });
  const row = workLists(old, now, ports).modules[0];
  assert.equal(row.tests.before, 4); assert.equal(row.tests.after, 4);
  assert.equal(row.tests.files.find(file => file.path.endsWith("old.js"))?.change, "removed");
  assert.equal(row.tests.files.find(file => file.path.endsWith("new.js"))?.change, "added");
  assert.ok(!row.tests.files.some(file => file.path.includes("fixtures") || file.path.endsWith(".txt")));
});

test("braced header citations and unresolved literal edges stay explicit", () => {
  const node = source("node", {"lib/util.js": "require('missing');", "lib/internal/parse/a.js": "", "lib/internal/parse/b.js": ""});
  const ports = source("ports", {
    "runtime/node/util/tsconfig.json": "{}", "runtime/node/util/src/main.ts": "// lib/util.js\nexport {};",
    "runtime/node/util/src/parse.ts": "// lib/internal/parse/{a,b}.js\nexport {};",
  });
  const row = workLists(node, node, ports).modules[0];
  assert.ok(row.partition.own.includes("lib/internal/parse/a.js"));
  assert.ok(row.partition.own.includes("lib/internal/parse/b.js"));
  assert.deepEqual(row.imports.after.edges.map(edge => [edge.specifier, edge.to]), [["missing", undefined]]);
  assert.throws(() => workLists(node, node, ports, ["invented"]), /unknown ported module/);
});

test("type-import preambles retain citations without treating body comments as ownership", () => {
  const node = source("node", {"lib/zlib.js": "require('internal/zip');", "lib/internal/zip.js": ""});
  const ports = source("ports", {
    "runtime/node/zlib/tsconfig.json": "{}",
    "runtime/node/zlib/src/main.ts": "// lib/zlib.js\nexport {};",
    "runtime/node/zlib/src/zip.ts": `import type {View} from './types.ts';
      import {Buffer} from './semi;colon.ts'
      // From Node lib/internal/zip.js.
      export const first = 1;
      // A later body reference to lib/internal/errors.js is not a header.
    `,
  });
  const report = workLists(node, node, ports);
  assert.ok(report.modules[0].partition.own.includes("lib/internal/zip.js"));
  assert.ok(!report.workItems.some(row => row.path === "lib/internal/errors.js"));
});

test("source identity pins Git objects and refuses missing references by name", t => {
  const root = mkdtempSync(join(tmpdir(), "node-work-list-")); t.after(() => rmSync(root, {recursive: true, force: true}));
  const git = (...args: string[]) => execFileSync("git", gitArguments(["-C", root, ...args]), {env:fixtureEnvironment(t),encoding: "utf8"}).trim();
  git("init", "-q"); mkdirSync(join(root, "lib")); writeFileSync(join(root, "lib/zlib.js"), "// original\n");
  git("add", "lib/zlib.js"); git("-c", "user.name=control", "-c", "user.email=control@example.invalid", "commit", "-qm", "source control");
  const pinned = gitSource(root, "HEAD"); writeFileSync(join(root, "lib/zlib.js"), "// edited later\n");
  assert.equal(pinned.identity.commit, git("rev-parse", "HEAD"));
  assert.equal(pinned.read("lib/zlib.js"), "// original\n");
  assert.throws(() => gitSource(root, "missing-source-ref"), /provision the exact objects first/);
});
