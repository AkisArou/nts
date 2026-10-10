//! Native columns are read at each backend boundary, including host callbacks.
use super::{counted_caller, expect, prepare, run_on_both_backends};
use nts_core::hir::{self, Callee, OpKind, Provider};

// The override reserves a logical selector, but nobody calls that method.
// The closure selector must therefore move when projected.
const SHAPES: &str = r"
class Base { value = 1; unused(): number { return 1; } }
class Derived extends Base { extra = 2; override unused(): number { return 2; } }
export function concrete(): number {
    return new Base().value + new Derived().extra;
}
";

fn require_moved_closure(program: &hir::Program) {
    let logical = hir::closure_call_slot(program);
    let column = program.native_column(logical).expect("closure reader");
    assert_ne!(logical, column, "the callback must exercise a moved column");
}

#[test]
fn an_omitted_live_column_is_rejected_at_both_native_emitters() {
    let source = r"
class Base { a(): number { return 3; } read(): number { return 1; } }
class Derived extends Base {
    override a(): number { return 4; }
    override read(): number { return 2; }
}
export function read(other: boolean): number {
    const value: Base = other ? new Derived() : new Base();
    return value.read();
}
";
    let Some((_, mut prepared)) = prepare("dispatch-sabotage", source) else {
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emit_c =
        |program: &hir::Program| nts_codegen_c::emit(program, hir::native::NativeAbi::LP64);
    let first = emit_c(&prepared.program);
    assert!(first.is_complete(), "{:?}", first.diagnostics);
    let (_, again) = prepare("dispatch-sabotage", source).expect("same frontend");
    assert_eq!(first.writer.text(), emit_c(&again.program).writer.text());
    let slot = prepared
        .program
        .funcs
        .iter()
        .flat_map(|f| &f.values)
        .find_map(|op| {
            if let OpKind::Call {
                callee: Callee::Virtual { slot, .. },
                ..
            } = op.kind
            {
                Some(slot)
            } else {
                None
            }
        })
        .expect("a real table reader");
    // The exported callback constant must remain valid, so the rejection
    // proves the actual virtual-call emitter checked its own reader.
    assert_ne!(slot, hir::closure_call_slot(&prepared.program));
    prepared
        .program
        .native_dispatch
        .as_mut()
        .expect("plan")
        .columns[slot as usize] = None;
    let errors = hir::verify::verify(&prepared.program).expect_err("missing column");
    assert!(errors.iter().any(|error| matches!(error,
        hir::verify::Invalid::MissingNativeColumn { slot: missing, .. } if *missing == slot
    )));
    let c = emit_c(&prepared.program);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    for diagnostics in [&c.diagnostics, &llvm.diagnostics] {
        assert!(
            diagnostics
                .iter()
                .any(|d| d.message.contains("has no native dispatch column")),
            "the actual table load must reject an omitted column: {diagnostics:?}"
        );
    }
}

#[test]
fn promise_and_timer_callbacks_read_the_moved_column() {
    let source = format!(
        r"
{SHAPES}
let total = 0;
function record(n: number): void {{ total += n; }}
async function later(n: number): Promise<number> {{ return n + 1; }}
export function schedule(n: number): number {{
    later(n).then(value => record(value));
    setTimeout(() => record(n * 100), 1);
    return total;
}}
export function observed(): number {{ return total; }}
"
    );
    let Some((_, prepared)) = prepare("dispatch-callback-readers", &source) else {
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    require_moved_closure(&prepared.program);
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .flat_map(|f| &f.values)
            .any(|op| matches!(op.kind, OpKind::PromiseSubscribe { .. }))
    );
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .flat_map(|f| &f.values)
            .any(|op| matches!(op.kind, OpKind::DispatchSlot(_)))
    );
    let library = format!(
        "{}\n{}",
        include_str!("../../../../../runtime/c/nts_test_host.h"),
        include_str!("../../../../../runtime/c/nts_test_host.c")
            .replace("#include \"nts_test_host.h\"", "")
    );
    let caller = r#"
#include "program.h"
#include <stdio.h>
void nts_test_host_install(void);
uint32_t nts_test_host_run(uint32_t);
int main(void) {
    nts_test_host_install();
    size_t before = nts_live_count();
    for (int i = 0; i < 50; ++i) {
        schedule(7);
        if (observed() != i * 708.0) return 1;
        nts_test_host_run(64);
        if (observed() != (i + 1) * 708.0) return 2;
    }
    nts_collect_cycles();
#ifdef NTS_PROVIDER_RC
    if (nts_live_count() != before) return 3;
#else
    (void)before;
#endif
    printf("%.0f", observed());
    return 0;
}
"#;
    for provider in [Provider::NoGc, Provider::ReferenceCounting] {
        let Some((_, outputs)) =
            run_on_both_backends("dispatch-callbacks", &source, provider, &library, caller)
        else {
            return;
        };
        for output in outputs {
            assert_eq!(output, "35400");
        }
    }
}

#[test]
fn a_context_bridge_reads_the_moved_column_of_an_unknown_closure() {
    let source = format!(
        r#"
import type {{ c_int }} from "@nts/scalars";
import type {{ ScopedClosure }} from "c:types";
{SHAPES}
declare function apply(f: ScopedClosure<(n: c_int) => c_int>, n: c_int): c_int;
export function forward(f: (n: c_int) => c_int, n: c_int): number {{ return apply(f, n); }}
function first(n: c_int): c_int {{ return ((n + 3) | 0) as c_int; }}
function second(n: c_int): c_int {{ return ((n + 7) | 0) as c_int; }}
export function run(n: c_int): number {{
    const callbacks = [first, second];
    return forward(callbacks[n & 1], n);
}}
"#
    );
    let Some((_, prepared)) = prepare("dispatch-context-reader", &source) else {
        return;
    };
    require_moved_closure(&prepared.program);
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .any(|f| f.values.iter().any(|op| {
                let OpKind::NativeBridge {
                    closure,
                    context: true,
                    ..
                } = op.kind
                else {
                    return false;
                };
                let hir::HirType::Managed(hir::ManagedType::Object(ty)) = f.value(closure).ty
                else {
                    return false;
                };
                prepared
                    .program
                    .layouts
                    .iter()
                    .find(|l| l.types.contains(&ty))
                    .is_some_and(|l| hir::bridged_through_table(&prepared.program, l).is_some())
            })),
        "the bridge must load through a signature rather than name a body"
    );
    let library =
        "int apply(int (*f)(int, void *), void *context, int n) { return f(n, context); }";
    for provider in [Provider::NoGc, Provider::ReferenceCounting] {
        let caller = counted_caller(r#"printf("%.0f %.0f", run(4), run(5));"#, "run(4); run(5);");
        let Some((_, outputs)) =
            run_on_both_backends("dispatch-context", &source, provider, library, &caller)
        else {
            return;
        };
        for output in outputs {
            assert_eq!(output, expect("7 12", provider));
        }
    }
}
