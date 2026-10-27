import { test } from "node:test";
import assert from "node:assert/strict";
import { commentsOnly } from "./comment-changes.ts";

test("Rust compiler tokens retain nested comments, raw strings and doc attributes", () => {
  assert.equal(commentsOnly("x.rs", "fn f() { /* outer /* nested */ x */ }", "fn f() { /* new */ }"), true);
  assert.equal(commentsOnly("x.rs", "/// old\nfn f() {}", "/// new\nfn f() {}"), true);
  assert.equal(commentsOnly("x.rs", "//! old\nfn f() {}", "//! new\nfn f() {}"), true);
  assert.equal(commentsOnly("x.rs", 'fn f() { let x = r#"// old"#; }', 'fn f() { let x = r#"// new"#; }'), false);
  assert.equal(commentsOnly("x.rs", '#[doc="old"] fn f() {}', '#[doc="new"] fn f() {}'), false);
  assert.equal(commentsOnly("x.rs", "fn f() { let x = a + /* x */ = b; }", "fn f() { let x = a += b; }"), false);
});

test("Rust source-observing macros and procedural attributes retain the ordinary gate", () => {
  for (const text of ["fn f() { line!(); }", "#[derive(Custom)] struct X;", "#[custom] fn f() {}", "fn f() { custom!(x); }"]) {
    assert.equal(commentsOnly("x.rs", text + " // old", text + " // new"), false);
  }
  assert.equal(commentsOnly("x.rs", "fn f() { /* unclosed", "fn f() { /* other"), false);
});

test("TypeScript's scanner distinguishes comments from literal contents and ASI", () => {
  assert.equal(commentsOnly("x.ts", 'const x = "/* x */"; // old\n', 'const x = "/* x */"; // new\n'), true);
  assert.equal(commentsOnly("x.ts", 'const x = "// old";', 'const x = "// new";'), false);
  assert.equal(commentsOnly("x.ts", "function f() { return /*x*/ 1; }", "function f() { return /*\n*/ 1; }"), false);
  for (const text of ["const r = /a/;", "const t = `a${x}`;", "/// <reference path='x'/>\n", "// @ts-ignore\nlet x;", "// expect-ir: a\nlet x;"]) {
    assert.equal(commentsOnly("x.ts", text + " // old", text + " // new"), false);
  }
});

test("Clang raw tokens keep disabled code, macro newlines, strings and character literals", () => {
  assert.equal(commentsOnly("x.c", "int x; /* old */\n", "int x; /* new */\n"), true);
  assert.equal(commentsOnly("x.h", "// old\n#define X 1\n", "// new\n#define X 1\n"), true);
  assert.equal(commentsOnly("x.c", '#if 0\nint x=1;\n#endif\n// old\n', '#if 0\nint x=2;\n#endif\n// new\n'), false);
  assert.equal(commentsOnly("x.c", 'char *s="/* old */";', 'char *s="/* new */";'), false);
  assert.equal(commentsOnly("x.c", "#define X /* old */ 1\n", "#define X /*\nnew */ 1\n"), false);
  assert.equal(commentsOnly("x.c", "int x; /* unclosed", "int x; /* other"), false);
  assert.equal(commentsOnly("x.c", "int x=__LINE__; // old\n", "int x=__LINE__; // new\n"), false);
});

test("front matter and key markers remain significant even outside fixture paths", () => {
  for (const path of ["x.ts", "x.c", "x.rs"]) {
    for (const [before, after] of [
      ["/*--- features: [a] ---*/\n", "/*--- features: [b] ---*/\n"],
      ["// backend: c\n", "// backend: llvm\n"],
      ["/*\n * flags: module\n */\n", "/*\n * flags: strict\n */\n"],
    ]) assert.equal(commentsOnly(path, before, after), false, path + before);
    assert.equal(commentsOnly(path, "// see docs/old.md\n", "// see docs/new.md\n"), true, path);
  }
});

test("unchanged Rust fields do not mask prose changes, while changed SAFETY markers stay guarded", () => {
  const before = "struct Named {\n    name: String,\n}\n// see docs/old.md\n";
  assert.equal(commentsOnly("x.rs", before, before.replace("old.md", "new.md")), true);
  assert.equal(commentsOnly("x.rs", before + "// SAFETY: old proof\n", before + "// SAFETY: new proof\n"), false);
});
