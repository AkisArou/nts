//! Discover closure identities, captured bindings, and closure variants needed by specialized bodies.

#[cfg(test)]
use super::collection_tests;
use super::{
    A_GENERIC_DECLARATION_READING_THIS, ClassCopy, FuncBuilder, HirType, LoweringSnapshot, NodeId,
    NodeKind, Retyped, SemanticSnapshot, Structural, SymbolFlags, SymbolId, SymbolRecord,
    THIS_CAPTURE, Then, TypeId, binds_its_own_this, declaration_initializer, initialization,
    is_generic_function, is_static_member, names_a_body, names_only_a_type_parameter,
    parameter_entries, reads_a_name, retyped_symbols_of, settler_symbols, signature_key, syntax,
    the_function_of,
};

/// How many parameters the erased entry takes: the widest closure in the program.
///
/// See [`Hierarchy::erased_call_arity`](super::Hierarchy::erased_call_arity) for why the width is per program rather
/// than a constant, and why one fact read twice is tolerable here.
///
/// A program whose closures all take nothing gets an entry that takes nothing,
/// which is the right answer and not a degenerate one. A refused closure is
/// skipped because its `#call` is never lowered either, so it has no entry to be
/// wide enough for.
pub(super) fn widest_closure(snapshot: &SemanticSnapshot, closures: &[ClosureInfo]) -> usize {
    closures
        .iter()
        .filter(|closure| closure.refusal.is_none())
        .filter_map(|closure| {
            let ty = *snapshot.node_types.get(&closure.node)?;
            Some(signature_key(snapshot, ty)?.0.len())
        })
        .max()
        .unwrap_or(0)
}

/// One arrow function, and what its body reads from the scope around it.
///
/// # Why a closure is an object
///
/// A closure is captured state plus code. So is an object. Saying so rather
/// than inventing a second mechanism means a closure gets the object machinery
/// exactly as written: a base-first layout, escape analysis that leaves it in
/// the frame when it does not outlive the call, reference counting with the
/// same rules as everything else, and dispatch through a slot. None of the four
/// needed a line of new code.
///
/// The class is the compiler's own -- the checker has a type for the
/// *signature*, which is what a value holding the closure is declared as, but
/// nothing for the thing that carries the captures.
#[cfg_attr(not(test), derive(Clone))]
#[derive(Debug)]
pub(super) struct ClosureInfo {
    /// The arrow function node; for any other [`ClosureSource`], the
    /// declaration it was made from, which that variant names.
    pub(super) node: NodeId,
    /// What the body reads from outside itself, in a fixed order.
    pub(super) captures: Vec<Capture>,
    /// Why it cannot be lowered, if it cannot.
    ///
    /// Recorded here rather than raised here, so that a program containing one
    /// closure this does not handle still compiles the rest -- and so the
    /// reason is reported at the arrow rather than at whatever read it.
    pub(super) refusal: Option<&'static str>,
    /// Where it came from, which decides what its body is.
    pub(super) source: ClosureSource,
    /// The structural copy this closure is a variant for, by suffix, or
    /// `None` for the closure as written.
    ///
    /// A closure is lowered once, and a copy that re-types a parameter it
    /// captures cannot use that one: its field holds a `Thing` where the body
    /// reads a `Named`. So `closure_variants` gives each such (closure, copy)
    /// pair a closure of its own -- same node, same captures, the re-typed
    /// ones at the copy's types -- and `lower_arrow` inside the copy names the
    /// variant. The variant's body is lowered in the copy's context, so the
    /// calls in it name the copies the enclosing body's do.
    pub(super) within: Option<String>,
    /// And, where that copy is a *generic's* rather than a structural one, the
    /// copy itself: what it binds, and which generic it is a copy of.
    ///
    /// Carried rather than looked up. `Shared::class_copies` used to be a
    /// `suffix -> copy` map and two declarations whose copies spell one suffix
    /// collided, so a variant could be made for one declaration and the
    /// substitution found for another -- or, as it happened, for none. The copy
    /// is unambiguous exactly where the variant is made.
    pub(super) within_copy: Option<ClassCopy>,
    /// The captured symbols a variant re-types, at the copy's types. Empty
    /// for the closure as written.
    pub(super) retyped_captures: std::collections::BTreeMap<u32, HirType>,
    /// Whether the body reads its own `this`: a `function` expression that
    /// does ([`FuncBuilder::binds_this`]). Its body takes the call's `this`
    /// after the closure, as a uniform entry does ([`super::UNIFORM_THIS`](crate::hir::UNIFORM_THIS)),
    /// and its written `#call` is a wrapper passing `undefined`, for the
    /// callers that have no `this` to give (`docs/records/notebooks/function-receivers.md`).
    pub(super) reads_this: bool,
}

#[cfg(test)]
impl Clone for ClosureInfo {
    fn clone(&self) -> Self {
        collection_tests::note(|counts| counts.closure_copies += 1);
        Self {
            node: self.node,
            captures: self.captures.clone(),
            refusal: self.refusal,
            source: self.source,
            within: self.within.clone(),
            within_copy: self.within_copy.clone(),
            retyped_captures: self.retyped_captures.clone(),
            reads_this: self.reads_this,
        }
    }
}

/// Where a closure came from, which decides what its body is.
///
/// One enum rather than two booleans, because the booleans had combinations
/// that meant nothing -- a closure that binds a receiver without wrapping
/// anything -- and a third kind would have added a third flag and four more.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ClosureSource {
    /// An arrow or a function expression, lowered from its own body.
    Authored,
    /// A *named function* used as a value.
    ///
    /// `nextTick(finish, stream)` passes `finish` where JavaScript's answer is
    /// a function object. This compiler's answer is a closure with no captures
    /// whose `call` forwards to `finish` -- one static instance, so `finish`
    /// is the same object everywhere it is written. An event emitter removing
    /// a listener depends on exactly that.
    Function,
    /// A **method** used as a value, whose receiver the closure carries.
    ///
    /// `const g = c.twice` is a function object that remembers `c`. A free
    /// function needs nothing remembered, so [`Self::Function`] is a single
    /// static instance; a method needs one object *per read*, with the receiver
    /// in field 0 -- which is also what JavaScript does, since `c.twice !==
    /// c.twice`.
    ///
    /// Always empty [`ClosureInfo::captures`]: a method body reads its receiver
    /// through `this`, not through the enclosing scope, so field 0 is the whole
    /// environment and `bind_captures` starts after it.
    Method,
    /// The specification's `NewPromiseResolveThenableJob` for one `then`:
    /// `x.then(resolve, reject)`, run as a microtask. The node is what it
    /// calls -- a class's `then` method, or the function a binding's `then`
    /// names. See [`Thenable`](super::thenable_jobs::Thenable).
    Job {
        /// Which `then` it calls.
        calls: Then,
        /// The resolving functions it hands that `then`, by closure index:
        /// `CreateResolvingFunctions`. `None` where `then` declares no
        /// parameter for one.
        resolve: Option<usize>,
        reject: Option<usize>,
    },
    /// One of the resolving functions a [`Self::Job`] makes. The node is the
    /// `then` parameter it is passed as, whose function type is its
    /// signature -- so the `then` that calls it calls exactly what it built.
    Resolving { rejects: bool },
    /// The reaction a `.then`, `.catch` or `.finally` on a promise subscribes:
    /// the specification's `PromiseReaction` pair and the `NewPromiseReactionJob`
    /// that runs it, as one closure. The node is the call. See [`reactions`](super::reactions).
    Reaction,
    /// The job an `import()` of one module queues: evaluate it if it has not
    /// run, then settle the import's promise with its namespace or its error. The
    /// node is the module's root. See [`module_jobs`](super::module_namespaces::module_jobs).
    ModuleJob { module: usize },
    /// The function `f.bind(r, ...bound)` makes: it holds `f`, `r` and the bound
    /// arguments, and calls `f` with `r` as its `this` and the bound arguments
    /// before its own. The node is the call. See [`bound_functions`](fn@super::bound_functions).
    Bound,
}

impl ClosureSource {
    /// Whether `call` forwards to a declaration rather than running a body.
    pub(super) const fn wraps(self) -> bool {
        matches!(self, Self::Function | Self::Method)
    }

    /// Whether field 0 is the receiver of a method it forwards to.
    pub(super) const fn binds_receiver(self) -> bool {
        matches!(self, Self::Method)
    }

    /// Whether only the runtime calls it -- a microtask, through the `call` slot
    /// it was subscribed at -- so no site can dispatch at its raising entry, and a
    /// raising variant of it is a body nothing reaches.
    ///
    /// A [`Self::Job`] is called the same way and would answer yes too; it is
    /// left out until that is measured on its own, so this change stays about
    /// the reaction.
    pub(super) const fn only_the_runtime_calls(self) -> bool {
        matches!(self, Self::Reaction)
    }
}

impl ClosureInfo {
    /// The closure as written: no copy of an enclosing generic, nothing
    /// re-typed, nothing wrapped.
    ///
    /// **One spelling for what "as written" means.** Three sites made one of
    /// these with all eight fields written out, so a field added to the struct
    /// was a field added in four places -- which is exactly how `within_copy`
    /// arrived, and the compiler only caught it because every field is required.
    /// A field with a `Default` would have been silently wrong in three of them.
    pub(super) fn as_written(node: NodeId) -> Self {
        Self {
            node,
            captures: Vec::new(),
            refusal: None,
            source: ClosureSource::Authored,
            within: None,
            within_copy: None,
            retyped_captures: std::collections::BTreeMap::new(),
            reads_this: false,
        }
    }
}

/// File a method read as a value under the closure it will become.
///
/// **The same question one member kind over.** `const g = c.twice` is a
/// function object, and the closure it becomes wraps `C#twice`. Collected here
/// rather than at the read, because the read needs the `ClosureInfo` to already
/// exist.
///
/// Two lists, because the two shapes differ in what they carry. A **static**
/// method needs no receiver at all, so it is the free-function case under
/// another name: one instance for the program, forwarding directly. An
/// **instance** method's closure holds the object that selects its body, which
/// means one object per read.
fn collect_method_used_as_value(
    probe: &FuncBuilder,
    record: &SymbolRecord,
    reference: NodeId,
    wrapped: &mut Vec<NodeId>,
    bound: &mut Vec<NodeId>,
) {
    for declaration in &record.declarations {
        if probe.kind_of(*declaration) != Some(syntax::METHOD_DECLARATION) {
            continue;
        }
        // The name in `twice(n) { … }` is an identifier for the same symbol,
        // and declaring a method is not using it as a value.
        if probe.node(reference).parent == Some(*declaration) {
            continue;
        }
        let list = if is_static_member(probe.snapshot, *declaration) {
            &mut *wrapped
        } else {
            &mut *bound
        };
        if !list.contains(declaration) {
            list.push(*declaration);
        }
    }
}

/// Does this method's body reach its receiver?
///
/// **A property read does not bind one.** `const g = c.twice; g(3)` calls
/// `twice` with `this` *undefined* -- `c.twice` is the function itself, not
/// `c.twice.bind(c)`, and the two differ the moment the body touches `this`.
/// Measured against node: a method reading `this.k` **throws** where this
/// compiler answered `30`.
///
/// The receiver is still carried, because it is what *selects* the body -- a
/// `D` read through a `C`-typed name must reach `D`'s override, which is a
/// virtual dispatch and needs the object. So the closure holds it for dispatch
/// and hands it on as `this`, and that is only sound while the body cannot tell
/// -- which is what this asks.
///
/// An arrow written inside the method is walked into, because an arrow inherits
/// `this`; a nested `function` is not, because it has its own. `super` counts
/// too: it is the receiver under another name.
fn uses_its_receiver(probe: &FuncBuilder, method: NodeId) -> bool {
    if probe
        .node(method)
        .children
        .iter()
        .any(|child| probe.first_this(*child).is_some())
    {
        return true;
    }
    let mut subtree = Vec::new();
    probe.subtree(method, &mut subtree);
    subtree
        .iter()
        .any(|node| probe.kind_of(*node) == Some(syntax::SUPER_KEYWORD))
}

/// A name the closure body reads and the enclosing scope binds.
#[derive(Clone, Debug)]
pub(super) struct Capture {
    pub(super) symbol: u32,
    /// A statically resolved local class carries only readiness, never a
    /// constructor value. Its cell belongs to the declaring invocation.
    pub(super) readiness_only: bool,
    /// `Some(rejects)` when the name is a **promise settler** -- `resolve` or
    /// `reject` from a `new Promise` executor.
    ///
    /// A settler is not a value: `Settler`'s doc says so, and a call to one is
    /// the settle it stands for. So a closure capturing one has nothing in
    /// `bindings` to copy, and used to be refused.
    ///
    /// What it captures instead is the **promise**, and the body re-derives the
    /// settle from it. That is why this is on the capture rather than on the
    /// closure: the field holds a `Promise<T>` while the name in the source is
    /// a function, so every side that reads the field has to know the
    /// difference.
    ///
    /// Decided in `collect_closures`, because `closures` is built once and
    /// *cloned* into each `FuncBuilder` -- a mark made while lowering the
    /// enclosing function would never reach the builder that lowers the body.
    pub(super) settles: Option<bool>,
    /// The field name, which is the source name: a dump of the layout should
    /// read like the program.
    pub(super) name: String,
    /// A node that reads it, for the type and for a diagnostic's location.
    pub(super) at: NodeId,
    /// Whether the name is declared *below* the closure that reads it.
    ///
    /// The cell then exists before it holds anything, and a body that runs in
    /// that window would read a zero where JavaScript throws a
    /// `ReferenceError`. Such a cell carries a `ready` flag and its reads are
    /// guarded. Lexical bindings throw `ReferenceError` through ordinary HIR;
    /// a forward var retains a named stop until its cell can hold undefined.
    ///
    /// Only a *closure* can reach that window: TypeScript rejects a direct use
    /// before declaration in the same scope, so there is no other way in.
    pub(super) forward: bool,
    /// Whether the closure captures the *binding* rather than its value.
    ///
    /// JavaScript closures always capture the binding. For a name nothing
    /// writes to that is the same thing as capturing the value, and capturing
    /// the value is free -- so that is what happens, and it is the common case
    /// by a wide margin.
    ///
    /// For a name something *does* write to the two differ, and observably:
    ///
    /// ```ts
    /// let called = false;
    /// const onDestroy = () => { if (called) return; called = true; };
    /// ```
    ///
    /// Both the enclosing function and the closure have to see one `called`.
    /// So the variable moves into a one-slot cell on the heap, both hold a
    /// pointer to it, and every read and write goes through the cell. The
    /// pointer is what gets captured, still by value.
    pub(super) by_reference: bool,
}

/// Whether a name is reached *by name* rather than carried in a closure.
///
/// There is one of it for the whole program and every function already reaches
/// it, so copying it into a closure object would be storage for nothing. That
/// covers a function, a class, an import of either, and anything declared at
/// module scope -- and a *type*, which is not a value at all.
///
/// Getting this wrong does not produce a wrong answer, it produces a refusal
/// that blames the wrong thing: the closure is refused for finding no value for
/// a name that never had one, and the message can only say how far away the
/// declaration was.
///
/// **And the first sentence was false for one kind of function**, which is what
/// `nested` is for. A nested `function` declaration that captures is lowered as
/// a *closure body* ([`not_a_plain_function`]): there is one of it per call of
/// its enclosing function, carrying an environment, and nothing emits it under
/// its own name. So it is a local like any other and a sibling closure reading it
/// must capture it. Without that, `Closure1#call` called `inner` and the cascade
/// said "which nothing in this program defines" with no root diagnostic anywhere
/// -- exactly the failure the paragraph above predicts. Found by the GTK lane in
/// Workbench's Network Monitor and by the React lane in upstream's child
/// reconciler.
pub(super) fn reached_by_name(
    probe: &FuncBuilder,
    snapshot: &SemanticSnapshot,
    symbol: SymbolId,
    record: &SymbolRecord,
    nested: &rustc_hash::FxHashSet<NodeId>,
) -> bool {
    // First, because both tests below would otherwise claim such a declaration:
    // the kind test, and the `FUNCTION` flag on its symbol.
    //
    // `all` rather than `any`, and non-empty: a name some of whose declarations
    // are reached by name *is* reached by name, and treating one as a capture
    // when it is not refuses the closure for a binding the enclosing builder has
    // no value for. The permissive direction is the unsafe one here.
    if !record.declarations.is_empty()
        && record
            .declarations
            .iter()
            .all(|declaration| nested.contains(declaration))
    {
        return false;
    }
    // There is one of it for the whole program, so copying a pointer to
    // it into every closure would be storage for nothing.
    if record.declarations.iter().any(|declaration| {
        matches!(
            probe.kind_of(*declaration),
            Some(syntax::FUNCTION_DECLARATION | syntax::CLASS_DECLARATION)
        )
    }) {
        return true;
    }
    // The same, for a name that arrived through an import -- whose
    // declaration is an import specifier rather than the thing itself
    // -- and for a name that is not a value at all.
    //
    // `(callback as Callback<Stats>)` mentions `Callback`, a type
    // alias, inside an arrow. It has a symbol and it is declared
    // outside, so without this it looked like something to capture, and
    // the closure was refused for failing to find a value for a name
    // that never had one. `Buffer`, `Stats` and `uvException` are the
    // same mistake one step further out: imported, so the declaration
    // test above does not see what they are.
    let denoted = probe.denoted_symbol(symbol);
    let record = snapshot.symbols.get(denoted.0 as usize).unwrap_or(record);
    if [
        SymbolFlags::FUNCTION,
        SymbolFlags::CLASS,
        SymbolFlags::INTERFACE,
        SymbolFlags::TYPE_ALIAS,
        SymbolFlags::ENUM,
        SymbolFlags::MODULE,
    ]
    .iter()
    .any(|flag| record.flags.contains(*flag))
    {
        return true;
    }
    // A module-scope name, for the same reason: one of it for the whole
    // program, reached by name. `const BASE64 = "..."` and `const
    // weakSetHas = WeakSet.prototype.has` are not things a closure
    // carries a copy of.
    if record
        .declarations
        .iter()
        .all(|declaration| probe.is_module_scope(*declaration))
    {
        return true;
    }
    // A name something writes to is captured by reference: it moves
    // into a cell, and the cell pointer is what the closure holds.
    //
    // Except when the binding is per-iteration. `for (let i = 0; ...)`
    // gives each turn of the loop its own `i` -- a closure made in the
    // body captures that turn's value, and JavaScript is explicit about
    // it. One cell for the whole loop would hand every closure the
    // value the loop ended on, so it is named and refused rather than
    // answered wrongly.
    false
}

/// The symbols whose cell may need to say whether it has been filled yet.
/// Initialization analysis can prove some lexical readers ready and omit
/// their flag; a remaining forward var keeps the named stop for now.
pub(super) fn guarded_symbols(closures: &[ClosureInfo]) -> Vec<u32> {
    #[cfg(test)]
    collection_tests::note(|counts| counts.derived_elements += closures.len());
    let mut found: Vec<u32> = closures
        .iter()
        .filter(|closure| closure.refusal.is_none())
        .flat_map(|closure| &closure.captures)
        .filter(|capture| capture.forward)
        .map(|capture| capture.symbol)
        .collect();
    found.sort_unstable();
    found.dedup();
    found
}

/// The symbols a program captures by reference, in a stable order.
/// Each position is a cell's type identity, so two compiler runs must agree.
pub(super) fn boxed_symbols(closures: &[ClosureInfo]) -> Vec<u32> {
    #[cfg(test)]
    collection_tests::note(|counts| counts.derived_elements += closures.len());
    let mut found: Vec<u32> = closures
        .iter()
        .filter(|closure| closure.refusal.is_none())
        .flat_map(|closure| &closure.captures)
        .filter(|capture| capture.by_reference)
        .map(|capture| capture.symbol)
        .collect();
    found.sort_unstable();
    found.dedup();
    found
}

/// The type id of the `n`th cell, and the name of its struct.
///
/// Synthetic like a closure's, and from the *bottom* of the synthetic band
/// rather than the top: closures count down from `u32::MAX` and the suspension
/// machine takes the half above `FLOOR + 2^19`, so this is the space left.
/// The setter a property's name implies: `setTitle:` for `title`.
pub(super) fn default_setter(name: &str) -> String {
    let mut letters = name.chars();
    let first = letters.next().map(|c| c.to_ascii_uppercase()).into_iter();
    format!("set{}:", first.chain(letters).collect::<String>())
}

/// The handle a pointer to an opaque object is, `const` or not.
pub(super) fn opaque_handle(
    pointee: &crate::hir::native::Pointee,
) -> Option<&crate::hir::native::Handle> {
    match pointee {
        crate::hir::native::Pointee::Opaque(handle) => Some(handle),
        crate::hir::native::Pointee::Const(inner) => opaque_handle(inner),
        _ => None,
    }
}

/// The `n` behind a synthetic closure type id. The inverse of [`closure_type`](super::closure_type).
pub(super) fn closure_index(ty: TypeId) -> usize {
    (ty.0.saturating_sub(crate::hir::SYNTHETIC_CLOSURES)) as usize
}

/// Find every arrow function and work out what it captures.
///
/// This runs before any lowering because both sides have to agree: the
/// enclosing function writes the captures into the object in this order, and
/// the closure body reads them back from the same fields.
/// What to do with a closure's capture of a name a `for` loop's head declares.
///
/// Three outcomes, because the question has three answers and the rule that had
/// two got one of them wrong for every loop in the corpus. See
/// [`FuncBuilder::rebinding_refusal`].
#[derive(Debug, Clone, Copy)]
enum Rebinding {
    /// No `for` head declares this name, so none of this applies.
    NotTheLoops,
    /// Rebound per iteration, and copying the value is **exact** rather than an
    /// approximation of a cell.
    CopyIsExact,
    /// Refused, and the message says which of the two reasons it is.
    Refused(&'static str),
}

/// Whether a declaration is lowered as a closure body rather than as a function.
///
/// **Only one that actually captures.** [`FuncBuilder::is_nested_closure`] takes
/// every nested declaration, and one that reads nothing from around it is an
/// ordinary function that was always emitted as one -- skipping those left 210
/// `a declaration outside every walk` in `util` alone, a body nothing emitted
/// and nothing refused.
///
/// Asked in two places, which is why it is a function: one side decides not to
/// emit a function and the other decides to allocate a closure, and a
/// disagreement between them is a name with nothing behind it.
///
/// Such a declaration is **not a function of this program**. Its body is
/// lowered as a closure body and its name bound where the declaration stands,
/// so emitting a top-level one as well would be two definitions of one thing --
/// and the top-level one is the one that cannot work, its body reading a local
/// of its enclosing function with nowhere to read it from. That refusal,
/// `a name from an enclosing scope`, is what this change is about.
pub(super) fn not_a_plain_function(kind: NodeKind, closures: &[ClosureInfo], id: NodeId) -> bool {
    kind != NodeKind::Syntax(syntax::FUNCTION_DECLARATION) || taken_as_a_closure(closures, id)
}

pub(super) fn taken_as_a_closure(closures: &[ClosureInfo], id: NodeId) -> bool {
    closures
        .iter()
        .any(|closure| closure.node == id && !closure.captures.is_empty())
}

/// Every symbol something assigns to, anywhere in the program.
///
/// A variable that is *ever* assigned cannot be captured, because this captures
/// by value and JavaScript captures by reference. For a name nothing writes to
/// the two are the same thing; for one something writes to they are observably
/// different, and quietly picking the wrong one would make a program compute a
/// stale answer rather than fail to compile.
///
/// Its own function because `collect_closures` is at the line limit and this is
/// the self-contained half -- a whole-program question, asked once, whose
/// answer the walk below only reads.
fn assigned_anywhere(snapshot: &SemanticSnapshot, probe: &FuncBuilder) -> Vec<u32> {
    let mut assigned = Vec::new();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        if node.kind == NodeKind::Syntax(syntax::SOURCE_FILE) {
            probe.assigned_symbols(id, &mut assigned);
        }
        // **A `var` declared a second time is written by the second
        // declaration**: `var x = 'a'; ... { var x = 'b'; }` is one binding,
        // and the second initializer stores into it. A closure capturing `x`
        // by value between the two kept `'a'` where node reads `'b'`
        // (`outcomes/a-var-redeclared-in-a-block-under-a-closure-global`, the
        // function-scope half). Not in `assigned_symbols`, which a loop's carry
        // analysis also reads and which this does not mean to widen.
        if node.kind == NodeKind::Syntax(syntax::VARIABLE_DECLARATION)
            && let [name, .., initializer] = probe.children(id).as_slice()
            && initializer != name
            && probe.kind_of(*name) == Some(syntax::IDENTIFIER)
            && let Some(symbol) = probe.node(*name).symbol
            && snapshot
                .symbols
                .get(symbol.0 as usize)
                .is_some_and(|record| record.declarations.len() > 1)
        {
            assigned.push(symbol.0);
        }
    }
    assigned
}

/// What one closure candidate captures from around it.
///
/// **Asked twice, which is why it is a function.** Once by [`nested_closures`],
/// to find out which nested `function` declarations capture anything at all, and
/// once by [`collect_closures`] for the closures the program keeps. A second
/// derivation of "what is free in this body" would be two answers to the
/// question a closure's whole layout rests on.
fn captures_of(
    probe: &FuncBuilder,
    snapshot: &SemanticSnapshot,
    id: NodeId,
    settlers: &rustc_hash::FxHashMap<u32, bool>,
    assigned: &[u32],
    nested: &rustc_hash::FxHashSet<NodeId>,
    readers: &initialization::PrivateReaders,
) -> ClosureInfo {
    let mut info = ClosureInfo::as_written(id);

    let mut subtree = Vec::new();
    probe.subtree(id, &mut subtree);

    // `this` first, so its field index is stable and a layout dump reads
    // the way the program does.
    //
    // An arrow does not bind `this`; it inherits the enclosing one, which
    // makes it a free variable like any other and it was the only one not
    // treated as such. `self.this` inside a closure was the *closure
    // object*, so `this.emit(...)` looked for `emit` on the closure's own
    // layout and did not find it -- 17 sites named `emit`, 8 `#inScope`,
    // and the whole of the "`v`, which `an anonymous type` does not
    // declare" row, which is the same thing said about a field.
    //
    // `mentions_this` already knew how to ask: it stops at anything that
    // rebinds `this` and descends through arrows, which is the rule.
    //
    // **And the closure itself may be one.** A `function` expression that reads
    // `this` reads the call's (`ClosureInfo::reads_this`), so the walk below
    // would find its own `this` and capture the enclosing one in its place: the
    // wrong object, silently. It was unreachable while such a function was
    // refused rather than collected.
    let binds_its_own = probe.kind_of(id).is_some_and(binds_its_own_this);
    if !binds_its_own
        && let Some(at) = probe
            .node(id)
            .children
            .iter()
            .find_map(|child| probe.first_this(*child))
    {
        info.captures.push(Capture {
            symbol: THIS_CAPTURE,
            readiness_only: false,
            settles: None,
            name: "this".to_owned(),
            at,
            forward: false,
            by_reference: false,
        });
    }

    for read in &subtree {
        let Some(symbol) = probe.node(*read).symbol else {
            continue;
        };
        if !reads_a_name(probe, *read) {
            continue;
        }
        if info.captures.iter().any(|had| had.symbol == symbol.0) {
            continue;
        }
        let Some(record) = snapshot.symbols.get(symbol.0 as usize) else {
            continue;
        };
        if names_only_a_type_parameter(probe, record) {
            continue;
        }
        // Nothing to capture: a name declared outside the decoded files, or
        // one the arrow declares itself.
        if record.declarations.is_empty()
            || record
                .declarations
                .iter()
                .any(|declaration| subtree.contains(declaration))
        {
            continue;
        }
        // A name declared *below* the arrow that reads it. The closure
        // captures the binding, and where the closure is built that binding
        // has no value -- so there is nothing to copy and it has to go
        // through a cell, whether or not anything writes to it:
        //
        //     const onListening = () => { ...cleanup...; };
        //     const cleanup = ...;
        //
        // Legal, because the body runs later.
        let arrow = probe.node(id).origin.location;
        let below = record.declarations.iter().all(|declaration| {
            let declared = probe.node(*declaration).origin.location;
            declared.file == arrow.file && declared.span.start > arrow.span.start
        }) || record.declarations.iter().any(|declaration| {
            // A parameter is initialized only after its initializer returns.
            // A closure made by that initializer captures the still-unready
            // binding, just as one written before a later declaration does.
            parameter_entries::parameter_declaration(probe, *declaration)
                .is_some_and(|parameter| probe.ancestor(id, syntax::PARAMETER) == Some(parameter))
        });
        let readiness_only = (below || probe.kind_of(id) == Some(syntax::FUNCTION_DECLARATION))
            && initialization::runtime_reference(probe, *read)
            && record.declarations.iter().all(|declaration| {
                probe.kind_of(*declaration) == Some(syntax::CLASS_DECLARATION)
                    && !probe.is_module_scope(*declaration)
                    && !readers.ready_after(probe, id, *declaration)
            });
        if !readiness_only && reached_by_name(probe, snapshot, symbol, record, nested) {
            continue;
        }
        if readiness_only
            && record
                .declarations
                .iter()
                .any(|declaration| initialization::reentered_scope(probe, *declaration))
        {
            info.refusal = Some(
                "a closure reading a local class before its declaration in a re-entered scope, which needs fresh readiness storage on each entry",
            );
            break;
        }
        let mut by_reference = assigned.contains(&symbol.0) || below || readiness_only;
        if by_reference {
            match probe.rebinding_refusal(record, symbol.0, below) {
                Rebinding::Refused(message) => {
                    info.refusal = Some(message);
                    break;
                }
                Rebinding::CopyIsExact => by_reference = false,
                Rebinding::NotTheLoops => {}
            }
        }
        info.captures.push(Capture {
            symbol: symbol.0,
            readiness_only,
            settles: settlers.get(&symbol.0).copied(),
            name: record.name.to_string(),
            at: *read,
            by_reference,
            forward: below || readiness_only,
        });
    }
    info
}

/// Every nested `function` declaration this program lowers as a closure body.
///
/// **A fixpoint, because the answer feeds itself.** Such a declaration is not
/// reached by name -- there is one of it per call of its enclosing function,
/// carrying an environment, and nothing emits it under its own name -- so
/// [`reached_by_name`] has to answer `false` for one, and a *sibling* closure
/// reading it captures it like any other local. Which means
///
/// ```ts
/// function outer(n: number) {
///   function a() { return n; }     // captures `n`, so a closure
///   function b() { return a(); }   // captures `a`, so a closure too
/// }
/// ```
///
/// needs `a`'s answer before `b`'s. One pass takes `a` and leaves `b` emitted as
/// a plain function calling a name nothing defines, which is what the GTK lane
/// reported from Workbench's Network Monitor: `Closure1#call` calling `inner`,
/// "which nothing in this program defines", with no root diagnostic anywhere.
/// React's child reconciler is ~24 inner functions calling each other, so the
/// chain is the population rather than a corner.
///
/// Monotone, so it converges: adding a declaration to the set can only add
/// captures, never remove one. Bounded anyway, because a bound that is never
/// reached costs nothing and a fixpoint that cannot end costs a build.
fn nested_closures(
    probe: &FuncBuilder,
    snapshot: &SemanticSnapshot,
    settlers: &rustc_hash::FxHashMap<u32, bool>,
    assigned: &[u32],
    readers: &initialization::PrivateReaders,
) -> rustc_hash::FxHashSet<NodeId> {
    let candidates: Vec<NodeId> = snapshot
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| node.kind == NodeKind::Syntax(syntax::FUNCTION_DECLARATION))
        .map(|(index, _)| NodeId(u32::try_from(index).unwrap_or(u32::MAX)))
        .filter(|id| probe.is_nested_closure(*id))
        .collect();
    let mut found = rustc_hash::FxHashSet::default();
    for _ in 0..NESTED_CLOSURE_ROUNDS {
        let mut grew = false;
        for id in &candidates {
            if found.contains(id) {
                continue;
            }
            if !captures_of(probe, snapshot, *id, settlers, assigned, &found, readers)
                .captures
                .is_empty()
            {
                found.insert(*id);
                grew = true;
            }
        }
        if !grew {
            break;
        }
    }
    found
}

/// The rounds [`nested_closures`] may take, one per level of a chain of nested
/// functions calling each other. Eight is far past anything written: React's
/// reconciler is ~24 functions wide and one deep.
const NESTED_CLOSURE_ROUNDS: usize = 8;

pub(super) fn collect_closures(
    snapshot: &LoweringSnapshot<'_>,
    readers: &initialization::PrivateReaders,
) -> Vec<ClosureInfo> {
    let probe = FuncBuilder::probe(snapshot);
    let settlers = settler_symbols(snapshot, &probe);

    let assigned = assigned_anywhere(snapshot, &probe);
    // Before the loop, because `reached_by_name` consults it for every name any
    // closure reads and the answer for one nested declaration depends on the
    // others.
    let nested = nested_closures(&probe, snapshot, &settlers, &assigned, readers);

    let mut closures = Vec::new();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        // An arrow, and a `function` expression that does not bind its own
        // `this`.
        //
        // The refusal for the second used to say it out loud -- "it uses no
        // `this`, so an arrow function with the same body lowers today" -- and
        // that is a message telling the author to retype their program. The
        // difference between the two forms is exactly `this`: an arrow inherits
        // the enclosing one, which is why it is captured here like any other
        // free name, and a `function` binds its own. One that never mentions
        // `this` has no such binding to be wrong about, so it is the same
        // closure.
        //
        // And an object literal's **method**, under the same rule. Written as
        // `{ read() { return base + 1 } }` it is a table method with no
        // environment, and `base` was refused as a name from an enclosing
        // scope -- 35 sites in `runtime/`, one idiom: a literal standing in
        // for an interface, reading the locals of the function that built it.
        // Collected here so its captures are known; whether it *becomes* a
        // closure is the type's decision, made by `collect_stored_members`
        // from every literal of the type, and a method it leaves as a table
        // entry is never asked for. One that mentions `this` binds its own,
        // the way a `function` does, and stays a table method with a receiver.
        let is_closure = match node.kind {
            NodeKind::Syntax(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION) => true,
            NodeKind::Syntax(syntax::FUNCTION_DECLARATION) => probe.is_nested_closure(id),
            NodeKind::Syntax(syntax::METHOD_DECLARATION) => {
                probe.is_a_literal_method(id) && !probe.binds_this(id)
            }
            _ => false,
        };
        if !is_closure {
            continue;
        }
        let mut info = captures_of(&probe, snapshot, id, &settlers, &assigned, &nested, readers);
        info.reads_this = matches!(
            node.kind,
            NodeKind::Syntax(syntax::FUNCTION_EXPRESSION | syntax::FUNCTION_DECLARATION)
        ) && probe.binds_this(id);
        closures.push(info);
    }

    collect_function_values(snapshot, &probe, &mut closures);
    closures
}

/// The named functions a program uses as *values*, as closures that forward.
///
/// Separate from the arrow walk above because it asks a different question of
/// a different node: not "what does this arrow capture" but "is this name being
/// passed rather than called".
///
/// Only for functions something actually uses this way. A wrapper for every
/// declaration would give a closure table to every program that has a function,
/// and a program of ordinary calls should carry no table at all.
#[expect(
    clippy::too_many_lines,
    reason = "keep semantic text and key projection beside its existing dispatch"
)]
fn collect_function_values(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    closures: &mut Vec<ClosureInfo>,
) {
    // One per declaration rather than one per use, which is what makes a single
    // static instance meaningful: two mentions of `finish` are the same object,
    // as they are in JavaScript.
    let mut wrapped: Vec<NodeId> = Vec::new();
    // The method declarations read as values, kept apart from `wrapped`
    // because the closure each becomes carries a receiver.
    let mut bound: Vec<NodeId> = Vec::new();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        // **A private name is an identifier too, for this question.**
        // `return this.#method` is the shape the corpus writes -- a getter
        // handing a private method out as a value -- and `#method` is a
        // `PRIVATE_IDENTIFIER`, so a filter naming only `IDENTIFIER` saw every
        // public method read and none of the private ones.
        if !matches!(
            node.kind,
            NodeKind::Syntax(syntax::IDENTIFIER | syntax::PRIVATE_IDENTIFIER)
        ) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        // Being called is not being used as a value. Being the name after a dot
        // is not either, EXCEPT through a namespace import: `codec.ucs2decode`
        // is a property access whose symbol is an ordinary module function, and
        // `punycode` hands exactly that to an object literal --
        // `export const ucs2 = { decode: codec.ucs2decode, ... }`.
        //
        // The test is on the property access rather than on the identifier,
        // because it is the access that would be a callee: in `codec.decode(x)`
        // the call's callee is `codec.decode`, not `decode`, so asking the
        // identifier gives `false` for every namespaced call in the program and
        // would wrap every function any module reaches that way. A wrapper for
        // each of those would give a closure table to programs that are nothing
        // but ordinary calls.
        //
        // A class method reaches here too, and is collected separately below:
        // its declaration is a `METHOD_DECLARATION` and the closure it becomes
        // carries a receiver, which a free function's does not.
        // **Importing a function is not using it as a value.** The name in
        // `import { nextTick } from "./tick"` is an identifier whose symbol
        // follows to the declaration, and nothing calls it there -- so it read
        // as a use, and every imported function was wrapped. That wrapper was
        // dead, and harmless, until a generic one also got an erased kernel
        // (`generic_values::register`): `nextTick<A extends unknown[]>` then
        // refused at its rest parameter in a program that only ever calls it
        // (blockers/a-generic-rest-forwarded-to-its-callback).
        if node.parent.and_then(|parent| probe.kind_of(parent)) == Some(syntax::IMPORT_SPECIFIER) {
            continue;
        }
        let used_as_value = if probe.names_a_member(id) {
            node.parent.is_some_and(|parent| {
                probe.kind_of(parent) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
                    && !probe.is_callee(parent)
            })
        } else {
            !probe.is_callee(id)
        };
        if !used_as_value {
            continue;
        }
        let Some(symbol) = node.symbol else {
            continue;
        };
        let Some(record) = snapshot.symbols.get(symbol.0 as usize) else {
            continue;
        };
        // An imported name is a local symbol whose whole content is a pointer
        // to the declaring module's, and the frontend has followed the chain to
        // the end -- so one hop reaches the declaration however many files the
        // name travelled through.
        let record = record
            .aliased
            .and_then(|to| snapshot.symbols.get(to.0 as usize))
            .unwrap_or(record);
        if record.flags.contains(SymbolFlags::METHOD) {
            collect_method_used_as_value(probe, record, id, &mut wrapped, &mut bound);
            continue;
        }
        if !record.flags.contains(SymbolFlags::FUNCTION) {
            continue;
        }
        for declaration in &record.declarations {
            if probe.kind_of(*declaration) != Some(syntax::FUNCTION_DECLARATION) {
                continue;
            }
            // The name in `function finish(...)` is an identifier for the same
            // symbol, and declaring a function is not using it as a value.
            if node.parent == Some(*declaration) {
                continue;
            }
            // **A nested declaration that captures is already a closure, and
            // that closure IS its value.** A wrapper for one forwards to the
            // declared name, and there is no function of that name -- so the
            // wrapper compiled and `Closure1#call` called `inner`, "which
            // nothing in this program defines". Read after its declaration the
            // binding holds the closure and the wrapper was never reached; read
            // before it, the wrapper was reached and was wrong. Now neither
            // exists, and a read before the declaration refuses by name.
            if taken_as_a_closure(closures, *declaration) {
                continue;
            }
            if !wrapped.contains(declaration) {
                wrapped.push(*declaration);
            }
        }
    }
    // A shorthand property is a use as a value that the loop above cannot see.
    //
    // It tests `node.symbol` for `FUNCTION`, and `{ lowers }` is one node whose
    // symbol is the *property's* -- so a function named there is never wrapped,
    // and the reference has nothing to resolve to. The same fact that makes
    // `shorthand_value_symbol` resolve by name makes this have to.
    //
    // By name against the function symbols, and only those: a shorthand naming
    // a local or a global needs no wrapper, and this list is the one that
    // decides which programs carry a closure table at all.
    let spelled: Vec<&str> = snapshot
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| node.kind == NodeKind::Syntax(syntax::SHORTHAND_PROPERTY_ASSIGNMENT))
        .filter_map(|(index, _)| {
            let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
            let [name] = probe.children(id)[..] else {
                return None;
            };
            snapshot
                .nodes
                .get(name.0 as usize)?
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
        })
        .collect();
    if !spelled.is_empty() {
        for record in &snapshot.symbols {
            if !record.flags.contains(SymbolFlags::FUNCTION)
                || !record
                    .name
                    .public_name()
                    .is_some_and(|name| spelled.contains(&name))
            {
                continue;
            }
            for declaration in &record.declarations {
                if probe.kind_of(*declaration) == Some(syntax::FUNCTION_DECLARATION)
                    && !taken_as_a_closure(closures, *declaration)
                    && !wrapped.contains(declaration)
                {
                    wrapped.push(*declaration);
                }
            }
        }
    }

    closures.extend(
        wrapped
            .into_iter()
            .map(|declaration| function_value(snapshot, probe, declaration)),
    );
    // A method whose body reads `this` takes the call's, as a `function` does: a
    // read does not bind it ([`FuncBuilder::method_receiver`]).
    closures.extend(bound.into_iter().map(|declaration| ClosureInfo {
        reads_this: uses_its_receiver(probe, declaration),
        source: ClosureSource::Method,
        ..ClosureInfo::as_written(declaration)
    }));
}

/// The closure a declared function is wrapped in where it is used as a value.
/// One that reads its own `this` takes the call's, so its wrapper does too, and
/// hands it on ([`FuncBuilder::wrapped_call`]).
fn function_value(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    declaration: NodeId,
) -> ClosureInfo {
    let reads_this = probe.declaration_reads_this(probe.implementation_of(declaration));
    ClosureInfo {
        source: ClosureSource::Function,
        reads_this,
        refusal: (reads_this && is_generic_function(snapshot, declaration))
            .then_some(A_GENERIC_DECLARATION_READING_THIS),
        ..ClosureInfo::as_written(declaration)
    }
}

/// The symbol a `const` declaration's initializer names: `const alias = apply`,
/// `const typed: (n: number) => number = apply`, and either through an
/// assertion. `None` for anything else.
pub(super) fn const_alias_of(probe: &FuncBuilder, declaration: NodeId) -> Option<u32> {
    if probe.kind_of(declaration) != Some(syntax::VARIABLE_DECLARATION)
        || probe.declaration_kind(declaration) != nts_semantic_schema::VariableKind::Const
    {
        return None;
    }
    let name = probe.name_node(declaration)?;
    let initializer =
        declaration_initializer(&probe.children(declaration), name, |id| probe.kind_of(id))?;
    let initializer = probe.through_assertions(initializer);
    if probe.kind_of(initializer) != Some(syntax::IDENTIFIER) {
        return None;
    }
    Some(probe.denoted_symbol(probe.node(initializer).symbol?).0)
}

/// Every `const` alias in the program, as `(alias, named)` symbols: what
/// [`with_const_aliases`](super::structural_copies::with_const_aliases) reads within one body, read over the whole program
/// for the throw analysis.
pub(super) fn const_function_aliases(probe: &FuncBuilder) -> Vec<(u32, u32)> {
    (0..probe.snapshot.nodes.len())
        .filter_map(|at| {
            let declaration = NodeId(u32::try_from(at).ok()?);
            let named = const_alias_of(probe, declaration)?;
            Some((probe.node(probe.name_node(declaration)?).symbol?.0, named))
        })
        .collect()
}

/// The function a chain of `const` aliases ends at, where `symbol` is such an
/// alias: `apply` for `typed` in `const alias = apply; const typed: F = alias`.
/// `None` where `symbol` is not a `const` alias, or the chain ends anywhere but
/// a declaration with a body.
///
/// Follow the complete finite symbol chain. A cycle contains no terminal
/// body, and is detected by identity rather than by an arbitrary hop count.
pub(super) fn function_behind_const(probe: &FuncBuilder, symbol: u32) -> Option<NodeId> {
    let record = |symbol: u32| probe.snapshot.symbols.get(symbol as usize);
    let mut at = const_alias_of(probe, *record(symbol)?.declarations.first()?)?;
    let mut seen = rustc_hash::FxHashSet::default();
    while seen.insert(at) {
        let declarations = &record(at)?.declarations;
        if let Some(function) = declarations
            .iter()
            .find(|at| names_a_body(probe.kind_of(**at)))
        {
            return Some(*function);
        }
        at = const_alias_of(probe, *declarations.first()?)?;
    }
    None
}

/// Every eligible function this program mentions somewhere other than as a callee.
///
/// The functions lowering turns into a closure of its own: a name in an argument, an
/// initialiser, a field. Read as "an identifier naming one, that is not the callee of
/// a call", because the callee position is the one place a mention is *not* a value
/// -- and that is the only distinction available without parents.
pub(super) fn functions_used_as_values(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    eligible: &rustc_hash::FxHashSet<NodeId>,
) -> Vec<NodeId> {
    // The positions where naming a function is **not** using it as a value: the
    // callee of a call, and the declaration's own name.
    //
    // **Without the second, every eligible function matched** -- `function thrower()`
    // writes an identifier bound to `thrower` that is in no callee position -- so the
    // seed became "every eligible function" and cost **+1,341 refusals** across the
    // 29 corpora, indistinguishable from the blunt rule it exists to avoid. The
    // measurement is what said so: two rules with the same number are one rule.
    let mut excluded: rustc_hash::FxHashSet<NodeId> = rustc_hash::FxHashSet::default();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if matches!(
            node.kind,
            NodeKind::Syntax(
                syntax::CALL_EXPRESSION
                    | syntax::NEW_EXPRESSION
                    | syntax::TAGGED_TEMPLATE_EXPRESSION
            )
        ) {
            let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
            // **The callee's own name, which for a member call is the member.**
            // `check.same(x)` has a property access in the callee position, so
            // excluding the callee *node* left the identifier `same` inside it reading
            // as a mention of a value -- and a namespaced or method-shaped callee is
            // the commonest spelling in the test262 harness (`assert.sameValue`).
            //
            // It cost 71 cases of `test262-cases`, one of them a pass, and only once
            // `copies` held implementations rather than overload signatures: before
            // that the stray identifier answered `same`'s *signature*, which was in
            // the set, so the over-approximation was invisible. A false member of one
            // set hid a false member of another.
            //
            // **The name and not the whole callee expression**, which was the first
            // version and under-approximates: in `f.call(x)` or `(cond ? f : g)(x)`
            // the inner `f` genuinely *is* used as a value, and excluding every
            // identifier under the callee would hide it. Those shapes refuse today
            // for other reasons, which is exactly why the rule must not rest on them
            // -- an under-approximation here is a wrapper closure with no raising
            // body, which is a run-time escape rather than a refusal.
            let Some(callee) = probe.children(id).first().copied() else {
                continue;
            };
            match probe.kind_of(callee) {
                Some(syntax::IDENTIFIER) => {
                    excluded.insert(callee);
                }
                Some(syntax::PROPERTY_ACCESS_EXPRESSION) => {
                    excluded.extend(probe.children(callee).last().copied());
                }
                // A computed callee (`fns[0]()`) names nothing, and anything else --
                // a parenthesised expression, a call, a conditional -- holds its
                // operands as values and is left alone.
                _ => {}
            }
        }
    }
    // **The declaration's name, which is not always its first child.** `export
    // function f()` puts the modifier there, so excluding `first()` left `f`'s own
    // name reading as a mention *of a value* -- and since a function calling a
    // throwing closure is itself in `throwing.any`, every exported function in the
    // program then failed the wrapped test and switched the gate off. The probe that
    // caught it is three exported functions and an IIFE, which is
    // `tests/programs/an-iife-inside-a-try` now.
    //
    // Every identifier child, because a declaration's direct identifier children are
    // its name: parameters are `Parameter` nodes, the body is a `Block`, the return
    // annotation is a type.
    //
    // **Over every declaration in the program rather than over the set passed in**,
    // because an overloaded function's *signatures* are not in that set -- `eligible`
    // holds implementations ([`a_raising_callee_of`]) -- and a signature's own name
    // would then read as a mention of a value, seeding a copy from a declaration
    // nobody used as one. The filter below is what restricts the answer to the set,
    // so excluding a name that is nobody's value costs nothing.
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if !matches!(
            node.kind,
            NodeKind::Syntax(
                syntax::FUNCTION_DECLARATION
                    | syntax::METHOD_DECLARATION
                    | syntax::GET_ACCESSOR
                    | syntax::SET_ACCESSOR
            )
        ) {
            continue;
        }
        let declaration = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        excluded.extend(
            probe
                .children(declaration)
                .into_iter()
                .filter(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER)),
        );
    }
    let mut found = Vec::new();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::IDENTIFIER) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        if excluded.contains(&id) {
            continue;
        }
        // **Not a name an import or an export declaration writes.** `import { f }`
        // and `export { f } from "…"` bind or publish a name and use no value --
        // and once the
        // symbol below goes through the import to the function, the specifier's
        // own identifier read as a use of it: every imported throwing function
        // was "used as a value", had no raising copy for it, and withheld every
        // call through a closure inside a `try` in the program (the Chromium
        // lane's probe, 2026-10-08: `idlTranscript`, called directly once, and
        // `ntsChromiumDomProgram`, re-exported).
        // `collect_function_values` skips the import specifier for the same reason.
        if matches!(
            node.parent.and_then(|parent| probe.kind_of(parent)),
            Some(syntax::IMPORT_SPECIFIER | syntax::EXPORT_SPECIFIER)
        ) {
            continue;
        }
        // **Through an import to what it names**, as every other reader of a callee
        // does: `import { literalFirst }` binds an alias whose only declaration is the
        // specifier, so an imported function used as a value seeded nothing, got no
        // copy, and its wrapper's raising entry aborted by name inside every `try`.
        let Some(symbol) = node
            .symbol
            .and_then(|it| snapshot.symbols.get(probe.denoted_symbol(it).0 as usize))
        else {
            continue;
        };
        found.extend(
            symbol
                .declarations
                .iter()
                // Through `implementation_of` for [`a_raising_callee_of`]'s reason: a
                // set keyed on the declaration a copy is made of must be asked with
                // that declaration, and an overloaded function's signatures are not
                // it. Without this a genuine value-use of an overloaded function --
                // `const f = same` -- asked for all three and got `false` for two.
                .map(|at| probe.implementation_of(the_function_of(probe, *at)))
                .filter(|declaration| eligible.contains(declaration)),
        );
    }
    found
}

/// A closure of its own for each closure a structural copy re-types a
/// capture of. See `ClosureInfo::within`.
///
/// For every copy `(declaration, retyped, suffix)`, every closure written
/// inside `declaration` that captures a parameter the copy re-typed gets a
/// variant: same node and captures, `within` the copy, the re-typed captures
/// at the copy's types. Closures that capture nothing the copy changed serve
/// every copy as written. Appended after the closures as written, so every
/// lookup that takes the first closure at a node keeps finding the plain one.
pub(super) fn closure_variants(
    probe: &FuncBuilder,
    closures: &[ClosureInfo],
    structural: &Structural,
) -> Vec<ClosureInfo> {
    let mut variants = Vec::new();
    let mut copies: Vec<(&NodeId, &Vec<(Retyped, String)>)> = structural.copies.iter().collect();
    copies.sort_by_key(|(declaration, _)| declaration.0);
    for (declaration, copies) in copies {
        for (retyped, suffix) in copies {
            let retyped_symbols = retyped_symbols_of(probe, *declaration, retyped);
            if retyped_symbols.is_empty() {
                continue;
            }
            for closure in closures {
                if closure.within.is_some() || !probe.is_within(closure.node, *declaration) {
                    continue;
                }
                let retyped_captures: std::collections::BTreeMap<u32, HirType> = closure
                    .captures
                    .iter()
                    .filter_map(|capture| {
                        let ty = retyped_symbols.get(&capture.symbol)?;
                        Some((capture.symbol, ty.clone()))
                    })
                    .collect();
                if retyped_captures.is_empty() {
                    continue;
                }
                variants.push(ClosureInfo {
                    within: Some(suffix.clone()),
                    retyped_captures,
                    ..closure.clone()
                });
            }
        }
    }
    variants
}

/// A copy of every closure written inside a generic class, one per copy of it.
///
/// **A closure body is lowered once, in a builder of its own**, and that
/// builder had no substitution — so a `this` captured inside
/// `ByteTeeBranch<18494>` was *stored* at the copy's type and *read* at the
/// declaration's, and `zlib` emitted
///
/// ```text
/// NtsObj_ByteTeeBranch * v2;
/// v2 = v0->this;      // the field is a NtsObj_ByteTeeBranch_18494_ *
/// ```
///
/// which clang refuses. `captured_as` is the one derivation both sides use and
/// it answers `type_of(capture.at)` — correct in each builder, and the two
/// builders disagreed about what the enclosing class was.
///
/// Same shape as the structural variants beside it, one axis over: there the
/// copy re-types a *parameter* and the variant records which, here the copy
/// binds a *type parameter* and the variant is lowered under its
/// substitution. `retyped_captures` stays empty because nothing is re-typed
/// name by name — the substitution answers every capture at once.
pub(super) fn class_closure_variants(
    probe: &FuncBuilder,
    closures: &[ClosureInfo],
    copies: &[ClassCopy],
) -> Vec<ClosureInfo> {
    let mut copies: Vec<&ClassCopy> = copies.iter().collect();
    // Sorted, so one compiler on one input numbers the closures one way.
    copies.sort_by(|a, b| (a.declaration.0, &a.suffix).cmp(&(b.declaration.0, &b.suffix)));
    let mut variants = Vec::new();
    for copy in copies {
        for closure in closures {
            if closure.within.is_some() || !probe.is_within(closure.node, copy.declaration) {
                continue;
            }
            // A closure the structural pass already varied keeps that
            // variant: its suffix is the structural copy's, and the two
            // mechanisms name different things.
            //
            // **The copy travels with the variant.** It was looked up again at
            // lowering time, by suffix, in a map two declarations could collide
            // in -- see `class_copies`. The right copy is in hand here, which is
            // the only place it is not ambiguous.
            variants.push(ClosureInfo {
                within: Some(copy.suffix.clone()),
                within_copy: Some(copy.clone()),
                ..closure.clone()
            });
        }
    }
    variants
}

impl ClassCopy {
    /// The generic *function* copy this is, where it is one.
    ///
    /// A class's copy is identified by its instantiation, which is a `TypeId`; a
    /// function's by its declaration and suffix, because a function
    /// instantiation is not a type. `Copy` carries both fields for the same
    /// reason. See `generics::GenericFunctions::at_call_in_copy`.
    pub(super) fn function(&self) -> Option<NodeId> {
        self.instance.is_none().then_some(self.declaration)
    }
}

impl FuncBuilder<'_> {
    /// Whether a symbol's binding is created afresh on every loop iteration.
    ///
    /// True only for a `for` statement's *own* variable -- `for (let i = 0;
    /// ...)`. A `let` in the body is a different declaration each time round
    /// anyway, so it needs nothing special; this is about the one the loop
    /// header owns, which JavaScript rebinds per iteration even though it is
    /// written once.
    /// The loop whose *head* declares this name, where one does.
    ///
    /// This replaced an `is_per_iteration` returning a bool, which had exactly
    /// one caller and that caller now wants the loop as well as the answer.
    /// Keeping both would be two walks of one question by one rule, which is
    /// how the two come to disagree; the bool is `.is_some()` and costs nothing
    /// to spell at the call site.
    ///
    /// Up from the declaration to the loop that owns it, stopping at the first
    /// block. A loop's header has no block between it and the declaration; a
    /// `let` in the body is inside one, and that one is a fresh declaration
    /// every time round anyway.
    pub(super) fn per_iteration_loop(&self, record: &SymbolRecord) -> Option<(NodeId, NodeId)> {
        record.declarations.iter().find_map(|declaration| {
            self.binding_parents(*declaration).find_map(|parent| {
                matches!(
                    self.kind_of(parent),
                    Some(syntax::FOR_STATEMENT | syntax::FOR_OF_STATEMENT)
                )
                .then_some((parent, *declaration))
            })
        })
    }

    /// What to do with a capture of a name a `for` loop's head declares.
    ///
    /// Three outcomes rather than two, which is the whole of the change made on
    /// 2026-09-13 and the reason this is a function returning [`Rebinding`]
    /// rather than a condition returning a bool.
    ///
    /// **Copying is exact, not an approximation.** `for (let i = …)` copies the
    /// binding *before* each iteration and runs the increment in the copy, so
    /// iteration k's binding keeps iteration k's value for ever. A closure made
    /// in the body and reading `i` must see that value, and the value `i` holds
    /// where the closure is built **is** that value.
    ///
    /// The rule this replaced asked whether the name was written *anywhere*. A
    /// counter is written by its own `i++` in every loop ever written, so that
    /// question refused every loop in order to catch the rare one:
    ///
    /// ```text
    /// for (let i = 0; i < 3; i++) { fns.push(() => i); i += 10; }
    /// ```
    ///
    /// where the write lands in the binding the closure is already holding, so
    /// node answers 10 for `fns[0]()` and a copy answers 0. That is the case
    /// the refusal was always for, and asking about the **body** is how to say
    /// it.
    ///
    /// **`var` is not this, and the distinction carries the correctness.** It
    /// has one binding for the whole loop, so every closure must see the value
    /// the loop *ended* on -- 3 where `let` gives 0. The old rule was safe here
    /// by accident, walking to the enclosing `for` without asking which keyword
    /// wrote it; that over-refusal was recorded as costing nothing, with seven
    /// ambient `var`s in `runtime/node` and none in a loop beside it. It was
    /// the only thing between `var` and a wrong answer once `let` was narrowed.
    /// A shared cell is probably right for `var` and is unmeasured, and with
    /// zero sites there is nothing to check it against.
    ///
    /// `below` keeps its refusal: a name declared after the arrow that reads it
    /// has no value to copy where the closure is built, whatever the loop does.
    fn rebinding_refusal(&self, record: &SymbolRecord, symbol: u32, below: bool) -> Rebinding {
        let Some((owner, declaration)) = self.per_iteration_loop(record) else {
            return Rebinding::NotTheLoops;
        };
        if self.declaration_kind(declaration) == nts_semantic_schema::VariableKind::Var {
            return Rebinding::Refused(
                "a closure over a `for` loop's `var`, which JavaScript does \
                 not rebind per iteration",
            );
        }
        if below || self.written_in_the_body_of(owner, symbol) {
            return Rebinding::Refused(
                "a closure over a `for` loop's own variable that the loop's \
                 body also writes, which JavaScript rebinds on every iteration",
            );
        }
        Rebinding::CopyIsExact
    }
}
