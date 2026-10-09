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

use super::{Callee, Func, HirType, ManagedType, OpKind, Program, TypeId};

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

        // A clone exists to turn a dispatch into a direct call by name, so it
        // is only worth making while that name still refers to something.
        //
        // `drop_callers_of_refused` runs before this and removes a closure
        // whose body calls something refused. The dispatch that reached it is
        // handled -- reachability nulls a table entry naming a function that is
        // gone -- but a *clone* would write the name into a `Callee::Direct`
        // afterwards, and nothing looks at that again. `path` and `url` both
        // reached the verifier as `MissingCallee { callee: "Closure34#call" }`
        // for exactly this, and had done for as long as the profile step did
        // not verify.
        //
        // Recorded as serving itself, so the same request is not found again.
        //
        // **The entry the clone names**, asked once: a closure's written
        // `#call`, or, for one that reads its own `this`, the body taking it
        // (`Program::receiving`). Asking for the `#call` there refused every
        // such clone, because nothing calls that wrapper but the runtime, so
        // reachability had removed it.
        let entry = super::is_closure_type(request.concrete).then(|| {
            let written = super::lower::closure_method(request.concrete);
            match program.receiving.get(&written) {
                Some(body) => (body.clone(), true),
                None => (written, false),
            }
        });
        if let Some((target, _)) = &entry
            && !program.funcs.iter().any(|func| &func.name == target)
        {
            let original = program.funcs[request.callee].name.clone();
            clones.insert((original.clone(), request.slot, request.concrete), original);
            continue;
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
        // The written entry's name and shape, resolved here because the clone
        // cannot see the program. Its absence is already handled above -- that
        // check is what keeps a clone from naming a function reachability
        // removed -- so this only fails for a `concrete` that is not a closure
        // type at all, where there is nothing to make direct.
        let written = entry.and_then(|(target, takes_this)| {
            program
                .funcs
                .iter()
                .find(|func| func.name == target)
                .map(|func| {
                    (
                        target,
                        func.params.len(),
                        func.return_type.clone(),
                        takes_this,
                    )
                })
        });
        let result_absent = super::erased_entry_absent(program, request.concrete);
        if let Some(written) = written {
            retype_parameter(
                &mut clone,
                request.slot,
                request.concrete,
                program.erased_call_slot,
                written,
                result_absent,
            );
        }
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
    let Some(param) = func
        .parameter_values()
        .and_then(|values| values.get(slot as usize).copied().flatten())
    else {
        return false;
    };
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
///
/// `written` is the class's `#call` with its parameter count and return type,
/// resolved by the caller because this has only the clone.
fn retype_parameter(
    clone: &mut Func,
    slot: u32,
    concrete: TypeId,
    erased_slot: Option<u32>,
    written: (String, usize, HirType, bool),
    result_absent: super::Absent,
) {
    let Some(param) = clone
        .parameter_values()
        .and_then(|values| values.get(slot as usize).copied().flatten())
    else {
        return;
    };
    let ty = HirType::Managed(ManagedType::Object(concrete));
    clone.values[param.0 as usize].ty = ty;

    // Which body a closure class's slot holds is decided by the class, and a
    // closure class is final. So this is the same reasoning the lowering does
    // for a receiver it can see -- it is only that the receiver became visible
    // here rather than there.
    //
    // **And a call the site made in the uniform ABI has that ABI undone**, which
    // is not a nicety: pointing such a call at the written `#call` and leaving
    // its arguments is `CallArgumentCount { expected: 2, found: 9 }`, and
    // *keeping* the uniform entry -- direct, so the dispatch is still bought --
    // cost `benches/cases/closures` seven `nts_value_of_undefined` constructions
    // and a read-back inside its hot loop. [`super::call_directly`] is that
    // surgery, shared with `fields::devirtualize` because both arrive at the same
    // question from different evidence. The receiver needs no re-typing here: the
    // parameter *is* the class, which is what this pass just decided.
    let (name, arity, returns, takes_this) = written;
    let sites: Vec<(usize, bool)> = clone
        .values
        .iter()
        .enumerate()
        .filter_map(|(index, value)| {
            let OpKind::Call { callee, args, .. } = &value.kind else {
                return None;
            };
            let Callee::Closure { slot: at } = callee else {
                return None;
            };
            // **The ordinary uniform slot only.** Every `Callee::Closure` lowering
            // makes names it -- `closure_callee` has no other answer for a receiver
            // known as a signature -- except a call inside a `try`, which names the
            // *raising* entry and whose whole point is that the body it reaches
            // records an uncaught `throw` instead of ending the program. Redirecting
            // one at `closure_method`'s written entry would drop that, and drop it
            // silently: the args are the uniform ones, so the arity would not match
            // either. Those keep their dispatch, which `fields::devirtualize` can
            // still resolve because it reads the class's entry at the call's own
            // slot rather than assuming the written one.
            (args.first() == Some(&param) && Some(*at) == erased_slot).then_some((index, true))
        })
        .collect();
    for (index, uniform) in sites {
        let written = super::Written {
            name: name.clone(),
            arity,
            returns: &returns,
            result_absent,
            takes_this,
        };
        super::call_directly(clone, index, written, uniform, None);
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
