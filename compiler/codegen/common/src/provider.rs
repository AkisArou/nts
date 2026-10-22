//! Planning and integrity checks shared by host-managed backends.

use nts_core::hir::{OpKind, Program, Provider};
use nts_diagnostics::Diagnostic;

/// Select host-owned memory, refusing a conflicting native counting request.
/// The backend name makes a boundary decline actionable without a fake Origin.
///
/// # Errors
/// Returns a named decline when reference counting was requested.
pub fn host_gc(backend: &str, counting: bool) -> Result<Provider, String> {
    if counting {
        return Err(format!(
            "NTS2001: {backend} declines --rc: managed memory belongs to the host GC"
        ));
    }
    Ok(Provider::HostGc)
}

/// Find counting operations that survived a host-GC preparation.
///
/// The input has passed the core verifier. Native providers retain their own
/// lifetime contract; this check only applies to `HostGc`. Preparation omits
/// managed-reference lifetimes. Foreign ownership markers and markers added
/// after provider lowering must still produce diagnostics at this boundary.
#[must_use]
pub fn host_gc_diagnostics(program: &Program, backend: &str) -> Vec<Diagnostic> {
    if program.provider != Provider::HostGc {
        return Vec::new();
    }
    let mut diagnostics = Vec::new();
    for func in &program.funcs {
        if func.abstract_declaration {
            continue;
        }
        for block in crate::block_order(func) {
            for id in &func.blocks[block.0 as usize].ops {
                let op = func.value(*id);
                if matches!(op.kind, OpKind::Retain(_) | OpKind::Release(_)) {
                    diagnostics.push(Diagnostic::error(
                        "NTS2001",
                        format!(
                            "{backend} declines `{}`: {:?} survived HostGc preparation",
                            func.name, op.kind
                        ),
                        op.origin.location,
                    ));
                }
            }
        }
    }
    diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use nts_core::hir::{
        Block, Func, HirType, ManagedType, Op, Param, ParamShape, Terminator, ValueId,
    };
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    fn markers(provider: Provider) -> Program {
        let origin = Origin::source(Location {
            file: SourceId(0),
            span: Span::new(1, 2),
        });
        let ty = HirType::Managed(ManagedType::String);
        let func = Func {
            name: "resume".to_owned(),
            params: vec![Param {
                name: "frame".to_owned(),
                ty: ty.clone(),
                origin: origin.clone(),
                shape: ParamShape::Ordinary,
                known: nts_core::hir::facts::Facts::TOP,
                written: None,
            }],
            return_type: HirType::Void,
            written_return: None,
            result_absent: nts_core::hir::Absent::Impossible,
            written_return_elements: Vec::new(),
            values: vec![
                Op {
                    kind: OpKind::Param(0),
                    ty,
                    origin: origin.clone(),
                },
                Op {
                    kind: OpKind::Retain(ValueId(0)),
                    ty: HirType::Void,
                    origin: origin.clone(),
                },
                Op {
                    kind: OpKind::Release(ValueId(0)),
                    ty: HirType::Void,
                    origin: origin.clone(),
                },
            ],
            blocks: vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                terminator: Terminator::Return(None),
            }],
            origin,
            exported: true,
            initializes_receiver: false,
            abstract_declaration: false,
            async_result: None,
            frame: None,
            obligations: Vec::new(),
            exact: nts_core::hir::ExactArithmetic::default(),
        };
        Program {
            funcs: vec![func],
            provider,
            ..Program::default()
        }
    }

    #[test]
    fn both_managed_targets_refuse_counting_by_name() {
        for backend in ["jvm", "wasm"] {
            assert_eq!(host_gc(backend, false), Ok(Provider::HostGc));
            let Err(message) = host_gc(backend, true) else {
                panic!("counting accepted")
            };
            assert!(message.contains(backend) && message.contains("--rc"));
        }
    }

    #[test]
    fn surviving_counting_operations_have_source_diagnostics() {
        let program = markers(Provider::HostGc);
        assert!(nts_core::hir::verify::verify(&program).is_ok());
        let diagnostics = host_gc_diagnostics(&program, "jvm");
        assert_eq!(diagnostics.len(), 2);
        for diagnostic in diagnostics {
            assert_eq!(diagnostic.code, "NTS2001");
            assert!(diagnostic.message.contains("resume") && diagnostic.message.contains("HostGc"));
            assert_eq!(diagnostic.primary, program.funcs[0].origin.location);
        }
    }

    #[test]
    fn native_provider_lifetimes_are_not_reinterpreted() {
        for provider in [Provider::NoGc, Provider::ReferenceCounting] {
            assert!(host_gc_diagnostics(&markers(provider), "native").is_empty());
        }
    }
}
