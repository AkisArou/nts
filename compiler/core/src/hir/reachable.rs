//! Dropping functions nothing can call.
//!
//! # The roots depend on the product
//!
//! RFC §6.8 lists `executable` and `shared-library` as different products, and
//! they have different public surfaces — so "what can be called from outside"
//! is a different question for each, and using one answer for both is either
//! unsound or wasteful.
//!
//! - An **executable** has no outside. Nothing but its entry point can be
//!   called, and a module's `export` means only "visible to another module of
//!   this program". Exports are *not* roots.
//! - A **library** can have any of its exports called by a caller this
//!   compilation cannot see. Every export is a root (RFC §27.1).
//! - A library with a **declared surface** narrows that. This is what the
//!   `exports: [...]` list in `nts.config.ts` is for: naming fewer than the
//!   source exports shrinks the ABI *and* the binary, which is the only reason
//!   declaring them is worth the trouble.
//!
//! Treating every export as a root regardless is the safe default and a poor
//! one for an executable — it keeps every exported function of every module,
//! whether the program can reach it or not.
//!
//! # Why this is exact rather than heuristic
//!
//! A JavaScript bundler tree-shaking has to guess whether importing a module
//! has side effects. This walks a call graph the checker already resolved, so
//! the root set is exact.
//!
//! # Why here and not left to the linker
//!
//! The linker does drop unreferenced functions, given `-ffunction-sections` and
//! `--gc-sections`, and it should still be asked to. But it runs last, and two
//! things follow from that.
//!
//! The smaller one is cost: everything the linker drops was first lowered,
//! analyzed interprocedurally, specialized, bounds-proven, emitted and compiled.
//! Using ten functions from a hundred means paying for a hundred to ship ten.
//!
//! The one that matters is **precision**, and no linker can undo it. Facts cross
//! function boundaries, so a call site widens what its callee's parameters are
//! known to be — including a call site that can never execute:
//!
//! ```text
//! function scale(v: number) { return v * 2; }        // called from `hot` with 0..99
//! function dead(v: number)  { return scale(v); }     // unreachable, `v` unbounded
//! ```
//!
//! With `dead` present, `scale`'s parameter is unbounded and it compiles to
//! `v0 * 2.0`. With `dead` pruned, it compiles to `(int64_t)v0 * 2`. Same
//! function, same body; the difference is a caller that cannot run. Dead code
//! does not merely cost bytes, it costs the surviving code its proofs — and by
//! the time the linker sees the program, the damage is in the object file.

use rustc_hash::{FxHashMap, FxHashSet};

use super::{Callee, Func, OpKind, Program};

/// Where a walk over the call graph starts.
#[derive(Debug, Clone, Copy)]
pub enum Roots<'a> {
    /// An executable: only these entry points. A module's exports are not
    /// roots, because nothing outside the program can call them — there is no
    /// outside.
    Entry(&'a [String]),
    /// A library whose whole export surface is public. The safe default, and
    /// the correct one whenever the product is not known.
    EveryExport,
    /// A library whose surface is **what its entry modules publish**, which is
    /// what every artifact this compiler emits actually exposes.
    ///
    /// `EveryExport` roots at the `exported` flag, so a helper exported for a
    /// sibling module to import is a root -- correct for a TypeScript package,
    /// where a consumer can import any module, and wrong for a `.so`, a
    /// `.node`, a jar or an `.xcframework`. None of those has a way to reach
    /// internal module: there is one entry and its surface is the ABI.
    ///
    /// **This is what removed a config field.** `exports: [...]` in
    /// `nts.config.ts` was a hand-written list of the names crossing the ABI,
    /// and it was a second statement of something the source already made: the
    /// entry's exports. It only had a case to answer because the default here
    /// was wider than any artifact -- so a helper the entry did not publish
    /// stayed a root, and narrowing it needed a list. Naming the entry, which a
    /// product must do anyway, says the same thing and cannot disagree with the
    /// source.
    ///
    /// Derived from the program rather than carried as names, because
    /// `public_api` is an output of lowering and roots are an input to it.
    EntrySurface,
    /// A library with a declared surface (RFC §27.1). Names that are not
    /// actually exported are reported rather than ignored: a manifest that
    /// names a function the source does not export is a mistake in the
    /// manifest, and silently exporting nothing is the worst way to find out.
    Declared(&'a [String]),
}

/// Names in a declared surface that the program does not export.
#[must_use]
/// The functions the *runtime* can call because a closure was handed to an
/// external: the methods of whatever was passed, and of everything that
/// derives from it.
///
/// Two passes need exactly this set and had neither. `prune` needs it or the
/// bodies go and the table is emitted as a null pointer -- the note this rule
/// carried said that had "no case that executes it", and it does now.
/// `interprocedural::analyze_program` needs it as an **edge**: a function whose
/// only caller is the runtime has no call site in the program, so the join over
/// its callers is BOTTOM, and BOTTOM is the identity for join.
///
/// That second one is a miscompilation rather than a missing optimisation. A
/// module-level `let handle = -1` assigned only inside such a callback keeps
/// the facts `[-1, -1]`, so every read of it folds to `-1` -- on **all three
/// backends**, with node printing the real value. It was found by a TypeScript
/// program calling a networking intrinsic, which is the first thing in this
/// repository to hand a closure across the boundary and then read what it
/// stored.
///
/// The declared type at the call site is the *base* whenever the closure
/// reached the intrinsic through a function of its own -- `send(cb)` where
/// `send` forwards `cb` on -- and that base is abstract, so its own methods are
/// declarations with no bodies. Hence the implementations, not just the layout.
fn callback_targets<'p>(
    program: &'p Program,
    hierarchy: &Hierarchy,
    func: &'p Func,
    args: &[super::ValueId],
) -> Vec<&'p str> {
    let types = args
        .iter()
        .flat_map(|arg| super::carried_values(func, *arg))
        .map(|arg| &func.values[arg.0 as usize].ty);
    super::exposure::reachable_types(program, &hierarchy.layouts, types)
        .into_iter()
        .filter_map(|ty| hierarchy.layouts.of(ty))
        .flat_map(|at| hierarchy.implementations(at))
        .flat_map(|at| program.layouts[at].methods.iter().filter_map(Option::as_deref))
        .collect()
}

/// The layout list read as a tree, once, for a walk that asks of it per call.
///
/// Both questions below are searches over the whole list -- which layout holds
/// a type, which layouts derive from a layout -- and `callback_names` asks them
/// for every external call in the program, inside a pass that itself runs once
/// per round of the interprocedural fixpoint. Read once, they are lookups.
struct Hierarchy {
    layouts: super::fields::LayoutIndex,
    /// The layouts whose base is each layout, by index.
    derived: Vec<Vec<usize>>,
}

impl Hierarchy {
    fn build(program: &Program) -> Self {
        let layouts = super::fields::LayoutIndex::build(program);
        let mut derived = vec![Vec::new(); program.layouts.len()];
        for (at, layout) in program.layouts.iter().enumerate() {
            if let Some(base) = layout.base.and_then(|base| layouts.of_class(base)) {
                derived[base].push(at);
            }
        }
        Self { layouts, derived }
    }

    /// A layout and everything that derives from it, transitively.
    ///
    /// For the external-argument rule: a value declared as a base may be any of
    /// its implementations at run time, and the runtime calls through the table
    /// of whichever it actually got.
    ///
    /// Breadth-first with a seen set rather than recursion, because a malformed
    /// hierarchy that reaches itself is a wrong answer here and a stack
    /// overflow with recursion -- and this runs on every external call in the
    /// program.
    fn implementations(&self, at: usize) -> Vec<usize> {
        let mut seen = vec![at];
        let mut frontier = vec![at];
        while let Some(base) = frontier.pop() {
            for derived in &self.derived[base] {
                if !seen.contains(derived) {
                    seen.push(*derived);
                    frontier.push(*derived);
                }
            }
        }
        seen
    }
}

/// Every function the runtime can call, across the whole program.
///
/// The program-wide union of [`callback_targets`]. `analyze_program` joins this
/// into its `outward` set, which is the "callers are outside the compiled set"
/// wall the module's own documentation describes -- and a closure the runtime
/// invokes is exactly on the far side of it.
#[must_use]
pub fn callback_names(program: &Program) -> Vec<&str> {
    let hierarchy = Hierarchy::build(program);
    let mut found = Vec::new();
    for func in &program.funcs {
        for op in &func.values {
            let OpKind::Call {
                callee: Callee::External(_) | Callee::Native(_),
                args,
                ..
            } = &op.kind
            else {
                continue;
            };
            for name in callback_targets(program, &hierarchy, func, args) {
                if !found.contains(&name) {
                    found.push(name);
                }
            }
        }
    }
    found
}

pub fn undeclared<'a>(program: &Program, declared: &'a [String]) -> Vec<&'a str> {
    declared
        .iter()
        .filter(|name| {
            !program
                .funcs
                .iter()
                .any(|func| func.exported && func.name == **name)
        })
        .map(String::as_str)
        .collect()
}

/// The names something outside this compilation can call, as a set.
///
/// A named type rather than the set itself, because three passes take it and
/// each was otherwise spelling a concrete hasher into its public signature.
pub type RootNames = FxHashSet<String>;

/// The functions something outside this compilation can call.
///
/// Two passes need this and they need the *same* answer. Reachability starts
/// here; the interprocedural analysis stops here, because a root's parameters
/// are written by a caller it cannot see and are therefore as wide as their
/// declared types.
///
/// Using `exported` for the second question is what an executable gets wrong.
/// A class exported so another module can import it makes every one of its
/// methods exported -- and in an executable, none of them is callable from
/// outside, because there is no outside.
#[must_use]
pub fn root_names<'p>(program: &'p Program, roots: Roots<'_>) -> Vec<&'p str> {
    let mut names: Vec<&str> = match roots {
        Roots::Entry(names) | Roots::Declared(names) => program
            .funcs
            .iter()
            .filter(|func| names.contains(&func.name))
            .map(|func| func.name.as_str())
            .collect(),
        // The entry's surface alone: `EveryExport` without the `exported`
        // flag. What a single-entry artifact publishes, and nothing a sibling
        // module merely exported so another sibling could import it.
        //
        // **Module evaluation is a root here too**, for the reason it is one
        // under `Entry`: nothing *calls* it and the program is wrong without it.
        // Leaving it out was measured rather than reasoned about --
        // `examples/library` exports `add` and a module-level
        // `const greeting`, and without this line the emitted C lost
        // `module__init` and the string it stores, so a library whose whole
        // surface is two names published one of them as null. That is the same
        // wrong *answer* the named-entry arm was fixed for, arrived at from the
        // other direction.
        Roots::EntrySurface => program
            .funcs
            .iter()
            .filter(|func| {
                func.name == super::lower::MODULE_INIT
                    || program
                    .public_api
                    .iter()
                    .any(|(emitted, _)| *emitted == func.name)
                    || program.public_namespaces.iter().any(|(_, properties)| {
                        properties.iter().any(|(_, emitted)| *emitted == func.name)
                    })
                    // **A published class's members are published with it.**
                    //
                    // `public_api` names the class -- `Counter` -- and its
                    // methods are functions called `Counter#bump`, which match
                    // none of the tests above. `EveryExport` kept them by the
                    // `exported` flag, and dropping that flag is the whole point
                    // of this variant, so removing it took the methods with it:
                    // a consumer got a class it could construct and could not
                    // call. `javap` on `ts-from-java` showed
                    // `- public double bump();` and `- public double hits();`
                    // against a checked-in capture, which is what that capture
                    // is for.
                    //
                    // Not DCE being right, and the arm that separates them is
                    // one export: add `drive(c: Counter) { return c.bump(); }`
                    // and `bump` comes back while an unused sibling stays gone.
                    // So a member reached through the call graph was already a
                    // root and a member reachable only *as the class's surface*
                    // was not -- which is the thing a published class is.
                    //
                    // Every member rather than the public ones: HIR carries no
                    // visibility, and keeping a private method a consumer cannot
                    // name is what `EveryExport` did anyway. Over-rooting is the
                    // safe direction here; under-rooting is a jar that does not
                    // link.
                    || func.name.split_once('#').is_some_and(|(owner, _)| {
                        // **A published *class*, not anything with a `#` in its
                        // name.** The first version asked only whether the owner
                        // was in `public_api`, and `eachUpTo#Closure0` -- a
                        // closure *specialization* of an exported function --
                        // has owner `eachUpTo`, which is. Rooting those kept
                        // specializations alive past the point their call sites
                        // had been rewritten, and the verifier reported
                        // `Unreachable { func: "eachUpTo", block: BlockId(6) }`
                        // for the original and its clone alike.
                        //
                        // The tell that it was not the root *list*: for
                        // `native-buffer` the list into `prune` is
                        // `["uppercaseAscii"]` either way, because
                        // specializations do not exist yet when pruning runs.
                        // They exist at the later `analyze_program` calls, which
                        // take the same root set through `root_names` -- so the
                        // damage was downstream of the list I had instrumented
                        // and identical to it.
                        //
                        // A class has a layout and is not itself a function;
                        // `eachUpTo` is a function and has no layout. Both
                        // halves, because a specialization of a published class's
                        // method would satisfy the first alone.
                        program.layouts.iter().any(|layout| layout.name == owner)
                            && !program.funcs.iter().any(|func| func.name == owner)
                            && program
                                .public_api
                                .iter()
                                .any(|(emitted, _)| *emitted == owner)
                    })
            })
            .map(|func| func.name.as_str())
            .collect(),
        // `exported` *and* whatever the entry modules publish. The flag means
        // "the declaration carries `export`", so a module-private function the
        // entry re-exports under another name -- `export const alias = local`
        // -- carries none and was pruned out from under its own export.
        //
        // Both, rather than `public_api` alone: the flag is what makes a
        // library's whole surface a root, and `public_api` is the entry's, and
        // a program built as a library wants the first. `EntrySurface` above is
        // the arm that deliberately does *not* want it.
        Roots::EveryExport => program
            .funcs
            .iter()
            .filter(|func| {
                func.exported
                    || program
                        .public_api
                        .iter()
                        .any(|(emitted, _)| *emitted == func.name)
                    // A namespace's members are reached only through the object
                    // the addon builds, which nothing in the IR does.
                    || program.public_namespaces.iter().any(|(_, properties)| {
                        properties.iter().any(|(_, emitted)| *emitted == func.name)
                    })
            })
            .map(|func| func.name.as_str())
            .collect(),
    };
    // A method of an Objective-C class the program registers is reached
    // through the runtime, by selector, which no call in the IR names.
    for class in &program.objc_classes {
        names.extend(class.methods.iter().map(|method| method.function.as_str()));
        names.extend(class.state.as_deref());
    }
    if !matches!(roots, Roots::Entry(_)) {
        for generator in &program.generators {
            if names.contains(&generator.constructor.as_str())
                && program.funcs.iter().any(|func| func.name == generator.resume)
            {
                names.push(&generator.resume);
            }
        }
    }
    names
}

/// Remove every function the roots cannot reach, and report how many.
pub fn prune(program: &mut Program, roots: Roots<'_>) -> usize {
    // Both indexes read the program once for questions this walk asks per
    // name and per external call: which function answers to a name, and which
    // layouts a value's own can be at run time. Searched instead, each is a
    // pass over the whole program inside a loop over the whole program.
    let by_name: FxHashMap<&str, usize> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(at, func)| (func.name.as_str(), at))
        .collect();
    let hierarchy = Hierarchy::build(program);
    let mut reached: FxHashSet<&str> = FxHashSet::default();
    let mut pending: Vec<&str> = root_names(program, roots);
    reached.extend(pending.iter().copied());

    while let Some(name) = pending.pop() {
        let Some(func) = by_name.get(name).map(|at| &program.funcs[*at]) else {
            continue;
        };
        for op in &func.values {
            // A bridge holds a closure that C will call and this program never
            // does, so nothing here is a caller and the body would be pruned.
            // The vtable slot is then emitted as a null and the bridge calls
            // nothing -- which is what happened the first time, and reported as
            // "a closure publishes no function" from the backend rather than
            // from here.
            //
            // The closure was previously a direct argument of the call, so
            // `callback_targets` below saw it. It is an operand of the bridge
            // now, and this walk matches on `Call` rather than exhaustively, so
            // the compiler does not ask about a new operation that reaches a
            // function without calling it.
            if let OpKind::NativeBridge { closure, .. } = &op.kind {
                let bridged = std::slice::from_ref(closure);
                for target in callback_targets(program, &hierarchy, func, bridged) {
                    if let Some(callee) = by_name.get(target).map(|at| &program.funcs[*at])
                        && reached.insert(callee.name.as_str())
                    {
                        pending.push(callee.name.as_str());
                    }
                }
            }
            let OpKind::Call { callee, args, .. } = &op.kind else {
                continue;
            };
            // A virtual call reaches *every* implementation of its slot, because
            // which one runs is decided by a receiver this cannot see. Keeping
            // only the one the static type names would prune an override that a
            // table still points at, and a table entry the linker cannot resolve
            // is a link error at best.
            let targets: Vec<&str> = match callee {
                Callee::Direct(target) => vec![target.as_str()],
                // An external callee is not in this program and the linker
                // supplies it -- but a *closure* handed to one is called back
                // through its method table, which is what `setTimeout` does
                // with its callback. So the methods of whatever object was
                // passed are reachable.
                //
                // Without this the body was pruned, and because the layout's
                // entry went with it the table was emitted as a null pointer.
                // Nothing failed: `examples/timers` cancels every timer before
                // it can fire, so the call through the null was never made --
                // which is what a rule with no case that executes it looks
                // like from the outside.
                // An external callee is not in this program and the linker
                // supplies it -- but a *closure* handed to one is called back
                // through its method table, which is what `setTimeout` does
                // with its callback.
                Callee::External(_) | Callee::Native(_) => {
                    callback_targets(program, &hierarchy, func, args)
                }
                Callee::Virtual { slot, .. } | Callee::Closure { slot } => program
                    .layouts
                    .iter()
                    .filter_map(|layout| layout.methods.get(*slot as usize))
                    .filter_map(|method| method.as_deref())
                    .collect(),
            };
            for target in targets {
                if let Some(callee) = by_name.get(target).map(|at| &program.funcs[*at])
                    && reached.insert(callee.name.as_str())
                {
                    pending.push(callee.name.as_str());
                }
            }
        }
    }

    let keep: FxHashSet<String> = reached.into_iter().map(str::to_owned).collect();
    let before = program.funcs.len();
    program.funcs.retain(|func| keep.contains(&func.name));

    // A table entry naming a function that is gone. It is unreachable by the
    // same argument that removed the function -- no call site dispatches
    // through this slot -- and leaving the name would ask the linker for a
    // definition that no longer exists.
    for layout in &mut program.layouts {
        for method in &mut layout.methods {
            if method.as_ref().is_some_and(|name| !keep.contains(name)) {
                *method = None;
            }
        }
    }
    before - program.funcs.len()
}
