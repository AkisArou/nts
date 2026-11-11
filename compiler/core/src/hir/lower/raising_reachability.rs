//! Collect the body-level graph of throws, handlers, and potential raising callees.

use super::{
    A_FUNCTION_WRITTEN_AS_A_VALUE, FuncBuilder, HirType, NodeId, NodeKind, SemanticSnapshot,
    a_parameter_pattern_can_throw, a_value_held_call, access_families, calls_in_the_body_of,
    children_in_the_body_of, children_that_run, const_function_aliases, copyable_symbols,
    declared_base_class, declares_a_class, iterator_close, parameters_of, parse_bigint,
    raising_callees_of, syntax, taken_as_a_closure, the_constructor_declared_by,
};

/// Every symbol whose function can raise a `throw`.
///
/// Two passes and a fixpoint. The seed is the symbols whose declarations
/// *write* a `throw`; the closure adds any symbol that calls one already in the
/// set. A call with no symbol to resolve -- `fns[0]()`, `this.handler()` --
/// puts its caller in the set unconditionally, because what it reaches is
/// exactly what cannot be decided here.
///
/// # Keyed by symbol, and walked from one
///
/// [`FuncBuilder::calls_compiled_code`] asks this about the symbol it read off
/// the *callee identifier*, so the set has to hold those ids and nothing else.
/// The first version walked nodes instead and read `node.symbol` on each
/// `FunctionDeclaration`, which is `None` there -- the whole set came back
/// empty and the refusal it gates stopped firing without a single diagnostic
/// changing. Walking `snapshot.symbols` makes the key a property of the
/// iteration rather than a hope about the node.
///
/// Nested functions are not entered when looking for a `throw` or for a call.
/// An arrow written inside a declaration is a *value*, and where it runs is a
/// different question from where it was written -- attributing its `throw` to
/// the enclosing function would put half the program in the set for throws that
/// happen somewhere else entirely.
/// Which symbols can raise, and which of them raise **only by themselves**.
///
/// `any` is the transitive closure a `try` consults; `bodily` is the same closure
/// with a function's calls to **its own parameters** not counted. The two exist
/// because "can this raise" has two readers asking different questions:
///
///   a `try`       any caller may pass any callback, so a body that invokes one of
///                 its own parameters can raise and `any` says so. A `try` around
///                 it needs a handler edge or a refusal.
///   the thenable  the job is the **only** caller of a `then` through the resolve
///   census        path and it supplies both callbacks itself -- they are this
///                 compiler's own resolving closures, which cannot throw. So for
///                 `then` those calls are not a way to raise, and `bodily` is the
///                 set that says so. It is arrival precision, available at this
///                 one site for free because the arriving closures are ours.
///
/// **`bodily` counts only [`Reached::Unnamed`] as unresolved**, which is exactly the
/// rule the one set before the split had. A split meant to narrow one reader must not
/// widen it anywhere, and this one did until `interop` said so.
///
/// **Reading `any` there was measured and it is wrong**, not merely coarse:
/// `tests/programs/an-await-of-a-thenable` went from 2 refusals to 11, every one of them
/// a `then` whose only unresolved callee is the `resolve` the job hands it. A
/// `then` that calls a callback from somewhere *else* -- a field, a capture -- is
/// `Elsewhere` and is in both sets, so the distinction is exactly the one the
/// argument above licenses and no wider. `copyable` is the subset a
/// [raising copy](FuncBuilder::raises) can be made of, and it is a **greatest**
/// fixpoint rather than a least one:
///
/// > `f` is copyable when `f` is a plain function this compiler can copy, and
/// > every callee of `f` that can raise is itself copyable.
///
/// Optimistic, then shrunk. A least fixpoint would have to start from functions
/// that call nothing and grow, which admits a caller before it has established
/// its callees; this starts by assuming every plain thrower qualifies and
/// removes any that reaches one that does not. **The direction is the whole of
/// the soundness argument**: a copy whose own call reached a *plain* callee
/// would end the program from inside a `try` that compiled, which is a wrong
/// answer where the refusal was merely a refusal.
///
/// An unresolved callee disqualifies: what it reaches is exactly what cannot be
/// established here, and it is already the reason its caller is in `any`.
///
/// Recursion stays in. `f` calling `f` is satisfied by `f` being copyable,
/// which is what the greatest fixpoint gives and a least one would not.
pub(super) struct Throwing {
    pub(super) any: rustc_hash::FxHashSet<u32>,
    pub(super) bodily: rustc_hash::FxHashSet<u32>,
    pub(super) copyable: rustc_hash::FxHashSet<u32>,
    /// For each raiser `copyable` dropped, the raising callee it dropped it
    /// for: one dropped in an earlier round, or one never copyable.
    pub(super) uncopied_for: rustc_hash::FxHashMap<u32, u32>,
}

/// What one call in a body reaches, as far as a raise is concerned.
///
/// **Three answers, because `Option<u32>` could only give two and the middle one
/// is where a wrong answer lived.** A callee's *symbol* is not a callee's
/// *function*: `component(props)` with `component` a parameter has a symbol, so it
/// was recorded as resolved, and a parameter's symbol is in no throwing set --
/// which is how a `try` around a function that invokes its callback compiled with
/// no handler edge. See [`throwing_symbols`].
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Reached {
    /// A callee with a body, whose own answer can be asked.
    Body(u32),
    /// A potential descriptor callback. Its raise is carried by the runtime
    /// protocol; an unavailable entry stops instead of calling an ordinary
    /// body. It may make a caller throwing, never uncopyable.
    Printer(u32),
    /// A parameter of the declaration being walked: a callback its own caller
    /// supplies. Unresolved, and separated because the one site that knows which
    /// closures arrive may discount it -- see [`Throwing`].
    OwnCallback,
    /// A callee that names something this walk cannot ask: a field, a captured
    /// binding, an import of a value.
    Elsewhere,
    /// A callee that names nothing at all -- `fns[0]()`, `(cond ? f : g)()`.
    ///
    /// **The only kind [`Throwing::bodily`] counts as unresolved**, because it is the
    /// only kind the single set before this walk gained its third answer counted: a
    /// callee *with* a symbol was resolved then, however little the symbol named.
    ///
    /// Folding it in with `Elsewhere` left `bodily` **wider** than the set it narrows,
    /// and that turned `tests/interop/windows-winrt` red on main: the binder's
    /// `then` for an `IAsyncOperation` reaches a bound member, so the thenable census
    /// called it raising and refused `await operation` at two sites, cascading to
    /// `reportAwaited` and a module-scope statement on both Windows backends. Found by
    /// the JVM lane bisecting three main pins with the example's own `build.sh` --
    /// `nts hir` refuses nothing there, because `nts.config.ts` compiles a different
    /// entry surface, so no arm of mine could have seen it.
    Unnamed,
}

impl Reached {
    /// The callee whose own answer can be asked, where there is one.
    pub(super) const fn body(self) -> Option<u32> {
        match self {
            Self::Body(symbol) | Self::Printer(symbol) => Some(symbol),
            Self::OwnCallback | Self::Elsewhere | Self::Unnamed => None,
        }
    }
}

/// The function a declaration *is*, following a `const` to its initialiser.
///
/// **A function-valued `const` declares its symbol at the variable, and the
/// function is its initialiser.** `const f = () => { throw ... }` gives `f` a
/// `VariableDeclaration` declaration and nothing else, so asking the
/// declaration's own kind put `f` outside the throwing set -- and a
/// `try { f() } catch` then saw a callee that cannot raise, compiled, and threw
/// where node answers 5.
///
/// Measured: `agreements/a-throw-across-a-call`'s `throwAcrossAnArrow` was a
/// **wrong answer** rather than a refusal, on every binary before 2026-09-23,
/// while its two siblings spelled `function` were correctly refused. Three
/// spellings of one program and two of them right, which is the shape
/// `a-probe-arm-must-differ-in-one-thing` exists to catch.
///
/// The last matching child, because a declaration is `[name, type?, initialiser]`
/// and only the initialiser can be a function.
pub(super) fn the_function_of(probe: &FuncBuilder, declaration: NodeId) -> NodeId {
    if probe.kind_of(declaration) != Some(syntax::VARIABLE_DECLARATION) {
        return declaration;
    }
    probe
        .children(declaration)
        .into_iter()
        .rev()
        .find(|child| {
            matches!(
                probe.kind_of(*child),
                Some(
                    syntax::FUNCTION_DECLARATION
                        | syntax::FUNCTION_EXPRESSION
                        | syntax::ARROW_FUNCTION
                        | syntax::METHOD_DECLARATION
                )
            )
        })
        .unwrap_or(declaration)
}

/// Whether a symbol names something with a body: the four kinds
/// [`throwing_symbols`] walks.
///
/// **The same test in both directions, which is the point of it being a
/// function.** The outer loop gives a symbol an entry only where one of its
/// declarations is one of these, so a symbol that fails this can never be in
/// `throws` or `calls` -- and a *callee* that fails it is therefore an unresolved
/// callee, however firmly it wears a symbol. Asking one question in one place is
/// what stops those two from disagreeing, which is exactly how they disagreed.
pub(super) fn names_a_body(kind: Option<u16>) -> bool {
    matches!(
        kind,
        Some(
            syntax::FUNCTION_DECLARATION
                | syntax::FUNCTION_EXPRESSION
                | syntax::ARROW_FUNCTION
                | syntax::METHOD_DECLARATION
                // **An accessor has a body and can `throw` from it**, and leaving it
                // out meant its symbol got no entry, so the `throw` was in no set and
                // a function that *read* it was in none either. `static get #g() {
                // throw … }` with `Priv.read()` returning `Priv.#g`, called from a
                // closure inside a `try`, escaped the handler on `ac1533ca4`: the
                // conformance lane's private-static-getter and -setter files. Found
                // by running the emitted C, because the read is not a call node and
                // no census sees a program that compiles.
                | syntax::GET_ACCESSOR
                | syntax::SET_ACCESSOR
        )
    )
}

/// Whether a class body's child is an element defined under a name: a field, a
/// method or an accessor, as against a constructor, a static block or an
/// index signature.
pub(super) fn names_a_class_element(kind: Option<u16>) -> bool {
    matches!(
        kind,
        Some(
            syntax::PROPERTY_DECLARATION
                | syntax::METHOD_DECLARATION
                | syntax::GET_ACCESSOR
                | syntax::SET_ACCESSOR
        )
    )
}

/// Whether every declaration of this symbol is one of `own`: a callback the body
/// being walked received as a parameter, rather than a field, a capture or an
/// import. See [`Reached::OwnCallback`].
///
/// `all` rather than `any`, and non-empty: a symbol with a declaration outside the
/// set is not one this body's caller supplies, and the whole point of the
/// distinction is that the caller is known.
fn a_parameter_among(
    snapshot: &SemanticSnapshot,
    symbol: u32,
    own: &rustc_hash::FxHashSet<NodeId>,
) -> bool {
    snapshot.symbols.get(symbol as usize).is_some_and(|record| {
        !record.declarations.is_empty() && record.declarations.iter().all(|at| own.contains(at))
    })
}

/// Whether this symbol resolves to a body, so a call naming it is a *resolved*
/// callee. See [`names_a_body`].
fn a_callee_with_a_body(snapshot: &SemanticSnapshot, probe: &FuncBuilder, symbol: u32) -> bool {
    snapshot.symbols.get(symbol as usize).is_some_and(|record| {
        record
            .declarations
            .iter()
            .any(|at| names_a_body(probe.kind_of(the_function_of(probe, *at))))
    })
}

/// Operators whose lowering generates a JavaScript throw without a source
/// `throw` statement. Radix and repeat guards already seed their callers as
/// unresolved calls; bigint operators have no call node to do that for them.
/// Overflow refuses the runtime's domain rather than throwing and is excluded.
fn an_operator_that_can_raise(probe: &FuncBuilder, at: NodeId) -> bool {
    if probe.kind_of(at) != Some(syntax::BINARY_EXPRESSION)
        || probe.type_of(at) != Some(HirType::BigInt)
    {
        return false;
    }
    let children = probe.children(at);
    let [_, operator, rhs] = children.as_slice() else {
        return false;
    };
    let operator = probe.kind_of(*operator);
    let power = matches!(
        operator,
        Some(syntax::ASTERISK_ASTERISK_TOKEN | syntax::ASTERISK_ASTERISK_EQUALS_TOKEN)
    );
    let divisor = matches!(
        operator,
        Some(
            syntax::SLASH_TOKEN
                | syntax::SLASH_EQUALS_TOKEN
                | syntax::PERCENT_TOKEN
                | syntax::PERCENT_EQUALS_TOKEN
        )
    );
    if !power && !divisor {
        return false;
    }
    // A safe literal needs neither a guard nor a raising convention at its
    // callers. Read bigint syntax exactly: a Number constant could round it.
    let rhs = probe.through_parentheses(*rhs);
    if probe.kind_of(rhs) == Some(syntax::BIGINT_LITERAL)
        && let Some(value) = probe
            .node(rhs)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .and_then(parse_bigint)
    {
        return if power { value < 0 } else { value == 0 };
    }
    true
}

fn a_synthesized_throw(probe: &FuncBuilder<'_>, at: NodeId) -> bool {
    probe.initialization.can_raise_at(at)
        || probe.array_constructor_may_raise(at)
        || an_operator_that_can_raise(probe, at)
        || probe.iterators.close_can_raise(at)
        || an_immutable_store(probe, at)
        || (probe.kind_of(at).is_some_and(declares_a_class)
            && probe.static_named_prototype(at).is_some())
}

/// A write to a binding no assignment may change, which throws `TypeError`
/// (`Place::Unwritable`): `fixed = 2` on a `const`, `Named = 1` in a function
/// expression's own body, or a pattern naming one.
fn an_immutable_store(probe: &FuncBuilder<'_>, at: NodeId) -> bool {
    let Some(target) = probe.written_target(at) else {
        return false;
    };
    let mut names = Vec::new();
    probe.target_names(target, &mut names);
    names
        .into_iter()
        .any(|symbol| probe.immutable_binding(symbol))
}

pub(super) fn walk_one_declaration(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    declaration: NodeId,
    symbol: u32,
    base: Option<u32>,
    throws: &mut rustc_hash::FxHashSet<u32>,
    reached: &mut Vec<Reached>,
) {
    // This declaration's own parameters, so a call to one is told apart
    // from a call to a field or a capture. See [`Reached::OwnCallback`].
    //
    // By **node**, matched against the callee symbol's declarations, and not
    // by asking each parameter node for its symbol: a `PARAMETER` carries
    // none in this encoding -- its name child does -- so that spelling
    // collected an empty set and every callback read as `Elsewhere`, which
    // is the answer it would have given with no code at all. Through
    // `parameters_of`, which is the one derivation of "which children are
    // the parameters" and is what `class_thenable` asks with.
    // **A class with no constructor of its own constructs through its base's**, and
    // this walk has nothing else to find in it: no constructor to descend into and, in
    // the shape that matters, no field initialiser either. So `class Inherits extends
    // Base {}` was in no throwing set, `new Inherits(n)` inside a `try` read as a call
    // that cannot raise, and the base constructor's `throw` left a handler that had
    // compiled -- 9 of 29 cases answering `nts: uncaught RangeError` where node answers
    // `-1`.
    //
    // The `super(…)` arm below records exactly this for a class that writes its
    // constructor out; an **implicit** `super(...args)` is the same statement with no
    // node to stand on, which is why it is recorded here rather than found there.
    if probe.kind_of(declaration).is_some_and(declares_a_class)
        && the_constructor_declared_by(probe, declaration).is_none()
        && let Some(base) = base
    {
        reached.push(Reached::Body(base));
    }
    // **An object binding pattern in the parameter list throws before the body runs.**
    // `function fn({}) {}` called `fn(null)` must throw a `TypeError`
    // (`RequireObjectCoercible`), and that throw is in `fn`'s own frame -- so `fn` can
    // raise, and a `try` around a call to it needs `fn`'s raising copy.
    //
    // **A synthesised throw is in no `THROW_STATEMENT`**, which is the whole reason
    // this arm exists: the walk below looks for the keyword, and
    // [`FuncBuilder::require_object_coercible`] emits a throw the source never wrote.
    // Without it the guard turns a silent wrong answer into an **abort** -- the
    // TypeError reaches `nts_uncaught` while `assert.throws`' handler watches nothing --
    // and an abort erases every observation in its program, so that is the worse of the
    // two. The same shape as the class-with-a-throwing-field-initialiser arm above.
    if parameters_of(probe, declaration)
        .iter()
        .any(|parameter| a_parameter_pattern_can_throw(probe, *parameter))
    {
        throws.insert(symbol);
    }
    // **And a construction whose `this` is never bound always throws**, from no
    // `throw` the source wrote -- `extends null`, or a derived constructor that
    // calls `super()` nowhere ([`FuncBuilder::never_binds_this`]): it throws a
    // `ReferenceError` at a `this` or on the way out
    // ([`FuncBuilder::this_is_never_bound`]). An empty `constructor() {}` was
    // the case that showed it -- the throw was emitted, nothing counted it, so a
    // `new` inside a `try` called the ordinary body and the program ended where
    // node's handler runs.
    //
    // **Only where a constructor is written**, because that is where the throws
    // are emitted. A class with the default constructor has no body to throw
    // from here -- the specification's default `super(...args)` would throw a
    // `TypeError`, which this compiler does not model -- and counting it as a
    // raiser with nothing to carry the raise made `closures_carry` false for the
    // whole program: every `try` around a call through a closure refused.
    let class = match probe.kind_of(declaration) {
        Some(kind)
            if declares_a_class(kind)
                && the_constructor_declared_by(probe, declaration).is_some() =>
        {
            Some(declaration)
        }
        Some(syntax::CONSTRUCTOR) => {
            std::iter::successors(probe.node(declaration).parent, |at| probe.node(*at).parent)
                .take(3)
                .find(|at| probe.kind_of(*at).is_some_and(declares_a_class))
        }
        _ => None,
    };
    if class.is_some_and(|class| probe.never_binds_this(class)) {
        throws.insert(symbol);
    }
    let own = parameters_of(probe, declaration).into_iter().collect();
    let mut pending: Vec<NodeId> = children_in_the_body_of(probe, declaration);
    while let Some(at) = pending.pop() {
        let kind = probe.kind_of(at);
        if names_a_body(kind) {
            continue;
        }
        if kind == Some(syntax::THROW_STATEMENT) || a_synthesized_throw(probe, at) {
            throws.insert(symbol);
        }
        reached.extend(probe.potential_implicit_calls(at));
        // **An accessor access is a call to its body**, which this walk did
        // not see either -- the same omission as `calls_in_the_body_of`, in
        // the other of the two walks that answer "what can raise here". One
        // fact, two walks, and they disagreed until a program that compiles
        // was run by hand.
        if probe.reads_an_accessor(at) {
            if probe.hierarchy.access_families.at(at).next().is_some() {
                reached.extend(
                    probe
                        .hierarchy
                        .access_families
                        .at(at)
                        .flat_map(access_families::Family::symbols)
                        .map(Reached::Body),
                );
            } else {
                reached.push(
                    probe
                        .children(at)
                        .last()
                        .and_then(|member| probe.node(*member).symbol)
                        .map_or(Reached::Elsewhere, |member| Reached::Body(member.0)),
                );
            }
        }
        if matches!(
            kind,
            Some(
                syntax::CALL_EXPRESSION
                    | syntax::NEW_EXPRESSION
                    | syntax::TAGGED_TEMPLATE_EXPRESSION
            )
        ) {
            // `f.call(r)` reaches `f` ([`FuncBuilder::through_call_or_apply`]).
            let callee = probe
                .through_call_or_apply(at)
                .or_else(|| probe.children(at).first().copied());
            // **`super(…)` is a call to the base's constructor, and the `super`
            // keyword carries no symbol.** So it read as an *unresolved* callee,
            // which puts its caller in the set at once -- and since a class now
            // has an entry, every class with an explicit `super()` became a raiser
            // and every `try` constructing one refused.
            // `tests/programs/an-error-subclass-that-carries-a-field`'s
            // `try { throw new TaggedError(…) }` is the witness, and it was one
            // `agree` regression standing for most of a +69.
            //
            // Resolved to the base class instead, from the heritage clause of the
            // class being walked. Where the base is **not** a class this program
            // declares -- `class TaggedError extends Error` -- nothing is recorded:
            // a provided constructor is emitted inline and cannot throw, which is
            // the sentence `calls_compiled_code` already makes about one.
            if callee.is_some_and(|it| probe.kind_of(it) == Some(syntax::SUPER_KEYWORD)) {
                if let Some(base) = base {
                    reached.push(Reached::Body(base));
                }
                pending.extend(children_that_run(probe, at));
                continue;
            }
            // **The declaration an import names, not the import.** A name
            // arriving through `import { f }` is a local alias whose only
            // declaration is the specifier, so it named no body and every call
            // to an imported function was `Elsewhere` -- while `call_targets`,
            // which the copy machinery reads, resolved the same call to `f`.
            let named = callee
                .and_then(|callee| probe.node(callee).symbol)
                .map(|it| probe.denoted_symbol(it).0);
            // **A `new` is resolved by its type, not by a value.** Which
            // constructor runs is fixed by the name, so a `new X(...)` is
            // not a callee arriving from somewhere -- and treating it as one
            // made every function that constructs anything an unresolved
            // caller, which is most of them:
            // `tests/programs/an-await-of-a-thenable` refused 6 thenables instead
            // of 2, on four `then`s whose bodies call their own two
            // callbacks and `new Error(...)`. `Error` is a provided
            // constructor, whose symbol declares `interface Error` and
            // `declare var Error`, so neither the body test nor a class test
            // catches it; the *construct* is what answers.
            //
            // Recorded exactly as it was before `Reached` existed -- the
            // named symbol, which for a class is in no throwing set because
            // this walk does not descend into a `CONSTRUCTOR`. That hole is
            // named rather than closed here: closing it is descending into
            // constructors, which is its own change with its own
            // measurement.
            let constructs = kind == Some(syntax::NEW_EXPRESSION);
            reached.push(
                match named {
                    Some(target) if constructs || a_callee_with_a_body(snapshot, probe, target) => {
                        Reached::Body(target)
                    }
                    Some(target) if a_parameter_among(snapshot, target, &own) => {
                        Reached::OwnCallback
                    }
                    Some(_) => Reached::Elsewhere,
                    None => Reached::Unnamed,
                },
                // **A symbol is not the same as a function, and that
                // is where the difference escaped.**
                // `component(props)` with `component` a *parameter*
                // has a symbol, so it was recorded as a resolved
                // callee -- and a parameter's symbol is in no
                // throwing set, because that set holds functions
                // whose body throws. So `renderWithHooks`, which
                // calls it, never joined; the `try` around it
                // compiled; and the throw escaped **silently**. The
                // React lane's reduction compiled and then declined 6
                // of 29 cases, the negative inputs where node answers
                // -1. The arm below already had the rule -- "an
                // unresolved callee is unbounded, so its caller joins
                // the set at once" -- and a parameter is an
                // unresolved callee wearing a symbol.
                //
                // **It was built, measured and left unlanded, and the
                // reason is worth keeping because it is the reason it
                // lands now.** On its own the rule is right and blunt:
                // over `runtime/node`, definitions 29915 -> 29344 and
                // `emit-c --napi` refusals 14632 -> 15158. It refused
                // every `try` whose call reaches a parameter or field
                // holding a closure, including those whose closures
                // provably cannot throw, because there was nothing for
                // such a call to name. The note ended *"precision
                // first, then the rule"*.
                //
                // `Hierarchy::raising_call_slot` is the precision. A
                // call through a function value inside a `try` now
                // dispatches at an entry that records the `throw` and
                // returns, and `a_copy_can_contain` admits such a call
                // into a copy, so the functions this rule newly calls
                // raisers get copies instead of refusals. The two
                // halves have to land together: this one alone is the
                // measured cost with none of the gain, and the other
                // alone leaves the escape above standing one level up
                // -- which is what `outcomes/a-throw-through-a-try-
                // with-only-a-finally` said, in the words its own
                // header had promised.
            );
        }
        pending.extend(children_that_run(probe, at));
    }
}

pub(super) fn throwing_symbols(snapshot: &SemanticSnapshot, probe: &FuncBuilder) -> Throwing {
    let nested = |kind: Option<u16>| names_a_body(kind);
    // What each symbol's declarations write: whether one throws, and which
    // symbols they call. One walk, because both are the same descent.
    let mut throws: rustc_hash::FxHashSet<u32> = rustc_hash::FxHashSet::default();
    let mut calls: rustc_hash::FxHashMap<u32, Vec<Reached>> = rustc_hash::FxHashMap::default();
    for (index, record) in snapshot.symbols.iter().enumerate() {
        let symbol = u32::try_from(index).unwrap_or(u32::MAX);
        // Every symbol is walked and only the callable ones get an entry. The
        // snapshot holds a symbol for every type, parameter and binding as
        // well, and giving each an empty vector made the fixpoint below iterate
        // tens of thousands of symbols that can never be in the set.
        let mut reached: Vec<Reached> = Vec::new();
        for declaration in &record.declarations {
            let declaration = &the_function_of(probe, *declaration);
            // **A class gets an entry too, and its entry is its *construction*.**
            // `children_in_the_body_of` selects its instance initializers and
            // constructor. Its static elements run at definition, and its methods
            // and accessors have entries of their own.
            //
            // Without it a class symbol was in no set, so `new X()` could not raise
            // however loudly its field initializer threw:
            // `class Init { v = (() => { throw … })() }` constructed inside a closure
            // reached a run-time abort where node catches.
            //
            // **And the blunt version of this cost 14 working functions**, measured:
            // refusing every `new` of a program class took `web-platform`'s
            // `readHttp2Frame` and every `parseHttp2*@raises` with it, because they
            // construct `Http2ProtocolError` -- whose constructor cannot throw. The
            // precise rule keeps them and still refuses `Init`.
            if !nested(probe.kind_of(*declaration))
                && !probe.kind_of(*declaration).is_some_and(declares_a_class)
            {
                continue;
            }
            // An `async` function never raises *synchronously*: a `throw` in
            // one rejects the promise it already returned. That rejection is a
            // real edge into the enclosing handler and `lower_unguarded`
            // already routes it -- `tests/programs/async-catch` is eight functions
            // of exactly this and every one of them works -- so admitting an
            // async callee here would refuse a shape that is not broken.
            //
            // **Except an `async` generator's parameter patterns**, which are
            // bound at the call, before its generator object exists, and throw
            // there -- synchronously, as a generator's do. Only the patterns:
            // its body's `throw` rejects a step's promise, as an `async`
            // function's does, so the body is not walked; a pattern can always
            // throw (`null` destructured), so the declaration simply joins the
            // set.
            if probe
                .node(*declaration)
                .modifiers
                .contains(nts_semantic_schema::DeclarationModifiers::ASYNC)
            {
                if probe
                    .node(*declaration)
                    .modifiers
                    .contains(nts_semantic_schema::DeclarationModifiers::GENERATOR)
                    && probe.needs_parameter_entry(*declaration)
                {
                    throws.insert(symbol);
                }
                continue;
            }
            let base = declared_base_class(snapshot, probe, *declaration);
            walk_one_declaration(
                snapshot,
                probe,
                *declaration,
                symbol,
                base,
                &mut throws,
                &mut reached,
            );
        }
        if !reached.is_empty() {
            calls.insert(symbol, reached);
        }
    }
    // **Twice, over one walk.** `any` counts every unresolved callee; `bodily`
    // counts only those the body did not receive as a parameter. One walk and two
    // closures rather than two walks, so the two sets cannot disagree about what
    // the program says -- only about which question is being asked of it. See
    // [`Throwing`].
    let close = |unresolved: fn(Reached) -> bool| {
        let mut set = throws.clone();
        // An unresolved callee is unbounded, so its caller joins the set at once.
        for (symbol, reached) in &calls {
            if reached.iter().copied().any(unresolved) {
                set.insert(*symbol);
            }
        }
        // Fixpoint. Bounded by the number of symbols, and it converges in a handful
        // of rounds on this corpus because the call graph is shallow.
        loop {
            let mut grew = false;
            for (symbol, reached) in &calls {
                if set.contains(symbol) {
                    continue;
                }
                if reached
                    .iter()
                    .copied()
                    .filter_map(Reached::body)
                    .any(|called| set.contains(&called))
                {
                    set.insert(*symbol);
                    grew = true;
                }
            }
            if !grew {
                break;
            }
        }
        set
    };
    let mut set = close(|reached| !matches!(reached, Reached::Body(_) | Reached::Printer(_)));
    let mut bodily = close(|reached| matches!(reached, Reached::Unnamed));
    // An imported name is its own symbol pointing at the declaring module's, and
    // the caller asks about the *local* one. Following the alias here keeps
    // `calls_compiled_code` a single lookup.
    //
    // **And a `const` initialised with a function's name is one too.** It was
    // missing, and a call through it is a call to a body that raises made by a
    // symbol no set contained -- so `const alias = apply; try { alias(n, cb) }
    // catch {}` lowered with no handler at all, and a `throw` in `cb` ended the
    // program where node caught it. Call lowering resolves the alias to `apply`
    // itself; this is the throw analysis asking the same question. A fixpoint,
    // because an alias may name an alias.
    let mut aliases: Vec<(u32, u32)> = snapshot
        .symbols
        .iter()
        .enumerate()
        .filter_map(|(index, record)| Some((u32::try_from(index).ok()?, record.aliased?.0)))
        .collect();
    aliases.extend(const_function_aliases(probe));
    loop {
        let mut grew = false;
        for (alias, to) in &aliases {
            grew |= set.contains(to) && set.insert(*alias);
            grew |= bodily.contains(to) && bodily.insert(*alias);
        }
        if !grew {
            break;
        }
    }
    let (copyable, uncopied_for) = copyable_symbols(snapshot, probe, &set, &calls);
    Throwing {
        any: set,
        bodily,
        copyable,
        uncopied_for,
    }
}

/// Calls in exactly the bodies offered by the selected raising-copy arm.
pub(super) fn raising_body_calls(
    probe: &FuncBuilder,
    copies: &rustc_hash::FxHashSet<NodeId>,
    closures: &[NodeId],
) -> rustc_hash::FxHashSet<NodeId> {
    copies
        .iter()
        .chain(closures)
        .flat_map(|body| calls_in_the_body_of(probe, *body))
        .collect()
}

/// Close a set of copies over what those copies call: a copy names its callees'
/// copies, so a callee of a copy needs one too.
///
/// A function because [`raising_copies`](fn@super::raising_copies) runs it twice -- once over every seed, and
/// once over the narrow seed where the gate came out off -- and two spellings of a
/// transitive closure is two chances to disagree about what a copy may name.
pub(super) fn close_over_callees(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    eligible: &rustc_hash::FxHashSet<NodeId>,
    mut copies: rustc_hash::FxHashSet<NodeId>,
) -> rustc_hash::FxHashSet<NodeId> {
    let mut pending: Vec<NodeId> = copies.iter().copied().collect();
    while let Some(declaration) = pending.pop() {
        for call in calls_in_the_body_of(probe, declaration) {
            for callee in raising_callees_of(snapshot, probe, call) {
                if eligible.contains(&callee) && copies.insert(callee) {
                    pending.push(callee);
                }
            }
        }
    }
    copies
}

/// Whether a raising copy may contain this call: it cannot raise, or the copy it
/// would name exists.
pub(super) fn a_copy_can_contain(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    throwing: &Throwing,
    eligible: &rustc_hash::FxHashSet<NodeId>,
    value_held_is_carried: bool,
    call: NodeId,
) -> bool {
    // **An accessor is carried when its copy exists**, which it can now: `lower_class`
    // builds one for a `get` or a `set` exactly as it does for a method, and
    // `accessor_callee` names it. Until then this returned `false` outright, with the
    // sentence `call_within` refuses a `try` around one with.
    //
    // Both of them where the member declares both, which is what `raising_callees_of`
    // answers: the access alone does not say whether it is a read or a write, so a copy
    // holding one has to be able to reach either.
    // **A `new` needs no arm of its own.** `throwing_symbols` walks a class over its
    // constructor and its field initializers, so a class that can throw is in
    // `Throwing::any` and `a_call_that_can_raise` below says so -- and the callee a
    // `new` resolves to is a `Constructor`, which is never `eligible`, so it comes out
    // uncarriable exactly when construction can raise. The blunt version, refusing
    // every `new` of a program class, cost 14 working functions in `web-platform`.
    // **An indirect callee -- `fns[0]()`, `this.handler()`, a parameter -- can be
    // carried now, and could not be.** What it reaches cannot be known, which used
    // to be the end of it: a copy holding such a call would dispatch at the
    // ordinary uniform entry, whose body calls `nts_uncaught`, so the raise the
    // copy exists to carry would end the program from inside a `try` that compiled.
    //
    // `Hierarchy::raising_call_slot` is what changes it. Inside a raising copy
    // `FuncBuilder::dispatches_to_a_raising_entry` names that slot for every call
    // through a function value and `test_for_a_raise` follows it with the flag
    // test, so a copy holding one propagates exactly as it does for a named callee
    // whose `@raises` it spells. The two are one decision and are documented as
    // one.
    //
    // **What this unblocked, and it was recorded as a guard before it was built.**
    // `outcomes/a-throw-through-a-try-with-only-a-finally` is
    // `try { fn(); } finally { … }` inside `call(fn)`, with the caller catching --
    // `AsyncResource#runInAsyncScope`'s shape, so every hook dispatch in
    // `runtime/node`. Without this arm `call` lost the fixpoint here, got no copy,
    // and the caller's `try` compiled with no handler edge because
    // `throwing_symbols` does not see a parameter-held callee: the `TypeError`
    // escaped, which is the wrong answer that record was written to catch and did.
    if probe.array_constructor_may_raise(call)
        || !a_call_that_can_raise(snapshot, probe, throwing, call)
    {
        return true;
    }
    if !probe.printers.at(call).is_empty() {
        // The descriptor either calls a raising entry, a quiet one, or stops
        // by name. Missing candidates cannot disqualify this caller: there is
        // no ordinary throwing-entry fallback. Its children are checked by
        // the same call walk independently.
        return true;
    }
    if probe.iterators.closes_at(call).is_some() {
        return (!probe.iterators.close_calls_value(call) || value_held_is_carried)
            && raising_callees_of(snapshot, probe, call)
                .iter()
                .all(|callee| eligible.contains(callee));
    }
    // **A callee held in a value is carried by the raising uniform entry or not at
    // all**, which is what `value_held_is_carried` answers: there is no declaration to
    // name, so the copy cannot spell an `@raises` for it. See [`a_value_held_callee`],
    // and [`raising_copies`] for why this is a parameter rather than a constant -- the
    // entry it would dispatch at is one the program-global gate can withhold, and a
    // copy naming an entry that was withheld would dangle.
    //
    // **And so is a function written as a value and called on the spot**, which a
    // raising body dispatches at the raising slot as it does a held value
    // ([`FuncBuilder::calls_a_closure`]). React's `UnknownOwner` calls an arrow it
    // writes; asked only about held values, the call read as one no copy could
    // contain, and a function used as a value with no copy held the raising gate
    // off for the whole program. The strict pass refuses it where the gate is off
    // after all, as it does a held value.
    //
    // **Only that, not every call `calls_a_closure` answers for.** It also counts
    // a call with no target at all, which includes a method read off an erased
    // value -- `value.toFixed(digits)` with `value: any` -- and the real lowering
    // cannot dispatch that one at the raising slot: asked here, it made
    // `fixed@raises` a copy that then refused
    // (`tests/programs/a-closed-call-recovers-an-erased-parameter`, 9 refusals to 10).
    if a_value_held_call(snapshot, probe, call)
        || probe.reason_without_a_leaf(call) == Some(A_FUNCTION_WRITTEN_AS_A_VALUE)
    {
        return value_held_is_carried;
    }
    // [`raising_callees_of`], because `eligible` holds implementations: asking with the
    // resolved node would answer "no copy" for every call to an overloaded function and
    // take its caller out of the fixpoint. **Non-empty and all of them**, since an
    // access running two accessors needs a copy of each.
    let callees = raising_callees_of(snapshot, probe, call);
    !callees.is_empty()
        && callees
            .iter()
            .all(|declaration| eligible.contains(declaration))
}

/// Whether this call can bring a `throw` back to its caller.
///
/// An unresolved callee can: what it reaches is exactly what cannot be established,
/// and it is already the reason its caller is in [`Throwing::any`]. A resolved one
/// can only if that set says so.
///
/// **One predicate, two readers, and the second is why it is one.**
/// [`a_copy_can_contain`] asks it to decide whether a copy may hold the call, and
/// [`raising_copies`](fn@super::raising_copies) asks it to decide whether a closure body needs a raising
/// variant at all -- a body with no call that can raise has an identical variant, so
/// nothing ever names its callees' copies and seeding from it is pure waste. Written
/// twice those two would drift, and the drift is a copy named and never made.
pub(super) fn a_call_that_can_raise(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    throwing: &Throwing,
    call: NodeId,
) -> bool {
    if probe.array_constructor_may_raise(call)
        || !probe.implicit_iterator_callees(call).is_empty()
        || probe.iterators.close_can_raise(call)
    {
        return true;
    }
    if !probe.printers.at(call).is_empty() {
        return probe.printers.at(call).iter().any(|target| {
            throwing
                .any
                .contains(&probe.printers.targets[*target].symbol)
        });
    }
    // **An accessor access asks about the member**, which is the last child; the first
    // is the receiver. See [`FuncBuilder::an_accessor_that_can_raise`] -- the same
    // question, asked where the builder has the set rather than the caller.
    if probe.reads_an_accessor(call) {
        if probe.hierarchy.access_families.at(call).next().is_some() {
            return probe
                .hierarchy
                .access_families
                .at(call)
                .flat_map(access_families::Family::symbols)
                .any(|symbol| throwing.any.contains(&symbol));
        }
        return probe
            .children(call)
            .last()
            .and_then(|member| probe.node(*member).symbol)
            .is_none_or(|symbol| throwing.any.contains(&symbol.0));
    }
    // `f.call(r)` can raise what `f` can ([`FuncBuilder::through_call_or_apply`]).
    let Some(callee) = probe
        .through_call_or_apply(call)
        .or_else(|| probe.children(call).first().copied())
    else {
        return false;
    };
    // **A symbol is not a function, and asking the set about one that names no body is
    // how this said "cannot raise" about a call to a closure.** `walk_one_declaration`
    // classifies a callee into [`Reached`] -- a body, the walked declaration's own
    // parameter, something *elsewhere* (a field, a capture, an import of a value), or
    // nothing named at all -- and only the first can be asked. `throwing_symbols` is
    // right about that and this function re-derived it from the symbol alone, so a
    // local bound to a field closure came out resolved:
    //
    // ```ts
    // run(n: number): number { const f = this.cb; if (f) { return f(n) } return n }
    // ```
    //
    // `f` has a symbol, the symbol holds no `throw`, so the call read as unable to
    // raise, `a_copy_can_contain` let `run` keep its copy, and that copy dispatched
    // the closure at the **ordinary** uniform entry. The `throw` then left a `try`
    // that compiled: `nts: uncaught RangeError` on 8 of 29 cases where node answers
    // `-1`, on `runtime/node/stream`'s own `DuplexSide#release` shape. Two derivations
    // of one fact, and the fifth instance of this family after the parameter, the
    // accessor, the `new` and `super(…)`.
    //
    // **A `new` is resolved by its type rather than by a value**, exactly as that
    // classifier says: which constructor runs is fixed by the name. Keeping that arm
    // is not a detail -- the blunt rule, every `new` of a program class can raise,
    // was measured at 14 working functions lost in `web-platform`.
    //
    // **And a callee that names a declaration with no body here cannot raise**, which
    // is the arm that keeps this from being the blunt rule in another spelling: every
    // `arr.push(x)` and `items.sort(cmp)` names a provided signature, and answering
    // "can raise" for those was measured at **+32 refusals per module** (`stream`
    // 1,037 -> 1,069) with nothing gained -- what a builtin does is the runtime's,
    // and where it runs a callback of ours the uniform entry carries that.
    let constructs = probe.kind_of(call) == Some(syntax::NEW_EXPRESSION);
    // Through an import to what it names, as `walk_one_declaration` does: asked of the
    // alias, `() => thrower(n)` with `thrower` imported read as unable to raise, no
    // copy of `thrower` was offered, and the closure's raising variant -- which does
    // resolve the call, through `call_targets` -- could not be built. Every `try`
    // dispatching that closure aborted by name at run time.
    match probe
        .node(callee)
        .symbol
        .map(|it| probe.denoted_symbol(it).0)
    {
        Some(symbol) if constructs || a_callee_with_a_body(snapshot, probe, symbol) => {
            throwing.any.contains(&symbol)
        }
        Some(symbol) if a_value_held_callee(snapshot, probe, symbol) => true,
        Some(_) => false,
        None => true,
    }
}

/// Whether a callee's symbol names a **value** that holds a function rather than a
/// function declaration: a variable, a parameter, a property, a destructured binding.
///
/// This is the distinction [`a_call_that_can_raise`] needs and the symbol alone does not
/// make. `const f = () => { throw … }` is *not* one -- [`the_function_of`] follows a
/// variable to its initialiser, so a function-valued `const` has a body and its own
/// answer in [`Throwing::any`]. What is one is `const f = this.cb`, a parameter, or an
/// interface's `cb: () => void`: a function arrives at run time and no walk can say
/// which.
///
/// **Not folded into [`Reached::Elsewhere`]**, which this is otherwise the same
/// distinction as, because that variant also holds a provided signature -- `arr.push` --
/// and the two want opposite answers here: a builtin cannot raise anything of ours, a
/// field can raise whatever was put in it.
pub(super) fn a_value_held_callee(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    symbol: u32,
) -> bool {
    snapshot.symbols.get(symbol as usize).is_some_and(|record| {
        record.declarations.iter().any(|at| {
            taken_as_a_closure(&probe.closures, *at)
                || matches!(
                    probe.kind_of(*at),
                    Some(
                        syntax::VARIABLE_DECLARATION
                            | syntax::PARAMETER
                            | syntax::PROPERTY_DECLARATION
                            | syntax::PROPERTY_SIGNATURE
                            | syntax::BINDING_ELEMENT
                    )
                )
        })
    })
}

/// Every closure body whose raising variant would differ from its ordinary one: one
/// that holds a call able to bring a `throw` back. See [`a_call_that_can_raise`].
pub(super) fn closure_bodies_that_can_raise(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    throwing: &Throwing,
) -> Vec<NodeId> {
    snapshot
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| {
            matches!(
                node.kind,
                NodeKind::Syntax(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION)
            )
        })
        .map(|(index, _)| NodeId(u32::try_from(index).unwrap_or(u32::MAX)))
        .filter(|body| {
            calls_in_the_body_of(probe, *body)
                .into_iter()
                .any(|call| a_call_that_can_raise(snapshot, probe, throwing, call))
        })
        .collect()
}

/// Every declaration a `try` body calls, anywhere in the program, and whether any
/// `try` guarded a call at all.
///
/// **Two facts from one walk**, because the second decides whether this program
/// lowers a raising body of any kind and a second walk to ask it could answer
/// differently. A guarded call with no resolvable callee -- a parameter, a field --
/// contributes nothing to the set and still means yes.
///
/// Deliberately coarse: a callee here only becomes a copy if it also passes
/// `Throwing::self_contained`, and a `try` this lowering goes on to refuse for
/// some other reason costs one unused copy rather than a wrong answer.
pub(super) fn calls_guarded_by_a_try(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
) -> (
    rustc_hash::FxHashSet<NodeId>,
    bool,
    rustc_hash::FxHashSet<NodeId>,
) {
    let mut called = rustc_hash::FxHashSet::default();
    let mut guarded_a_call = false;
    // **The call NODES as well as the callees they resolve to**, because a callee is not
    // always a body: a call on an interface-typed receiver resolves to a `MethodSignature`,
    // and the declarations that would carry its `throw` are the *implementors*, which only
    // the hierarchy can name. This walk already visits the nodes, so publishing them costs
    // nothing and spares a second walk over every `try` in the program -- which would be
    // two answers to "which calls does a `try` guard" and they would drift.
    let mut guarded_calls = rustc_hash::FxHashSet::default();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let regions = if node.kind == NodeKind::Syntax(syntax::TRY_STATEMENT) {
            probe
                .children(id)
                .first()
                .copied()
                .into_iter()
                .collect::<Vec<_>>()
        } else if probe.iterators.closes_at(id).is_some() {
            called.extend(probe.implicit_iterator_callees(id));
            guarded_calls.insert(id);
            guarded_a_call = true;
            iterator_close::guarded_regions(probe, id)
        } else {
            continue;
        };
        // The first child is the guarded block. A `catch` body is not guarded
        // by this `try` -- a throw there reaches the handler *above* -- and
        // including it would make a copy for a callee this `try` cannot catch.
        let mut pending = regions;
        while let Some(at) = pending.pop() {
            if matches!(
                probe.kind_of(at),
                Some(
                    syntax::CALL_EXPRESSION
                        | syntax::NEW_EXPRESSION
                        | syntax::TAGGED_TEMPLATE_EXPRESSION
                )
            ) || probe.reads_an_accessor(at)
                || !probe.implicit_printer_callees(at).is_empty()
                || !probe.implicit_iterator_callees(at).is_empty()
                || probe.iterators.close_can_raise(at)
            {
                guarded_a_call = true;
                guarded_calls.insert(at);
            }
            called.extend(raising_callees_of(snapshot, probe, at));
            // The same pruning, so which callees a `try` is taken to reach and
            // which it is refused for are one answer. A copy made for a callee
            // only a dead branch reaches is a body lowered for nothing.
            pending.extend(children_that_run(probe, at));
        }
    }
    (called, guarded_a_call, guarded_calls)
}
