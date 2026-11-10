//! Describe semantic types and attribute lowering refusals.

use super::{
    Copy, Diagnostic, FuncBuilder, HirType, LiteralValue, Lowered, LoweringSnapshot, ManagedType,
    Nameless, NodeId, OpKind, Origin, SemanticSnapshot, Shared, SymbolFlags, SymbolId, Terminator,
    TypeId, TypeKind, TypeRecord, ValueId, construction, contains_kind, feature_of, has_finally,
    is_anonymous_shape, kind_at, named, provided, qualified_name, syntax, uninstantiated, walk,
};

/// A scalar where a reference is wanted, or the reverse.
pub(super) fn representation_mismatch(have: &HirType, want: &HirType) -> String {
    format!(
        "{} where {} is wanted",
        representation_word(have),
        representation_word(want)
    )
}

/// A machine type, in words a reader can act on.
///
/// `{ty:?}` put Rust's `Debug` into a user-facing diagnostic: *a value of type
/// Never where Managed(Object(TypeId(16))) is wanted*. `TypeId(16)` names
/// nothing a program contains, and the sentence cannot be searched for either,
/// because every occurrence carries a different number.
///
/// Deliberately coarse. This message is about a **representation** mismatch — a
/// scalar where a reference is wanted, or the reverse — so the useful thing to
/// say is which side of that line each type falls, not which object type it is.
/// `describe` is the function for naming a *checker* type, and it is the right
/// one wherever the node's own type is what went wrong.
pub(super) fn representation_word(ty: &HirType) -> &'static str {
    match ty {
        HirType::Void => "nothing",
        HirType::Never => "a value that cannot exist",
        HirType::NativePointer(_) => "a native pointer",
        HirType::Bool => "a boolean",
        HirType::Int { .. } => "an integer",
        HirType::Float { .. } => "a number",
        HirType::BigInt => "a bigint",
        HirType::Erased => "an erased value",
        HirType::PossiblyUndefined(_) => "a possibly undefined value",
        HirType::Managed(managed) => managed_word(managed),
    }
}

/// The reference half of [`representation_word`].
fn managed_word(managed: &ManagedType) -> &'static str {
    match managed {
        ManagedType::BoxedBigInt => "owned bigint storage",
        ManagedType::String => "a string",
        ManagedType::Object(_) => "an object",
        ManagedType::Array(_) => "an array",
        ManagedType::Template => "an immutable template object",
        ManagedType::Promise(_) => "a promise",
        ManagedType::Map(_, _) => "a map",
        ManagedType::Table(_, _) => "a table",
        ManagedType::Set(_) => "a set",
        ManagedType::Date => "a date",
        ManagedType::Region => "a region's handle",
        ManagedType::Buffer => "a buffer",
        ManagedType::View(_) | ManagedType::AnyView => "a typed array",
        ManagedType::DataView => "a data view",
        ManagedType::Symbol => "a symbol",
    }
}

/// Lower every function declaration in a snapshot.
#[must_use]
/// Two functions of one name in one file, which the emitted C cannot hold.
///
/// Extracted from `lower_with` rather than inlined: the emission loop reads as
/// a list of reasons a declaration produces no copy, and each reason answering
/// in one line is what makes the list legible.
pub(super) fn ambiguous_name(snapshot: &LoweringSnapshot<'_>, id: NodeId) -> Diagnostic {
    let name = FuncBuilder::probe(snapshot)
        .declared_name(id)
        .unwrap_or_else(|| "?".to_owned());
    FuncBuilder::probe(snapshot).unsupported(
        id,
        &format!("a second function named `{name}` in the same file"),
    )
}

/// Why a generic function produced no copy, where that is worth saying.
///
/// **An empty answer is two different things and only one of them is silence
/// worth keeping.** A generic nothing calls and nothing exports is dead, and
/// reporting it would refuse a program nobody wrote. The other two cases used
/// to be silent as well, and should not have been:
///
/// - a call *reached* the declaration and left a type parameter unbound, so the
///   function cannot be emitted and every caller cascades off it;
/// - the module **exports** it, so the surface promises a name that no copy can
///   fill.
///
/// The second is `blockers/a-generic-rest-that-is-used`, whose expectation is an
/// *absence* because there was no message to name. The first is `asRequest` in
/// `fs`, which sat at the head of the node profile for a day carrying 26 lines
/// of "calls `asRequest`, which was refused above" with no refusal above --
/// invisible to every census, because a census reads diagnostics.
///
/// `None` for the dead case, which is the one that was right all along.
/// Report and record a generic no call pins down, and say whether that is what
/// this declaration is.
///
/// **The emitted name, asked the one way the copy path asks it.** This recorded
/// `None`, which is the bare declared name only, so a generic declared in two
/// modules -- qualified as `isReadableStream@readable` everywhere a caller names
/// it -- was filed under a spelling no cascade uses. The record carried a real
/// cause and 36 cascade lines said "refused above" instead of printing it.
///
/// No copy exists here, which is what `copies.is_empty()` means at the call site,
/// so the builder is a default one made to ask a naming question and dropped.
/// Reading `naming.qualified` directly would be a second derivation of the very
/// name this exists to get right.
pub(super) fn an_uninstantiated_generic(
    snapshot: &LoweringSnapshot<'_>,
    shared: &Shared,
    foreign: &crate::hir::runtime::ForeignTable,
    lowered: &mut Lowered,
    id: NodeId,
) -> bool {
    let Some(diagnostic) = uninstantiated(snapshot, &shared.generics, id) else {
        return false;
    };
    note_a_refused_function(snapshot, shared, foreign, lowered, id, diagnostic);
    true
}

/// The conservation law, enforced rather than merely measured: every function the
/// checker knows about is either lowered or refused, and never neither.
/// [`crate::hir::unaccounted`] explains why that is worth asking; this is what happens
/// when the answer is no.
///
/// A construct marked "not done" has to be *refused*. Several were silently absent
/// instead -- a method of a class expression is the clearest, since nothing walks a
/// class expression at all -- and a function that vanishes takes its callers'
/// correctness with it while the compiler reports success.
///
/// **It asks both halves of "was this refused", and for one commit it asked one.**
/// The top-level loop fills `refused` as it goes; a refused *member* is recorded by
/// [`note_member`], which is nowhere near that set, so the law was asking a question
/// only half the refusals could answer. `unaccounted` has a second escape that hides
/// it -- a declaration some diagnostic's span *covers* -- which saves every member
/// whose offending construct is in its own body.
///
/// The case that gets past both is what this cost: `Performance#constructor` refuses
/// for a `WeakRef` property declared in **another file**, so no span covered it, and
/// one run of `perf_hooks` printed `an anonymous declaration outside every walk` at
/// `performance.ts:123` *and* `this module-scope statement was dropped because it
/// calls `Performance#constructor`, which was refused above` at line 259. Two
/// messages about one function, one of them false -- and the false one says the
/// function has no cause, which is what sent the node lane after a mechanism that
/// does not exist.
///
/// Extracted when `lower_with` reached 101 lines, and the concept is worth the name:
/// this is the only place that turns "nothing accounted for this" into a diagnostic.
pub(super) fn report_unaccounted(
    snapshot: &SemanticSnapshot,
    lowered: &mut Lowered,
    generics: &crate::hir::generics::GenericFunctions,
    refused: &mut rustc_hash::FxHashSet<NodeId>,
) {
    refused.extend(lowered.refused_at.iter().copied());
    for (location, name) in crate::hir::unaccounted(
        snapshot,
        &lowered.program,
        &lowered.diagnostics,
        generics,
        refused,
    ) {
        lowered.diagnostics.push(Diagnostic::error(
            "NTS1001",
            match &name {
                Some(name) => format!("`{name}`, a declaration outside every walk"),
                None => "an anonymous declaration outside every walk".to_owned(),
            },
            location,
        ));
    }
}

/// Report a refusal of a whole function declaration **and record it**.
///
/// Two sites reach here and one of them recorded nothing at all. `refused_by_name`
/// pushed its diagnostic and never told `uncompiled`, so `stream`'s `map` --
/// refused as "a `finally` that spans a `yield`, which is iterator closing" -- was
/// printed and never written down, and `filter` and `forEach`, which call it, said
/// "which nothing in this program defines" about a function refused for a stated
/// reason. The Assistant lane's `integrity` counted that family: it is most of the
/// 200 cascade lines that blamed a plain function with no record, the generator
/// fixtures' `guarded` among them.
///
/// The emitted name, for the reason `b95a02b13` and `f00d70011` give: the record's
/// key has to be the name a caller writes. Neither site has a copy, so the builder
/// is a default one made to ask that question and dropped.
pub(super) fn note_a_refused_function(
    snapshot: &LoweringSnapshot<'_>,
    shared: &Shared,
    foreign: &crate::hir::runtime::ForeignTable,
    lowered: &mut Lowered,
    id: NodeId,
    diagnostic: Diagnostic,
) {
    let asking = shared.builder(snapshot, foreign, Copy::default());
    let emitted = asking.emitted_function_name(id);
    note_uncompiled(
        snapshot,
        &mut lowered.program,
        id,
        emitted.as_deref(),
        &diagnostic,
    );
    lowered.diagnostics.push(diagnostic);
}

/// Record why a function was not compiled, for every later reader to say.
///
/// Written where the refusal happens rather than reconstructed afterwards: the
/// name and the reason are decided in one place, so nothing can pair them
/// wrongly. Only *named* declarations are kept -- an anonymous or synthetic
/// function has no export to explain.
///
/// One entry per name. A generic with several copies can refuse more than once
/// and the first reason is as good as the fifth; a list of five would read as
/// five problems.
///
/// **This doc comment was attached to [`qualified_name`]**, which was inserted
/// between it and this function -- so the sentence "record why a function was not
/// compiled" documented a function that computes a name, and this one had none.
/// Worth a line because the two are read together and a misfiled doc sends the
/// reader to the wrong half.
/// Record a refused class or object-literal member under the name it would have
/// been **emitted** as.
///
/// The name is what decides whether the entry is ever found again: a caller and a
/// dispatch table both hold `Owner<12971>#member`, and passing `None` to
/// `note_uncompiled` recorded `qualified_name`'s `Owner#member` instead -- the
/// class's instantiation suffix is `class_name_for`'s to supply and
/// `qualified_name` has no way to know it. So the entry was written and never
/// found: a cascade through such a member says "refused above" about something
/// `nts refusals` cannot show, and a dispatch slot goes null with no diagnostic.
/// `runtime/node/http`'s `OutgoingMessage<12971>#destroy` is in the prepared HIR,
/// in no emitted C, and named by neither refusal record.
///
/// A free function taking the builder so each of the five sites stays one line.
/// The snapshot comes from the builder rather than beside it, because two ways to
/// reach one snapshot is how a caller ends up passing a different one.
///
/// **And the node, beside the name.** Taking `Lowered` rather than `Program` is
/// the whole of that: the name is what a cascade finds the entry by, and the
/// node is what the conservation law asks with, and writing one without the
/// other is how `unaccounted` came to report a function whose cause the same
/// run printed. See [`Lowered::refused_at`].
pub(super) fn note_member(
    builder: &mut FuncBuilder<'_>,
    lowered: &mut Lowered,
    owner: NodeId,
    member: NodeId,
    instance: Option<TypeId>,
    diagnostic: &Diagnostic,
) {
    let snapshot = builder.snapshot;
    let emitted = builder
        .emitted_member_name(owner, member, instance)
        .ok()
        .map(|(_, emitted)| emitted);
    note_uncompiled(
        snapshot,
        &mut lowered.program,
        member,
        emitted.as_deref(),
        diagnostic,
    );
    lowered.refused_at.insert(member);
}

pub(super) fn note_uncompiled(
    snapshot: &LoweringSnapshot<'_>,
    program: &mut crate::hir::Program,
    id: NodeId,
    emitted: Option<&str>,
    diagnostic: &Diagnostic,
) {
    // **The qualified name first, and independently of the simple one.**
    // `uncompiled` is keyed by `declared_name`, which is syntax: `parse`,
    // `constructor`. Every reader asks in the lowering's vocabulary --
    // `Catalog#parse`, `Readable#constructor` -- so a refused class member was
    // recorded and never found again.
    //
    // Two separate faults sat in the order this used to be written in, and the
    // second hid behind the first:
    //
    // **A constructor has no declared name at all.** `declared_name` returns
    // the text of the first `IDENTIFIER` child and `constructor` is a keyword,
    // so this function returned at its first line and recorded *nothing* --
    // not the qualified name, not the simple one. The `CONSTRUCTOR` arm in
    // `qualified_name` was therefore dead code from the day it was written.
    // Measured 2026-09-15 on `stream`: `uncompiled` was **empty** for a fixture
    // whose constructor refuses with a named cause, and seven declines in that
    // module said only "is a class whose constructor was not compiled" --
    // including `Readable`, whose export is the single most-named thing in the
    // module's failing tests.
    //
    // **And the simple name short-circuited the qualified one.** Returning
    // early when the *bare* name was already present meant the second class to
    // refuse a member called `parse` never got its `B#parse` entry, because
    // `parse` was taken. `stream` refuses four constructors; on the old order
    // at most one could ever have been recorded.
    //
    // So each name is recorded on its own, deduplicated on itself -- and a
    // member records its *qualified* name **instead of** its bare one, which
    // is the correction below.
    let declared = FuncBuilder::probe(snapshot).declared_name(id);
    // Read before `record` borrows the program, because it decides whether the
    // bare name is recorded at all. `qualified_name` answers `Some` for a
    // method or a constructor inside a class and `None` for everything else,
    // so it *is* the test for "this is a class member".
    let qualified = qualified_name(snapshot, id, declared.as_deref());
    let mut record = |at: String| {
        // **Never claim a name the program emits.** This list answers "why is
        // there no function called X", so an entry for a name that *is* there is
        // not a missing cause, it is a **false** one -- and the readers act on
        // it: `emit-c`'s `published_symbols` excludes such a name from
        // "published without a symbol", and the cascade prints its reason as the
        // cause of a call to it.
        //
        // The witness is a **structural copy**, and it took a corpus scan to
        // find: `blockers/an-options-bag-widened-by-assignment` records
        // `make@0obj6` with a real refusal and, beside it, a bare `make` with the
        // same sentence -- while `func make(options: managed<obj#8>)` is in the
        // output, because a `Wide` reaching a `Wide` needs no cast. The copy is
        // refused and the original is fine, and `emitted` is the copy's name
        // while `declared_name` is the original's. `programs/copy-phantom` is
        // that shape in miniature.
        //
        // **Why this is a test of `funcs` rather than a rule about suffixes.**
        // Not recording the bare name whenever `emitted` differs from it would
        // also cover the copy case -- and it would take out the case
        // `note_uncompiled` was written for: an exported *generic* has no plain
        // body, every copy carries a suffix, and the napi wrapper asks with the
        // export name. That was 19 of `fs`'s 23 rootless wrappers. A generic's
        // bare name is not in `funcs`, so it is still recorded here.
        //
        // The ordering this depends on, stated because it is not obvious: a
        // function emitted *after* this call could still leave a stale entry.
        // For the case above it cannot -- `function_copies` puts the plain copy
        // first and the loop lowers them in order, so the original is already in
        // `funcs` when a later copy refuses.
        if program.funcs.iter().any(|func| func.name == at) {
            return;
        }
        if !program
            .uncompiled
            .iter()
            .map(|entry| (&entry.name, &entry.reason))
            .any(|(had, _)| *had == at)
        {
            program.uncompiled.push(crate::hir::Uncompiled::refused(
                at,
                diagnostic.message.clone(),
            ));
        }
    };
    // **The emitted name first, because that is the one every asker uses.** A
    // call names `asRequest<[erased]x2>` and `declared_name` answers
    // `asRequest`, so the entry was recorded and never found: the cascade fell
    // to its fallback and the napi wrapper printed `which was refused above`
    // about a refusal that had been recorded with its cause. 19 of `fs`'s 23
    // remaining rootless wrappers were this one function.
    //
    // Per copy rather than per declaration, and that is not incidental: a copy
    // is a body, `asRequest` refuses in eight of them, and the reasons can
    // differ. Collapsing them onto one key is what lost them.
    //
    // `None` from a class member, whose emitted name is built by
    // `lower_method_of` from `class_name_for` and carries the *class's*
    // instantiation suffix instead. `qualified_name` covers the `Owner#member`
    // half of that and the instantiation half is a smaller, separate gap.
    if let Some(emitted) = emitted {
        record(emitted.to_owned());
    }
    // **A class member does not claim the bare member name**, and the sentence
    // this replaced said the opposite: "both are kept rather than the bare one
    // dropped". Keeping both makes this list a single flat namespace in which
    // `Holder#names` and a module-scope `function names` are one key, first
    // writer wins -- and the cascade *prints* what it finds there as the cause.
    //
    // Two consequences, both measured on 2026-09-26 with seventeen lines:
    //
    //     class Holder { names() { const p = /a+/; return p.source.length; } }
    //     function names() { return Object.getOwnPropertyNames(globalThis).length; }
    //     export function caller() { return names(); }
    //
    // `nts refusals` printed ``caller  it calls `names`, and a regular
    // expression literal ...`` -- about a function containing no regular
    // expression -- and the reflection refusal that is `names`' actual cause
    // appeared nowhere. With the method's body the only refusal, the bare entry
    // is a **phantom**: `tag` was in `program.c` while `uncompiled` claimed it
    // was refused, so a reader asking why an export is missing gets an answer
    // about one that is present.
    //
    // It cost a night. The raising-copy experiment lost 48 functions in
    // `runtime/node/http` and every one of them read "a super keyword is not
    // supported by this lowering yet" -- `EventEmitterAsyncResource#emit`'s
    // reason, arriving under the bare key `emit`, while the function actually
    // missing was the *top-level* `emit` in `internal/async-hooks.ts` whose own
    // cause was dropped. A design for `super.m` as a value was written against
    // that reading before the collision was found.
    //
    // **Nothing needs a member's bare name**, which is what makes this safe
    // rather than a trade: `emit-c`'s `refused_by_lowering` matches an export
    // name or a `Owner#` prefix, the napi wrapper asks `{name}#constructor` and
    // export names, and the cascade asks the callee's *emitted* name, which for
    // a method is `Owner#member`. The bare name stays for a top-level function,
    // which is the one vocabulary where it is the emitted name.
    //
    // `blockers/a-static-that-shadows-a-refused-function` is the same defect one
    // member kind over -- a `static readonly f = f` publishing the static's
    // reason against a module-scope `function f` -- and its guard is in
    // `ModuleScope::unsupported` rather than here, because that one collides
    // over a *global*'s name and this one over a function's.
    match qualified {
        Some(qualified) => record(qualified),
        None => {
            if let Some(name) = declared {
                record(name);
            }
        }
    }
}

/// A function refused for what its name says, as a diagnostic.
///
/// A probe built for one line, lifted out so the driver loop reads as the
/// dispatch it is.
pub(super) fn refusal_by_name(
    snapshot: &LoweringSnapshot<'_>,
    id: NodeId,
    what: &str,
) -> Diagnostic {
    FuncBuilder::probe(snapshot).unsupported(id, what)
}

/// The name a class or literal member is written with, for a diagnostic.
pub(super) fn member_name_of(snapshot: &SemanticSnapshot, member: NodeId) -> Option<String> {
    snapshot
        .nodes
        .get(member.0 as usize)?
        .children
        .iter()
        .find_map(|child| {
            snapshot
                .nodes
                .get(child.0 as usize)?
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                .map(str::to_owned)
        })
}

/// Give a nested function of a refused function its enclosing function's name,
/// where nothing else has explained it.
///
/// A nested function declared inside a refused body is lowered nowhere, and the
/// cascade through it said only "which nothing in this program defines" -- true,
/// and with nothing in it leading to the reason, which is sitting on the enclosing
/// function's own row. `runtime/node/events` declares `closeHandler` and
/// `errorHandler` inside `export function on(...)`, refused as an exported generic
/// nothing instantiates, while the object literal in the same body still becomes
/// `EventAsyncIterator#return` and calls them.
///
/// **Late, and that is the whole correction over `ffd44917d`.** Recording this at
/// the moment the *outer* refusal is noted made it win: `note_uncompiled` keeps the
/// first entry for a key, so a nested function with a refusal of its own -- a
/// regular expression literal, say -- was described as "declared inside `outer`"
/// and its real cause was lost. Measured with a two-arm probe: an `inner` holding a
/// regex under a refused generic `outer` reported the nesting, while the same
/// `inner` under a compiling outer reported the regex. Here every specific reason
/// has already been recorded, so this fills gaps and overwrites nothing.
///
/// Sorted rather than taken in `FxHashSet` order, so the list this produces does
/// not depend on a hash: `uncompiled` is printed, and a diagnostic whose order
/// varies between runs is the same class of defect as a digest that does.
pub(super) fn attribute_nested_to_their_refused_outer(
    snapshot: &LoweringSnapshot<'_>,
    shared: &Shared,
    foreign: &crate::hir::runtime::ForeignTable,
    lowered: &mut Lowered,
    refused: &rustc_hash::FxHashSet<NodeId>,
) {
    let asking = shared.builder(snapshot, foreign, Copy::default());
    let mut outers: Vec<NodeId> = refused.iter().copied().collect();
    outers.sort_unstable();
    for outer in outers {
        let Some(outer_name) = asking.emitted_function_name(outer) else {
            continue;
        };
        let mut nested = Vec::new();
        walk(snapshot, outer, &mut |child| {
            if child != outer && kind_at(snapshot, child) == Some(syntax::FUNCTION_DECLARATION) {
                nested.push(child);
            }
        });
        for child in nested {
            let Some(name) = asking.emitted_function_name(child) else {
                continue;
            };
            if lowered
                .program
                .uncompiled
                .iter()
                .map(|entry| (&entry.name, &entry.reason))
                .any(|(at, _)| *at == name)
                || lowered.program.funcs.iter().any(|func| func.name == name)
            {
                continue;
            }
            lowered
                .program
                .uncompiled
                .push(crate::hir::Uncompiled::refused(
                    name,
                    format!("it is declared inside `{outer_name}`, which was not compiled"),
                ));
        }
    }
}

/// Drop any refusal record naming a function the finished program contains.
///
/// [`note_uncompiled`] already refuses to claim a name the program emits, because
/// such an entry is not a missing cause but a **false** one -- and the hole was in
/// its *timing*, which its own doc names: "a function emitted **after** this call
/// could still leave a stale entry", argued away for the case it was written for
/// and left open in general.
///
/// `runtime/node/punycode` is the other case. `main.ts:22` re-exports
/// `export const encode = codec.encode`, a module-scope binding holding a function,
/// which is refused and recorded under the bare name `encode` -- while
/// `codec.ts:217`'s `export function encode` is lowered **later** and emitted. So
/// `nts refusals` reported four of that module's exports as refused while the
/// program exports all four.
///
/// Called last, because the condition is the guard's own and only the moment is
/// new: here every function that will be emitted is in `funcs`. A later pass may
/// still drop one, and that stays consistent -- `prepare` pushes the name as it
/// removes it.
///
/// **Not** a place to keep the binding's reason under another key. A global and a
/// function sharing one namespace is what `13d3faba2` answered one layer down for
/// the LLVM symbol, and giving a global its own key would change what
/// `codegen/napi`'s `why_uncompiled` finds when it asks by *export* name. Dropping
/// a false claim needs no such argument.
pub(super) fn drop_refusals_the_program_contradicts(lowered: &mut Lowered) {
    let emitted: rustc_hash::FxHashSet<&str> = lowered
        .program
        .funcs
        .iter()
        .map(|func| func.name.as_str())
        .collect();
    lowered
        .program
        .uncompiled
        .retain(|entry| !emitted.contains(entry.name.as_str()));
}

/// A union member's name, short enough to put several on one line.
pub(super) fn short(snapshot: &SemanticSnapshot, ty: TypeId) -> String {
    let Some(record) = snapshot.types.get(ty.0 as usize) else {
        return "?".to_owned();
    };
    match &record.kind {
        TypeKind::Void => "void".to_owned(),
        TypeKind::Undefined => "undefined".to_owned(),
        TypeKind::Never => "never".to_owned(),
        TypeKind::Boolean => "boolean".to_owned(),
        TypeKind::Number => "number".to_owned(),
        TypeKind::String => "string".to_owned(),
        // A literal's *value* is not what makes a union hard; its
        // representation is. `1 | 2 | 3` and `1 | 2 | 4` are one problem.
        TypeKind::Literal(LiteralValue::Number(_)) => "a number literal".to_owned(),
        TypeKind::Literal(LiteralValue::String(_)) => "a string literal".to_owned(),
        TypeKind::Literal(LiteralValue::Boolean(_)) => "a boolean literal".to_owned(),
        TypeKind::Object { .. } => "an object".to_owned(),
        TypeKind::Array(_) => "an array".to_owned(),
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        TypeKind::NonPrimitive | TypeKind::UniqueSymbol => describe(snapshot, ty),
        _ => describe(snapshot, ty),
    }
}

/// What to call a syntax kind in a refusal.
///
/// "an expression of kind 216" names nothing, and naming the thing is the whole
/// rule for a refusal: it is a *tagged template*, and the difference between
/// those two messages is the difference between a number in a report and an
/// item on a queue. Six of the corpus's refusals were `kind 268`, which is a
/// `namespace`.
///
/// Falls back to the number for a kind the table does not carry, which is what
/// a frontend update that adds one would produce.
pub(super) fn spell(kind: u16, fallback: &str) -> String {
    nts_semantic_schema::syntax::name_of(kind).map_or_else(
        || format!("{fallback} of kind {kind}"),
        |name| {
            // The table humanises a `PascalCase` kind by splitting it into
            // words, which is right for nearly all of them and wrong for the
            // two whose name is a keyword pair rather than English.
            let name = match name {
                "for in statement" => "`for...in` statement",
                "for of statement" => "`for...of` statement",
                other => other,
            };
            let article = if name.starts_with(['a', 'e', 'i', 'o', 'u']) {
                "an"
            } else {
                "a"
            };
            format!("{article} {name}")
        },
    )
}

/// How an operator token is written, for a refusal that has to name it.
///
/// By kind, because a token node carries no text. The number is the fallback
/// rather than the answer: a refusal nobody can group by is a refusal nobody
/// can rank, and "this operator" was twenty-eight of them at once.
pub(super) fn spelling(kind: u16) -> String {
    let named = match kind {
        syntax::QUESTION_QUESTION_TOKEN => "??",
        syntax::AMPERSAND_AMPERSAND_TOKEN => "&&",
        syntax::BAR_BAR_TOKEN => "||",
        syntax::IN_KEYWORD => "in",
        syntax::INSTANCEOF_KEYWORD => "instanceof",
        _ => return spell(kind, "an operator"),
    };
    format!("`{named}`")
}

/// A type's declared name, or `fallback` where it has none.
///
/// Anonymous shapes -- an inline `{ a: number }`, a synthesized instantiation --
/// genuinely have no name to give, and the category is then all there is.
fn named_or(snapshot: &SemanticSnapshot, record: &TypeRecord, fallback: &str) -> String {
    let Some(symbol) = record.symbol else {
        return fallback.to_owned();
    };
    snapshot
        .symbols
        .get(symbol.0 as usize)
        .filter(|declared| {
            declared
                .name
                .public_name()
                .is_some_and(|name| !name.is_empty())
        })
        .map_or_else(
            || fallback.to_owned(),
            |declared| format!("`{}`", declared.name),
        )
}

#[must_use]
pub fn describe(snapshot: &SemanticSnapshot, ty: TypeId) -> String {
    if let Some(name) = crate::hir::native::pointer(snapshot, ty) {
        return format!("an opaque C pointer to {name}");
    }
    let Some(record) = snapshot.types.get(ty.0 as usize) else {
        return "an unknown type".to_owned();
    };
    match &record.kind {
        TypeKind::Any => "any".to_owned(),
        // **What the author wrote, not what the checker called it.** An evolving
        // declaration's source says nothing at all -- `var x;`, `const xs = []` --
        // so naming it "any" in a refusal would quote a word the program does not
        // contain and send its reader looking for one. It would also be the
        // conflation this variant exists to end: after the split, `(any)` in a
        // refusal means a *written* `any`, which has no better answer coming, where
        // this one does and being refused is a gap in the settling.
        //
        // "a **type**", because the phrase composes: it lands inside `(an array of
        // ...)` as well as on its own, and `blockers/pushes-of-disagreeing-types`
        // read "an array of a declaration the checker had not yet settled" until it
        // did.
        TypeKind::Evolving => "a type the checker had not yet settled".to_owned(),
        TypeKind::Unknown => "unknown".to_owned(),
        TypeKind::Null => "null".to_owned(),
        TypeKind::BigInt => "bigint".to_owned(),
        TypeKind::Symbol => "symbol".to_owned(),
        TypeKind::UniqueSymbol => "unique symbol".to_owned(),
        TypeKind::NonPrimitive => "object".to_owned(),
        // Named by its members, because "a union" is a category and the work
        // queue is ordered by what is actually in the corpus. `number |
        // undefined` and `string | number` want different representations, and
        // one refusal message cannot tell them apart.
        TypeKind::Union(members) => {
            let mut named: Vec<String> = members
                .iter()
                .map(|member| short(snapshot, *member))
                .collect();
            named.sort();
            named.dedup();
            format!("a union of {}", named.join(" | "))
        }
        TypeKind::Intersection(_) => "an intersection".to_owned(),
        TypeKind::Tuple(_) => "a tuple".to_owned(),
        TypeKind::Function(_) => "a function type".to_owned(),
        // The native receiver flag distinguishes polymorphic `this` from a
        // user parameter even when their display names happen to match.
        TypeKind::TypeParameter { name, .. } => {
            if let Some(constraint) = snapshot.polymorphic_this_constraint(ty) {
                let owner = named(snapshot, constraint).unwrap_or(name.as_str());
                format!("`this`, which stands for `{owner}` here")
            } else {
                format!("the type parameter `{name}`")
            }
        }
        TypeKind::Conditional { .. } => "a conditional type".to_owned(),
        TypeKind::IndexedAccess { .. } => "an indexed access".to_owned(),
        TypeKind::TemplateLiteral { .. } => "a template literal type".to_owned(),
        // `Map<K, V>` and `Set<T>` spelled with their arguments.
        //
        // The table is the same table whatever it holds, so a refusal naming
        // one is never about the Map -- it is about a key or a value with no
        // representation, and `Map` sends the reader to a feature that is
        // already built. 100 refusals in the node profile said `Map` and could
        // not be grouped by what actually blocks them.
        TypeKind::Object { .. } | TypeKind::Structured
            if matches!(
                provided(snapshot, ty),
                Some("Map" | "Set" | "WeakMap" | "WeakSet")
            ) =>
        {
            let name = provided(snapshot, ty).unwrap_or("Map");
            match snapshot.type_arguments.get(&ty) {
                Some(arguments) if !arguments.is_empty() => {
                    let spelled: Vec<String> = arguments
                        .iter()
                        .map(|argument| short(snapshot, *argument))
                        .collect();
                    format!("`{name}<{}>`", spelled.join(", "))
                }
                // No recorded arguments is its own answer: the frontend stopped
                // at the library boundary before it got them, which is why the
                // representation could not be built either.
                _ => format!("`{name}` with no recorded arguments"),
            }
        }
        TypeKind::Object { .. } => named_or(snapshot, record, "an object type"),
        // Worth distinguishing, because the two are refused for entirely
        // different reasons and only one of them is about *this* type. An
        // ordinary array is refused when its element is; `type Tree = Tree[]`
        // is refused because there is no finite `HirType` that spells it.
        TypeKind::Array(element) => {
            if contains_a_cycle(snapshot, ty, &mut Vec::new()) {
                "a recursive array type".to_owned()
            } else {
                // The element, for the same reason the structured arm below
                // names its symbol: an array is refused *because its element
                // is*, so the element is the whole of the answer and "an array
                // type" is the one part of it the reader already knew. Nine
                // array literals in `runtime/web-platform` said nothing but
                // this.
                format!("an array of {}", describe(snapshot, *element))
            }
        }
        // A placeholder the decomposition did not open. The flags say which
        // checker category it fell in, which no reader can rank; the symbol
        // says `Set` or `AsyncIterableIterator`, which is the whole question.
        // Three rows totalling 223 in the node profile were unreadable until
        // this named them, and they turned out to be two features.
        TypeKind::Structured => named_or(snapshot, record, "a structured type"),
        TypeKind::Unsupported { rendered, .. } => format!("`{rendered}`"),
        // **`never` and `undefined` are not in the group below**, and putting
        // them there made this function contradict itself. `describe` is read
        // inside "X of unrepresentable type (Y)", so a `never[]` property came
        // out as
        //
        // ```text
        // a property `s0` of unrepresentable type (an array of a representable type)
        // ```
        //
        // which tells a reader the element is fine and the property is not, with
        // nothing to act on. The React lane reported exactly that from a stage
        // slot typed `never[]` -- and `settled`'s own doc records the same
        // sentence one construct over, about an array *literal*, calling it "the
        // exact failure the `empty` flag beside this exists to avoid".
        //
        // Both are genuinely unrepresentable *as an element*, and for different
        // reasons worth telling apart. `representation_within`'s filter refuses
        // `Array(Never)` and `Array(Void)` in one arm, and the comment there is
        // about `undefined`: "the C backend writes the element type into every
        // access: `NTS_ITEMS(v, void)[i]` is not C". `never` is the other case --
        // nothing inhabits it, so there is no width to write, and what is
        // missing is a type for the empty array to take rather than a
        // representation for one that exists.
        TypeKind::Never => "`never`, which no value inhabits".to_owned(),
        TypeKind::Void | TypeKind::Undefined => {
            "`undefined`, which has no storage of its own".to_owned()
        }
        TypeKind::Boolean | TypeKind::Number | TypeKind::String | TypeKind::Literal(_) => {
            "a representable type".to_owned()
        }
    }
}

/// Whether following element and member types from here ever revisits a type.
///
/// A *cycle* rather than a return to the starting type: `type Tree = Tree[]`
/// reaches this compiler as an instantiation whose element is the alias whose
/// element is the alias, so the loop that has no finite representation need not
/// pass through the type being asked about. `type A = B[]; type B = A[]` is the
/// same shape with the ids spelled out.
///
/// Only through arrays and unions, which are the two kinds whose representation
/// is built out of another's. An object stops the walk for the reason it
/// terminates in [`representation`](super::representation): its representation is a pointer, and a
/// pointer to something that leads back here is an ordinary linked list.
fn contains_a_cycle(snapshot: &SemanticSnapshot, ty: TypeId, path: &mut Vec<TypeId>) -> bool {
    if path.contains(&ty) {
        return true;
    }
    path.push(ty);
    let found = match snapshot.types.get(ty.0 as usize).map(|record| &record.kind) {
        Some(TypeKind::Array(element)) => contains_a_cycle(snapshot, *element, path),
        Some(TypeKind::Union(members)) => members
            .iter()
            .any(|member| contains_a_cycle(snapshot, *member, path)),
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => false,
        _ => false,
    };
    path.pop();
    found
}

/// A construct refused by name rather than by the blanket `async` rule.
///
/// Each of these is a *different* transformation from the one an ordinary
/// `async` function needs, and each is the kind that looks like it nearly
/// works:
///
/// - An async generator is two suspension mechanisms at once, and its frame has
///   to survive being resumed from both a consumer and an awaited promise.
/// - `for await` is a loop whose *iteration protocol* suspends, so the
///   suspension points are inside machinery the source never wrote.
/// - A `finally` that spans a **`yield`** is iterator closing: a `for...of`
///   left by `break` calls `gen.return()`, which resumes the generator inside
///   its `try` and runs the `finally`. Nothing here does that -- an abandoned
///   walk simply stops calling the resumption.
///
/// A `finally` that spans an `await` is **not** on this list any more: a
/// rejection is an edge into a handler, and `lower_unguarded` synthesises the
/// handler a `try`/`finally` never wrote.
pub(super) fn refused_by_name(snapshot: &SemanticSnapshot, id: NodeId) -> Option<&'static str> {
    snapshot.nodes.get(id.0 as usize)?;
    let mut found = None;
    walk(snapshot, id, &mut |child| {
        if found.is_some() {
            return;
        }
        let kind = kind_at(snapshot, child);
        // The same for a `yield`, and it is **iterator closing**: a `for...of`
        // left by `break` or `return` calls `gen.return()` on the way out,
        // which resumes the generator inside its `try` and runs the `finally`.
        // Nothing here does that -- an abandoned walk simply stops calling the
        // resumption, and the frame sits at whatever state it stopped in.
        //
        // Measured rather than assumed, and it was a wrong answer that ran:
        // a generator whose `finally` incremented a module-scope counter
        // disagreed with node on **26 of 29 cases** the moment the walk had a
        // `break` in it. The refusal is at the `try` because that is the only
        // place that can see the question; the loop that abandons it is in
        // another function.
        //
        // A `catch` that spans a `yield` is **not** refused, and that is
        // measured too: 29 of 29 agree. The `await` rule refuses one because a
        // rejected resumption goes to a shared exit that knows no handler, and
        // nothing resumes a generator with a failure -- a `throw` in the body
        // and the handler that catches it are both in the resumption, in
        // blocks the split preserved.
        if kind == Some(syntax::TRY_STATEMENT)
            && has_finally(snapshot, child)
            && contains_kind(snapshot, child, syntax::YIELD_EXPRESSION)
        {
            found = Some("a `finally` that spans a `yield`, which is iterator closing");
        }
    });
    found
}

impl FuncBuilder<'_> {
    /// Refuse, naming the type that could not be represented.
    pub(super) fn unrepresentable(&self, id: NodeId, what: &str) -> Diagnostic {
        let named = self.describe_node(id);
        self.unsupported(id, &format!("{what} of unrepresentable type ({named})"))
    }

    /// What the checker called the type at a node, for a diagnostic to name.
    ///
    /// One function because a refusal that does *not* name its type cannot be
    /// counted by kind. `a conversion to string from this type` was 178 sites in
    /// `runtime/node` and no census could say whether they were objects wanting
    /// `ToPrimitive`, arrays wanting `join`, or erased values wanting a tag
    /// dispatch -- three different features behind one sentence. A message is an
    /// instrument, and one that cannot distinguish its own causes has the same
    /// defect as a `grep -c` that cannot tell zero from a wrong pattern.
    pub(super) fn describe_node(&self, id: NodeId) -> String {
        self.snapshot.node_types.get(&id).map_or_else(
            || "an untyped node".to_owned(),
            |ty| describe(self.snapshot, *ty),
        )
    }

    /// The same, for a type that is not the node's own.
    ///
    /// A layout fails on one of its *properties*, and the node it fails at is
    /// whatever asked for the layout — a `new` expression, a parameter. Naming
    /// the node's type there describes the class and not the property, so
    /// `context: unknown` was reported as "a property of unrepresentable type
    /// (an object type)" — which reads as though records could not nest, and
    /// cost a reader a day.
    pub(super) fn unrepresentable_member(
        &self,
        id: NodeId,
        what: &str,
        name: &str,
        ty: TypeId,
    ) -> Diagnostic {
        let named = describe(self.snapshot, ty);
        self.unsupported(
            id,
            &format!("{what} `{name}` of unrepresentable type ({named})"),
        )
    }

    /// What kind of name the lowering ran out of places to look for.
    ///
    /// This used to be one message — `a name declared outside this function` —
    /// for every name that was not a local, not a module constant and not a
    /// module variable. It was the largest single refusal in the corpus at 12
    /// files, which made it look like the most valuable thing to implement, and
    /// it is not a thing at all: a namespace, a global this runtime does not
    /// provide, and a variable captured from an enclosing function are three
    /// features, and counting them together ranks none of them.
    ///
    /// The symbol says which. `declarations` is empty exactly when the symbol
    /// was declared outside the decoded file set, which is what separates
    /// `console` from a name the program itself wrote.
    pub(super) fn describe_name(&self, id: NodeId, symbol: SymbolId) -> Nameless {
        let Some(record) = self.snapshot.symbols.get(symbol.0 as usize) else {
            return Nameless::Unsupported("an unresolved name".to_owned());
        };
        let is = |flag: SymbolFlags| record.flags.contains(flag);
        // A class this compiler provides, reached as a *value*. `Error` is a
        // class here and not a constructor object, so `Error.captureStackTrace`
        // fails on the name -- and reporting the name as unprovided is wrong
        // twice over, since `Error` is provided and the member is what is not.
        // Reported by the Node session, who had just written `class MyError
        // extends Error` and seen it work.
        if let Some(name) = record.name.public_name().filter(|name| {
            crate::hir::builtin::is_error(name)
                || crate::hir::builtin::typed_array_element(name).is_some()
        }) {
            return match self.member_read_from(id) {
                Some(member) => self
                    .provided_global_member(id, name, &member)
                    .of_feature(feature_of(record)),
                None => {
                    Nameless::Unsupported(format!("`{name}` used as a value rather than as a type"))
                }
            };
        }
        if is(SymbolFlags::MODULE) {
            // `Reflect` arrives here rather than at the global-member arm below,
            // because the library declares it as a *namespace* and not as a
            // variable of an interface type -- so "a namespace" was its whole
            // refusal and the category sentence never reached it. The fixture
            // `prototype-and-descriptor-reflection` is what found that: its
            // `Reflect.ownKeys` arm read `` `Reflect`, a namespace `` while the
            // three `Object` arms beside it named the boundary.
            if let Some(member) = self.member_read_from(id)
                && let Some(why) = record
                    .name
                    .public_name()
                    .and_then(|name| Self::reflection_of_a_layout(name, &member))
            {
                return Nameless::Unsupported(why);
            }
            // A library's namespace -- `Intl`, `WebAssembly`, and a function
            // `@types/node` merges one into, `setTimeout` -- is a library
            // global like any other; one the program declares is a namespace
            // used as a value.
            if record.declarations.is_empty() {
                return self.library_global(id, record);
            }
            return Nameless::Unsupported(format!("`{}`, a namespace", record.name));
        }
        if is(SymbolFlags::ENUM) {
            // A *member* access is a constant and is lowered as one. Reaching
            // here means the enum itself is wanted as an object -- which is
            // `Colour[1]`, the reverse mapping, and that needs the table a
            // plain enum emits alongside its members. Saying which keeps this
            // from reading as "enums are unsupported", which they are not.
            return Nameless::Unsupported(format!(
                "`{}` as an object rather than a member, which is the reverse mapping",
                record.name
            ));
        }
        if record.declarations.is_empty() {
            // Nothing in the compiled set declares it, so it is a global the
            // host is expected to have. Which one matters: `Math` is a table of
            // functions this compiler could provide, and `document` is not.
            //
            // So `Math` names the member, the way `Error` does above. The
            // corpus reported `Math.random()` as "`Math`, a global with no
            // definition here" -- true, and not the reason: `Math` is provided
            // and `random` is the part that is not. It is absent deliberately,
            // being the one member of the family no differential can check.
            // **`Date`'s two statics are two different answers**, and the
            // generic line below gave them one. Its instance methods are
            // already told apart by name a few hundred lines down --
            // `getFullYear` "reads a *local* calendar", `toISOString` "has no
            // way to throw" -- and the statics fell through to the catch-all.
            //
            // `Date.now` is a **decision**, and `lower_new_date` already words
            // it for the same capability: `new Date()` with no argument
            // refuses as "a clock this compiler has no capability for and no
            // differential could check". One refusal in two sentences, one of
            // which said nothing, across 6 sites.
            //
            // `Date.UTC` is **not** a clock. It is a pure function of its
            // arguments -- year, month, day -- returning a millisecond offset,
            // which is exactly the kind of thing a differential *can* check.
            // It is absent rather than impossible, and saying so is what keeps
            // it findable: grouped under the clock it would read as refused on
            // principle and nobody would look again.
            if record.name.is_name("Date")
                && let Some(member) = self.member_read_from(id)
            {
                return match member.as_str() {
                    "now" => Nameless::Unprovided {
                        what: "`Date.now`".to_owned(),
                        why: Some("it reads a clock, which no differential could check"),
                        feature: feature_of(record),
                    },
                    "UTC" => Nameless::Unprovided {
                        what: "`Date.UTC`".to_owned(),
                        why: Some(
                            "a pure function of its arguments rather than a clock, and simply \
                             not built yet",
                        ),
                        feature: feature_of(record),
                    },
                    _ => Nameless::unprovided(format!("`Date.{member}`"))
                        .of_feature(feature_of(record)),
                };
            }
            // **`Object` and `Reflect` are a boundary, and the generic line
            // below made them read as a to-do list.** 817 occurrences over 47
            // sites in `runtime/node` and `runtime/web-platform` said "a global
            // member with no definition here", which reads as *add this member
            // and it works* -- and for this family that is false in a way no
            // census could see: 456 of those occurrences are `Object
            // .getOwnPropertyNames`, and the loop every one of them is in
            // continues into `getOwnPropertyDescriptor` and `defineProperty` on
            // `this.prototype`. Adding the member moves the refusal one line
            // down, twice, and ends at redefining a property on an object that
            // does not exist.
            //
            // So the refusal names the *category*, which is the honest unit: a
            // fixed layout has no prototype object to hold a property and no
            // descriptor to redefine one with. The same sentence covers
            // `Reflect`, whose members are the same question asked through a
            // different global.
            //
            // Three sentences rather than one, on the `Date.now` / `Date.UTC`
            // precedent above: what is impossible and what is merely absent are
            // different answers, and grouping them is how a buildable member
            // comes to read as refused on principle.
            if let Some(member) = self.member_read_from(id)
                && let Some(why) = record
                    .name
                    .public_name()
                    .and_then(|name| Self::reflection_of_a_layout(name, &member))
            {
                return Nameless::Unsupported(why);
            }
            // With the member, when one is being read. `Object` was 44
            // refusals that could not be told apart, and they are not one
            // thing: `Object.keys` is a list the compiler is holding and
            // `Object.defineProperty` is a shape it does not have.
            return self.library_global(id, record);
        }
        // `resolve` and `reject` are not values. The executor's body is lowered
        // where the promise is built, so a call to one is the settle it stands
        // for -- and there is nothing to hand to anything that wants it as a
        // function. Saying so beats "a name from an enclosing scope", which is
        // true of the symbol and says nothing about why.
        if self
            .node(id)
            .symbol
            .is_some_and(|symbol| self.settlers.contains_key(&symbol.0))
        {
            return Nameless::Unsupported(format!(
                "`{}` used as a value rather than called, which needs the executor to be a \
                 real closure over the promise",
                record.name
            ));
        }
        if is(SymbolFlags::FUNCTION) {
            return Nameless::Unsupported(format!("`{}`, a function used as a value", record.name));
        }
        if is(SymbolFlags::CLASS) {
            return Nameless::Unsupported(format!("`{}`, a class used as a value", record.name));
        }
        // Declared in this program, in a scope between here and module scope.
        Nameless::Unsupported(format!("`{}`, a name from an enclosing scope", record.name))
    }

    /// `what` is interpolated into a sentence, so it has to end in a noun.
    ///
    /// "a global this compiler does not provide" became "…does not provide is
    /// not supported by this lowering yet", which reads as a missing word
    /// rather than as a diagnostic. Every message here is a noun phrase, and a
    /// relative clause in one ends on its object.
    pub(super) fn unsupported(&self, id: NodeId, what: &str) -> Diagnostic {
        Diagnostic::error(
            "NTS1001",
            format!("{what} is not supported by this lowering yet"),
            self.location(id),
        )
    }

    /// A builtin this compiler does not provide: a name only a library declares
    /// (`lib.es*`, `lib.dom`, `@types/node`) that reaches no implementation
    /// here. One code for every such name, whatever the name, so that "this
    /// target lacks `fetch`" is one question with one answer; NTS1001 stays
    /// for a construct the lowering cannot represent yet. `why`, where there
    /// is one, is the reason it is absent rather than merely unbuilt.
    fn unprovided(
        &self,
        id: NodeId,
        what: &str,
        why: Option<&str>,
        feature: Option<&str>,
    ) -> Diagnostic {
        let what = match feature {
            Some(feature) => format!("{what} ({feature})"),
            None => what.to_owned(),
        };
        let message = match why {
            Some(why) => format!("{what} is not provided by this compiler: {why}"),
            None => format!("{what} is not provided by this compiler"),
        };
        Diagnostic::error("NTS1100", message, self.location(id))
    }

    /// The refusal a [`Nameless`] answer makes.
    pub(super) fn refuse_nameless(&self, id: NodeId, nameless: &Nameless) -> Diagnostic {
        match nameless {
            Nameless::Unprovided { what, why, feature } => {
                self.unprovided(id, what, *why, feature.as_deref())
            }
            Nameless::Never(what) => Diagnostic::error(
                "NTS1101",
                format!(
                    "{what} is never provided: it evaluates source text, and a program \
                     compiled ahead of time carries no evaluator"
                ),
                self.location(id),
            ),
            Nameless::Unsupported(what) => self.unsupported(id, what),
        }
    }

    /// `x as T` where `x` is a union holding a member whose layout `T`'s is
    /// not a prefix of: tested at run time, and refused by name if it is one.
    ///
    /// `as` asserts without checking, and the unerase below reads the value
    /// at `T`'s offsets. For `(shape as Square).side` on a `Square | Named`
    /// that read `Named`'s field 0 -- the `name` string's pointer -- as a
    /// double: a type confusion, in the idiom every user-defined type guard
    /// is written with (`outcomes/a-cast-reads-a-field-another-layout-holds`).
    /// node answers `undefined` there, reading by name; a refusal is not that
    /// answer, but it is the honest one until a member read through a cast
    /// asks each layout, as `in` already does.
    ///
    /// Only the members whose layouts disagree are tested: a member `T`
    /// prefixes is read correctly through `T`'s offsets, and a structural
    /// subtype is the common case, which a test for `T` itself would refuse.
    pub(super) fn refuse_a_foreign_layout(
        &mut self,
        id: NodeId,
        value: ValueId,
        want: &HirType,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let HirType::Managed(ManagedType::Object(asserted)) = *want else {
            return Ok(());
        };
        if self.kind_of(id) != Some(syntax::AS_EXPRESSION) {
            return Ok(());
        }
        let Some(&operand_ty) = self
            .children(id)
            .first()
            .and_then(|operand| self.snapshot.node_types.get(operand))
        else {
            return Ok(());
        };
        let Some(TypeKind::Union(members)) = self
            .snapshot
            .types
            .get(operand_ty.0 as usize)
            .map(|record| record.kind.clone())
        else {
            return Ok(());
        };
        let mut foreign = Vec::new();
        for member in members {
            let object = matches!(
                self.snapshot
                    .types
                    .get(member.0 as usize)
                    .map(|record| &record.kind),
                Some(TypeKind::Object { .. } | TypeKind::Structured)
            );
            if object && member != asserted && self.not_a_prefix(id, member, asserted).is_some() {
                foreign.push(member);
            }
        }
        if foreign.is_empty() {
            return Ok(());
        }
        for member in &foreign {
            self.layout_of(id, *member)?;
        }
        foreign.sort_unstable_by_key(|ty| ty.0);
        foreign.dedup();
        let is_foreign = self.push(
            OpKind::InstanceOf {
                value,
                classes: foreign,
                by_layout: false,
            },
            HirType::Bool,
            origin.clone(),
        );
        let refused = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: is_foreign,
            then_target: refused,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });
        self.switch_to(refused);
        let named = describe(self.snapshot, asserted);
        let what = self.push(
            OpKind::ConstString(
                format!(
                    "an `as` asserting {named} of a value whose layout is not one: reading through \
                 it would read another type's fields"
                )
                .into(),
            ),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        self.runtime_call("nts_refused", vec![what], HirType::Void, origin.clone());
        self.terminate(Terminator::Unreachable);
        self.switch_to(carry_on);
        Ok(())
    }

    /// `x instanceof C`.
    ///
    /// # The answer is a comparison, not a walk
    ///
    /// JavaScript's `instanceof` walks a prototype chain, because a program can
    /// change one while it runs. A compiled program cannot: the classes that
    /// extend `C` are all of them, they are known here, and nothing can be
    /// added after the binary is built. So the question "is this object a `C`"
    /// is "is its class one of these", and *these* is usually one.
    ///
    /// The right side is resolved through the **symbol** the class declares
    /// rather than through its name. Two modules may each declare a `Point`,
    /// and a name would pick whichever the map happened to hold.
    /// `instanceof` against a type this compiler represents natively rather than
    /// as a class.
    ///
    /// None of these has a per-class layout for the search above to find, so
    /// that search cannot succeed and the message it would produce -- "something
    /// this compiler has no class for" -- is true and useless: it describes the
    /// representation rather than the question. The runtime answers instead.
    ///
    /// Three shapes, and the differences are the point:
    ///
    ///   - a **typed array** is two tests. All nine share one struct and one
    ///     descriptor, differing only in how their bytes are read, so the
    ///     descriptor says *some typed array* and the `kind` field says *which*.
    ///     A test of the descriptor alone calls a `Float32Array` a `Uint8Array`.
    ///   - an **`ArrayBuffer`** is one class rather than nine, so its descriptor's
    ///     KIND is the whole answer and there is nothing below it.
    ///   - a **promise** is an `NTS_KIND_OBJECT` like a date or a view, so the
    ///     kind says nothing and descriptor IDENTITY is the answer.
    ///
    /// `Ok(None)` for everything else, which is the ordinary class path.
    /// Whether a name this program can write has no representation here.
    ///
    /// The guard under every "nothing a compiled program holds is one" fold, and
    /// the reason those folds are honest rather than assertions: the day the type
    /// represents, the caller falls through to the refusal it has today instead
    /// of answering `false` about a real value.
    ///
    /// One function because it is one fact. [`Self::instanceof_native`] and
    /// [`Self::instanceof_builtin`] both ask it, and two spellings of a guard
    /// this load-bearing is how they drift.
    ///
    /// **An instance type the snapshot does not hold has no values, because
    /// every creation site records its type** -- a `new`, a literal, a library
    /// module compiled in. So an absent instance type proves the fold as an
    /// unrepresentable one does. The fold depends on that: if the snapshot
    /// ever stops recording a creation site's type, absence proves nothing and
    /// this answers `false` about a real value.
    pub(super) fn has_no_representation(
        &self,
        global: &construction::CheckedGlobalReference,
    ) -> bool {
        self.global_instance_type(global)
            .is_none_or(|ty| self.represent(ty).is_none())
    }

    /// A type described by what it holds, for one that has nothing else.
    ///
    /// The fallback under [`Self::type_in_a_message`], and **every type with no
    /// declared name reaches it** -- which it did not when a location rung sat
    /// in front of it. A **synthesised** type — an intersection, a mapped type,
    /// a `Partial<T>` instantiation — has no symbol, so it has no name, and this
    /// is what is left. Under `Buffer.from` what stood before it was `an
    /// anonymous type`, twice over, describing nothing.
    ///
    /// Its property names are what is left and they identify it: a reader who
    /// sees `{ length?, 0? }` knows a `Partial<ArrayLike>` when the name and
    /// the file were both unavailable. Six at most, because the point is
    /// recognition rather than a full printing, and a mapped type over a long
    /// interface would otherwise fill the terminal.
    fn shaped_like(&self, ty: TypeId) -> String {
        // **A tuple, which this had no arm for** -- it matched `Object` only, so
        // every tuple fell to the fallback and a refusal about two of them read
        // `a `an anonymous type` where a `an anonymous type` is wanted`. Tuples
        // reach messages far more often since a fixed-arity rest began taking its
        // type's representation, which is how the sentence became common enough
        // to notice.
        if let Some(TypeKind::Tuple(positions)) =
            self.snapshot.types.get(ty.0 as usize).map(|r| &r.kind)
        {
            // Each position abbreviated, on this function's own rule: *"the point
            // is recognition rather than a full printing"*. A four-position tuple
            // of unions printed 240 characters, three of them the same
            // `a union of a boolean literal | undefined` -- which tells a reader
            // less than the shape does, because the repetition hides the arity.
            let positions = &positions.elements;
            let mut shown: Vec<String> = positions
                .iter()
                .take(6)
                .map(|position| {
                    let described = describe(self.snapshot, *position);
                    match described.char_indices().nth(28) {
                        Some((at, _)) => format!("{}…", &described[..at]),
                        None => described,
                    }
                })
                .collect();
            if positions.len() > shown.len() {
                shown.push("...".to_owned());
            }
            return format!("the tuple `[{}]`", shown.join(", "));
        }
        let Some(TypeKind::Object { properties }) =
            self.snapshot.types.get(ty.0 as usize).map(|r| &r.kind)
        else {
            return "an anonymous type".to_owned();
        };
        let mut names: Vec<String> = properties
            .iter()
            .take(6)
            .map(|property| {
                let mark = if property.optional { "?" } else { "" };
                format!("{}{mark}", property.name)
            })
            .collect();
        if properties.len() > names.len() {
            names.push("...".to_owned());
        }
        format!("the anonymous `{{ {} }}`", names.join(", "))
    }

    /// Why a call through `callee` has no function to make: what its type is
    /// where it is called, when the checker has one. A union is spelled out
    /// (`null | (() => string)`), since naming its shape says nothing.
    pub(super) fn called_without_a_function(&self, callee: NodeId, name: &str) -> String {
        let Some(&ty) = self.snapshot.node_types.get(&callee) else {
            return format!("a call through `{name}`, which names no function");
        };
        let spelled = match self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        {
            Some(TypeKind::Object { .. } | TypeKind::Structured) => self.type_in_a_message(ty),
            _ => format!("`{}`", short(self.snapshot, ty)),
        };
        format!("a call through `{name}`, whose type here, {spelled}, is not a function's")
    }

    /// Where a type with no name is written.
    ///
    /// The counterpart of [`Self::name_of_type`] for the case that has no
    /// answer: an anonymous object type — an inline `{ k?: T }`, a `Partial`, a
    /// mapped type — has no name to print and does have a declaration, and the
    /// declaration is what a reader has to go and change.
    ///
    /// The first declaration, not all of them. A merged declaration has more
    /// than one and they are all in the same file; a list would be longer and
    /// no more actionable.
    ///
    /// The file and the offset the declaration starts at, not a line and
    /// column: converting is the diagnostic boundary's job rather than the
    /// lowering's, which is why the raw number is printed here. The file alone
    /// was tried first and is not enough — one file can declare several
    /// anonymous types with an optional field, and which one is the whole
    /// question.
    ///
    /// **The offset counts UTF-16 code units**, as every `Span` does; this
    /// said "the byte" until 2026-09-27, when a location bug of exactly that
    /// confusion was fixed two files away. The `+N` is honest as written, since
    /// it names no unit, and it is still the worse half of this: a reader gets a
    /// number to count rather than a place. What it owes is a
    /// `Diagnostic::with_label` at that location, so the
    /// printer converts it like every other location instead of this deriving
    /// "where is it" a second time. That changes the text of a large family
    /// — the erasure rows are 152 sites and 3,061 occurrences — so it
    /// wants its own measured commit.
    ///
    /// `an anonymous type` remains the answer where there is genuinely nothing
    /// to point at: a symbol declared outside the decoded file set has an empty
    /// `declarations`, which is honest rather than a gap.
    /// How a refusal names a type, when what the reader has to fix is its
    /// declaration.
    ///
    /// Two rungs -- the declared name, then the shape -- and the third one this
    /// replaced is gone because it could not be *recorded*.
    ///
    /// `named` answers with whatever symbol the checker attached, and for a type
    /// with no declaration that is `__object`, `__type` or `__class`:
    /// TypeScript's placeholders, which [`is_anonymous_shape`] exists to
    /// recognise and which the refusal below was printing verbatim. *"a `delete`
    /// of `c` on `__object`"* names nothing a reader can go and edit.
    ///
    /// **`declared_at` used to sit between them and answered with a path and a
    /// byte offset** -- `the anonymous type at /abs/path/main.ts+1657`. Three
    /// things were wrong with that at once, and the third is what removed it:
    /// an absolute path is not the same sentence on two machines, so a fixture
    /// cannot hold it in an `// expect:` line and the refusal could not be
    /// pinned at all; a byte offset is not a place anyone reads, while the
    /// diagnostic already carries a real `file:line:col` of its own; and
    /// [`Self::shaped_like`]'s own doc calls itself *"the one the case that
    /// matters actually reaches"*, so the rung existed for object literals and
    /// answered them worst. It had exactly one caller.
    ///
    /// So the shape is the fallback, and it is the better sentence anyway: for a
    /// refusal about *optionality*, printing the shape `{ a, b, c }` shows at a
    /// glance that none of the three carries a `?`, because `shaped_like` prints
    /// the mark.
    ///
    /// One spelling, because the two callers ([`Self::presence_bit_named`] and
    /// [`Self::the_absence_has_a_slot`]) are the two sides of one question --
    /// whether a property may be absent -- and a refusal pair that names the
    /// same type two ways is the reader's problem, not a tidiness one.
    pub(super) fn type_in_a_message(&self, ty: TypeId) -> String {
        named(self.snapshot, ty)
            .filter(|_| !is_anonymous_shape(self.snapshot, ty))
            .map_or_else(|| self.shaped_like(ty), |name| format!("`{name}`"))
    }

    /// What to say about a call the checker resolved to no declaration.
    ///
    /// **Four different failures wear this one position**, and telling them
    /// apart is the whole of the value here: a message naming the wrong cause
    /// sends its reader somewhere there is nothing to find.
    ///
    /// A name the checker resolved to no declaration is a builtin this compiler
    /// has not implemented, *or* a name from a package whose implementation is
    /// not in this program -- the second is far commoner now that dependencies
    /// are acquired, because a package publishing only generated JavaScript has
    /// nothing to acquire. Reporting it as a missing builtin sends its reader
    /// to `hir::builtin`, where nothing is missing.
    ///
    /// A third was found by probing the ledger row for *calling* a class value.
    /// `TypeError(m)` is what JavaScript makes `new TypeError(m)`, TypeScript
    /// accepts it, and it arrives here with no declaration -- so it read as a
    /// builtin this compiler does not provide, which is false twice over: the
    /// class is the second entry in `hir::builtin`. What is missing is a `call`
    /// that constructs. Only a *provided* class reaches that arm, since a class
    /// the program declares is TS2348 before the compiler sees it.
    ///
    /// **The fourth had somebody else's name in it.** A callee this program
    /// *declares* is not a builtin, whatever the checker resolved its call to:
    ///
    /// ```js
    /// var f = Function('eval = 42;');
    /// f();
    /// ```
    ///
    /// `f` is an ordinary `var` in the source. Its call resolves to no
    /// declaration because its type is `Function`, whose call signature lives
    /// in `lib.d.ts` -- so this named the variable and sent its reader to
    /// `hir::builtin` to add `f`. Nine files of the slice-1 `test/language`
    /// population, under four names (`f`, `fn`, `MyFunction`,
    /// `_13_0_12_fun`), and every one of them is `Function` or `new Function`.
    /// One message was carrying two causes and the count for the real one was
    /// nine files short. The type is what the sentence should name.
    ///
    /// `SymbolRecord::declarations` is the test, and the schema already
    /// documents it: "empty for a symbol declared outside the decoded file
    /// set". A binding-table lookup was tried first and **never fired** -- the
    /// maps it asks are the lowering's own, so a symbol whose declaration the
    /// lowering already refused is absent from them, which is exactly this
    /// case. `tests/refusals/a-value-of-function-type-called`
    /// pins the sentence.
    pub(super) fn no_such_callee(&self, callee_node: NodeId, name: &str) -> Nameless {
        let declared_here = self
            .node(callee_node)
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .is_some_and(|symbol| !symbol.declarations.is_empty());
        if crate::hir::PROVIDED_ERROR_NAMES.contains(&name) {
            Nameless::Unsupported(format!(
                "`{name}`, a class this compiler provides, called without `new`"
            ))
        } else if self.imported_from(callee_node).is_some() {
            Nameless::Unsupported(format!(
                "`{name}`, an imported name whose implementation is not in this program"
            ))
        } else if declared_here {
            Nameless::Unsupported(format!(
                "`{name}`, a value of type {} called as a function, where the type does not say \
                 which function it is",
                self.describe_node(callee_node)
            ))
        } else if name == "eval" {
            Nameless::Never(format!("`{name}`"))
        } else if crate::hir::builtin::provides_global(name.split('.').next().unwrap_or(name)) {
            // Provided, and reached in a form its lowering does not take: a
            // function read as a value (`cond ? setTimeout : null`), a
            // property of one (`console.log.name`).
            Nameless::Unsupported(format!(
                "`{name}`, a builtin this compiler provides, reached in a form its lowering does \
                 not take"
            ))
        } else {
            let feature = self
                .node(callee_node)
                .symbol
                .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
                .and_then(feature_of);
            Nameless::unprovided(format!("`{name}`")).of_feature(feature)
        }
    }
}
