//! What a dispatch slot's implementations must agree about.
//!
//! A virtual call reads an untyped pointer out of the receiver's table and
//! calls it at the signature of the implementation the receiver's *static* type
//! names -- which is what [`super::Callee::Virtual`]'s `declared` is for. So
//! every implementation in that slot is entered through that one signature,
//! whatever its own says, and a disagreement about a parameter's
//! **representation** is a value read as something it is not.
//!
//! TypeScript permits the disagreement: method parameters are **bivariant**, so
//! `_write(chunk: Uint8Array)` overriding `_write(chunk: unknown)` is accepted
//! by the checker. Refusing it declines a hole the language left open rather
//! than one this compiler made.
//!
//! # Why this rule exists here and not only on the JVM
//!
//! The JVM backend has refused exactly this since it was written -- `NTS4009`,
//! "the JVM would treat these as two unrelated methods and dispatch would
//! silently reach the wrong one" -- because two descriptors that differ are two
//! methods there and the mistake cannot be spelled. C and LLVM can spell it:
//! every reference is `T *` in one and `ptr` in the other, so the pointer goes
//! through and the callee reads it at its own idea of the layout.
//!
//! The conformance lane classified every `NTS4009` decline over the runtime on
//! 2026-09-28: nine shapes are the JVM's alone and **one is live on C**.
//! `ChildWritable._write(chunk: Uint8Array)` over `(chunk: unknown)` in
//! `child_process` and `cluster` -- node writes three bytes to a child's stdin
//! and nts takes SIGSEGV. It is not reachable today, because every
//! `ChildWritable` constructor chain is refused, so this costs **zero**
//! functions. That is the argument for doing it now rather than later: the day
//! `Writable#constructor` compiles, the crash publishes inside a commit about
//! something else, and whoever wrote that commit cannot see it.
//!
//! # What it refuses, and the three things it must not
//!
//! Each of the four came from a fixture, and three of them are fixtures that
//! must stay silent -- a rule hoisted from `bridge_for` verbatim would refuse
//! all three, because that one compares JVM descriptors and a descriptor
//! differs for reasons that are not representation differences.
//!
//! - **A differing parameter representation** is refused. The receiver is
//!   exempt: a subclass receiver is the whole point of dispatch, and base-first
//!   layout is what makes reading it through the base's type correct.
//! - **A return record whose layout is not prefix-compatible** with the
//!   declared one is refused. The caller reads the result at the *declared*
//!   record's offsets, so the declared record's fields have to be a prefix of
//!   what actually arrives.
//! - **Fewer parameters is allowed.** `_read()` overriding `_read(size)` is
//!   ordinary, and C ignores arguments a callee does not declare exactly as
//!   JavaScript does. Only the common prefix is compared.
//! - **A covariant record that extends the declared one, or repeats its fields
//!   in order, is allowed** -- that is what prefix-compatible means.
//!
//! # Two type ids can be one representation
//!
//! The comparison is by **layout**, never by `TypeId`. Two instantiations of one
//! generic are two ids and one layout, and
//! `outcomes/a-controller-stored-by-a-generic-branch` is the arm that proves a
//! `TypeId` comparison would be wrong: a generic branch hands a generic stream a
//! closure storing the controller, the two instantiations disagree about the id
//! and agree about the pointer, and it answers correctly on C. Comparing ids
//! would have refused a program that works.
//!
//! # Why the *call* is refused and not the override
//!
//! Refusing the override would empty its slot, and a table entry that is a null
//! pointer is the same segfault wearing a different hat -- which is what
//! `3f1362b65` found and `6c9008a6d` reverted. The call site is also where the
//! hazard actually is: the disagreement is proven statically, but whether
//! anything dispatches through it is not, and `lower.rs`'s standing policy is
//! "refused where a site proves it". A program that never makes such a call
//! compiles exactly as before, which is why the reach cost is zero.
use rustc_hash::FxHashMap;

use super::{Callee, Func, HirType, ManagedType, OpKind, Program, ValueId};

/// Virtual calls whose slot holds an implementation that cannot be entered
/// through the declared signature, as `(function, value, why)` triples in the
/// shape [`super::native_storage::check`] uses.
pub(super) fn check(program: &Program) -> Vec<(usize, ValueId, String)> {
    let mut problems = Vec::new();
    // Built once, and only for a program that dispatches: the layout index
    // walks every layout, and a hierarchy with no overriding has no slots.
    let mut layouts: Option<super::fields::LayoutIndex> = None;
    // Keyed by the pair a call site names, because that pair decides the
    // answer: the same slot entered through a different declared signature is
    // a different question.
    let mut asked: FxHashMap<(u32, &str), Option<String>> = FxHashMap::default();
    let by_name: FxHashMap<&str, &Func> = program
        .funcs
        .iter()
        .map(|func| (func.name.as_str(), func))
        .collect();
    for (at, func) in program.funcs.iter().enumerate() {
        for block in &func.blocks {
            for &value in &block.ops {
                let OpKind::Call {
                    callee: Callee::Virtual { slot, declared },
                    ..
                } = &func.value(value).kind
                else {
                    continue;
                };
                let layouts =
                    layouts.get_or_insert_with(|| super::fields::LayoutIndex::build(program));
                let why = asked
                    .entry((*slot, declared.as_str()))
                    .or_insert_with(|| disagreement(program, layouts, &by_name, *slot, declared));
                if let Some(why) = why {
                    problems.push((at, value, why.clone()));
                }
            }
        }
    }
    problems
}

/// The first implementation in `slot` that cannot be entered through
/// `declared`'s signature, said in a sentence.
///
/// `None` when every one of them can, which is the ordinary case and the one a
/// hierarchy is written for.
fn disagreement(
    program: &Program,
    layouts: &super::fields::LayoutIndex,
    by_name: &FxHashMap<&str, &Func>,
    slot: u32,
    declared: &str,
) -> Option<String> {
    let through = by_name.get(declared)?;
    for layout in &program.layouts {
        let Some(Some(name)) = layout.methods.get(slot as usize) else {
            continue;
        };
        if name == declared {
            continue;
        }
        let Some(implementation) = by_name.get(name.as_str()) else {
            continue;
        };
        // The receiver is exempt, so the walk starts at 1. A shorter
        // implementation is compared over what it has: C ignores an argument a
        // callee does not declare, as JavaScript does.
        for (index, (want, have)) in through
            .params
            .iter()
            .zip(implementation.params.iter())
            .enumerate()
            .skip(1)
            .map(|(index, (want, have))| (index, (&want.ty, &have.ty)))
        {
            // **A function-typed parameter is a different question**, and it is
            // one a check here could not answer. A closure arriving erased and
            // called at a signature is the closure-dispatch gap -- the value is
            // a closure either way, and what differs is the signature its
            // `#call` was written at, which no test on the value can verify.
            // JavaScript calls a function at any signature: extra arguments are
            // dropped and missing ones are `undefined`, so the *call* is legal
            // and what is missing is a uniform entry to route it through. That
            // is the standing uniform-signature-thunk item (React's every
            // component, and their ~600 `handler as (value: T) => void` sites),
            // and it needs an adapter rather than a refusal.
            //
            // Measured, not assumed: without this the rule refused
            // `EventEmitter#off` and `prependListener` in **nine** projects, on
            // `Readable#on` declaring parameter 2 as `Fn8783__97` where
            // `EventEmitter#on` passes it erased -- ordinary TypeScript, and a
            // listener registry is the commonest shape there is.
            if is_a_function(program, layouts, want) || is_a_function(program, layouts, have) {
                continue;
            }
            if !one_representation(layouts, want, have) {
                return Some(format!(
                    "`{name}` is reached through `{declared}`, which passes parameter {index} as \
                     {} where this one declares {} -- one dispatch slot, two representations, so \
                     the value would be read as something it is not",
                    names(program, layouts, want),
                    names(program, layouts, have),
                ));
            }
        }
        // **Only where no adaptation exists**, which is two records whose fields
        // are laid out differently. A declared return that is `Erased` with a
        // concrete implementation is the other thing -- `interface Source {
        // on(e: string): unknown }` against `on(e): this`, which is ordinary
        // TypeScript -- and what that wants is an `Erase` on the way out, the
        // way Java emits a covariant-return bridge. Refusing it instead cost
        // `EventEmitter#off` and `prependListener` in **nine** projects, which
        // `refusal-diff` named the first time this rule was measured.
        //
        // That gap is real and is not this rule's: the node-port lane reduced it
        // the same day, and under `--rc` it does not even compile --
        // `assigning to 'NtsValue' from incompatible type 'NtsObj_Emitter *'`,
        // because only RC materialises a temp for a discarded result. It is
        // recorded there rather than swept in here, because a refusal and a
        // missing conversion are different work and only one of them is a
        // representation that cannot be bridged.
        if !one_representation(layouts, &through.return_type, &implementation.return_type)
            && both_are_records(layouts, &through.return_type, &implementation.return_type)
            && !keeps_the_declared_prefix(
                program,
                layouts,
                &through.return_type,
                &implementation.return_type,
            )
        {
            return Some(format!(
                "`{name}` is reached through `{declared}` and returns {} where the caller reads \
                 {} -- the declared record's fields are not a prefix of what arrives, so every \
                 field after the first disagreement is read at the wrong offset",
                names(program, layouts, &implementation.return_type),
                names(program, layouts, &through.return_type),
            ));
        }
    }
    None
}

/// Whether two slots hold the same thing at run time.
///
/// Equal types trivially, and **two object types that share a layout**, which
/// is not the same question: `Layout::types` merges structurally identical
/// types, and two instantiations of one generic are two ids over one pointer.
fn one_representation(layouts: &super::fields::LayoutIndex, a: &HirType, b: &HirType) -> bool {
    if a == b {
        return true;
    }
    match (a, b) {
        (HirType::Managed(ManagedType::Object(a)), HirType::Managed(ManagedType::Object(b))) => {
            match (layouts.of_class(*a), layouts.of_class(*b)) {
                (Some(a), Some(b)) => a == b,
                _ => false,
            }
        }
        _ => false,
    }
}

/// Whether what a caller reads at `declared`'s return record is still there in
/// `arriving`: every declared field, at its own index, with its own
/// representation.
///
/// A record that **extends** the declared one satisfies this, and so does one
/// that **repeats** its fields in order. One that reorders them does not, which
/// is the same fact `put_bases_first` maintains for classes, arriving from the
/// override side instead.
fn keeps_the_declared_prefix(
    program: &Program,
    layouts: &super::fields::LayoutIndex,
    declared: &HirType,
    arriving: &HirType,
) -> bool {
    let (
        HirType::Managed(ManagedType::Object(declared)),
        HirType::Managed(ManagedType::Object(arriving)),
    ) = (declared, arriving)
    else {
        return false;
    };
    let (Some(declared), Some(arriving)) =
        (layouts.of_class(*declared), layouts.of_class(*arriving))
    else {
        return false;
    };
    let (declared, arriving) = (&program.layouts[declared], &program.layouts[arriving]);
    declared.fields.len() <= arriving.fields.len()
        && declared
            .fields
            .iter()
            .zip(&arriving.fields)
            .all(|(want, have)| {
                want.name == have.name && one_representation(layouts, &want.ty, &have.ty)
            })
}

/// What to call a representation in this rule's sentences.
///
/// A **third** vocabulary, deliberately, and the reason is the audience. `lower`'s
/// `spelling_of` answers what `typeof` would, so both sides of every
/// disagreement here would read "object"; the CLI's `render` writes the IR's own
/// syntax for a listing, which is right for `nts hir` and noise in a refusal.
/// What this rule is about is *layouts*, so it names them -- and a layout has a
/// name already, put there for exactly this kind of sentence.
fn names(program: &Program, layouts: &super::fields::LayoutIndex, ty: &HirType) -> String {
    match ty {
        HirType::Erased => "an erased value".to_owned(),
        HirType::Managed(ManagedType::Object(id)) => layouts.of_class(*id).map_or_else(
            || "an object".to_owned(),
            |at| format!("a `{}`", program.layouts[at].name),
        ),
        HirType::Managed(ManagedType::View(_)) => "a typed-array view".to_owned(),
        HirType::Managed(ManagedType::String) => "a string".to_owned(),
        HirType::Managed(_) => "a managed reference".to_owned(),
        HirType::Bool => "a boolean".to_owned(),
        HirType::Int { .. } | HirType::Float { .. } => "a number".to_owned(),
        HirType::BigInt => "a bigint".to_owned(),
        HirType::NativePointer(_) => "a C pointer".to_owned(),
        HirType::Void | HirType::Never => "nothing".to_owned(),
    }
}

/// Whether both of these are object records with layouts, which is the only
/// case where a return disagreement has no conversion to fall back on: two
/// records put their fields at different offsets and no cast fixes that.
fn both_are_records(layouts: &super::fields::LayoutIndex, a: &HirType, b: &HirType) -> bool {
    matches!(
        (a, b),
        (HirType::Managed(ManagedType::Object(_)), HirType::Managed(ManagedType::Object(_)))
    ) && [a, b].iter().all(|ty| {
        matches!(ty, HirType::Managed(ManagedType::Object(id)) if layouts.of_class(*id).is_some())
    })
}

/// Whether this is a function type -- a closure, or the signature layout a call
/// through one is typed at.
///
/// Asked of both sides of a parameter disagreement, because a closure is a
/// closure whatever signature its `#call` was written at, and the mismatch that
/// matters there is one only an adapter can fix. See the comment at the call.
fn is_a_function(program: &Program, layouts: &super::fields::LayoutIndex, ty: &HirType) -> bool {
    let HirType::Managed(ManagedType::Object(id)) = ty else {
        return false;
    };
    // A *synthetic* closure class, and a **signature layout**, which is the one
    // the corpus actually produces: `Readable#on`'s listener parameter is
    // `Fn8783__97`, whose id is an ordinary type id, so the synthetic test alone
    // answered no and the rule refused nine projects' listener registries.
    //
    // Asked by **name**, which is `is_signature_name`'s own choice and its own
    // reason -- "`Layout` is what three backends read, and a field that exists
    // to tell two of its own names apart is a field they would all have to
    // ignore". Reused rather than re-derived: a second test for "is this a
    // function type" would be a second answer to a question whose answer is
    // already a one-line function.
    super::is_closure_type(*id)
        || layouts
            .of_class(*id)
            .is_some_and(|at| super::lower::is_signature_name(&program.layouts[at].name))
}
