//! Every published member has a concrete lowering witness. These are entry-
//! point checks, not a substitute for the standard suites or backend records.
use std::fmt::Write as _;

use camino::Utf8Path;
use nts_core::hir::{
    self,
    features::{CompilerProvider, Use, compiler_providers},
};
use nts_frontend_ts::Frontend;

struct Directory(std::path::PathBuf);
impl Drop for Directory {
    fn drop(&mut self) {
        drop(std::fs::remove_dir_all(&self.0));
    }
}

fn method(receiver: &str, member: &str, args: &str) -> String {
    format!("return {receiver}.{member}({args});")
}

#[expect(
    clippy::too_many_lines,
    reason = "exhaustive source witnesses kept together for member-by-member audit"
)]
fn witness(row: &CompilerProvider, member: &str) -> String {
    let name = row.global;
    if let Some(member) = member.strip_prefix("prototype.") {
        if hir::builtin::TYPED_ARRAYS.contains(&name) {
            return match member {
                "buffer" => format!("return new {name}(8).buffer.byteLength;"),
                "length" | "byteLength" | "byteOffset" => format!("return new {name}(8).{member};"),
                "set" => format!("const a = new {name}(8); a.set(new {name}(2)); return a[0];"),
                "copyWithin" => {
                    format!("const a = new {name}(8); a.copyWithin(0, 1); return a[0];")
                }
                "fill" => method(&format!("new {name}(8)"), member, "1"),
                "join" => method(&format!("new {name}(8)"), member, "\",\""),
                "slice" | "subarray" => method(&format!("new {name}(8)"), member, "0, 2"),
                _ => panic!("missing typed array witness: {member}"),
            };
        }
        match name {
            "Array" => {
                if member == "length" {
                    return "return [1, 2].length;".into();
                }
                let args = match member {
                    "at" | "includes" | "indexOf" | "lastIndexOf" | "push" | "unshift" | "fill" => {
                        "1"
                    }
                    "slice" | "splice" | "with" => "0, 1",
                    "concat" => "[3]",
                    "join" => "\",\"",
                    "every" | "some" | "filter" | "find" | "findLast" | "findIndex"
                    | "findLastIndex" => "x => x > 0",
                    "map" => "x => x + 1",
                    "reduce" | "reduceRight" => "(a, b) => a + b, 0",
                    "sort" | "toSorted" => "(a, b) => a - b",
                    "forEach" => {
                        return "let total = 0; [1, 2].forEach(x => { total += x; }); return total;"
                            .into();
                    }
                    "pop" | "shift" | "reverse" | "toReversed" | "toString" => "",
                    _ => panic!("missing array witness: {member}"),
                };
                return method("[1, 2]", member, args);
            }
            "String" => {
                if member == "length" {
                    return "return \"ab\".length;".into();
                }
                let args = match member {
                    "at" | "charAt" | "charCodeAt" | "codePointAt" | "repeat" => "1",
                    "padStart" | "padEnd" => "4, \"x\"",
                    "slice" | "substring" => "0, 1",
                    "replace" | "replaceAll" => "\"a\", \"x\"",
                    "concat" | "endsWith" | "includes" | "indexOf" | "lastIndexOf" | "split"
                    | "startsWith" => "\"a\"",
                    "isWellFormed" | "toWellFormed" | "toLowerCase" | "toUpperCase" | "trim"
                    | "trimEnd" | "trimStart" => "",
                    _ => panic!("missing string witness: {member}"),
                };
                return method("\"ab\"", member, args);
            }
            "Number" => {
                return method(
                    "(1.5)",
                    member,
                    if member == "toFixed" { "2" } else { "10" },
                );
            }
            "BigInt" => return method("(12n)", member, "10"),
            "Date" => return method("new Date(0)", member, ""),
            "ArrayBuffer" => {
                let init = "const a = new ArrayBuffer(8, { maxByteLength: 16 });";
                return match member {
                    "byteLength" | "maxByteLength" | "resizable" | "detached" => {
                        format!("{init} return a.{member};")
                    }
                    "slice" | "transfer" | "transferToFixedLength" => {
                        format!("{init} return a.{member}(4).byteLength;")
                    }
                    "resize" => format!("{init} a.resize(12); return a.byteLength;"),
                    _ => panic!("missing buffer witness: {member}"),
                };
            }
            "DataView" => {
                let init = "const a = new DataView(new ArrayBuffer(32));";
                return match member {
                    "buffer" => format!("{init} return a.buffer.byteLength;"),
                    "byteLength" | "byteOffset" => format!("{init} return a.{member};"),
                    method if method.starts_with("get") => format!("{init} return a.{method}(0);"),
                    method if method.starts_with("set") => format!(
                        "{init} a.{method}(0, {}); return a.byteLength;",
                        if method.contains("Big") { "1n" } else { "1" }
                    ),
                    _ => panic!("missing DataView witness: {member}"),
                };
            }
            "Map" | "Set" => {
                let init = if name == "Map" {
                    "const a = new Map<number, number>(); a.set(1, 2);"
                } else {
                    "const a = new Set<number>(); a.add(1);"
                };
                return match member {
                    "size" => format!("{init} return a.size;"),
                    "get" | "has" | "delete" | "add" => format!("{init} return a.{member}(1);"),
                    "set" => format!("{init} return a.set(1, 3).size;"),
                    "clear" => format!("{init} a.clear(); return a.size;"),
                    "forEach" => {
                        format!("{init} let n = 0; a.forEach(v => {{ n += v; }}); return n;")
                    }
                    "entries" => format!(
                        "{init} let n = 0; for (const [k, v] of a.entries()) n += k + v; return n;"
                    ),
                    "keys" | "values" => {
                        format!("{init} let n = 0; for (const v of a.{member}()) n += v; return n;")
                    }
                    _ => panic!("missing table witness: {member}"),
                };
            }
            "Promise" => {
                return match member {
                    "then" => "return Promise.resolve(1).then(x => x + 1);".into(),
                    "catch" => "return Promise.resolve(1).catch(() => 0);".into(),
                    "finally" => "return Promise.resolve(1).finally(() => {});".into(),
                    _ => panic!("missing promise witness: {member}"),
                };
            }
            _ => {
                let args = if name == "AggregateError" {
                    "[1], \"x\", { cause: 1 }"
                } else {
                    "\"x\", { cause: 1 }"
                };
                return match member {
                    "message" | "name" | "cause" | "errors" => {
                        format!("return new {name}({args}).{member};")
                    }
                    _ => panic!("missing error witness: {name}.{member}"),
                };
            }
        }
    }
    match name {
        "Math" => {
            if member.chars().next().is_some_and(char::is_uppercase) {
                return format!("return Math.{member};");
            }
            method(
                "Math",
                member,
                if ["atan2", "hypot", "imul", "max", "min", "pow"].contains(&member) {
                    "1, 2"
                } else {
                    "1"
                },
            )
        }
        "Number" => {
            if member.starts_with("is") {
                method("Number", member, "1")
            } else {
                format!("return Number.{member};")
            }
        }
        "Array" => method("Array", member, "[1, 2]"),
        "ArrayBuffer" => method("ArrayBuffer", member, "new Uint8Array(2)"),
        "BigInt" => method("BigInt", member, "8, 12n"),
        "String" => method("String", member, "65"),
        "Symbol" => method(
            "Symbol",
            member,
            if member == "for" {
                "\"x\""
            } else {
                "Symbol.for(\"x\")"
            },
        ),
        "JSON" => method("JSON", member, "{ a: 1 }"),
        "console" => format!("console.{member}(\"x\"); return 1;"),
        "Object" if member == "assign" => {
            "const a: Record<string, number> = { a: 1 }; const b: Record<string, number> = { a: 2 }; return Object.assign(a, b);".into()
        }
        "Object" if member == "create" => {
            "return Object.create(null) as Record<string, number>;".into()
        }
        "Object" => method(
            "Object",
            member,
            match member {
                "hasOwn" => "{ a: 1 }, \"a\"",
                "is" => "1, 1",
                "entries" | "keys" | "values" => "{ a: 1 }",
                _ => panic!("missing Object witness: {member}"),
            },
        ),
        "Promise" => match member {
            "resolve" => method("Promise", member, "1"),
            "reject" => "return Promise.reject<number>(new Error(\"x\"));".into(),
            "all" | "race" => method("Promise", member, "[Promise.resolve(1)]"),
            "withResolvers" => "return Promise.withResolvers<number>().promise;".into(),
            _ => panic!("missing Promise static: {member}"),
        },
        _ => panic!("missing static witness: {name}.{member}"),
    }
}

fn global_witness(name: &str, use_kind: Use) -> String {
    match use_kind {
        Use::Value => format!("return {name};"),
        Use::Construct => match name {
            "Array" => "return new Array<number>(2).length;".into(),
            "ArrayBuffer" => "return new ArrayBuffer(8).byteLength;".into(),
            "DataView" => "return new DataView(new ArrayBuffer(8)).byteLength;".into(),
            "Date" => "return new Date(0).getTime();".into(),
            "Map" => "return new Map<number, number>().size;".into(),
            "Set" => "return new Set<number>().size;".into(),
            "Promise" => "return new Promise<number>(resolve => resolve(1));".into(),
            "AggregateError" => "return new AggregateError([1], \"x\").message;".into(),
            name if hir::builtin::TYPED_ARRAYS.contains(&name) => {
                format!("return new {name}(2).length;")
            }
            _ => format!("return new {name}(\"x\").message;"),
        },
        Use::Call => match name {
            "Symbol" => "return Symbol(\"x\");".into(),
            "BigInt" | "Boolean" | "Number" | "String" | "isFinite" | "isNaN" => {
                format!("return {name}(1);")
            }
            "parseInt" | "parseFloat" => format!("return {name}(\"12\");"),
            "setInterval" | "setTimeout" => format!("return {name}(() => {{}}, 1);"),
            "clearInterval" | "clearTimeout" => {
                format!("const timer = setTimeout(() => {{}}, 1); {name}(timer); return timer;")
            }
            _ => format!("return {name}(\"abc\");"),
        },
    }
}

#[test]
fn every_published_member_has_a_surviving_lowering_witness() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let cache = std::env::var_os("TMPDIR").map_or_else(
        || root.join("target").into_std_path_buf(),
        std::path::PathBuf::from,
    );
    let path = cache.join(format!(
        "nts-compiler-provider-witnesses-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&path).expect("create provider witness project");
    let directory = Directory(path);
    let config = directory.0.join("tsconfig.json");
    std::fs::write(&config, r#"{"compilerOptions":{"target":"ESNext","lib":["ESNext","DOM"],"types":[],"strict":true},"files":["main.ts"]}"#).expect("write witness config");
    let mut source = String::new();
    let mut names = Vec::new();
    for provider in compiler_providers() {
        for member in &provider.members {
            let name = format!("{}_{}", provider.global, member.replace('.', "_"));
            writeln!(
                source,
                "export function {name}() {{ {} }}",
                witness(&provider, member)
            )
            .expect("append member witness");
            names.push(name);
        }
        for use_kind in &provider.uses {
            let name = format!("{}_{use_kind:?}", provider.global);
            writeln!(
                source,
                "export function {name}() {{ {} }}",
                global_witness(provider.global, *use_kind)
            )
            .expect("append global witness");
            names.push(name);
        }
    }
    std::fs::write(directory.0.join("main.ts"), source).expect("write member witnesses");
    let mut frontend = Frontend::new(&root).with_checkers(std::num::NonZeroU16::MIN);
    let snapshot = frontend
        .snapshot(Utf8Path::from_path(&config).expect("UTF-8 witness config"))
        .expect("capture provider witnesses");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            roots: hir::reachable::Roots::EveryExport,
            ..hir::Options::default()
        },
    )
    .expect("valid prepared provider witnesses");
    let missing: Vec<_> = names
        .iter()
        .filter(|name| {
            !prepared
                .program
                .funcs
                .iter()
                .any(|func| func.name == **name)
        })
        .collect();
    assert!(
        missing.is_empty(),
        "members without emitted witnesses: {missing:?}; refusals: {:?}; diagnostics: {:?}",
        prepared.program.uncompiled,
        prepared.diagnostics
    );
    assert!(
        prepared.program.refused_bodies().next().is_none(),
        "{:?}",
        prepared.program.uncompiled
    );
}
