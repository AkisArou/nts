//! Where a value enters a signature: what [`Program::typed_signatures`] rests
//! on, read off the program itself.
//!
//! A signature's calls take its typed entry only where every value that can
//! sit at its type is a closure of its own (`lower::typed_signatures`). The
//! lowering decides that once, and the verifier checks it on every prepared
//! program ([`super::verify`]'s `TypedSignatureEntered`), both from this one
//! reading. A later pass that lets another value in is then invalid HIR, caught
//! where it happens, rather than a call through the wrong ABI that C would emit
//! without a word.

use super::{Callee, Func, HirType, ManagedType, OpKind, Program, Terminator, ValueId};
use nts_semantic_schema::TypeId;

/// Every place a value enters a signature layout without being one of the
/// signature's own, as `(signature layout, function)`.
///
/// Three ways, each something the program states:
/// - an unerase into it, which can hold any function value ever erased;
/// - an exported function's parameter of it, which holds whatever the host
///   passes;
/// - a value of another type moved into a position typed as it. The HIR lets
///   one object pointer stand where another is wanted
///   ([`super::verify::compatible`]), so a producer passing a value across a
///   type boundary need not convert it, and records nothing. An interface
///   adapter (`OneListener#then@Wakeable`) passes its `() => unknown`
///   parameter straight to the implementation's `() => void` one, and a
///   closure admitted to the first reaches the second's typed call. The JVM's
///   verifier rejected that class (tests/programs/a-literal-thenable-
///   dispatched-with-class-wakeables), and C and LLVM agreed only because no
///   other closure happened to arrive. So every argument is read against its
///   parameter, every return against the result, every block argument against
///   its parameter, every field, global and element store against its slot,
///   and a runtime helper handed both an array and an object against the
///   array's elements.
///
/// A value of the signature, or of a layout descending from it, is what the
/// rule admits there.
#[must_use]
pub(super) fn entries_from_elsewhere(program: &Program) -> Vec<(usize, usize)> {
    let by_name: rustc_hash::FxHashMap<&str, &Func> = program
        .funcs
        .iter()
        .map(|func| (func.name.as_str(), func))
        .collect();
    let mut entries = Vec::new();
    for (at, func) in program.funcs.iter().enumerate() {
        let mut enter = |signature: Option<usize>| {
            if let Some(signature) = signature {
                entries.push((signature, at));
            }
        };
        for op in &func.values {
            if matches!(op.kind, OpKind::Unerase { .. }) {
                enter(signature_of(program, &op.ty));
            }
        }
        if func.exported {
            for param in &func.params {
                enter(signature_of(program, &param.ty));
            }
        }
        for_each_move(program, &by_name, func, |found, want| {
            enter(foreign_to(program, found, want));
        });
    }
    entries
}

/// The signature layout a type is, or holds as its elements, if it is one.
fn signature_of(program: &Program, ty: &HirType) -> Option<usize> {
    match ty {
        HirType::Managed(ManagedType::Array(element)) => signature_of(program, element),
        HirType::Managed(ManagedType::Object(ty)) => {
            let at = layout_of(program, *ty)?;
            super::lower::is_signature_name(&program.layouts[at].name).then_some(at)
        }
        _ => None,
    }
}

/// Each `(found, wanted)` pair a function moves a value through: arguments
/// and parameters, a return and the result, block arguments and parameters,
/// stores and their slots.
fn for_each_move(
    program: &Program,
    by_name: &rustc_hash::FxHashMap<&str, &Func>,
    func: &Func,
    mut moved: impl FnMut(&HirType, &HirType),
) {
    let ty = |value: &ValueId| &func.values[value.0 as usize].ty;
    for block in &func.blocks {
        for id in &block.ops {
            match &func.values[id.0 as usize].kind {
                OpKind::Call { callee, args, .. } => {
                    if let Some(callee) = callee_of(program, by_name, func, callee, args) {
                        for (arg, param) in args.iter().zip(&callee.params) {
                            moved(ty(arg), &param.ty);
                        }
                        // And the answer into the call's own type: a call
                        // typed as a signature whose callee returns something
                        // else is an unerase lowering left implicit (a generic
                        // `identity` answering erased), which `prepare` then
                        // spells as one.
                        moved(&callee.return_type, &func.values[id.0 as usize].ty);
                    } else {
                        // A helper's prototype says only "a reference", so
                        // whether it stores one argument into another is not
                        // written down: an object handed in beside an array
                        // may become one of its elements.
                        for array in args {
                            if let HirType::Managed(ManagedType::Array(element)) = ty(array) {
                                for value in args {
                                    moved(ty(value), element);
                                }
                            }
                        }
                    }
                }
                OpKind::GlobalSet { global, value } => {
                    if let Some(slot) = program.globals.get(*global as usize) {
                        moved(ty(value), &slot.ty);
                    }
                }
                OpKind::FieldSet {
                    object,
                    field,
                    value,
                } => {
                    if let HirType::Managed(ManagedType::Object(owner)) = ty(object)
                        && let Some(owner) = layout_of(program, *owner)
                        && let Some(slot) = program.layouts[owner].fields.get(*field as usize)
                    {
                        moved(ty(value), &slot.ty);
                    }
                }
                OpKind::ArraySet { array, value, .. } => {
                    if let HirType::Managed(ManagedType::Array(element)) = ty(array) {
                        moved(ty(value), element);
                    }
                }
                _ => {}
            }
        }
        let mut into = |target: &super::BlockId, args: &[ValueId]| {
            let params = &func.blocks[target.0 as usize].params;
            for (arg, param) in args.iter().zip(params) {
                moved(ty(arg), ty(param));
            }
        };
        match &block.terminator {
            Terminator::Return(Some(value)) => moved(ty(value), &func.return_type),
            Terminator::Jump { target, args } => into(target, args),
            Terminator::Branch {
                then_target,
                then_args,
                else_target,
                else_args,
                ..
            } => {
                into(then_target, then_args);
                into(else_target, else_args);
            }
            _ => {}
        }
    }
}

/// The function a call's arguments are passed to, where it is one of the
/// program's: by name, by the declared method, or by the receiver's slot.
fn callee_of<'a>(
    program: &Program,
    by_name: &rustc_hash::FxHashMap<&str, &'a Func>,
    calling: &Func,
    callee: &Callee,
    args: &[ValueId],
) -> Option<&'a Func> {
    let name = match callee {
        Callee::Direct(name) | Callee::Virtual { declared: name, .. } => name.clone(),
        Callee::Closure { slot } => {
            let receiver = args.first()?;
            let HirType::Managed(ManagedType::Object(ty)) = &calling.values[receiver.0 as usize].ty
            else {
                return None;
            };
            program.layouts[layout_of(program, *ty)?]
                .methods
                .get(*slot as usize)
                .cloned()
                .flatten()?
        }
        Callee::External(_) | Callee::Native(_) => return None,
    };
    by_name.get(name.as_str()).copied()
}

/// The signature layout a value of type `found` would enter, put where `want`
/// is wanted, if it is not one the rule admits there: the signature itself or
/// a layout descending from it. An array of one is the same question asked of
/// its elements.
fn foreign_to(program: &Program, found: &HirType, want: &HirType) -> Option<usize> {
    match (found, want) {
        (
            HirType::Managed(ManagedType::Array(found)),
            HirType::Managed(ManagedType::Array(want)),
        ) => foreign_to(program, found, want),
        (HirType::Managed(ManagedType::Object(found)), _) => {
            let at = signature_of(program, want)?;
            match layout_of(program, *found) {
                Some(from) if from == at || descends(program, from, at) => None,
                _ => Some(at),
            }
        }
        // Anything else standing where a signature is wanted -- an erased
        // value, chiefly -- is an unerase that was left implicit.
        _ => signature_of(program, want),
    }
}

/// Every layout a typed signature's calls can reach, by name: the signature
/// and each layout descending from it.
pub(super) fn group_layouts(program: &Program, signature: &str) -> Vec<usize> {
    let Some(at) = program
        .layouts
        .iter()
        .position(|layout| layout.name == signature)
    else {
        return Vec::new();
    };
    std::iter::once(at)
        .chain(
            (0..program.layouts.len())
                .filter(|&layout| layout != at && descends(program, layout, at)),
        )
        .collect()
}

/// The layout a type id is laid out as.
#[must_use]
pub(super) fn layout_of(program: &Program, ty: TypeId) -> Option<usize> {
    program
        .layouts
        .iter()
        .position(|layout| layout.types.contains(&ty))
}

/// Whether `layout`'s declared ancestry reaches `ancestor`.
#[must_use]
pub(super) fn descends(program: &Program, layout: usize, ancestor: usize) -> bool {
    let mut at = layout;
    // Bounded by the layout count: a base chain is a tree, and a cycle in one
    // is a malformed program that is not this reading's to report.
    for _ in 0..program.layouts.len() {
        match program.base_layout(&program.layouts[at]) {
            Some(base) if base == ancestor => return true,
            Some(base) if base != at => at = base,
            _ => return false,
        }
    }
    false
}
