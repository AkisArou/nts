//! Structural verification of HIR.
//!
//! # Why this exists
//!
//! Invalid SSA does not crash. It compiles, runs, and reads whatever happened to
//! be in a register — and the first version of loop lowering in this compiler
//! produced exactly that: after `while (i < n) { total = total + i; }` the
//! `return total` used the value the *body* defined rather than the header
//! parameter, so the exit block used a value it does not dominate. It was caught
//! by reading the printed IR, which is not a method that scales.
//!
//! Every check here is cheap and runs over the whole program. A backend that
//! trusts its input is entitled to; something has to earn that trust first.

use rustc_hash::FxHashSet;

use super::{
    BinOp, Block, BlockId, Callee, Func, HirType, OpKind, Program, Terminator, ValueId,
};

/// A way the IR was malformed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invalid {
    /// Native local storage escaped or could be reused while an alias survives.
    NativeStorage { func: String, reason: &'static str },
    /// A branch names a block that does not exist.
    DanglingSuccessor { func: String, target: BlockId },
    /// A layout's base is not laid out as its prefix.
    ///
    /// Base-first layout is what makes an upcast free: the C backend spells it
    /// as a pointer cast, the LLVM backend as nothing at all, and the JVM
    /// backend as a `super_class` its verifier checks when the class loads. All
    /// three rely on the base's fields sitting at the front of the derived's,
    /// in order, and until this nothing said so -- it was a property everybody
    /// assumed and no pass asserted.
    ///
    /// Only the fields. A dispatch table legitimately differs slot for slot
    /// between a base and a class that overrides one of its methods; that is
    /// what overriding *is*, and equality there would refuse every hierarchy
    /// this compiler exists to compile.
    BrokenBase {
        layout: String,
        base: String,
    },
    /// Two layouts share a name and are not the same shape.
    ///
    /// A layout's name is what every backend names its type after, so two of
    /// them is two definitions of one C struct -- `error: redefinition of
    /// 'NtsObj_IteratorResult'`, from clang, a compilation stage away from the
    /// choice that caused it and naming no source line at all.
    ///
    /// That is how it arrived on 2026-09-20: `IteratorResult<T>` gets a layout
    /// **per instantiation**, and every instantiation was named by one
    /// constant, so `http` and `process` stopped building. The name was also
    /// what three call sites compared against to recognise the provided layout,
    /// which is why it was a constant -- one string doing two jobs that pull in
    /// opposite directions.
    ///
    /// Checked here rather than in an emitter because it is a statement about
    /// the program, and because the JVM backend would answer it differently:
    /// there the descriptor carries the type, so two same-named layouts collide
    /// silently instead of loudly.
    DuplicateLayout {
        name: String,
        /// Where they part: a field name, or the count when even that differs.
        ///
        /// The first version of this reported the two field *counts*, and the
        /// defect it was written for has the same count on both sides --
        /// `IteratorResult` is `{ done, value }` either way and the `value`
        /// slots hold different things. It printed `fields: 2, other: 2`, which
        /// is true and says nothing.
        differs: String,
    },
    /// A direct call passed an argument of an incompatible *representation*.
    ///
    /// Representation and not type, and the distinction is the whole of what
    /// this checks. Passing a `Square` where a `Shape` is expected is an
    /// upcast, which base-first layout makes a no-op pointer cast -- both are
    /// one pointer, and whether the upcast is legal was the typechecker's
    /// question, not this pass's. A first version compared types exactly and
    /// reported five of those in `examples/inheritance` alone.
    ///
    /// What it does catch is a value reaching a parameter that cannot hold it:
    ///
    /// The verifier checked arity and not types, which meant a value could be
    /// passed into a parameter of a different representation and reach the
    /// a `NtsString *` into a `double` is a diagnostic in C, but a
    /// `NtsString *` into a `NtsValue` is a struct initialised from a pointer,
    /// and the compiler that emitted it was never asked. Found while adding
    /// `HirType::Erased`, whose whole purpose is that concrete values must be
    /// *converted* into it.
    CallArgumentType {
        func: String,
        callee: String,
        at: usize,
        expected: HirType,
        found: HirType,
    },
    /// A value was stored into a slot of an incompatible representation.
    ///
    /// The companion to [`Self::CallArgumentType`], and it exists because that
    /// one was not enough. A conversion is needed wherever a value meets a slot
    /// whose type the source states -- an argument, a declaration, a return, a
    /// global, an array element, a field -- and the argument check found the
    /// missing conversion in the *one* place its author had been looking at.
    /// The other four were each found by something else: a `typeof` that
    /// matched neither path, a C compiler, a differential disagreeing with
    /// node. An instrument covers what its author had in mind, so this one
    /// covers the whole class rather than the next case.
    StoreType {
        func: String,
        what: &'static str,
        expected: HirType,
        found: HirType,
    },
    /// The two operands of one operator have different representations.
    ///
    /// C answers this with its usual arithmetic conversions and says nothing,
    /// so the C backend never had to ask -- and the LLVM backend, which must
    /// name one type for the instruction, grew a copy of those rules to
    /// compensate. That is C's semantics living somewhere that should not know
    /// them. The conversion belongs in the IR, where both backends read it.
    OperandsDiffer {
        func: String,
        op: &'static str,
        left: HirType,
        right: HirType,
    },
    /// A direct call's result is not what the function it names returns.
    ///
    /// Unchecked until a closure turned out to be fourteen times slower through
    /// LLVM than through C. `Closure0__call` was defined returning `double` and
    /// called expecting `i32`, because the definition took its type from the
    /// callee and the call site took it from the operation. LLVM verified it --
    /// with opaque pointers a call carries its own signature -- and then could
    /// not inline a call whose signature disagrees with its callee.
    CallResultType {
        func: String,
        callee: String,
        expected: HirType,
        found: HirType,
    },
    /// An operator was applied to an operand it cannot be applied to.
    ///
    /// Arithmetic, ordering and the bitwise operators all read a *machine*
    /// value; an erased one is a tag beside a payload and has to be read out
    /// first. The backend does not check -- it emits `a * b` on whatever it was
    /// given, and for a `NtsValue` that is a struct in a multiplication, which
    /// C rejects with no source location and nothing naming the operator.
    ///
    /// Found by making a narrowing return the erased value where the checker
    /// had narrowed it to `never`: the branch was unreachable, so nothing ran
    /// wrongly, and `nts hir` still reported "all of it verifies" over a
    /// multiplication of a tagged value. `invalid HIR 0` was counting a
    /// question nobody had asked.
    OperandType {
        func: String,
        op: &'static str,
        found: HirType,
    },
    /// A jump passed a different number of arguments than the target takes.
    ///
    /// The arguments *are* the edge's contribution to the target's parameters, so
    /// a mismatch means some parameter has no value on that path.
    ArgumentCount {
        func: String,
        target: BlockId,
        expected: usize,
        found: usize,
    },
    /// A value was used somewhere its definition does not reach.
    ///
    /// The failure this module exists for. Perfectly plausible-looking IR.
    NotDominated {
        func: String,
        value: ValueId,
        used_in: BlockId,
    },
    /// The entry block declares parameters.
    ///
    /// Parameters are supplied by predecessors, and the entry has none — a
    /// function's own arguments are `OpKind::Param`, not block parameters.
    EntryHasParams { func: String },
    /// A block cannot be reached from the entry.
    Unreachable { func: String, block: BlockId },
    /// An edge hands a block parameter a value of another representation.
    ///
    /// A block parameter is where two paths agree about what a name holds, so
    /// this is the two paths disagreeing. `n > 0 ? n : undefined` produced one:
    /// the join took an erased value and the first arm passed a bare `double`.
    EdgeType {
        func: String,
        target: BlockId,
        at: usize,
        expected: HirType,
        found: HirType,
    },
    /// A function that owes a value fell out of the end of its body.
    ///
    /// [`super::Terminator::FellThrough`] is sound only where the block is
    /// dead, and no dead block reaches this point: the check above rejects
    /// every block the entry cannot reach, and the loop `while (true) { }` --
    /// the one shape that legally falls out of a body owing a value -- has its
    /// constant condition folded and its exit removed before this runs.
    ///
    /// So one here means the function's *return type* is wrong. The emitter
    /// renders the fall-through as `__builtin_unreachable()`, which is not a
    /// crash: it is a licence for the C compiler to compute anything at all in
    /// the caller. A setter that read its own name as a return annotation did
    /// exactly that -- it compiled, every test passed, and the answer was
    /// wrong by a constant.
    FellThrough { func: String, block: BlockId },
    /// A `return` whose value does not match what the function returns.
    ///
    /// Nothing checked this, and it is not a theoretical shape: `ref(): this`
    /// lowered to a function typed `void` that returned a `Box`, because a
    /// return type with no representation defaulted to void rather than
    /// refusing. The C said `void f(...)` and returned a pointer, which clang
    /// rejects -- so the only thing that noticed was a compiler that never ran,
    /// because nothing in the gate builds an addon.
    ReturnType {
        func: String,
        block: BlockId,
        expected: HirType,
        found: Option<HirType>,
    },
    /// A direct call passed a different number of arguments than the function
    /// it names takes.
    ///
    /// A static call is the one place a callee's shape is known exactly, so a
    /// mismatch is a lowering bug rather than a language feature. Without this
    /// check it reaches the backend as a C call of the wrong arity: caught, but
    /// by the C compiler, a long way from the pass that caused it -- and only
    /// where a C compiler runs at all.
    CallArgumentCount {
        func: String,
        callee: String,
        expected: usize,
        found: usize,
    },
    /// A direct call names a function this program does not contain.
    ///
    /// It reaches the linker as an undefined symbol, which is a failure with no
    /// source location and no explanation. Every one of these has been a
    /// lowering that guessed a name: `e.toString()` on a class extending the
    /// provided `Error` emitted `E#toString` because nothing declared the
    /// method and the receiver's own type was used as a fallback.
    MissingCallee { func: String, callee: String },
    /// Two functions in one program share a name.
    ///
    /// The emitted C would define one of them twice, and a call naming it
    /// reaches whichever the linker picked. A namespace is how this arises: its
    /// members are lowered under their unqualified names, so `Rect.area` and
    /// `Tri.area` both emit `area`. Refused in the lowering, so this should
    /// never fire — it is here because the failure without it was a C
    /// redefinition error with no source location.
    DuplicateFunction { name: String },
}

/// Check a whole program.
///
/// # Errors
///
/// Returns every problem found rather than the first, so one run reports the
/// whole picture.
pub fn verify(program: &Program) -> Result<(), Vec<Invalid>> {
    let mut problems = Vec::new();
    for func in &program.funcs {
        verify_func(func, &mut problems);
    }
    check_calls(program, &mut problems);
    check_native_calls(program, &mut problems);
    for (at, _, reason) in super::native_storage::check(program) {
        problems.push(Invalid::NativeStorage { func: program.funcs[at].name.clone(), reason });
    }
    check_layouts(program, &mut problems);
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems)
    }
}

/// Native signatures must agree exactly after reconciliation, including integer
/// width and signedness. C's implicit conversions must not hide a broken HIR
/// contract that a second backend will read literally.
fn check_native_calls(program: &Program, problems: &mut Vec<Invalid>) {
    for func in &program.funcs {
        for op in func
            .blocks
            .iter()
            .flat_map(|block| &block.ops)
            .filter_map(|value| func.values.get(value.0 as usize))
        {
            let OpKind::Call {
                callee: Callee::Native(target),
                args,
                ..
            } = &op.kind
            else {
                continue;
            };
            if target.retention.len() != target.parameters.len()
                || target.retention.iter().zip(&target.parameters).any(|(kept, ty)| {
                    *kept == super::native::Retention::NotRetained
                        && !matches!(ty, super::native::Type::Pointer(_) | super::native::Type::FnPointer(_))
                })
            {
                problems.push(Invalid::NativeStorage { func: func.name.clone(), reason: "invalid native no-escape contract" });
            }
            let result = target.result.representation();
            if op.ty != result {
                problems.push(Invalid::CallResultType {
                    func: func.name.clone(),
                    callee: target.name.clone(),
                    expected: result,
                    found: op.ty.clone(),
                });
            }
            // A variadic prototype takes at least its declared parameters and
            // then anything; a fixed one takes exactly them.
            let miscounted = match target.variadic {
                Some(_) => args.len() < target.parameters.len(),
                None => args.len() != target.parameters.len(),
            };
            if miscounted {
                problems.push(Invalid::CallArgumentCount {
                    func: func.name.clone(),
                    callee: target.name.clone(),
                    expected: target.parameters.len(),
                    found: args.len(),
                });
            }
            for (at, (arg, want)) in args.iter().zip(&target.parameters).enumerate() {
                let Some(found) = func.values.get(arg.0 as usize) else {
                    continue;
                };
                let expected = want.representation();
                if !want.accepts(&found.ty) {
                    problems.push(Invalid::CallArgumentType {
                        func: func.name.clone(),
                        callee: target.name.clone(),
                        at,
                        expected,
                        found: found.ty.clone(),
                    });
                }
            }
        }
    }
}

/// Each layout's base, against the layout that extends it.
///
/// `Layout.base` was added so that two types differing only in what they extend
/// stop merging -- `class Circle extends Shape {}` had `Shape`'s fields and
/// `Shape`'s dispatch table and became `Shape`. Having introduced the field,
/// this is what keeps it honest: a base named here has to be laid out as the
/// prefix every backend already treats it as.
fn check_layouts(program: &Program, problems: &mut Vec<Invalid>) {
    // **One name, one shape.** See `Invalid::DuplicateLayout`. Keyed on the
    // name and compared on the fields, because a layout reached twice for the
    // same type is ordinary -- `layout_of` is asked from many places and hands
    // back a clone -- and only a *disagreement* is the defect.
    let mut by_name: rustc_hash::FxHashMap<&str, &super::Layout> =
        rustc_hash::FxHashMap::default();
    for layout in &program.layouts {
        match by_name.entry(layout.name.as_str()) {
            std::collections::hash_map::Entry::Vacant(slot) => {
                slot.insert(layout);
            }
            std::collections::hash_map::Entry::Occupied(slot) => {
                let first = *slot.get();
                let differs = if first.fields.len() == layout.fields.len() {
                    first
                        .fields
                        .iter()
                        .zip(&layout.fields)
                        .find(|(mine, theirs)| !super::lower::same_slot(mine, theirs))
                        .map(|(mine, theirs)| {
                            format!("`{}`: {:?} against {:?}", mine.name, mine.ty, theirs.ty)
                        })
                } else {
                    Some(format!(
                        "{} field(s) against {}",
                        first.fields.len(),
                        layout.fields.len()
                    ))
                };
                if let Some(differs) = differs {
                    problems.push(Invalid::DuplicateLayout {
                        name: layout.name.clone(),
                        differs,
                    });
                }
            }
        }
    }
    for layout in &program.layouts {
        let Some(at) = program.base_layout(layout) else {
            continue;
        };
        let Some(base) = program.layouts.get(at) else {
            continue;
        };
        // `same_slot` rather than a comparison written out here. A shadowed
        // private field carries its base's name plus `@` and the base's type id,
        // and this check and `laid_out_as_a_prefix` must agree about that --
        // "two places that must agree" is what `Layout::same_shape`'s own
        // comment says has cost this project a week.
        let prefix = base.fields.len() <= layout.fields.len()
            && base
                .fields
                .iter()
                .zip(&layout.fields)
                .all(|(mine, theirs)| super::lower::same_slot(mine, theirs));
        if !prefix {
            problems.push(Invalid::BrokenBase {
                layout: layout.name.clone(),
                base: base.name.clone(),
            });
        }
    }
}

/// Direct calls, against the functions they name.
///
/// Program-wide rather than per-function, because the thing a call has to agree
/// with is another function.
///
/// Dispatched calls are left alone. Which implementation runs is decided by the
/// receiver, and every override of a method has the signature the base declares,
/// so the question this asks is answered by the typechecker rather than here.
fn check_calls(program: &Program, problems: &mut Vec<Invalid>) {
    let mut arity: rustc_hash::FxHashMap<&str, Vec<HirType>> = rustc_hash::FxHashMap::default();
    let mut returns: rustc_hash::FxHashMap<&str, HirType> = rustc_hash::FxHashMap::default();
    for func in &program.funcs {
        returns.insert(func.name.as_str(), func.return_type.clone());
        if arity
            .insert(
                func.name.as_str(),
                func.params.iter().map(|p| p.ty.clone()).collect(),
            )
            .is_some()
        {
            problems.push(Invalid::DuplicateFunction {
                name: func.name.clone(),
            });
        }
    }
    for func in &program.funcs {
        check_stores(program, func, problems);
        check_native_memory(func, problems);
        // The ops a block still holds, not every value the lowering ever made.
        //
        // This asks whether a call "reaches the linker as an undefined symbol",
        // and only an emitted call does: every backend walks the blocks. A pass
        // that takes an op *out* of the control flow leaves it in `func.values`
        // -- renumbering is not available, because a `ValueId` is an index and
        // so is a field and a block -- so scanning the value list reports a
        // call nothing will emit. `excise_from_initializer` makes exactly that
        // shape, and this refused to emit `os` over a call it had removed.
        for op in func
            .blocks
            .iter()
            .flat_map(|block| block.ops.iter())
            .map(|value| &func.values[value.0 as usize])
        {
            // **A virtual call's arguments are checked; its result is not.**
            //
            // The arguments, because they were the gap that mattered. A virtual
            // call is coerced at lowering to the signature the *checker*
            // resolved and dispatches through the slot the *declaring class*
            // spells; where an interface narrows a parameter those differ, and
            // a backend casts the function pointer without converting the
            // argument. `specialize::insert_conversions` fixes that now, and
            // this is what keeps it fixed -- in the HIR, where `compatible`
            // can see the case clang cannot: two mismatched **pointer** types
            // compile, link and are wrong.
            //
            // The result is left alone, and that is measured rather than
            // conceded. `AsyncWriter.fail?(): unknown` over an implementation
            // returning `void` gives `CallResultType { expected: Void, found:
            // Erased }` in `stream`, `fs`, `http` and `zlib` -- and **no
            // backend ever sees it**: 416 void-returning functions in `stream`'s
            // emitted C, and not one assignment from any of them, because an
            // unused result is dropped before emission. Reporting it would
            // redden the gate over a defect nobody can act on, which is worse
            // than the silence it replaces -- it trains a reader to skip the
            // check. `docs/records/0340` holds it as the remaining question.
            let (name, args, virtual_dispatch) = match &op.kind {
                OpKind::Call {
                    callee: Callee::Direct(name),
                    args,
                    ..
                } => (name, args, false),
                OpKind::Call {
                    callee: Callee::Virtual { declared, .. },
                    args,
                    ..
                } => (declared, args, true),
                _ => continue,
            };
            // `compatible` and not equality: two references are two pointers
            // however their types relate, which is what lets `ref(): this`
            // return the class that implements it.
            if !virtual_dispatch
                && let Some(declared) = returns.get(name.as_str())
                && !compatible(&op.ty, declared)
            {
                problems.push(Invalid::CallResultType {
                    func: func.name.clone(),
                    callee: name.clone(),
                    expected: declared.clone(),
                    found: op.ty.clone(),
                });
            }
            let Some(expected) = arity.get(name.as_str()) else {
                // A virtual callee is reached through a descriptor rather than
                // by symbol, so a declared name with no emitted function is not
                // the undefined-symbol hazard `MissingCallee` exists for.
                if virtual_dispatch {
                    continue;
                }
                problems.push(Invalid::MissingCallee {
                    func: func.name.clone(),
                    callee: name.clone(),
                });
                continue;
            };
            if args.len() != expected.len() {
                problems.push(Invalid::CallArgumentCount {
                    func: func.name.clone(),
                    callee: name.clone(),
                    expected: expected.len(),
                    found: args.len(),
                });
                continue;
            }
            for (at, (arg, want)) in args.iter().zip(expected).enumerate() {
                let Some(found) = func.values.get(arg.0 as usize).map(|op| &op.ty) else {
                    continue;
                };
                if !compatible(found, want) {
                    problems.push(Invalid::CallArgumentType {
                        func: func.name.clone(),
                        callee: name.clone(),
                        at,
                        expected: want.clone(),
                        found: found.clone(),
                    });
                }
            }
        }
    }
}

/// Whether a value of one type can be passed where another is expected.
///
/// Not assignability -- the typechecker answered that. This asks whether the
/// backend can emit the call at all, so two object pointers are compatible
/// however their classes are related: base-first layout makes an upcast a no-op
/// cast, and a derived pointer in a base parameter is what every `super` call
/// in the program already is.
///
/// Deliberately strict everywhere else, including between arrays of different
/// elements. An array is one pointer too, so that pair could be allowed -- and
/// is not, because nothing has produced one and a rule with no case behind it
/// is a guess about which mismatches are safe.
fn compatible(found: &HirType, want: &HirType) -> bool {
    if found == want {
        return true;
    }
    // An array is the exception to the reference rule below, and the JVM
    // backend is what found it.
    //
    // `Square` where `Shape` is expected is *one object seen through two
    // types*, and base-first layout is what makes the pointer interchangeable.
    // `[i32]` where `[f64]` is expected is not that: an array's element width
    // **is** its storage, so those are two different objects. The coarse
    // answer -- "both are pointers" -- is being asked a question only the
    // element type can answer, and it says yes.
    //
    // Neither native backend can see the difference. C spells every array
    // `NtsArray *` and LLVM spells every reference `ptr`, so the disagreement
    // has nothing to land on. The JVM puts the element type in the descriptor
    // and its verifier rejects the class at load: `Type '[I' is not assignable
    // to '[D'` on `const arr = [1, 2]; export const [a, b] = arr;`, where
    // specialization narrowed the array to `[i32]` and left the global
    // receiving it at `[f64]`.
    if let (
        HirType::Managed(super::ManagedType::Array(found)),
        HirType::Managed(super::ManagedType::Array(want)),
    ) = (found, want)
    {
        return compatible(found, want);
    }
    // Two references are two pointers, however their types relate. A `Square`
    // where a `Shape` is expected is a no-op cast under base-first layout, and
    // a `Promise<void>` slot holding a `Promise<number>` is one pointer either
    // way -- the payload is in the type for the compiler's benefit, and C sees
    // `NtsPromise *`.
    if found.may_hold_a_reference()
        && want.may_hold_a_reference()
        && *found != HirType::Erased
        && *want != HirType::Erased
    {
        return true;
    }
    // Nothing else. Two scalars used to be compatible here, on the grounds that
    // "the backend already emits the conversion" -- which was a description of
    // the *C* backend, where an assignment converts silently and the mismatch
    // is invisible. Written into the definition of a valid program, it meant
    // the IR could hand a `double` to an `i32` slot and be within its rights.
    //
    // The second backend had to write those conversions down, and got one
    // wrong: it took an array's element type from the value being stored and
    // emitted `store i64` into an array of doubles. Same width, no crash, and
    // every read of that element afterwards was an integer's bits read as a
    // double.
    //
    // So the conversion is inserted once, by `specialize::reconcile_stores`,
    // and this says what it now means for a program to be valid.
    false
}

fn check_native_memory(func: &Func, problems: &mut Vec<Invalid>) {
    for op in func.blocks.iter().flat_map(|b| b.ops.iter().map(|v| func.value(*v))) {
        let valid = match &op.kind {
            OpKind::NativeLocal { count } => *count > 0 && matches!(&op.ty, HirType::NativePointer(p) if super::layout::native_shape(p, super::native::NativeAbi::BOUND).is_some()),
            OpKind::NativeMalloc { bytes } => func.value(*bytes).ty == HirType::NUMBER
                && matches!(&op.ty, HirType::NativePointer(p) if super::layout::native_shape(p, super::native::NativeAbi::BOUND).is_some()),
            OpKind::NativeFree { pointer } => op.ty == HirType::Void && matches!(func.value(*pointer).ty, HirType::NativePointer(_)),
            // A layout on the bounding ABI. A backend whose ABI has none
            // (a bit-field record under Win64) refuses it by name.
            OpKind::NativeSizeOf(storage) => op.ty == HirType::NUMBER && super::layout::native_shape(storage, super::native::NativeAbi::BOUND).is_some(),
            _ => true,
        };
        if !valid { problems.push(Invalid::OperandType { func: func.name.clone(), op: "native storage", found: op.ty.clone() }); }

        let (pointer, index) = match &op.kind {
            OpKind::NativeLoad { pointer, index } | OpKind::NativeStore { pointer, index, .. }
            | OpKind::NativeIndexAddress { pointer, index } => (*pointer, Some(*index)),
            OpKind::NativeFieldAddress { pointer, .. } => (*pointer, None),
            _ => continue,
        };
        let found = &func.value(pointer).ty;
        let HirType::NativePointer(element) = found else {
            problems.push(Invalid::OperandType { func: func.name.clone(), op: "native memory access", found: found.clone() });
            continue;
        };
        let expected = match &op.kind {
            OpKind::NativeLoad { .. } | OpKind::NativeStore { .. } => element.element_type(),
            // An index address normally keeps the pointer's type: `p + i` points
            // at the same kind of thing `p` did. The exception is an array,
            // where it is the *decay* -- `a[i]` is an element, so the result
            // points at the element and not at another array. Same address
            // arithmetic, one fewer level of type.
            OpKind::NativeIndexAddress { .. } => match element.viewed() {
                super::native::Pointee::Opaque(_) => None,
                super::native::Pointee::Array { element, .. }
                | super::native::Pointee::Flexible(element) => {
                    Some(HirType::NativePointer((**element).clone()))
                }
                _ => Some(found.clone()),
            },
            // Through a view as well as a plain pointer, and with the same two
            // reasons to hand back an unaligned one: the record is packed, or
            // it was reached through something that was. Lowering applies both,
            // so this has to.
            OpKind::NativeFieldAddress { field, .. } => match element.viewed() {
                super::native::Pointee::Record(layout) => layout.fields.get(*field as usize).map(|f| {
                    let through_packing =
                        matches!(element, super::native::Pointee::Unaligned(_));
                    let slot = if layout.packed || through_packing {
                        super::native::Pointee::Unaligned(Box::new(f.ty.clone()))
                    } else {
                        f.ty.clone()
                    };
                    HirType::NativePointer(slot)
                }),
                _ => None,
            },
            _ => None,
        };
        let Some(expected) = expected else {
            problems.push(Invalid::OperandType { func: func.name.clone(), op: "native memory layout", found: found.clone() });
            continue;
        };
        let actual = match op.kind {
            OpKind::NativeStore { value, .. } => &func.value(value).ty,
            _ => &op.ty,
        };
        let mut report = |what, expected, actual: &HirType| {
            if expected != *actual {
                problems.push(Invalid::StoreType { func: func.name.clone(), what, expected, found: actual.clone() });
            }
        };
        report("native memory element", expected, actual);
        if let Some(index) = index {
            report("native memory index", HirType::Int { bits: 64, signed: true }, &func.value(index).ty);
        }
    }
}

/// The values a block actually executes.
///
/// **`Func::values` is every value the function ever defined, not every value
/// it runs.** Dead-code elimination drops a value from its block's `ops` and
/// leaves the definition behind — values are addressed by index, so removing
/// one would renumber the rest — and `emit.rs` says the same thing from the
/// other side: it collects "from the values each block still *executes*, not
/// from every value the function defines".
///
/// So a dead definition is never emitted, and until 2026-09-20 it was still
/// *verified*. Every pass that fixes types walks `block.ops`;
/// `specialize::reconcile_stores` is the one that matters here, and it inserts
/// the conversion a narrowed field needs. A store dropped from its block before
/// that pass ran therefore kept its old type — correctly, nothing runs it —
/// and the verifier reported it:
///
/// ```text
/// invalid HIR: StoreType { func: "module#init", what: "a field",
///   expected: Int { bits: 32, signed: true }, found: Float { bits: 64 } }
/// ```
///
/// **Invalid HIR is the worst outcome available**: `emit-c` writes nothing and
/// exits 0, so seven files of the slice-1 `test/language` population were
/// silently unbuilt over a value no backend would have emitted. Found by
/// tracing `reconcile_stores`, which reported `module#init (0 field sets)`
/// while the dump showed two.
///
/// Narrowing what the verifier looks at is the permissive direction, so it is
/// worth saying exactly how far it goes: an op no block lists is not in the
/// emitted program on any backend. If one ever is, that is a defect in the
/// backend's collection and this is not the check that would find it.
///
/// **Reachability is deliberately not consulted.** An op in an unreachable
/// block is reported as `Unreachable`, which is the finding, and asking
/// `reachable_blocks` here would be a second derivation of it — one that runs
/// *before* the edges have been checked, and therefore indexes a dangling
/// successor. `a_dangling_successor_is_caught` failed with `index out of
/// bounds: the len is 1 but the index is 9` on the first version of this, which
/// is the existing code's own ordering saying so: it calls `reachable_blocks`
/// only after `if !edges_sound { return; }`.
fn executed_values(func: &Func) -> FxHashSet<super::ValueId> {
    func.blocks
        .iter()
        .flat_map(|block| block.ops.iter().copied())
        .collect()
}

fn check_stores(program: &Program, func: &Func, problems: &mut Vec<Invalid>) {
    let mut report = |what, expected: &HirType, found: &HirType| {
        if !compatible(found, expected) {
            problems.push(Invalid::StoreType {
                func: func.name.clone(),
                what,
                expected: expected.clone(),
                found: found.clone(),
            });
        }
    };
    let executed = executed_values(func);
    for (index, op) in func.values.iter().enumerate() {
        if !executed.contains(&super::ValueId(u32::try_from(index).unwrap_or(u32::MAX))) {
            continue;
        }
        match &op.kind {
            // A read is a slot too. Nothing checked it, and the backend that
            // had to name a type for the load chose the *result's* rather than
            // the element's -- the same confusion that made a write store an
            // `i64` into an array of doubles.
            OpKind::ArrayGet { array, .. } => {
                if let HirType::Managed(super::ManagedType::Array(element)) =
                    &func.values[array.0 as usize].ty
                {
                    report("an array element read", element, &op.ty);
                }
            }
            OpKind::ArraySet { array, value, .. } => {
                if let HirType::Managed(super::ManagedType::Array(element)) =
                    &func.values[array.0 as usize].ty
                {
                    report(
                        "an array element",
                        element,
                        &func.values[value.0 as usize].ty,
                    );
                }
            }
            OpKind::GlobalSet { global, value } => {
                if let Some(slot) = program.globals.get(*global as usize) {
                    report("a global", &slot.ty, &func.values[value.0 as usize].ty);
                }
            }
            // **And a field read is a slot too**, for the reason the array
            // read above gives and in the same words -- it was written for
            // arrays and not for fields, so nothing asked whether a load's
            // type is the one the layout holds.
            //
            // What it catches: a value whose type says one class and a layout
            // whose field says another. Generic instantiation produced exactly
            // that on 2026-09-22 -- a copy read `writerState.stream` as
            // `WritableStreamState<Uint8Array>` from a layout whose field is
            // `WritableStreamState<W>` -- and the two structs are
            // prefix-compatible, so `coerce` had nothing to say and the C
            // emitter wrote `v2 = v1->stream` between them. It reached a
            // person as nine lines of `-Wincompatible-pointer-types` from
            // clang, three modules away from the pass that caused it, and
            // would have reached the JVM as a verifier error at class load.
            OpKind::FieldGet { object, field } => {
                if let HirType::Managed(super::ManagedType::Object(ty)) =
                    &func.values[object.0 as usize].ty
                    && let Some(layout) = program
                        .layouts
                        .iter()
                        .find(|layout| layout.types.contains(ty))
                    && let Some(slot) = layout.fields.get(*field as usize)
                {
                    report("a field read", &slot.ty, &op.ty);
                }
            }
            OpKind::FieldSet {
                object,
                field,
                value,
            } => {
                if let HirType::Managed(super::ManagedType::Object(ty)) =
                    &func.values[object.0 as usize].ty
                    && let Some(layout) = program
                        .layouts
                        .iter()
                        .find(|layout| layout.types.contains(ty))
                    && let Some(slot) = layout.fields.get(*field as usize)
                {
                    report("a field", &slot.ty, &func.values[value.0 as usize].ty);
                }
            }
            _ => {}
        }
    }
    if let Some(Terminator::Return(Some(value))) = func
        .blocks
        .iter()
        .map(|block| &block.terminator)
        .find(|t| matches!(t, Terminator::Return(Some(_))))
    {
        report(
            "a return",
            &func.return_type,
            &func.values[value.0 as usize].ty,
        );
    }
}

fn verify_func(func: &Func, problems: &mut Vec<Invalid>) {
    if !func.blocks.is_empty() && !func.entry().params.is_empty() {
        problems.push(Invalid::EntryHasParams {
            func: func.name.clone(),
        });
    }

    // Edges first: dominance is meaningless over a graph with dangling successors.
    let mut edges_sound = true;
    for (at, block) in func.blocks.iter().enumerate() {
        for target in block.terminator.successors() {
            if (target.0 as usize) >= func.blocks.len() {
                problems.push(Invalid::DanglingSuccessor {
                    func: func.name.clone(),
                    target,
                });
                edges_sound = false;
            }
        }
        if edges_sound {
            check_arguments(
                func,
                BlockId(u32::try_from(at).unwrap_or(u32::MAX)),
                block,
                problems,
            );
        }
    }
    if !edges_sound {
        return;
    }

    let reachable = reachable_blocks(func);
    for index in 0..func.blocks.len() {
        let id = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
        if !reachable.contains(&id) {
            problems.push(Invalid::Unreachable {
                func: func.name.clone(),
                block: id,
            });
            // One report per block. A dead block that also fell through is
            // dead first, and that is the thing to fix.
            continue;
        }
        if matches!(func.blocks[index].terminator, Terminator::FellThrough) {
            problems.push(Invalid::FellThrough {
                func: func.name.clone(),
                block: id,
            });
        }
    }

    check_operands(func, problems);
    check_dominance(func, &reachable, problems);
}

/// An operator's operands must be things it can be applied to.
///
/// Only the one rule that has a case behind it: arithmetic, ordering and the
/// bitwise operators cannot read an erased value, because the payload has to be
/// taken out of it first. `Eq` and `Ne` are excluded deliberately -- comparing
/// two erased values is `nts_value_strict_eq`, which is the whole point of
/// carrying a tag -- and `Concat` takes managed strings.
///
/// # A managed operand is not checked here, and could not be
///
/// Measured 2026-09-20. `(new C() as unknown as number) * 2` is accepted by the
/// lowering with **no refusal** and emits C that does not compile:
///
/// ```text
///     error: pointer cannot be cast to type 'double'
///         v3 = (double)v0;
/// ```
///
/// Lowering's own output is already ill-typed --- `mul %0, %1 : f64` where `%0`
/// is `managed<obj#1>` --- so both rules below would fire on it. Neither does,
/// because **`insert_conversions` runs first and repairs it**: a managed value
/// where an `f64` is wanted falls through that function's arms to the blanket
/// `_ => OpKind::Convert(operand)`, and by the time this walk sees the program
/// both operands agree at `f64`. The verifier is then correct about a program
/// that is not the one the lowering produced.
///
/// The comment on that blanket arm reasons about this exact hazard one case
/// over: *"a `Convert` is emitted as a C cast -- `(double)v` on a sixteen-byte
/// struct ... neither of which is C"*. It guards the **erased** boundary and
/// the managed one falls past it.
///
/// **Closed 2026-09-20 by removing the repair rather than adding a rule here.**
/// `insert_conversions` now leaves a managed-where-scalar mismatch standing ---
/// there is nothing to convert *to*, since no cast makes a pointer a number ---
/// and `OperandsDiffer` below reports it against the operator, before any C is
/// written. All four shapes above now report; all four controls still compile;
/// 307 examples produce no invalid HIR.
///
/// What is still owed is the *sentence*. A verifier failure renders as
/// `invalid HIR: OperandsDiffer { .. }`, which is Rust's `Debug` in front of a
/// person --- the defect `representation_word` exists to avoid, one file over.
/// The better answer is a refusal in the lowering, where `coerce` already has
/// the words: *an object where a number is wanted*, which is exactly why
/// `return (new C() as unknown as number)` on its own has always been refused
/// properly. That is a message change rather than a correctness one now.
///
/// The boundary, each arm measured rather than inferred:
///
/// ```text
///     (obj as unknown as number) * 2     bad C
///     (obj as unknown as number) + 1     bad C
///     ({a:1} as unknown as number) * 2   bad C
///     ("x" as unknown as number) * 2     bad C
///     return (obj as unknown as number)  REFUSED, correctly
///     (n as unknown as string)           REFUSED, correctly
///     (v as number) on an `unknown` param   compiles, correct
/// ```
///
/// Pre-existing: a binary built 2026-09-18 emits the same invalid C.
fn check_operands(func: &Func, problems: &mut Vec<Invalid>) {
    let executed = executed_values(func);
    for (index, op) in func.values.iter().enumerate() {
        if !executed.contains(&super::ValueId(u32::try_from(index).unwrap_or(u32::MAX))) {
            continue;
        }
        let OpKind::Binary { op: bin, lhs, rhs } = &op.kind else {
            continue;
        };
        let machine = match bin {
            BinOp::Add => "+",
            BinOp::Sub => "-",
            BinOp::Mul => "*",
            BinOp::Div => "/",
            BinOp::Rem => "%",
            BinOp::Lt => "<",
            BinOp::Le => "<=",
            BinOp::Gt => ">",
            BinOp::Ge => ">=",
            BinOp::BitAnd => "&",
            BinOp::BitOr => "|",
            BinOp::BitXor => "^",
            BinOp::Shl => "<<",
            BinOp::Shr => ">>",
            BinOp::UShr => ">>>",
            BinOp::Min => "Math.min",
            BinOp::Max => "Math.max",
            // `Eq` and `Ne` read a tag on purpose; `Concat` takes strings.
            BinOp::Eq | BinOp::Ne | BinOp::Concat => continue,
        };
        for operand in [lhs, rhs] {
            let found = &func.values[operand.0 as usize].ty;
            if *found == HirType::Erased {
                problems.push(Invalid::OperandType {
                    func: func.name.clone(),
                    op: machine,
                    found: found.clone(),
                });
            }
        }
        // And the two operands must agree with *each other*. Nothing checked
        // this, and nothing had to: C picks a type for a mixed-type `+` by its
        // usual arithmetic conversions and says nothing. The second backend had
        // to pick one too, so it grew a copy of C's rules -- which is C's
        // semantics living in a backend that should not know them.
        let (left, right) = (
            &func.values[lhs.0 as usize].ty,
            &func.values[rhs.0 as usize].ty,
        );
        if left != right && *left != HirType::Erased && *right != HirType::Erased {
            problems.push(Invalid::OperandsDiffer {
                func: func.name.clone(),
                op: machine,
                left: left.clone(),
                right: right.clone(),
            });
        }
        // And, for everything that is not a comparison, the result must be that
        // same type. A comparison answers a bool whatever it compared; `a + b`
        // answers what it worked in, and a slot of another width is a
        // conversion somebody has to write.
        if !bin.is_comparison() && op.ty != *left && *left != HirType::Erased {
            problems.push(Invalid::OperandsDiffer {
                func: func.name.clone(),
                op: machine,
                left: left.clone(),
                right: op.ty.clone(),
            });
        }
    }
}

/// Every jump must supply exactly the parameters its target declares, of the
/// types it declares them.
///
/// The count was checked and the types were not, and the difference is what an
/// edge is *for*: a block parameter is where two paths agree about what a name
/// holds, so an edge handing it something of another shape is the two paths
/// disagreeing. It reached the backend as C assigning a `double` to an
/// `NtsValue` -- caught, but by the C compiler, with no source location and
/// nothing naming the join.
fn check_arguments(func: &Func, id: BlockId, block: &Block, problems: &mut Vec<Invalid>) {
    let mut check = |target: BlockId, args: &[ValueId]| {
        let expected = func.blocks[target.0 as usize].params.len();
        if args.len() != expected {
            problems.push(Invalid::ArgumentCount {
                func: func.name.clone(),
                target,
                expected,
                found: args.len(),
            });
            return;
        }
        for (at, (argument, parameter)) in args
            .iter()
            .zip(&func.blocks[target.0 as usize].params)
            .enumerate()
        {
            let found = &func.values[argument.0 as usize].ty;
            let want = &func.values[parameter.0 as usize].ty;
            if !compatible(found, want) {
                problems.push(Invalid::EdgeType {
                    func: func.name.clone(),
                    target,
                    at,
                    expected: want.clone(),
                    found: found.clone(),
                });
            }
        }
    };

    match &block.terminator {
        Terminator::Jump { target, args } => check(*target, args),
        Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => {
            check(*then_target, then_args);
            check(*else_target, else_args);
        }
        Terminator::Return(value) => {
            // `never` is what a function that does not come back returns, and
            // it may carry a value or not -- a `throw` lowers to one either way.
            let found = value.map(|v| func.values[v.0 as usize].ty.clone());
            let agrees = match (&func.return_type, &found) {
                // A function that does not come back may carry a value or not:
                // a `throw` lowers to either shape.
                (HirType::Never, _) => true,
                // A `void` function returns nothing *at all* -- not even a
                // void-typed value, because C cannot spell one in a `return`
                // and the emitter declares no variable to hold it.
                (HirType::Void, carried) => carried.is_none(),
                // Otherwise the same rule a store and a call argument get: two
                // references are two pointers however their types relate, which
                // is what lets a function declared to return a function type
                // return the closure class that implements it.
                (wanted, Some(got)) => compatible(got, wanted),
                (_, None) => false,
            };
            if !agrees {
                problems.push(Invalid::ReturnType {
                    func: func.name.clone(),
                    block: id,
                    expected: func.return_type.clone(),
                    found,
                });
            }
        }
        Terminator::Unreachable | Terminator::FellThrough => {}
    }
}

pub(super) fn reachable_blocks(func: &Func) -> FxHashSet<BlockId> {
    let mut seen = FxHashSet::default();
    let mut worklist = vec![BlockId(0)];
    while let Some(block) = worklist.pop() {
        if !seen.insert(block) {
            continue;
        }
        let block = &func.blocks[block.0 as usize];
        worklist.extend(block.terminator.successors());
        // A terminator is not the only thing that names a block. `Await`
        // carries the handler its promise rejects into -- the one edge into a
        // handler that no `throw` wrote -- and it is a real edge at run time,
        // so a handler reachable only that way is reachable.
        //
        // Found by removing unreachable blocks and deleting one of these. The
        // verifier had the same blind spot and had never reported it, because
        // every handler it had seen was also reachable from a `throw`.
        for value in &block.ops {
            if let OpKind::Await {
                rejects_to: Some(rejection),
                ..
            } = &func.values[value.0 as usize].kind
            {
                worklist.push(rejection.handler);
            }
        }
    }
    seen
}

/// Immediate dominators, by the iterative algorithm.
///
/// `idom[i]` is the immediate dominator of block `i`, or `None` for the entry and
/// for unreachable blocks.
pub(super) fn dominators(func: &Func, reachable: &FxHashSet<BlockId>) -> Vec<Option<BlockId>> {
    let count = func.blocks.len();
    let mut predecessors: Vec<Vec<BlockId>> = vec![Vec::new(); count];
    for (index, block) in func.blocks.iter().enumerate() {
        let from = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
        for target in block.terminator.successors() {
            predecessors[target.0 as usize].push(from);
        }
    }

    // Reverse postorder makes the fixpoint converge in few passes: a block is
    // visited after the predecessors that can reach it, except across back edges.
    let order = reverse_postorder(func);
    let mut position = vec![usize::MAX; count];
    for (rank, block) in order.iter().enumerate() {
        position[block.0 as usize] = rank;
    }

    let mut idom: Vec<Option<BlockId>> = vec![None; count];
    idom[0] = Some(BlockId(0));
    let mut changed = true;
    while changed {
        changed = false;
        for &block in order.iter().skip(1) {
            let mut new_idom = None;
            for &pred in &predecessors[block.0 as usize] {
                if idom[pred.0 as usize].is_none() {
                    continue;
                }
                new_idom = Some(match new_idom {
                    None => pred,
                    Some(current) => intersect(pred, current, &idom, &position),
                });
            }
            if new_idom.is_some() && idom[block.0 as usize] != new_idom {
                idom[block.0 as usize] = new_idom;
                changed = true;
            }
        }
    }

    idom[0] = None;
    for (index, entry) in idom.iter_mut().enumerate() {
        if !reachable.contains(&BlockId(u32::try_from(index).unwrap_or(u32::MAX))) {
            *entry = None;
        }
    }
    idom
}

fn intersect(
    mut a: BlockId,
    mut b: BlockId,
    idom: &[Option<BlockId>],
    position: &[usize],
) -> BlockId {
    while a != b {
        while position[a.0 as usize] > position[b.0 as usize] {
            match idom[a.0 as usize] {
                Some(next) if next != a => a = next,
                _ => return b,
            }
        }
        while position[b.0 as usize] > position[a.0 as usize] {
            match idom[b.0 as usize] {
                Some(next) if next != b => b = next,
                _ => return a,
            }
        }
    }
    a
}

fn reverse_postorder(func: &Func) -> Vec<BlockId> {
    let mut order = Vec::new();
    let mut seen = FxHashSet::default();
    postorder(func, BlockId(0), &mut seen, &mut order);
    order.reverse();
    order
}

fn postorder(func: &Func, block: BlockId, seen: &mut FxHashSet<BlockId>, order: &mut Vec<BlockId>) {
    if !seen.insert(block) {
        return;
    }
    for target in func.blocks[block.0 as usize].terminator.successors() {
        postorder(func, target, seen, order);
    }
    order.push(block);
}

/// Every use of a value must be dominated by its definition.
fn check_dominance(func: &Func, reachable: &FxHashSet<BlockId>, problems: &mut Vec<Invalid>) {
    let idom = dominators(func, reachable);

    // Which block defines each value.
    let mut defined_in = vec![None; func.values.len()];
    for (index, block) in func.blocks.iter().enumerate() {
        let id = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
        for value in block.params.iter().chain(&block.ops) {
            defined_in[value.0 as usize] = Some(id);
        }
    }

    let dominates = |definer: BlockId, user: BlockId| {
        let mut current = Some(user);
        while let Some(block) = current {
            if block == definer {
                return true;
            }
            current = idom[block.0 as usize];
        }
        false
    };

    let report = |value: ValueId, used_in: BlockId, problems: &mut Vec<Invalid>| {
        let Some(definer) = defined_in[value.0 as usize] else {
            return;
        };
        if !dominates(definer, used_in) {
            problems.push(Invalid::NotDominated {
                func: func.name.clone(),
                value,
                used_in,
            });
        }
    };

    for (index, block) in func.blocks.iter().enumerate() {
        let id = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
        if !reachable.contains(&id) {
            continue;
        }

        for value in &block.ops {
            for operand in operands(&func.values[value.0 as usize].kind) {
                report(operand, id, problems);
            }
        }

        // A terminator's operands are used in *this* block, including the
        // arguments it passes onward — they are evaluated here, not there.
        for operand in terminator_operands(&block.terminator) {
            report(operand, id, problems);
        }
    }
}

pub(crate) fn operands(kind: &OpKind) -> Vec<ValueId> {
    match kind {
        OpKind::Erase { value }
        | OpKind::TagOf { value }
        | OpKind::Unerase { value }
        | OpKind::InstanceOf { value, .. }
        | OpKind::SharedFieldGet { value, .. } => {
            vec![*value]
        }
        OpKind::NativeCopy { destination, source } => vec![*destination, *source],
        OpKind::Await { promise, rejects_to } => {
            let mut read = vec![*promise];
            // Every argument the rejection edge owes its handler is read here,
            // which is what keeps them live to this point. Without it the
            // values were dead at the `await` and `rc` released them before
            // the handler could be given them.
            if let Some(rejection) = rejects_to {
                read.extend(rejection.args.iter().copied());
            }
            read
        }
        OpKind::CellReady { cell, .. } => vec![*cell],
        OpKind::Suspend { promise, frame, .. } => vec![*promise, *frame],
        OpKind::Param(_)
        | OpKind::BlockParam(_)
        | OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstString(_)
        | OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::ClosureStatic
        | OpKind::ObjectNew { .. }
        | OpKind::GlobalGet(_) => Vec::new(),
        OpKind::Yield { value } | OpKind::GlobalSet { value, .. } => vec![*value],
        OpKind::StringUnitAt { string, index, .. } => vec![*string, *index],
        OpKind::Binary { lhs, rhs, .. } => vec![*lhs, *rhs],
        OpKind::Unary { operand, .. } | OpKind::Convert(operand) => vec![*operand],
        OpKind::Call { args, .. } => args.clone(),
        OpKind::ArrayNew { length, .. } => vec![*length],
        OpKind::Length(array) | OpKind::Retain(array) | OpKind::Release(array) => {
            vec![*array]
        }
        OpKind::FieldGet { object, .. } => vec![*object],
        OpKind::FieldSet { object, value, .. } => vec![*object, *value],
        OpKind::NativeLocal { .. } | OpKind::NativeSizeOf(_) => vec![],
        OpKind::NativeBridge { closure, .. } => vec![*closure],
        OpKind::NativeBlock { invoke, context, .. } => vec![*invoke, *context],
        OpKind::NativeMalloc { bytes } => vec![*bytes],
        OpKind::NativeFieldAddress { pointer, .. }
        | OpKind::NativeBitLoad { pointer, .. }
        | OpKind::NativeFree { pointer } => vec![*pointer],
        OpKind::NativeIndexAddress { pointer, index }
        | OpKind::NativeLoad { pointer, index } => vec![*pointer, *index],
        OpKind::NativeStore { pointer, index, value } => vec![*pointer, *index, *value],
        OpKind::NativeBitStore { pointer, value, .. } => vec![*pointer, *value],
        OpKind::ArrayGet { array, index, .. } => vec![*array, *index],
        OpKind::ArraySet {
            array,
            index,
            value,
            ..
        } => vec![*array, *index, *value],
        OpKind::Return(value) => value.iter().copied().collect(),
    }
}

pub(crate) fn terminator_operands(terminator: &Terminator) -> Vec<ValueId> {
    match terminator {
        Terminator::Return(value) => value.iter().copied().collect(),
        Terminator::Jump { args, .. } => args.clone(),
        Terminator::Branch {
            cond,
            then_args,
            else_args,
            ..
        } => {
            let mut all = vec![*cond];
            all.extend(then_args);
            all.extend(else_args);
            all
        }
        Terminator::Unreachable | Terminator::FellThrough => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{HirType, Op, Param};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn op(kind: OpKind) -> Op {
        Op {
            kind,
            ty: HirType::Float { bits: 64 },
            origin: origin(),
        }
    }

    fn block(params: Vec<ValueId>, ops: Vec<ValueId>, terminator: Terminator) -> Block {
        Block {
            params,
            ops,
            terminator,
        }
    }

    fn func(values: Vec<Op>, blocks: Vec<Block>) -> Program {
        Program {
            layouts: Vec::new(),
            globals: Vec::new(),
            funcs: vec![Func {
                name: "f".to_owned(),
                params: Vec::<Param>::new(),
                return_type: HirType::Float { bits: 64 },
                values,
                blocks,
                origin: origin(),
                exported: true,
                initializes_receiver: false,
                async_result: None,
                frame: None,
                abstract_declaration: false,
            }],
            ..Program::default()
        }
    }

    /// Two arrays of different elements are two different objects.
    ///
    /// `Square` where `Shape` is expected is one object seen through two types,
    /// and base-first layout makes the pointer interchangeable -- that leniency
    /// is load-bearing and stays. An array is not that: its element width *is*
    /// its storage.
    ///
    /// Neither native backend can tell. C spells every array `NtsArray *`, LLVM
    /// spells every reference `ptr`. The JVM puts the element in the descriptor
    /// and refused the class, which is how this was found.
    #[test]
    fn two_arrays_of_different_elements_are_not_compatible() {
        use crate::hir::ManagedType;

        let array = |element: HirType| HirType::Managed(ManagedType::Array(Box::new(element)));
        let i32_ty = HirType::Int {
            bits: 32,
            signed: true,
        };
        let f64_ty = HirType::Float { bits: 64 };

        assert!(
            !compatible(&array(i32_ty.clone()), &array(f64_ty.clone())),
            "an array of i32 does not fit a slot declared as an array of f64",
        );
        assert!(compatible(&array(f64_ty.clone()), &array(f64_ty)));

        // And the object leniency it must not disturb: two object types are two
        // pointers, which is what makes an upcast free.
        let object = |id: u32| {
            HirType::Managed(ManagedType::Object(nts_semantic_schema::TypeId(id)))
        };
        assert!(compatible(&object(1), &object(2)));
    }

    /// A store the function runs is checked; one no block lists is not.
    ///
    /// Both arms, because the change that added the second one is the
    /// permissive direction: a verifier that stopped looking would pass this
    /// test's *first* arm too if the arm did not exist. The two programs differ
    /// in exactly one thing — whether the block lists the store.
    ///
    /// The live arm is what `reconcile_stores` would have fixed and the dead
    /// arm is what it never sees: it walks `block.ops`, so a value dropped from
    /// a block keeps whatever type it had, correctly, since nothing runs it.
    #[test]
    fn only_a_store_a_block_runs_is_checked() {
        use crate::hir::{Field, Layout, ManagedType};
        use nts_semantic_schema::TypeId;

        let laid_out = Layout {
            types: vec![TypeId(1)],
            name: "Holder".to_owned(),
            interfaces: Vec::new(),
            fields: vec![Field {
                name: "count".to_owned(),
                ty: HirType::Int {
                    bits: 32,
                    signed: true,
                },
                readonly: false,
                declared_by: None,
            }],
            methods: Vec::new(),
            base: None,
        };

        // %0 the object, %1 an f64, %2 the store of %1 into an i32 field.
        let object = Op {
            kind: OpKind::ObjectNew { frame: false },
            ty: HirType::Managed(ManagedType::Object(TypeId(1))),
            origin: origin(),
        };
        let values = vec![
            object,
            op(OpKind::ConstFloat(1.0)),
            op(OpKind::FieldSet {
                object: ValueId(0),
                field: 0,
                value: ValueId(1),
            }),
        ];

        let live = {
            let mut program = func(
                values.clone(),
                vec![block(
                    Vec::new(),
                    vec![ValueId(0), ValueId(1), ValueId(2)],
                    Terminator::Return(Some(ValueId(1))),
                )],
            );
            program.layouts = vec![laid_out.clone()];
            program
        };
        let Err(problems) = verify(&live) else {
            panic!("a store the block runs must be caught, and nothing was reported");
        };
        assert!(
            problems
                .iter()
                .any(|p| matches!(p, Invalid::StoreType { what: "a field", .. })),
            "a store the block runs must be caught: {problems:#?}"
        );

        let dead = {
            // The same values, with the store dropped from the block -- which
            // is what dead-code elimination leaves behind, since values are
            // addressed by index and removing one would renumber the rest.
            let mut program = func(
                values,
                vec![block(
                    Vec::new(),
                    vec![ValueId(0), ValueId(1)],
                    Terminator::Return(Some(ValueId(1))),
                )],
            );
            program.layouts = vec![laid_out];
            program
        };
        if let Err(problems) = verify(&dead) {
            panic!("a store no block runs is not in the emitted program: {problems:#?}");
        }
    }

    /// A field *read* is a slot too, and nothing asked until 2026-09-22.
    ///
    /// The same program as `only_a_store_a_block_runs_is_checked`, read
    /// instead of written: an `i32` field loaded as an `f64`. `FieldSet` has
    /// been checked against the layout for a long time and `ArrayGet` since
    /// the backend picked the result's type over the element's; `FieldGet`
    /// was the one of the four nobody had written down.
    #[test]
    fn a_field_read_is_checked_against_the_layout() {
        use crate::hir::{Field, Layout, ManagedType};
        use nts_semantic_schema::TypeId;

        let laid_out = Layout {
            types: vec![TypeId(1)],
            name: "Holder".to_owned(),
            interfaces: Vec::new(),
            fields: vec![Field {
                name: "count".to_owned(),
                ty: HirType::Int { bits: 32, signed: true },
                readonly: false,
                declared_by: None,
            }],
            methods: Vec::new(),
            base: None,
        };

        // %0 the object, %1 the read of its `i32` field, typed `f64`.
        let values = vec![
            Op {
                kind: OpKind::ObjectNew { frame: false },
                ty: HirType::Managed(ManagedType::Object(TypeId(1))),
                origin: origin(),
            },
            Op {
                kind: OpKind::FieldGet { object: ValueId(0), field: 0 },
                ty: HirType::Float { bits: 64 },
                origin: origin(),
            },
        ];
        let mut program = func(
            values,
            vec![block(
                Vec::new(),
                vec![ValueId(0), ValueId(1)],
                Terminator::Return(None),
            )],
        );
        program.layouts = vec![laid_out];
        let Err(problems) = verify(&program) else {
            panic!("a field read of the wrong type must be caught, and nothing was reported");
        };
        assert!(
            problems
                .iter()
                .any(|p| matches!(p, Invalid::StoreType { what: "a field read", .. })),
            "the read must be reported against the layout: {problems:#?}"
        );
    }

    /// A base has to be laid out as the prefix every backend treats it as.
    ///
    /// The upcast is a pointer cast in C, nothing at all in LLVM, and a
    /// `super_class` the JVM verifier checks at load time. All three assume the
    /// base's fields sit at the front of the derived's, in order, and nothing
    /// asserted it until `Layout.base` existed to assert it against.
    #[test]
    fn a_base_must_be_the_prefix_of_what_extends_it() {
        use crate::hir::{Field, Layout};
        use nts_semantic_schema::TypeId;

        let field = |name: &str| Field {
            name: name.to_owned(),
            ty: HirType::Float { bits: 64 },
            readonly: false,
            declared_by: None,
        };
        let laid_out = |base: Option<TypeId>, id: u32, name: &str, fields: Vec<Field>| Layout {
            types: vec![TypeId(id)],
            name: name.to_owned(),
            interfaces: Vec::new(),
            fields,
            methods: Vec::new(),
            base,
        };

        let mut program = valid();
        program.layouts = vec![
            laid_out(None, 1, "Shape", vec![field("size")]),
            // Derived, and its first field is not the base's.
            laid_out(
                Some(TypeId(1)),
                2,
                "Circle",
                vec![field("radius"), field("size")],
            ),
        ];
        let problems = verify(&program).expect_err("a reordered base is not laid out");
        assert!(
            problems
                .iter()
                .any(|problem| matches!(problem, Invalid::BrokenBase { .. })),
            "expected a BrokenBase, got {problems:?}",
        );

        // The same two with the base first, which is what the compiler emits.
        program.layouts[1] = laid_out(
            Some(TypeId(1)),
            2,
            "Circle",
            vec![field("size"), field("radius")],
        );
        assert!(verify(&program).is_ok(), "base-first must verify");
    }

    /// `f() { b0: %0 = param 0; ret %0 }`
    fn valid() -> Program {
        func(
            vec![op(OpKind::Param(0))],
            vec![block(
                Vec::new(),
                vec![ValueId(0)],
                Terminator::Return(Some(ValueId(0))),
            )],
        )
    }

    #[test]
    fn a_well_formed_function_verifies() {
        assert!(verify(&valid()).is_ok());
    }

    #[test]
    fn a_value_used_where_its_definition_does_not_reach_is_caught() {
        // The exact shape loop lowering produced before it was fixed: b2 defines
        // %1, b1 branches to b2 or b3, and b3 returns %1 — which it does not
        // dominate. Nothing about this looks wrong until dominance is computed.
        let program = func(
            vec![op(OpKind::ConstBool(true)), op(OpKind::ConstFloat(1.0))],
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0)],
                    Terminator::Branch {
                        cond: ValueId(0),
                        then_target: BlockId(1),
                        then_args: Vec::new(),
                        else_target: BlockId(2),
                        else_args: Vec::new(),
                    },
                ),
                block(
                    Vec::new(),
                    vec![ValueId(1)],
                    Terminator::Jump {
                        target: BlockId(2),
                        args: Vec::new(),
                    },
                ),
                block(Vec::new(), Vec::new(), Terminator::Return(Some(ValueId(1)))),
            ],
        );

        let problems = verify(&program).expect_err("b2 does not dominate b3");
        assert!(
            problems
                .iter()
                .any(|p| matches!(p, Invalid::NotDominated { .. })),
            "{problems:?}",
        );
    }

    #[test]
    fn a_value_flowing_through_a_block_parameter_is_accepted() {
        // The same shape done correctly: b1 passes its value along the edge, and
        // b2 receives it as a parameter. This must verify, or the check would
        // reject every loop.
        let program = func(
            vec![
                op(OpKind::ConstBool(true)),
                op(OpKind::ConstFloat(1.0)),
                op(OpKind::ConstFloat(2.0)),
                op(OpKind::BlockParam(0)),
            ],
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0), ValueId(2)],
                    Terminator::Branch {
                        cond: ValueId(0),
                        then_target: BlockId(1),
                        then_args: Vec::new(),
                        else_target: BlockId(2),
                        else_args: vec![ValueId(2)],
                    },
                ),
                block(
                    Vec::new(),
                    vec![ValueId(1)],
                    Terminator::Jump {
                        target: BlockId(2),
                        args: vec![ValueId(1)],
                    },
                ),
                block(
                    vec![ValueId(3)],
                    Vec::new(),
                    Terminator::Return(Some(ValueId(3))),
                ),
            ],
        );
        assert_eq!(verify(&program), Ok(()));
    }

    #[test]
    fn a_dangling_successor_is_caught() {
        let program = func(
            vec![op(OpKind::Param(0))],
            vec![block(
                Vec::new(),
                vec![ValueId(0)],
                Terminator::Jump {
                    target: BlockId(9),
                    args: Vec::new(),
                },
            )],
        );
        let problems = verify(&program).expect_err("b9 does not exist");
        assert!(
            problems
                .iter()
                .any(|p| matches!(p, Invalid::DanglingSuccessor { .. })),
        );
    }

    #[test]
    fn an_edge_supplying_the_wrong_number_of_arguments_is_caught() {
        // The arguments *are* the edge's contribution to the target's parameters,
        // so a mismatch leaves a parameter with no value on that path.
        let program = func(
            vec![op(OpKind::ConstFloat(1.0)), op(OpKind::BlockParam(0))],
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0)],
                    Terminator::Jump {
                        target: BlockId(1),
                        args: Vec::new(),
                    },
                ),
                block(
                    vec![ValueId(1)],
                    Vec::new(),
                    Terminator::Return(Some(ValueId(1))),
                ),
            ],
        );
        let problems = verify(&program).expect_err("b1 takes one parameter");
        assert!(problems.iter().any(|p| matches!(
            p,
            Invalid::ArgumentCount {
                expected: 1,
                found: 0,
                ..
            }
        )));
    }

    #[test]
    fn parameters_on_the_entry_block_are_caught() {
        // Nothing can supply them: the entry has no predecessors. A function's own
        // arguments are `Param`, not block parameters.
        let program = func(
            vec![op(OpKind::BlockParam(0))],
            vec![block(
                vec![ValueId(0)],
                Vec::new(),
                Terminator::Return(Some(ValueId(0))),
            )],
        );
        let problems = verify(&program).expect_err("the entry cannot take parameters");
        assert!(
            problems
                .iter()
                .any(|p| matches!(p, Invalid::EntryHasParams { .. })),
        );
    }

    /// A reachable `FellThrough` is the wrong return type, and nothing else.
    ///
    /// The distinction this rests on: `Unreachable` in the same position is
    /// legitimate -- a `throw`, or a resumed generator's state dispatch -- so
    /// the check cannot be a rule about blocks that end without returning.
    #[test]
    fn falling_out_of_a_body_that_owes_a_value_is_caught() {
        let program = func(
            vec![op(OpKind::Param(0))],
            vec![block(Vec::new(), vec![ValueId(0)], Terminator::FellThrough)],
        );
        let problems = verify(&program).expect_err("the entry owes a value and returns none");
        assert!(
            problems
                .iter()
                .any(|p| matches!(p, Invalid::FellThrough { .. })),
            "{problems:?}",
        );
    }

    /// The same block, claiming rather than falling: nothing to report.
    #[test]
    fn a_claimed_unreachable_in_the_entry_is_allowed() {
        let program = func(
            vec![op(OpKind::Param(0))],
            vec![block(Vec::new(), vec![ValueId(0)], Terminator::Unreachable)],
        );
        assert!(verify(&program).is_ok());
    }

    #[test]
    fn an_unreachable_block_is_caught() {
        let program = func(
            vec![op(OpKind::Param(0))],
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0)],
                    Terminator::Return(Some(ValueId(0))),
                ),
                block(Vec::new(), Vec::new(), Terminator::Unreachable),
            ],
        );
        let problems = verify(&program).expect_err("b1 has no predecessor");
        assert!(
            problems
                .iter()
                .any(|p| matches!(p, Invalid::Unreachable { .. })),
        );
    }

    /// `g(x)` calling `f(a, b)`. The backend would emit a C call of the wrong
    /// arity and the C compiler would reject it; this says so in terms of the
    /// pass that produced it, and says it whether or not a C compiler runs.
    #[test]
    fn a_direct_call_must_agree_with_the_function_it_names() {
        let param = |name: &str| Param {
            name: name.to_owned(),
            ty: HirType::Float { bits: 64 },
            origin: origin(),
            known: crate::hir::facts::Facts::TOP,
            shape: crate::hir::ParamShape::Ordinary,
        };
        let takes_two = Func {
            name: "f".to_owned(),
            params: vec![param("a"), param("b")],
            return_type: HirType::Float { bits: 64 },
            values: vec![op(OpKind::Param(0))],
            blocks: vec![block(
                Vec::new(),
                vec![ValueId(0)],
                Terminator::Return(Some(ValueId(0))),
            )],
            origin: origin(),
            exported: false,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
        };
        let passes_one = Func {
            name: "g".to_owned(),
            params: vec![param("x")],
            return_type: HirType::Float { bits: 64 },
            values: vec![
                op(OpKind::Param(0)),
                op(OpKind::Call {
                    callee: Callee::Direct("f".to_owned()),
                    args: vec![ValueId(0)],
                    frame: None,
                }),
            ],
            blocks: vec![block(
                Vec::new(),
                vec![ValueId(0), ValueId(1)],
                Terminator::Return(Some(ValueId(1))),
            )],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
        };
        let program = Program {
            funcs: vec![takes_two, passes_one],
            layouts: Vec::new(),
            globals: Vec::new(),
            ..Program::default()
        };
        let problems = verify(&program).expect_err("one argument for two parameters");
        assert!(
            problems.iter().any(|problem| matches!(
                problem,
                Invalid::CallArgumentCount {
                    expected: 2,
                    found: 1,
                    ..
                }
            )),
            "{problems:?}"
        );
    }
}
