//! Types exposed to callers or callees outside the compiled program.
//! Field facts and array storage consume the same transitive classification.

use super::{HirType, ManagedType, OpKind, Program};
use rustc_hash::FxHashSet;

#[derive(Default)]
pub(super) struct Exposure {
    pub fields: FxHashSet<(usize, u32)>,
    pub elements: FxHashSet<HirType>,
}

/// Fields a native caller can supply or mutate, including nested objects and
/// containers. Compute once per analysis, outside its numeric fixpoint.
#[must_use]
pub(super) fn analyze(program: &Program, outward: &FxHashSet<&str>) -> Exposure {
    let mut pending = Vec::new();
    for func in &program.funcs {
        if outward.contains(func.name.as_str()) {
            pending.extend(func.params.iter().map(|param| &param.ty));
            pending.push(&func.return_type);
        }
        for op in &func.values {
            if let OpKind::Call {
                callee: super::Callee::External(_) | super::Callee::Native(_),
                args,
                ..
            } = &op.kind
            {
                pending.push(&op.ty);
                pending.extend(
                    args.iter()
                        .flat_map(|arg| super::carried_values(func, *arg))
                        .map(|arg| &func.values[arg.0 as usize].ty),
                );
            }
        }
    }
    let mut exposed = Exposure::default();
    for ty in reachable_types(program, pending) {
        match ty {
            HirType::Managed(ManagedType::Object(_)) => {
                let Some(at) = super::fields::layout_of(program, ty) else {
                    continue;
                };
                let layout = &program.layouts[at];
                for index in 0..layout.fields.len() {
                    let field = u32::try_from(index).unwrap_or(u32::MAX);
                    for (other, candidate) in program.layouts.iter().enumerate() {
                        if super::fields::shares_storage(layout, candidate, field) {
                            exposed.fields.insert((other, field));
                        }
                    }
                }
            }
            HirType::Managed(ManagedType::Array(element)) => {
                exposed.elements.insert((**element).clone());
            }
            _ => {}
        }
    }
    exposed
}

/// Types carried inside a published object or container. Callback reachability
/// uses the same traversal as field and element facts, including nested closures.
pub(super) fn reachable_types<'p>(
    program: &'p Program,
    seeds: impl IntoIterator<Item = &'p HirType>,
) -> FxHashSet<&'p HirType> {
    let mut pending: Vec<_> = seeds.into_iter().collect();
    let mut seen = FxHashSet::default();
    while let Some(ty) = pending.pop() {
        if !seen.insert(ty) {
            continue;
        }
        match ty {
            HirType::Managed(ManagedType::Object(_)) => {
                if let Some(at) = super::fields::layout_of(program, ty) {
                    pending.extend(program.layouts[at].fields.iter().map(|field| &field.ty));
                }
            }
            HirType::Managed(
                ManagedType::Array(element)
                | ManagedType::Set(element)
                | ManagedType::Promise(element),
            ) => pending.push(element),
            HirType::Managed(ManagedType::Map(key, value) | ManagedType::Table(key, value)) => {
                pending.push(key);
                pending.push(value);
            }
            _ => {}
        }
    }
    seen
}
