//! Observe the planner that normal lowering actually uses, from one capture.
//! The void-result fixture proves factory execution, not iterator consumption.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::cell::RefCell;

use nts_frontend_ts::Frontend;

use super::*;
use crate::hir::generics::{self, GenericFunctions};

#[derive(Default)]
struct Recording {
    stages: Vec<(&'static str, Vec<Site>)>,
}

struct Site {
    name: &'static str,
    call: NodeId,
    location: Location,
    body_location: Location,
    declared_argument: TypeKind,
    written_argument: TypeKind,
    resolved_argument: TypeKind,
    result: HirType,
    parameters: Vec<HirType>,
    detail: String,
}

thread_local! {
    static RECORDING: RefCell<Option<Recording>> = const { RefCell::new(None) };
}

// Restores the prior recorder on normal return AND unwinding; no process-wide
// environment switch, persistent callback, or cross-test planner state.
struct Scope(Option<Recording>);

impl Scope {
    fn start() -> Self {
        Self(RECORDING.with(|cell| cell.replace(Some(Recording::default()))))
    }

    fn finish(self) -> Recording {
        let recording = RECORDING.with(|cell| cell.borrow_mut().take().expect("armed recorder"));
        drop(self);
        recording
    }
}

impl Drop for Scope {
    fn drop(&mut self) {
        RECORDING.with(|cell| {
            drop(cell.replace(self.0.take()));
        });
    }
}

fn contract(snapshot: &SemanticSnapshot, ty: TypeId) -> String {
    let record = &snapshot.types[ty.0 as usize];
    let arguments: Vec<_> = snapshot
        .type_arguments
        .get(&ty)
        .into_iter()
        .flatten()
        .map(|arg| (*arg, &snapshot.types[arg.0 as usize].kind))
        .collect();
    format!(
        "{ty:?} symbol={:?} args={arguments:?} repr={:?}",
        record.symbol,
        representation(snapshot, ty)
    )
}

fn first_argument(snapshot: &SemanticSnapshot, ty: TypeId) -> TypeKind {
    let argument = snapshot.type_arguments[&ty][0];
    snapshot.types[argument.0 as usize].kind.clone()
}

// Called only on the actual body Shared after alias/fallback registration,
// not on the earlier initializer-probing Shared. It NEVER rebuilds the
// planner, materialises again, or asks the frontend another question.
pub(super) fn observe(
    stage: &'static str,
    snapshot: &LoweringSnapshot<'_>,
    planner: &GenericFunctions,
) {
    if !RECORDING.with(|cell| cell.borrow().is_some()) {
        return;
    }
    let probe = FuncBuilder::probe(snapshot);
    let mut sites = Vec::new();
    for (call, target) in &snapshot.call_targets {
        let children = probe.children(*call);
        let Some(text) = children.first().and_then(|id| {
            snapshot.nodes[id.0 as usize]
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
        }) else {
            continue;
        };
        let name = match text {
            "selected" => "selected",
            "closed" => "closed",
            _ => continue,
        };
        let declaration = target.callee.expect("decoded selected overload");
        let implementation = snapshot.implementation_of(declaration);
        let declared = generics::declared_signature(snapshot, declaration)
            .expect("selected declaration signature");
        let body_signature = generics::declared_signature(snapshot, implementation);
        let resolved = &snapshot.signatures[target.signature.0 as usize];
        // A body's node type can expose its overload signature. Read the
        // explicit written annotation independently, not from that alias.
        let annotations: Vec<_> = probe
            .children(implementation)
            .into_iter()
            .filter(|id| probe.kind_of(*id) == Some(syntax::TYPE_REFERENCE))
            .collect();
        assert_eq!(annotations.len(), 1, "one explicit factory result");
        let annotation = annotations[0];
        let written = snapshot.node_types[&annotation];
        let location = snapshot.nodes[call.0 as usize].origin.location;
        let body_location = snapshot.nodes[implementation.0 as usize].origin.location;
        let source = &snapshot.sources[location.file.0 as usize].display_path;
        let detail = format!(
            "source={source} stage={stage} name={name} call={call:?} location={location:?}\n\
             target={target:?} selected-node-type={:?} selected={declared:#?}\n\
             implementation={implementation:?} body={body_location:?} has-body={} \
             body-node-type={:?} body-signature={body_signature:#?}\n\
             annotation={annotation:?} written={} declared={} resolved={}\n\
             signature-id={:?} resolved-signature={resolved:#?}\n\
             selected-copies={:#?} implementation-copies={:#?}\n\
             selected-fallback={:#?} implementation-fallback={:#?}\n\
             at_call={:?} at_call_in={:?} at_call_in_copy={:?}",
            snapshot.node_types.get(&declaration),
            probe.has_a_body(implementation),
            snapshot.node_types.get(&implementation),
            contract(snapshot, written),
            contract(snapshot, declared.return_type),
            contract(snapshot, resolved.return_type),
            target.signature,
            planner.copies.get(&declaration),
            planner.copies.get(&implementation),
            planner.value_fallbacks.get(&declaration),
            planner.value_fallbacks.get(&implementation),
            planner.at_call.get(call),
            planner
                .at_call_in
                .iter()
                .filter_map(|(owner, calls)| calls.get(call).map(|suffix| (owner, suffix)))
                .collect::<Vec<_>>(),
            planner
                .at_call_in_copy
                .iter()
                .filter_map(|(owner, calls)| calls.get(call).map(|suffix| (owner, suffix)))
                .collect::<Vec<_>>(),
        );
        sites.push(Site {
            name,
            call: *call,
            location,
            body_location,
            declared_argument: first_argument(snapshot, declared.return_type),
            written_argument: first_argument(snapshot, written),
            resolved_argument: first_argument(snapshot, resolved.return_type),
            result: representation(snapshot, resolved.return_type).expect("owned result ABI"),
            parameters: resolved
                .parameters
                .iter()
                .map(|parameter| representation(snapshot, parameter.ty).expect("scalar parameter"))
                .collect(),
            detail,
        });
    }
    sites.sort_by_key(|site| site.call.0);
    RECORDING.with(|cell| {
        cell.borrow_mut()
            .as_mut()
            .expect("armed recorder")
            .stages
            .push((stage, sites));
    });
}

fn call_at<'a>(program: &'a Program, site: &Site) -> (&'a Func, &'a Op) {
    let matches: Vec<_> = program
        .funcs
        .iter()
        .flat_map(|func| {
            func.blocks.iter().flat_map(move |block| {
                block
                    .ops
                    .iter()
                    .map(move |value| (func, *value, &func.values[value.0 as usize]))
            })
        })
        .filter(|(_, _, op)| {
            op.origin.location == site.location
                && matches!(
                    op.kind,
                    OpKind::Call {
                        callee: Callee::Direct(_),
                        ..
                    }
                )
        })
        .collect();
    assert_eq!(matches.len(), 1, "one active direct call: {}", site.detail);
    let (caller, value, op) = matches[0];
    eprintln!("lowered {} {value:?}: {op:#?}", caller.name);
    (caller, op)
}

// Fixture-specific equality is intentional. verify::compatible accepts object
// pointers with different contracts; that is not proof this selected result
// and its body are the SAME specialised return contract. This adds no general
// verifier rule or claim about iterator payload/Promise fulfillment semantics.
fn same_result_contract(call: &Op, body: &Func) -> Result<(), &'static str> {
    let OpKind::Call {
        callee: Callee::Direct(name),
        ..
    } = &call.kind
    else {
        return Err("not a direct call");
    };
    if name != &body.name {
        return Err("different callee");
    }
    if call.ty != body.return_type {
        return Err("different result contract");
    }
    Ok(())
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one captured producer anchors the coherence and name-only negative controls"
)]
fn a_result_only_overload_names_a_body_with_its_actual_result_contract() {
    let config = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/a-generic-overload-pins-only-its-result/tsconfig.json")
        .canonicalize_utf8()
        .expect("committed void-result fixture");
    let snapshot = Frontend::new(config.parent().unwrap())
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("one normal capture");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let scope = Scope::start();
    let lowered = lower(&snapshot);
    let recording = scope.finish();
    assert_eq!(recording.stages.len(), 1, "only the actual body Shared");
    assert_eq!(recording.stages[0].0, "shared-after-value-registration");
    for (stage, sites) in &recording.stages {
        assert_eq!(sites.len(), 2, "{stage}: subject and one-change control");
        for site in sites {
            eprintln!("{}", site.detail);
        }
    }
    let sites = &recording.stages[0].1;
    let selected = sites.iter().find(|site| site.name == "selected").unwrap();
    let closed = sites.iter().find(|site| site.name == "closed").unwrap();
    assert!(matches!(
        selected.declared_argument,
        TypeKind::TypeParameter { .. }
    ));
    assert!(matches!(selected.resolved_argument, TypeKind::String));
    for site in sites {
        assert!(matches!(site.written_argument, TypeKind::Unknown));
        eprintln!("implementation bodies at {:?}:", site.body_location);
        for body in lowered
            .program
            .funcs
            .iter()
            .filter(|body| body.origin.location == site.body_location)
        {
            eprintln!(
                "{} -> {:?} params={:?}",
                body.name, body.return_type, body.params
            );
        }
    }
    assert!(matches!(closed.declared_argument, TypeKind::Unknown));
    assert!(matches!(closed.resolved_argument, TypeKind::Unknown));
    let (control_caller, control_call) = call_at(&lowered.program, closed);
    assert_eq!(control_caller.name, "control");
    let OpKind::Call {
        callee: Callee::Direct(control_target),
        ..
    } = &control_call.kind
    else {
        unreachable!()
    };
    let control_body = lowered
        .program
        .funcs
        .iter()
        .find(|func| &func.name == control_target)
        .expect("control's actual body");
    assert_eq!(control_body.origin.location, closed.body_location);
    assert_eq!(same_result_contract(control_call, control_body), Ok(()));
    let (subject_caller, subject_call) = call_at(&lowered.program, selected);
    assert_eq!(subject_caller.name, "subject");
    let OpKind::Call {
        callee: Callee::Direct(subject_target),
        ..
    } = &subject_call.kind
    else {
        unreachable!()
    };
    // Name-only repair negative: a real unknown-return body copied under the
    // missing specialised name remains wrong, even though pointer ABI accepts it.
    let mut renamed = control_body.clone();
    renamed.name.clone_from(subject_target);
    assert!(crate::hir::verify::compatible(
        &subject_call.ty,
        &renamed.return_type
    ));
    assert_eq!(
        same_result_contract(subject_call, &renamed),
        Err("different result contract")
    );
    // Also retain the actual selected implementation's fallback as the
    // name-only negative whenever that fallback is present in this lowering.
    for body in lowered.program.funcs.iter().filter(|body| {
        body.origin.location == selected.body_location && body.return_type != selected.result
    }) {
        let mut renamed = body.clone();
        renamed.name.clone_from(subject_target);
        assert_eq!(
            same_result_contract(subject_call, &renamed),
            Err("different result contract")
        );
    }
    let mut problems = Vec::new();
    for site in sites {
        let (caller, call) = call_at(&lowered.program, site);
        let OpKind::Call {
            callee: Callee::Direct(target),
            args,
            ..
        } = &call.kind
        else {
            unreachable!()
        };
        if call.ty != site.result {
            problems.push(format!(
                "{}: call {:?} != owned resolved result {:?}",
                site.name, call.ty, site.result
            ));
        }
        let bodies: Vec<_> = lowered
            .program
            .funcs
            .iter()
            .filter(|func| &func.name == target)
            .collect();
        if bodies.len() != 1 {
            problems.push(format!(
                "{}: {target} has {} emitted bodies",
                site.name,
                bodies.len()
            ));
            continue;
        }
        let body = bodies[0];
        if body.origin.location != site.body_location || same_result_contract(call, body).is_err() {
            problems.push(format!(
                "{}: {target} has a different body identity/result contract",
                site.name
            ));
        }
        let params: Vec<_> = body
            .params
            .iter()
            .map(|parameter| parameter.ty.clone())
            .collect();
        let actual_args: Vec<_> = args
            .iter()
            .map(|value| caller.values[value.0 as usize].ty.clone())
            .collect();
        eprintln!(
            "{}: call args={actual_args:?} body params={params:?}",
            site.name
        );
        if params != site.parameters || actual_args != params {
            problems.push(format!(
                "{}: {target} has a different parameter ABI",
                site.name
            ));
        }
    }
    assert!(problems.is_empty(), "call/body coherence: {problems:#?}");
}

#[test]
fn the_owned_observer_restores_its_previous_scope_after_unwinding() {
    let outer = Scope::start();
    RECORDING.with(|cell| {
        cell.borrow_mut()
            .as_mut()
            .unwrap()
            .stages
            .push(("outer", Vec::new()));
    });
    let failed = std::panic::catch_unwind(|| {
        let _inner = Scope::start();
        panic!("observer restoration control");
    });
    assert!(failed.is_err());
    let restored = outer.finish();
    assert_eq!(restored.stages.len(), 1);
    assert_eq!(restored.stages[0].0, "outer");
}
