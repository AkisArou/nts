//! Typed method boundaries for adaptive sorts, shared by identical contracts.

use std::cell::RefCell;
use std::rc::Rc;

use super::super::{
    Callee, Copy, Facts, Func, LayoutCollector, Lowered, LoweringSnapshot, Param, ParamShape,
    Shared, Substitution,
};
use super::managed::{INDEX, SLOT, Sort};
use super::{
    Comparator, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, Origin, Terminator,
    TypeId, ValueId,
};

#[derive(Clone, Debug, PartialEq, Eq)]
struct Contract {
    element: HirType,
    callback: HirType,
    entry: u32,
    parameters: Vec<HirType>,
    argument_type: Option<TypeId>,
    carry: bool,
    substitution: Substitution,
    sources: crate::hir::generics::Sources,
}

/// A registry belongs to one lowering, including its specialized builders.
#[derive(Clone, Default)]
pub(in crate::hir::lower) struct Registry(Rc<RefCell<Vec<Rc<Family>>>>);

#[derive(Clone, Debug)]
pub(super) struct Family {
    name: String,
    contract: Contract,
    comparator: Comparator,
    site: NodeId,
    suffix: String,
}

impl Registry {
    pub(super) fn request(
        &self,
        builder: &FuncBuilder<'_>,
        site: NodeId,
        element: &HirType,
        comparator: &Comparator,
    ) -> Rc<Family> {
        let contract = Contract {
            element: element.clone(),
            callback: builder.values[comparator.function.0 as usize].ty.clone(),
            entry: comparator.callee.0,
            parameters: comparator.parameters.clone(),
            argument_type: comparator.argument_source.and_then(|(_, ty)| ty),
            carry: builder.tested_for_a_raise(site),
            substitution: builder.substitution.clone(),
            sources: builder.sources.clone(),
        };
        let mut families = self.0.borrow_mut();
        if let Some(family) = families.iter().find(|family| family.contract == contract) {
            return Rc::clone(family);
        }
        let family = Rc::new(Family {
            name: format!("¢sort{}", families.len()),
            contract,
            comparator: comparator.clone(),
            site,
            suffix: builder.suffix.clone(),
        });
        families.push(Rc::clone(&family));
        family
    }
}

#[derive(Clone, Copy)]
pub(super) enum Phase {
    Run,
    Insert,
    Merge,
    Gallop { forward: bool, first: bool },
}

impl Phase {
    fn suffix(self) -> &'static str {
        match self {
            Self::Run => "run",
            Self::Insert => "insert",
            Self::Merge => "merge",
            Self::Gallop {
                forward: true,
                first: true,
            } => "gallopLeftForward",
            Self::Gallop {
                forward: true,
                first: false,
            } => "gallopRightForward",
            Self::Gallop {
                forward: false,
                first: true,
            } => "gallopLeftBackward",
            Self::Gallop {
                forward: false,
                first: false,
            } => "gallopRightBackward",
        }
    }

    pub(super) fn returns(self) -> HirType {
        match self {
            Self::Insert | Self::Merge => HirType::Void,
            Self::Run | Self::Gallop { .. } => INDEX,
        }
    }
}

impl Family {
    fn name(&self, phase: Phase) -> String {
        format!("{}${}", self.name, phase.suffix())
    }

    /// A carrying call is tested before its dummy result can be observed.
    pub(super) fn call(
        &self,
        builder: &mut FuncBuilder<'_>,
        phase: Phase,
        args: Vec<ValueId>,
        origin: &Origin,
    ) -> ValueId {
        let result = builder.push(
            OpKind::Call {
                callee: Callee::Direct(self.name(phase)),
                args,
                frame: None,
            },
            phase.returns(),
            origin.clone(),
        );
        if self.contract.carry {
            builder.emit_the_raise_test(origin);
        }
        result
    }
}

pub(in crate::hir::lower) fn lower_helpers(
    layouts: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    shared: &Shared,
    lowered: &mut Lowered,
    wanted: &mut std::collections::BTreeSet<usize>,
) {
    let mut index = 0;
    loop {
        let family = shared.sort_helpers.0.borrow().get(index).cloned();
        let Some(family) = family else { break };
        index += 1;
        for phase in [
            Phase::Run,
            Phase::Insert,
            Phase::Merge,
            Phase::Gallop {
                forward: true,
                first: true,
            },
            Phase::Gallop {
                forward: true,
                first: false,
            },
            Phase::Gallop {
                forward: false,
                first: true,
            },
            Phase::Gallop {
                forward: false,
                first: false,
            },
        ] {
            let mut builder = shared.builder(
                snapshot,
                super::super::NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default),
                Copy {
                    substitution: family.contract.substitution.clone(),
                    sources: family.contract.sources.clone(),
                    suffix: family.suffix.clone(),
                    raises: family.contract.carry,
                    ..Copy::default()
                },
            );
            match lower_phase(&mut builder, &family, phase) {
                Ok(function) => lowered.program.funcs.push(function),
                Err(diagnostic) => {
                    lowered
                        .program
                        .uncompiled
                        .push(crate::hir::Uncompiled::refused(
                            family.name(phase),
                            diagnostic.message.clone(),
                        ));
                    lowered.diagnostics.push(diagnostic);
                }
            }
            builder.harvest(wanted, &mut lowered.arrivals);
            layouts.collect(&mut lowered.program, builder.layouts.into_layouts());
        }
    }
}

fn parameter(
    builder: &mut FuncBuilder<'_>,
    params: &mut Vec<Param>,
    name: &str,
    ty: HirType,
    origin: &Origin,
) -> ValueId {
    let index = u32::try_from(params.len()).unwrap_or(u32::MAX);
    params.push(Param {
        name: name.to_owned(),
        shape: ParamShape::Ordinary,
        ty: ty.clone(),
        origin: origin.clone(),
        known: Facts::TOP,
        written: None,
    });
    builder.push(OpKind::Param(index), ty, origin.clone())
}

fn lower_phase(
    builder: &mut FuncBuilder<'_>,
    family: &Rc<Family>,
    phase: Phase,
) -> Result<Func, Diagnostic> {
    let origin = builder.origin(family.site);
    let mut params = Vec::new();
    let array = HirType::Managed(ManagedType::Array(Box::new(SLOT)));
    let owner_type = HirType::Managed(ManagedType::Array(Box::new(
        family.contract.element.clone(),
    )));
    let owner = parameter(builder, &mut params, "owner", owner_type, &origin);
    let order = parameter(builder, &mut params, "order", array.clone(), &origin);
    let length = parameter(builder, &mut params, "length", INDEX, &origin);
    let function = parameter(
        builder,
        &mut params,
        "compare",
        family.contract.callback.clone(),
        &origin,
    );
    let mut comparator = family.comparator.clone();
    comparator.function = function;
    comparator.snapshot = Some(owner);
    builder.returns = phase.returns();
    if family.contract.carry {
        builder.raising_calls.insert(family.site);
    }
    let mut args = Vec::new();
    for (name, ty) in match phase {
        Phase::Run => vec![("start", INDEX), ("minrun", INDEX)],
        Phase::Insert => vec![("start", INDEX), ("sorted", INDEX), ("end", INDEX)],
        Phase::Merge => vec![
            ("scratch", array.clone()),
            ("stack", array.clone()),
            ("base", INDEX),
            ("middle", INDEX),
            ("end", INDEX),
        ],
        Phase::Gallop { .. } => vec![
            ("source", array),
            ("start", INDEX),
            ("count", INDEX),
            ("pivot", INDEX),
        ],
    } {
        args.push(parameter(builder, &mut params, name, ty, &origin));
    }
    let mut sort = Sort {
        b: builder,
        id: family.site,
        origin: origin.clone(),
        owner,
        element: family.contract.element.clone(),
        comparator: &comparator,
        length,
        order,
        family: Rc::clone(family),
    };
    let result = match phase {
        Phase::Run => Some(sort.build_next_run(args[0], args[1])?),
        Phase::Insert => {
            sort.build_binary_insert(args[0], args[1], args[2])?;
            None
        }
        Phase::Merge => {
            sort.build_merge(args[0], args[1], args[2], args[3], args[4])?;
            None
        }
        Phase::Gallop { forward, first } => {
            Some(sort.build_gallop(args[0], args[1], args[2], args[3], forward, first)?)
        }
    };
    sort.b.terminate(Terminator::Return(result));
    Ok(sort
        .b
        .finish(family.name(phase), params, phase.returns(), origin, false))
}
