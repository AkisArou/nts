//! Block parameters that merge closures of more than one class.
//!
//! # The shape, and why only this backend sees it
//!
//! ```text
//! let f: Mapper = (v) => v + k;
//! if (pick) { f = (v) => v * k; }
//! return f(5);
//! ```
//!
//! lowers to a block parameter fed by two edges carrying two different closure
//! classes, and the parameter is typed as **one of them**:
//!
//! ```text
//! b0: %2 = object.new frame : managed<closure#524282>
//!     br %1, b1, b2(%2)
//! b1: %4 = object.new frame : managed<closure#524281>
//!     jump b2(%4)
//! b2(%6: managed<closure#524281>):
//!     %8 = call Closure7#call(%6, %7)
//! ```
//!
//! C and LLVM survive that because a pointer erases the difference. The JVM
//! cannot: the frame would declare `Closure7`, the edge from `b0` stores a
//! `Closure6`, and `invokevirtual Closure7#call` on a `Closure6` does not
//! verify. So this lane is the one that has to notice, and it refused --
//! `NTS4001`, storing one closure where another is declared.
//!
//! The middle end owns the real fix: type the merge at the **signature**, which
//! already has a layout, and make each arm an upcast to it. That is agreed and
//! is not this file. What is here is the JVM half, which is needed either way --
//! when the merge is typed at a signature there still has to be a *class* for
//! the slot to be declared as, and every closure with that shape has to be
//! related to it.
//!
//! # Why an interface, and why that makes the store free
//!
//! JVMS 4.10.1.2: a class is assignable to **any** interface without checking.
//! The verifier defers interface conformance to the call site, where
//! `invokeinterface` resolves it or raises `IncompatibleClassChangeError`. So a
//! slot declared as the interface accepts both closures with no cast and no
//! frame merge to compute, and the call still dispatches on the receiver's real
//! class.
//!
//! An abstract *class* would have been the other answer and is worse here: a
//! closure class would then have to extend it, `Layout.base` is the middle
//! end's to say, and two closures whose layouts already carry a base could not
//! both be given one.
//!
//! # Keyed by descriptor, not by name
//!
//! The same rule [`types::CALLBACKS`] keeps and for the same reason: a name
//! like `Closure7` counts closures in source order, so adding an unrelated line
//! renames the thing a slot is declared as. The shape is stable under every
//! edit that does not change the shape.
//!
//! Narrow on purpose. Only a block parameter that actually merges *differing*
//! closure classes is widened -- a freshly constructed closure keeps its own
//! class, because `field.set` writing its captures needs a receiver the field
//! is declared on, and an interface has no fields.

use nts_core::hir::{BlockId, Func, HirType, ManagedType, Program, Terminator, ValueId};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::types;

/// The generated interface a closure whose `call` has this descriptor
/// implements.
///
/// Mangled rather than hashed: `(D)D` is legible in a `javap` listing and a
/// hash is not, and the listing is this backend's substitute for a readable
/// rendering of the program. The substitutions are chosen so that two different
/// descriptors cannot collide -- `/` and `;` are the only characters a
/// descriptor uses that a class name may not contain, and each maps to a
/// character a descriptor never contains.
#[must_use]
pub fn interface_name(descriptor: &str) -> String {
    let mut mangled = String::with_capacity(descriptor.len() + 8);
    mangled.push_str("nts/gen/Fn$");
    for byte in descriptor.chars() {
        match byte {
            '(' | ')' => mangled.push('_'),
            '/' => mangled.push('-'),
            ';' => mangled.push('+'),
            '[' => mangled.push('%'),
            other => mangled.push(other),
        }
    }
    mangled
}

/// The descriptor of `layout`'s dispatched `call`, when it has exactly one.
///
/// `None` for a layout that is not a closure, and for one whose `call` this
/// program does not define -- both of which are refusals somewhere else, and
/// neither of which should be answered with a guess here.
#[must_use]
pub fn call_descriptor(program: &Program, layout: &nts_core::hir::Layout) -> Option<String> {
    let mut found: Option<String> = None;
    for name in layout.methods.iter().flatten() {
        if crate::hierarchy::member_name(name) != "call" {
            continue;
        }
        let func = program.funcs.iter().find(|func| &func.name == name)?;
        let descriptor = crate::instance_descriptor(program, func)?;
        match &found {
            // Two `call` slots with different shapes is not a closure this can
            // name one interface for, so it names none.
            Some(first) if first != &descriptor => return None,
            Some(_) => {}
            None => found = Some(descriptor),
        }
    }
    found
}

/// The closure layout a type names, if it names one.
fn closure_layout<'a>(
    program: &'a Program,
    ty: &HirType,
) -> Option<&'a nts_core::hir::Layout> {
    let HirType::Managed(ManagedType::Object(id)) = ty else {
        return None;
    };
    nts_core::hir::is_closure_type(*id).then(|| program.layout(*id))?
}

/// Every edge in a terminator, as `(target, arguments)`.
///
/// A private copy, as `hir`'s own passes each keep: the alternative is one
/// shared helper whose callers all want a slightly different borrow, and five
/// of those already exist upstream.
fn edges(terminator: &Terminator) -> Vec<(BlockId, &Vec<ValueId>)> {
    match terminator {
        Terminator::Jump { target, args } => vec![(*target, args)],
        Terminator::Branch { then_target, then_args, else_target, else_args, .. } => {
            vec![(*then_target, then_args), (*else_target, else_args)]
        }
        Terminator::Return(_) | Terminator::Unreachable | Terminator::FellThrough => Vec::new(),
    }
}

/// Block parameters that merge closures of differing classes, and the interface
/// each one is declared as.
///
/// A parameter is here only when the classes actually differ **and** every one
/// of them dispatches a `call` of the same shape. Closures whose shapes differ
/// are left alone, so the refusal that names them survives rather than becoming
/// an interface nothing can implement.
#[must_use]
pub fn joined(program: &Program, func: &Func) -> FxHashMap<ValueId, String> {
    let mut arriving: FxHashMap<ValueId, FxHashSet<ValueId>> = FxHashMap::default();
    for block in &func.blocks {
        for (target, args) in edges(&block.terminator) {
            let params = &func.blocks[target.0 as usize].params;
            for (param, arg) in params.iter().zip(args.iter()) {
                arriving.entry(*param).or_default().insert(*arg);
            }
        }
    }

    let mut widened = FxHashMap::default();
    for (param, args) in arriving {
        let Some(declared) = closure_layout(program, &func.values[param.0 as usize].ty) else {
            continue;
        };
        let Some(descriptor) = call_descriptor(program, declared) else {
            continue;
        };
        let wanted = types::class_name(declared);
        let mut differs = false;
        let mut all_closures = true;
        for arg in args {
            let Some(layout) = closure_layout(program, &func.values[arg.0 as usize].ty) else {
                all_closures = false;
                break;
            };
            if types::class_name(layout) != wanted {
                differs = true;
            }
            // Every arm must speak the same shape, or the interface would
            // declare a method one of them does not have -- an
            // `AbstractMethodError` at the first call through it, which the
            // verifier does not catch because it checks interfaces at the call.
            if call_descriptor(program, layout).as_deref() != Some(descriptor.as_str()) {
                all_closures = false;
                break;
            }
        }
        if differs && all_closures {
            widened.insert(param, interface_name(&descriptor));
        }
    }
    widened
}

/// The slot type for a widened parameter.
pub(crate) fn held_as(
    widened: &FxHashMap<ValueId, String>,
    value: ValueId,
) -> Option<nts_jvm_emitter::VType> {
    widened.get(&value).map(|name| nts_jvm_emitter::VType::Object(name.clone()))
}

/// Every interface this program needs, with the descriptor each declares.
///
/// Whole-program rather than per-function, because a class file is emitted once
/// and a closure that merges in one function must declare the interface
/// everywhere it is used.
///
/// One pass over the layouts, not one per interface. The shape is recovered
/// from the layout that produced it rather than by unmangling the name -- the
/// mangling is one-way on purpose, and reversing it would be a second statement
/// of the same table.
#[must_use]
pub fn required(program: &Program) -> Vec<(String, String)> {
    let wanted: FxHashSet<String> =
        program.funcs.iter().flat_map(|func| joined(program, func).into_values()).collect();
    if wanted.is_empty() {
        return Vec::new();
    }
    let mut found: Vec<(String, String)> = Vec::new();
    for layout in &program.layouts {
        let Some(descriptor) = call_descriptor(program, layout) else {
            continue;
        };
        let name = interface_name(&descriptor);
        if wanted.contains(&name) && !found.iter().any(|(other, _)| other == &name) {
            found.push((name, descriptor));
        }
    }
    found.sort();
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The mangling is reversible in the only sense that matters: two
    /// descriptors never collide.
    ///
    /// It does not have to be *undoable* -- `shape_of` recovers a shape by
    /// searching the layouts rather than by unmangling -- but a collision would
    /// give two call shapes one interface, and the second one to be emitted
    /// would declare a method the first's implementers do not have. That is an
    /// `AbstractMethodError` at the first call through it, which the verifier
    /// does not catch because it checks interfaces at the call rather than at
    /// load.
    #[test]
    fn two_descriptors_never_share_an_interface() {
        let shapes = [
            "()V",
            "(D)D",
            "(D)V",
            "(DD)D",
            "(Ljava/lang/String;)V",
            "(Ljava/lang/String;Ljava/lang/String;)V",
            "([BDD)V",
            "(Lnts/gen/Point;)Lnts/gen/Point;",
            "([[D)[D",
        ];
        let mut seen: Vec<(String, &str)> = Vec::new();
        for shape in shapes {
            let name = interface_name(shape);
            if let Some((_, first)) = seen.iter().find(|(other, _)| other == &name) {
                panic!("`{shape}` and `{first}` both mangle to `{name}`");
            }
            seen.push((name, shape));
        }
    }

    /// And the name is a legal one for a class file to carry.
    ///
    /// JVMS 4.2.1: a binary name may not contain `.`, `;`, `[` or `/` in a
    /// simple name -- the package separator `/` being the exception the name
    /// itself supplies. A descriptor is made of exactly those characters, so
    /// the mangling is not cosmetic; a raw descriptor here is a
    /// `ClassFormatError` at load, on every program that has a closure.
    #[test]
    fn the_name_is_one_a_class_file_may_carry() {
        for shape in ["(D)D", "(Ljava/lang/String;)V", "([BDD)V", "([[D)[D"] {
            let name = interface_name(shape);
            let simple = name.rsplit('/').next().unwrap_or(&name);
            for bad in ['.', ';', '[', '/'] {
                assert!(
                    !simple.contains(bad),
                    "`{shape}` mangles to `{name}`, whose simple name contains `{bad}`"
                );
            }
        }
    }

    /// The package is `nts/gen`, where every other generated class lives.
    #[test]
    fn the_interface_is_generated_code_and_says_so() {
        assert!(interface_name("(D)D").starts_with("nts/gen/Fn$"));
    }
}
