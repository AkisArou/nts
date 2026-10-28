//! Exercise the helper's three results through each real backend, independently
//! of the lowering's branch that consumes them.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use super::*;
use nts_core::hir::{
    Absent, Block, Callee, Func, ManagedType, Memory, Op, OpKind, Terminator, ValueId,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Case {
    Other,
    Absent,
    Present,
    Number,
    Map,
}

fn origin() -> nts_semantic_schema::Origin {
    nts_semantic_schema::Origin::source(nts_diagnostics::Location {
        file: nts_diagnostics::SourceId(0),
        span: nts_diagnostics::Span { start: 0, end: 0 },
    })
}

fn push(values: &mut Vec<Op>, kind: OpKind, ty: HirType) -> ValueId {
    let id = ValueId(u32::try_from(values.len()).unwrap());
    values.push(Op {
        kind,
        ty,
        origin: origin(),
    });
    id
}

fn erase(values: &mut Vec<Op>, value: ValueId) -> ValueId {
    push(
        values,
        OpKind::Erase {
            value,
            absent: Absent::Impossible,
            slots: Absent::Impossible,
        },
        HirType::Erased,
    )
}

fn call(values: &mut Vec<Op>, name: &str, args: Vec<ValueId>, ty: HirType) -> ValueId {
    push(
        values,
        OpKind::Call {
            callee: Callee::External(name.into()),
            args,
            frame: None,
        },
        ty,
    )
}

fn function(name: &str, case: Case) -> Func {
    let mut values = Vec::new();
    let text = push(
        &mut values,
        OpKind::ConstString("key".into()),
        HirType::Managed(ManagedType::String),
    );
    let key = erase(&mut values, text);
    let receiver = if case == Case::Other {
        let number = push(&mut values, OpKind::ConstFloat(9.0), HirType::NUMBER);
        erase(&mut values, number)
    } else {
        let element = if case == Case::Number {
            HirType::NUMBER
        } else {
            HirType::Erased
        };
        let map = if case == Case::Map {
            ManagedType::Map(
                Box::new(HirType::Managed(ManagedType::String)),
                Box::new(element),
            )
        } else {
            ManagedType::Table(
                Box::new(HirType::Managed(ManagedType::String)),
                Box::new(element),
            )
        };
        let kind = push(&mut values, OpKind::ConstFloat(1.0), HirType::NUMBER);
        let table = call(
            &mut values,
            if case == Case::Map {
                "nts_map_new"
            } else {
                "nts_table_new"
            },
            vec![kind],
            HirType::Managed(map),
        );
        if case != Case::Absent {
            let value = if case == Case::Number {
                let number = push(&mut values, OpKind::ConstFloat(0.0), HirType::NUMBER);
                erase(&mut values, number)
            } else {
                push(&mut values, OpKind::ConstUndefined, HirType::Erased)
            };
            let kind = push(
                &mut values,
                OpKind::ConstInt(1),
                HirType::Int {
                    bits: 32,
                    signed: false,
                },
            );
            call(
                &mut values,
                "nts_map_set",
                vec![table, key, value, kind],
                HirType::Void,
            );
        }
        erase(&mut values, table)
    };
    let result = call(
        &mut values,
        "nts_table_membership",
        vec![receiver, key],
        HirType::Int {
            bits: 32,
            signed: true,
        },
    );
    let answer = push(&mut values, OpKind::Convert(result), HirType::NUMBER);
    let ops = (0..values.len())
        .map(|at| ValueId(u32::try_from(at).unwrap()))
        .collect();
    Func {
        name: name.into(),
        params: Vec::new(),
        return_type: HirType::NUMBER,
        written_return: None,
        written_return_elements: Vec::new(),
        result_absent: Absent::Impossible,
        values,
        blocks: vec![Block {
            params: Vec::new(),
            ops,
            terminator: Terminator::Return(Some(answer)),
        }],
        origin: origin(),
        exported: true,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: hir::ExactArithmetic::default(),
    }
}

#[test]
fn all_three_results_agree_on_every_backend() {
    const TEST: &str = "table_membership_tests::all_three_results_agree_on_every_backend";
    if std::env::var_os("NTS_TABLE_MEMBERSHIP_ARM").is_none() {
        for backend in ["c", "llvm", "jvm"] {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", TEST, "--nocapture"])
                .env("NTS_TABLE_MEMBERSHIP_ARM", backend)
                .env("NTS_BACKEND", backend)
                .env_remove("NTS_RC")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{backend}: {}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }
        return;
    }
    let backend = Backend::from_environment().unwrap();
    let cases = [
        ("aOther", Case::Other, -1.0_f64),
        ("bAbsent", Case::Absent, 0.0),
        ("cPresent", Case::Present, 1.0),
        ("dNumber", Case::Number, 1.0),
        ("eMap", Case::Map, -1.0),
    ];
    let program = hir::Program {
        funcs: cases
            .iter()
            .map(|(name, case, _)| function(name, *case))
            .collect(),
        public_api: cases
            .iter()
            .map(|(name, _, _)| ((*name).into(), (*name).into()))
            .collect(),
        provider: if matches!(backend, Backend::C | Backend::Llvm) {
            Memory::NoGc
        } else {
            Memory::HostGc
        },
        ..hir::Program::default()
    };
    let testable: Vec<_> = cases
        .iter()
        .map(|(name, _, _)| Testable {
            name: (*name).into(),
            returns: HirType::NUMBER,
            result_absent: Absent::Impossible,
            params: Vec::new(),
            input_pools: None,
            excluded_tuples: Vec::new(),
        })
        .collect();
    let path = Utf8PathBuf::from_path_buf(
        std::env::temp_dir().join(format!("nts-table-membership-{}", std::process::id())),
    )
    .unwrap();
    std::fs::create_dir_all(&path).unwrap();
    let scratch = Scratch::holding(path);
    let mut refused = Vec::new();
    let mut aborts = Vec::new();
    let mut timeouts = 0;
    let run = match backend {
        Backend::C | Backend::Llvm => run_native(
            &scratch.path,
            &program,
            &[],
            &testable,
            &mut refused,
            &mut aborts,
            &mut timeouts,
        ),
        Backend::Jvm => run_jvm(
            &scratch.path,
            &program,
            &[],
            &testable,
            &mut refused,
            &mut aborts,
            &mut timeouts,
        ),
    }
    .unwrap();
    let expected: Vec<_> = cases
        .iter()
        .map(|(name, _, value)| format!("{name} 0 {:016x}", value.to_bits()))
        .collect();
    assert_eq!(run.results, expected);
    assert!(refused.is_empty() && aborts.is_empty() && timeouts == 0);
}
