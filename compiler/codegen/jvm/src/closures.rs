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
//! b0: %2 = object.new frame : managed<closure#524288>
//!     br %1, b1, b2(%2)
//! b1: %4 = object.new frame : managed<closure#524287>
//!     jump b2(%4)
//! b2(%6: managed<closure#524287>):
//!     %8 = call Closure1#call(%6, %7)
//! ```
//!
//! C and LLVM survive that because a pointer erases the difference. The JVM
//! cannot: the frame would declare `Closure1`, the edge from `b0` stores a
//! `Closure0`, and dispatch through `Closure1` on a `Closure0` does not verify.
//!
//! The middle end owns the real fix -- type the merge at the signature, and
//! make each arm an upcast to it. That is agreed and is not this file.
//!
//! # The base already exists, which is the whole of the fix here
//!
//! The first version of this generated an interface per call shape and had
//! every closure implement it. That was redundant, and finding out why is the
//! useful part: `nts layouts` on the same program says
//!
//! ```text
//! Fn2__2 [1]
//!   methods Fn2__2#call
//! Closure0 [4294967295]
//!   base 1 -> Fn2__2
//! Closure1 [4294967294]
//!   base 1 -> Fn2__2
//! ```
//!
//! The signature **has** a layout, it declares the `call` slot, and every
//! closure of that shape already names it as `Layout.base`. The emitted classes
//! say the same: `Closure0 extends Fn2__2`, with `Fn2__2` abstract and
//! declaring `call`. So the common supertype a merged slot needs was there all
//! along, stated by the IR, and generating a second one was this backend
//! inventing a relationship the middle end had already decided -- the thing
//! this lane is specifically not supposed to do.
//!
//! So a merged parameter is declared as the arms' shared base. The store is an
//! ordinary widening the verifier *checks*, rather than the unchecked
//! class-to-interface assignment JVMS 4.10.1.2 would have allowed -- which is
//! also strictly better, because an interface store that was wrong would have
//! been caught at the call instead of at the store.
//!
//! # When it does not apply
//!
//! Only when the arms actually differ **and** share a base. Where the signature
//! has no layout -- which happens, an array of closures is one -- there is no
//! common supertype to name and the refusal stands. That refusal is the middle
//! end's to close, and it is the same root as the typing of the merge.
//!
//! Narrow on purpose. A freshly constructed closure keeps its own class,
//! because `field.set` writing its captures needs a receiver the field is
//! declared on, and the base has no fields.

use nts_core::hir::{BlockId, Func, HirType, ManagedType, Program, Terminator, ValueId};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::types;

/// The closure layout a type names, if it names one.
fn closure_layout<'a>(program: &'a Program, ty: &HirType) -> Option<&'a nts_core::hir::Layout> {
    let HirType::Managed(ManagedType::Object(id)) = ty else {
        return None;
    };
    nts_core::hir::is_closure_type(*id).then(|| program.layout(*id))?
}

/// The layout `layout` names as its base, if it names one.
fn base_of<'a>(program: &'a Program, layout: &nts_core::hir::Layout) -> Option<&'a nts_core::hir::Layout> {
    program.base_layout(layout).and_then(|at| program.layouts.get(at))
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

/// Block parameters that merge closures of differing classes, and the base
/// class each one is declared as instead.
///
/// A parameter is here only when the classes differ **and** every one of them,
/// the declared type included, names the same `Layout.base`. Anything else is
/// left alone so the refusal that names it survives: a base that only some arms
/// share would be a slot type one of them does not widen to, which the verifier
/// would reject at the store rather than accept quietly.
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
        let Some(base) = base_of(program, declared) else {
            continue;
        };
        let shared = types::class_name(base);
        let wanted = types::class_name(declared);
        let mut differs = false;
        let mut agree = true;
        for arg in args {
            let Some(layout) = closure_layout(program, &func.values[arg.0 as usize].ty) else {
                agree = false;
                break;
            };
            if types::class_name(layout) != wanted {
                differs = true;
            }
            if base_of(program, layout).map(types::class_name).as_deref() != Some(shared.as_str()) {
                agree = false;
                break;
            }
        }
        if differs && agree {
            widened.insert(param, shared);
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
