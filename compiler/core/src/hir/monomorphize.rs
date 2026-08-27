//! Specializing a function to the closure it was handed.
//!
//! # The problem, measured
//!
//! ```text
//! function drive(f: (x: number) => number, times: number): number { ... f(i) ... }
//! const shift = (x: number): number => (x * 3 + step) | 0;
//! drive(shift, 4096);
//! ```
//!
//! Inside `drive`, `f` is declared as the *signature* type, so the call through
//! it is a dispatch. Called where it is made, the same closure is a direct call
//! -- the receiver's static type is the closure class, which is final. So the
//! identical arithmetic costs 2.8 ns reached by name and 13,700 ns reached
//! through a parameter.
//!
//! # Why clang cannot fix it
//!
//! It is circular. To fold `f->header.descriptor->methods[0]` into a known
//! function, clang has to prove the callee does not write `f->header.descriptor`
//! -- and it cannot know the callee without folding the load. So the loop keeps
//! an indirect call and reloads the descriptor every iteration, which is what
//! the disassembly shows.
//!
//! # What C++ does, and what this does
//!
//! A C++ programmer writes `template <typename F> drive(F f, ...)`, and the
//! compiler makes one `drive` per callable. This makes one `drive` per *closure
//! class*, for exactly the same reason and with the same result: inside the
//! clone the parameter's type is the concrete class, and the dispatch through it
//! is a direct call the C compiler inlines.
//!
//! The difference is that C++ needs the author to have written a template.
//! TypeScript has one `drive`, and the concrete type is something this compiler
//! knows at the call site.
//!
//! # What it will not do
//!
//! - A parameter that is *anything but* the receiver of a call. Retyping one
//!   that is stored, returned or passed on would have to retype everything
//!   downstream of it, and the profit is in the call.
//! - More than [`CLONE_CAP`] clones. Code size is a cost, and a program that
//!   passes fifty closures through one function is asking for a dispatch.

use rustc_hash::{FxHashMap, FxHashSet};

use super::{Callee, Func, HirType, ManagedType, OpKind, Program, TypeId, ValueId};

/// How many clones one program may grow.
///
/// Each is a full copy of a function body, so this is a code-size budget. Ten
/// covers every real higher-order shape -- a `map`, a `filter`, a comparator --
/// and stops a generated program from exploding.
const CLONE_CAP: usize = 10;

/// A bound on the iteration. A clone can pass its closure on, which asks for
/// another; that terminates because the set of (function, closure) pairs is
/// finite, and this is the backstop if it ever does not.
const ROUND_CAP: u32 = 8;

/// Clone functions for the closures they are called with, and report how many.
pub fn monomorphize(program: &mut Program) -> usize {
    let mut made = 0;
    // Which clone serves which (callee name, parameter, concrete type).
    let mut clones: FxHashMap<(String, u32, TypeId), String> = FxHashMap::default();

    for _ in 0..ROUND_CAP {
        let Some(request) = find_request(program, &clones) else {
            break;
        };
        if made >= CLONE_CAP {
            break;
        }

        let name = clone_name(program, &request);
        let source = &program.funcs[request.callee];
        let mut clone = source.clone();
        clone.name.clone_from(&name);
        // A clone has no name outside the program: it exists because one call
        // site named it, and reachability keeps it for exactly that reason.
        clone.exported = false;
        clone.params[request.slot as usize].ty =
            HirType::Managed(ManagedType::Object(request.concrete));
        retype_parameter(&mut clone, request.slot, request.concrete);
        program.funcs.push(clone);

        clones.insert(
            (
                program.funcs[request.callee].name.clone(),
                request.slot,
                request.concrete,
            ),
            name.clone(),
        );
        redirect(program, &request, &name);
        made += 1;
    }
    made
}

/// One call worth specializing.
struct Request {
    /// The function to clone, by index.
    callee: usize,
    /// Which parameter is a closure at every call site that reaches here.
    slot: u32,
    /// The class it actually receives.
    concrete: TypeId,
}

/// The first call whose callee is worth a clone.
///
/// One at a time, so that the clone made for a request is visible to the search
/// for the next -- a second call passing the same closure to the same function
/// finds the existing clone rather than asking for another.
fn find_request(
    program: &Program,
    clones: &FxHashMap<(String, u32, TypeId), String>,
) -> Option<Request> {
    for func in &program.funcs {
        for op in &func.values {
            let OpKind::Call {
                callee: Callee::Direct(name),
                args,
                ..
            } = &op.kind
            else {
                continue;
            };
            // A name this program does not define is an import, and there is
            // nothing here to clone.
            let Some(callee) = program.funcs.iter().position(|f| f.name == *name) else {
                continue;
            };
            for (slot, arg) in args.iter().enumerate() {
                let slot = u32::try_from(slot).unwrap_or(u32::MAX);
                let HirType::Managed(ManagedType::Object(concrete)) =
                    func.values[arg.0 as usize].ty
                else {
                    continue;
                };
                // Only a closure class, which is final -- the whole argument is
                // that the implementation is then known. A class from the
                // checker can have a subclass, and the receiver may be one.
                if concrete.0 < super::SYNTHETIC_TYPE_FLOOR {
                    continue;
                }
                let Some(param) = program.funcs[callee].params.get(slot as usize) else {
                    continue;
                };
                // Already concrete: this call needs nothing, and cloning would
                // make a copy identical to the original.
                if param.ty == HirType::Managed(ManagedType::Object(concrete)) {
                    continue;
                }
                if clones.contains_key(&(name.clone(), slot, concrete)) {
                    continue;
                }
                if !only_called(&program.funcs[callee], slot) {
                    continue;
                }
                return Some(Request {
                    callee,
                    slot,
                    concrete,
                });
            }
        }
    }
    None
}

/// Whether a parameter is used only as the receiver of a call.
///
/// The condition for retyping it in place. A parameter that is stored, returned
/// or handed on is one whose new type would have to travel with it, and the
/// profit is in the call rather than in the type.
fn only_called(func: &Func, slot: u32) -> bool {
    let param = ValueId(slot);
    for block in &func.blocks {
        for value in &block.ops {
            let reads = super::verify::operands(&func.values[value.0 as usize].kind);
            if !reads.contains(&param) {
                continue;
            }
            let OpKind::Call { args, .. } = &func.values[value.0 as usize].kind else {
                return false;
            };
            // The receiver, and nothing else. Passing it on as an ordinary
            // argument is the case this declines.
            if args.first() != Some(&param) || args[1..].contains(&param) {
                return false;
            }
        }
        if super::verify::terminator_operands(&block.terminator).contains(&param) {
            return false;
        }
    }
    true
}

/// Give the clone's parameter its concrete type, and make what it calls direct.
fn retype_parameter(clone: &mut Func, slot: u32, concrete: TypeId) {
    let param = ValueId(slot);
    let ty = HirType::Managed(ManagedType::Object(concrete));
    clone.values[param.0 as usize].ty = ty;

    // Which body a closure class's slot holds is decided by the class, and a
    // closure class is final. So this is the same reasoning the lowering does
    // for a receiver it can see -- it is only that the receiver became visible
    // here rather than there.
    let target = super::lower::closure_method(concrete);
    for value in &mut clone.values {
        let OpKind::Call { callee, args, .. } = &mut value.kind else {
            continue;
        };
        if !matches!(callee, Callee::Closure { .. }) || args.first() != Some(&param) {
            continue;
        }
        *callee = Callee::Direct(target.clone());
    }
}

/// Point every call that asked for this clone at it.
fn redirect(program: &mut Program, request: &Request, name: &str) {
    let original = program.funcs[request.callee].name.clone();
    let concrete = HirType::Managed(ManagedType::Object(request.concrete));

    for index in 0..program.funcs.len() {
        let types: Vec<HirType> = program.funcs[index]
            .values
            .iter()
            .map(|op| op.ty.clone())
            .collect();
        for op in &mut program.funcs[index].values {
            let OpKind::Call {
                callee: Callee::Direct(target),
                args,
                ..
            } = &mut op.kind
            else {
                continue;
            };
            if *target != original {
                continue;
            }
            if args
                .get(request.slot as usize)
                .is_some_and(|arg| types[arg.0 as usize] == concrete)
            {
                name.clone_into(target);
            }
        }
    }
}

/// A name for the clone that no source function can have.
///
/// `#` cannot appear in a TypeScript identifier, so `drive#Closure0` is this
/// compiler's and reads as what it is.
fn clone_name(program: &Program, request: &Request) -> String {
    let base = format!(
        "{}#{}",
        program.funcs[request.callee].name,
        super::lower::closure_class(request.concrete)
    );
    // A program with two functions of one name is not one this can produce, but
    // a suffix costs nothing and a duplicate definition is a link error. Bounded
    // by the number of functions, since that is how many names can be taken.
    let taken: FxHashSet<&str> = program.funcs.iter().map(|f| f.name.as_str()).collect();
    if !taken.contains(base.as_str()) {
        return base;
    }
    (2..=program.funcs.len() + 1)
        .map(|n| format!("{base}#{n}"))
        .find(|candidate| !taken.contains(candidate.as_str()))
        .unwrap_or(base)
}
