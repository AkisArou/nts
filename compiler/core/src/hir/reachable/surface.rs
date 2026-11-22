//! Callable types carried by the selected library surface. Index all matching
//! layouts once, then share visits across signatures, values and record cycles.

use rustc_hash::{FxHashMap, FxHashSet};

use super::Roots;
use crate::hir::{Func, HirType, ManagedType, Program, TypeId, has_a_closure_body};

/// Source members a published class exposes. A second `#` names a compiler
/// specialization, not another member. Constructors have a separate entry.
pub(super) fn declared_members<'p>(program: &'p Program, class: &str) -> Vec<(&'p Func, &'p str)> {
    program
        .funcs
        .iter()
        .filter_map(|func| {
            let (owner, member) = declared_member(&func.name)?;
            (owner == class).then_some((func, member))
        })
        .collect()
}

pub(super) fn declared_member(name: &str) -> Option<(&str, &str)> {
    let (owner, member) = name.split_once('#')?;
    (member != "constructor" && !member.contains('#')).then_some((owner, member))
}

#[derive(Clone, Copy)]
enum Work {
    RootName,
    Function,
    SurfaceName,
    Global,
    IndexedLayout,
    IndexedType,
    Type,
    LayoutEdge,
    Layout,
    Field,
}

trait Observer {
    fn visit(&mut self, work: Work);
}

impl Observer for () {
    fn visit(&mut self, _: Work) {}
}

pub(super) fn functions(
    program: &Program,
    roots: &[&str],
    selection: Roots<'_>,
) -> FxHashSet<TypeId> {
    observed(program, roots, selection, &mut ())
}

/// Entries reached through the selected surface's callable types. Publication
/// and pruning share this walk, including its exclusion of refused entries.
pub(super) fn entries<'p>(
    program: &'p Program,
    roots: &[&str],
    selection: Roots<'_>,
    by_name: &FxHashMap<&str, usize>,
) -> Vec<&'p str> {
    let surface = functions(program, roots, selection);
    super::closure_entries_from_outside(program, &surface, by_name)
}

fn observed(
    program: &Program,
    roots: &[&str],
    selection: Roots<'_>,
    observer: &mut impl Observer,
) -> FxHashSet<TypeId> {
    let mut pending = Vec::new();
    let roots: FxHashSet<_> = roots
        .iter()
        .inspect(|_| observer.visit(Work::RootName))
        .copied()
        .collect();
    for func in &program.funcs {
        observer.visit(Work::Function);
        if roots.contains(func.name.as_str()) {
            pending.extend(func.params.iter().map(|param| &param.ty));
            pending.push(&func.return_type);
        }
    }
    // Module evaluation can construct a closure without calling it. Only the
    // product's selected value bindings give that closure an outside caller.
    let values = value_names(program, selection, observer);
    for global in &program.globals {
        observer.visit(Work::Global);
        if values.contains(global.name.as_str()) {
            pending.push(&global.ty);
        }
    }
    walk(program, pending, observer)
}

fn value_names<'p>(
    program: &'p Program,
    selection: Roots<'p>,
    observer: &mut impl Observer,
) -> FxHashSet<&'p str> {
    let mut values = FxHashSet::default();
    let mut insert = |name| {
        observer.visit(Work::SurfaceName);
        values.insert(name);
    };
    match selection {
        Roots::Entry(_) => {}
        Roots::Declared(names) => names.iter().for_each(|name| insert(name.as_str())),
        Roots::EntrySurface | Roots::EveryExport => {
            for (emitted, _) in &program.public_api {
                insert(emitted.as_str());
            }
            for (_, members) in &program.public_namespaces {
                for (_, emitted) in members {
                    insert(emitted.as_str());
                }
            }
            if matches!(selection, Roots::EveryExport) {
                for global in &program.globals {
                    observer.visit(Work::Global);
                    if global.exported {
                        observer.visit(Work::SurfaceName);
                        values.insert(global.name.as_str());
                    }
                }
            }
        }
    }
    values
}

fn walk<'p>(
    program: &'p Program,
    mut pending: Vec<&'p HirType>,
    observer: &mut impl Observer,
) -> FxHashSet<TypeId> {
    // A type may inhabit several layouts, and a layout may represent several
    // types. Keep every relation; Program::layout's first match is insufficient.
    let mut layouts: FxHashMap<TypeId, Vec<usize>> = FxHashMap::default();
    for (index, layout) in program.layouts.iter().enumerate() {
        observer.visit(Work::IndexedLayout);
        for ty in &layout.types {
            observer.visit(Work::IndexedType);
            layouts.entry(*ty).or_default().push(index);
        }
    }
    let mut types = FxHashSet::default();
    let mut visited_layouts = FxHashSet::default();
    let mut found = FxHashSet::default();
    while let Some(ty) = pending.pop() {
        observer.visit(Work::Type);
        match ty {
            HirType::Managed(ManagedType::Array(element)) => pending.push(element),
            HirType::Managed(ManagedType::Object(id)) if types.insert(*id) => {
                if program.signature_faces.contains_key(id) || has_a_closure_body(*id) {
                    found.insert(*id);
                    continue;
                }
                for index in layouts.get(id).into_iter().flatten() {
                    observer.visit(Work::LayoutEdge);
                    if visited_layouts.insert(*index) {
                        observer.visit(Work::Layout);
                        for field in &program.layouts[*index].fields {
                            observer.visit(Work::Field);
                            pending.push(&field.ty);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    found
}

#[cfg(test)]
mod tests;
