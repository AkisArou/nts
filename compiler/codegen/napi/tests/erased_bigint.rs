//! A real Node caller crosses the erased primitive boundary and observes owned
//! native storage. Values outside the signed 128-bit profile must not truncate.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use nts_core::hir::{self, HirType, OpKind, ValueId};
use nts_semantic_schema::Origin;
use std::path::{Path, PathBuf};
use std::process::Command;

fn origin() -> Origin {
    Origin::source(nts_diagnostics::Location {
        file: nts_diagnostics::SourceId(0),
        span: nts_diagnostics::Span::new(0, 1),
    })
}

fn function(
    name: &str,
    params: usize,
    body: Vec<(OpKind, HirType)>,
    result: Option<ValueId>,
) -> hir::Func {
    let values: Vec<_> = (0..params)
        .map(|slot| (OpKind::Param(u32::try_from(slot).unwrap()), HirType::Erased))
        .chain(body)
        .map(|(kind, ty)| hir::Op {
            kind,
            ty,
            origin: origin(),
        })
        .collect();
    hir::Func {
        name: name.into(),
        params: (0..params)
            .map(|slot| hir::Param {
                name: format!("arg{slot}"),
                ty: HirType::Erased,
                origin: origin(),
                shape: hir::ParamShape::Ordinary,
                known: hir::facts::Facts::TOP,
            })
            .collect(),
        return_type: result.map_or(HirType::Void, |value| values[value.0 as usize].ty.clone()),
        blocks: vec![hir::Block {
            params: Vec::new(),
            ops: (0..values.len())
                .map(|at| ValueId(u32::try_from(at).unwrap()))
                .collect(),
            terminator: hir::Terminator::Return(result),
        }],
        values,
        origin: origin(),
        exported: true,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
    }
}

fn store_then_throw() -> hir::Func {
    let mut store_then_throw = function(
        "storeThenThrow",
        1,
        vec![
            (
                OpKind::GlobalSet {
                    global: 0,
                    value: ValueId(0),
                },
                HirType::Void,
            ),
            (OpKind::ConstUndefined, HirType::Erased),
            (
                OpKind::ConstNull,
                HirType::Managed(hir::ManagedType::String),
            ),
            (
                OpKind::Call {
                    callee: hir::Callee::External("nts_uncaught".into()),
                    args: vec![ValueId(2), ValueId(3)],
                    frame: None,
                },
                HirType::Void,
            ),
        ],
        None,
    );
    store_then_throw.blocks[0].terminator = hir::Terminator::Unreachable;
    store_then_throw
}

fn throws_primitive() -> hir::Func {
    let mut throw_value = function(
        "throwValue",
        1,
        vec![
            (
                OpKind::ConstNull,
                HirType::Managed(hir::ManagedType::String),
            ),
            (
                OpKind::Call {
                    callee: hir::Callee::External("nts_uncaught".into()),
                    args: vec![ValueId(0), ValueId(1)],
                    frame: None,
                },
                HirType::Void,
            ),
        ],
        None,
    );
    throw_value.blocks[0].terminator = hir::Terminator::Unreachable;
    throw_value
}

fn program() -> hir::Program {
    let mut program = hir::Program {
        provider: hir::Provider::ReferenceCounting,
        funcs: vec![
            function("echo", 1, Vec::new(), Some(ValueId(0))),
            function("first", 2, Vec::new(), Some(ValueId(0))),
            function(
                "store",
                1,
                vec![(
                    OpKind::GlobalSet {
                        global: 0,
                        value: ValueId(0),
                    },
                    HirType::Void,
                )],
                None,
            ),
            function(
                "read",
                0,
                vec![(OpKind::GlobalGet(0), HirType::Erased)],
                Some(ValueId(0)),
            ),
            function(
                "clear",
                0,
                vec![
                    (OpKind::ConstUndefined, HirType::Erased),
                    (
                        OpKind::GlobalSet {
                            global: 0,
                            value: ValueId(0),
                        },
                        HirType::Void,
                    ),
                ],
                None,
            ),
        ],
        globals: vec![hir::Global {
            name: "held".into(),
            ty: HirType::Erased,
            initial: 0.0,
            exported: false,
            deferred: false,
            origin: origin(),
        }],
        ..hir::Program::default()
    };
    let mut typed = function("typedEcho", 1, Vec::new(), Some(ValueId(0)));
    typed.params[0].ty = HirType::BigInt;
    typed.values[0].ty = HirType::BigInt;
    typed.return_type = HirType::BigInt;
    program.funcs.push(typed);
    program
        .funcs
        .extend([store_then_throw(), throws_primitive()]);
    program.public_api = program
        .funcs
        .iter()
        .map(|func| (func.name.clone(), func.name.clone()))
        .collect();
    program.public_functions = program.funcs.iter().map(|func| func.name.clone()).collect();
    program
}

fn headers() -> Option<PathBuf> {
    let supplied = std::env::var_os("NTS_NAPI_INCLUDE").map(PathBuf::from);
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../third_party/node/src");
    let node = Command::new("node")
        .args(["-p", "process.execPath"])
        .output()
        .ok();
    let installed = node.and_then(|output| {
        let binary = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
        Some(binary.parent()?.parent()?.join("include/node"))
    });
    supplied
        .into_iter()
        .chain([repo])
        .chain(installed)
        .find(|path| path.join("node_api.h").exists())
}

fn emit_client(program: &hir::Program, headers: &Path, dir: &Path) -> PathBuf {
    let mut emitted_program = program.clone();
    hir::rc::insert(&mut emitted_program);
    let emitted = nts_codegen_c::emit(&emitted_program, hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let addon = nts_codegen_napi::emit(program);
    assert!(addon.skipped.is_empty(), "{:?}", addon.skipped);
    // Observe the allocator through a test-only Node callback. All tested
    // crossings and ownership decisions remain the actual emitted wrappers.
    let observed = addon.source.replacen(
        "NAPI_MODULE_INIT() {",
        r#"
static napi_value live(napi_env env, napi_callback_info info) {
    (void)info;
    nts_collect_cycles();
    napi_value out;
    napi_create_double(env, (double)nts_live_bytes(), &out);
    return out;
}
NAPI_MODULE_INIT() {
    napi_value probe;
    napi_create_function(env, "live", NAPI_AUTO_LENGTH, live, NULL, &probe);
    napi_set_named_property(env, exports, "live", probe);
"#,
        1,
    );
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    std::fs::write(dir.join("addon.c"), observed).unwrap();
    let mut sources = vec![dir.join("program.c"), dir.join("addon.c")];
    for file in emitted.support_files() {
        let path = file.write(dir).unwrap();
        if file.compiled {
            sources.push(path);
        }
    }
    let binary = dir.join("probe.node");
    let built = Command::new("clang")
        .args([
            "-std=c11",
            "-O1",
            "-fPIC",
            "-shared",
            "-DNTS_PROVIDER_RC",
            "-DNAPI_VERSION=8",
        ])
        .arg("-I")
        .arg(dir)
        .arg("-I")
        .arg(headers)
        .arg("-o")
        .arg(&binary)
        .args(sources)
        .arg("-lm")
        .output()
        .unwrap();
    assert!(
        built.status.success(),
        "{}",
        String::from_utf8_lossy(&built.stderr)
    );
    binary
}

const CLIENT_SCRIPT: &str = r"
const assert = require('node:assert/strict');
const a = require(process.argv[1]);
for (const name of ['echo', 'typedEcho', 'first', 'store', 'storeThenThrow', 'throwValue', 'read', 'clear', 'live']) {
  assert.equal(typeof a[name], 'function', name);
}
const baseline = a.live();
function assertThrown(value) {
  let caught = false;
  try { a.throwValue(value); } catch (thrown) {
    caught = true;
    assert.ok(Object.is(thrown, value), 'a thrown primitive crosses unchanged');
  }
  assert.ok(caught);
}
const values = [0n, -1n, 9007199254740993n, (1n << 64n) + 7n,
                (1n << 127n) - 1n, -(1n << 127n)];
for (let repeat = 0; repeat < 100; repeat++) {
  for (const value of values) {
    assert.equal(a.echo(value), value);
    assert.equal(a.typedEcho(value), value);
    assertThrown(value);
    assert.equal(a.first(value, 'discarded'), value);
    assert.equal(a.first('kept', value), 'kept');
    a.store(value);
    assert.equal(a.read(), value);
    a.clear();
    let caught = false;
    try { a.storeThenThrow(value); } catch (thrown) {
      caught = true;
      assert.equal(thrown, undefined);
    }
    assert.ok(caught, 'compiled throw reaches the wrapper');
    assert.ok(a.live() > baseline, 'the global still owns its payload after a throw');
    assert.equal(a.read(), value);
    a.clear();
  }
  for (const value of ['\ud800', 'plain', true, -0, NaN, Infinity, null, undefined]) {
    assert.ok(Object.is(a.echo(value), value));
    assertThrown(value);
  }
  for (const value of [1n << 127n, -(1n << 127n) - 1n, 1n << 256n]) {
    assert.throws(() => a.echo(value), {name: 'RangeError', code: 'ERR_OUT_OF_RANGE'});
    assert.throws(() => a.typedEcho(value), {name: 'RangeError', code: 'ERR_OUT_OF_RANGE'});
    assert.throws(() => a.first('owned before failure', value), RangeError);
  }
  for (const value of [Symbol('x'), {}, () => 1]) {
    assert.throws(() => a.echo(value), TypeError);
  }
  for (const value of [0, '1', null, undefined]) {
    assert.throws(() => a.typedEcho(value), TypeError);
  }
  assert.equal(a.live(), baseline, 'each boundary releases its native payload');
}
console.log('signed 128-bit boundary, failure cleanup and 100 ownership rounds passed');
";

#[test]
fn erased_bigints_cross_without_rounding_truncation_or_leaks() {
    let Some(headers) = headers() else {
        assert!(
            std::env::var_os("NTS_TESTS_REQUIRE_TOOLING").is_none(),
            "missing Node-API headers"
        );
        eprintln!("SKIP erased BigInt boundary: Node-API headers are required");
        return;
    };
    let program = program();
    assert!(hir::verify::verify(&program).is_ok());
    let dir = std::env::temp_dir().join(format!("nts-erased-bigint-node-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let binary = emit_client(&program, &headers, &dir);

    let ran = Command::new("node")
        .args(["-e", CLIENT_SCRIPT])
        .arg(&binary)
        .output()
        .unwrap();
    assert!(
        ran.status.success(),
        "{}{}",
        String::from_utf8_lossy(&ran.stdout),
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(String::from_utf8_lossy(&ran.stdout).contains("100 ownership rounds passed"));
    std::fs::remove_dir_all(dir).unwrap();
}
