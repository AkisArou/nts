//! Execute real table calls with Clang's function-type instrumentation.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use crate::scratch;
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use scratch::ScratchDir;
use std::process::Command;

fn run(name: &str, source: &str, expected: i32, reference_result: bool) {
    let caller = format!(
        "#include \"program.h\"\nint main(void) {{ return run(7.0) == {expected}.0 ? 0 : 1; }}\n"
    );
    execute(name, source, &caller, reference_result, true);
}

fn execute(name: &str, source: &str, caller: &str, reference_result: bool, table_call: bool) {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/dispatch-abi-tests"), name);
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "fixture must typecheck");
    let prepared = hir::prepare_with(&snapshot, &hir::Options::default()).unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert!(
        !table_call || text.contains("->header.descriptor->methods["),
        "must exercise an indirect table call: {text}"
    );
    if reference_result {
        assert!(
            text.contains("__nts_dispatch_") || text.contains("__nts_timer_"),
            "reference/ignored-result channel needs a compatible entry: {text}"
        );
    } else {
        assert!(
            !text.contains("__nts_dispatch_") && !text.contains("__nts_timer_"),
            "receiver-only entries need no adapter: {text}"
        );
    }
    std::fs::write(dir.join("program.c"), text).unwrap();
    std::fs::write(dir.join("program.h"), &emitted.header).unwrap();
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("caller.c"), caller).unwrap();
    for file in ["nts_test_host.h", "nts_test_host.c"] {
        std::fs::copy(root.join("runtime/c").join(file), dir.join(file)).unwrap();
    }
    let compile = Command::new("clang")
        .current_dir(&dir)
        .args([
            "-std=c11",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-O1",
            "-fsanitize=function",
            "-fno-sanitize-recover=function",
            "-I.",
            "caller.c",
            "program.c",
            "nts_runtime.c",
            "nts_test_host.c",
            "-lm",
            "-o",
            "caller",
        ])
        .output()
        .unwrap();
    assert!(
        compile.status.success(),
        "{}",
        String::from_utf8_lossy(&compile.stderr)
    );
    let output = Command::new(dir.join("caller")).output().unwrap();
    assert!(
        output.status.success(),
        "{:?}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn captured_typed_closures_define_the_same_receiver_type_their_slot_calls() {
    run(
        "closures",
        r"
export function run(n:number):number {
    const reads:Array<()=>number>=[()=>n,()=>n+1,()=>n+2];
    const read=reads[(((n|0)%3)+3)%3];
    return read();
}",
        8,
        false,
    );
}

#[test]
fn virtual_implementations_define_the_slots_canonical_receiver() {
    run(
        "virtual",
        r"
class Base { read():number { return 10; } }
class One extends Base { read():number { return 20; } }
class Two extends Base { read():number { return 30; } }
export function run(n:number):number {
    const choice=((n|0)%3+3)%3;
    const values:Base[]=[new Base(),new One(),new Two()];
    return values[choice].read();
}",
        20,
        false,
    );
}

#[test]
fn a_covariant_reference_answer_has_a_real_canonical_result_adapter() {
    run(
        "reference",
        r"
class Base { value:number=10; clone():Base { return this; } }
class One extends Base {
    constructor(){ super(); this.value=20; }
    clone():One { return this; }
}
class Two extends Base {
    constructor(){ super(); this.value=30; }
    clone():Two { return this; }
}
export function run(n:number):number {
    const values:Base[]=[new Base(),new One(),new Two()];
    return values[(((n|0)%3)+3)%3].clone().value;
}",
        20,
        true,
    );
}

#[test]
fn a_timers_ignored_return_keeps_its_actual_void_entry_type() {
    let source = r"
let answer=0;
export function run(n:number):void {
    setTimeout(()=>{ answer=n; return n+1; },0);
}
export function readAnswer():number { return answer; }
";
    let caller = "#include \"program.h\"\n#include \"nts_test_host.h\"\nint main(void) { nts_test_host_install(); run(7.0); nts_test_host_run(8); return readAnswer()==7.0?0:1; }\n";
    execute(
        "timer-control",
        &source.replace("return n+1;", "return;"),
        caller,
        false,
        false,
    );
    execute("timer-result", source, caller, true, false);
}

#[test]
fn dropped_virtual_parameters_are_unused_physical_parameters_without_an_adapter() {
    run(
        "dropped-parameters",
        r"
class Base { read(n:number):number { return 10+n; } }
class One extends Base { override read():number { return 20; } }
class Two extends Base { override read():number { return 30; } }
function own(value:One):number { return value.read(); }
export function run(n:number):number {
    const values:Base[]=[new Base(),new One(),new Two()];
    return values[(((n|0)%3)+3)%3].read(n) + own(new One());
}",
        40,
        false,
    );
}

#[test]
fn raising_overrides_keep_the_shared_physical_parameter_tail() {
    run(
        "dropped-raising",
        r"
class Base { read(n:number):number { if(n<0)throw new RangeError('base'); return 10; } }
class One extends Base { override read():number { throw new RangeError('child'); } }
export function run(n:number):number {
    const values:Base[]=[new Base(),new One()];
    try { return values[(n|0)&1].read(n); } catch { return 17; }
}",
        17,
        false,
    );
}

#[test]
fn a_printer_role_keeps_its_one_parameter_after_virtual_arity_unification() {
    run(
        "printer-arity",
        r"
class Base { toString(_n?:number):string { return 'base'; } }
class Child extends Base { override toString():string { return 'child'; } }
export function run(n:number):number {
 const values:Base[]=[new Base(),new Child()];
 const value=values[(n|0)&1];
 return value.toString(n).length + String(value).length;
}",
        10,
        false,
    );
}
