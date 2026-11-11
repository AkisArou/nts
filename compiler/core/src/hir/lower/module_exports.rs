//! Compute the public surface from the entry roots and publish exports or their refusal.

use super::{
    FuncBuilder, HirType, LiteralValue, Lowered, LoweringSnapshot, ManagedType, ModuleScope,
    Naming, NodeId, NodeKind, SemanticSnapshot, TypeId, TypeKind, initializer_function,
    module_namespace_of, namespace_of, probe_kind, representation, syntax,
};

/// Whether a variable declaration carries `export`.
///
/// The modifier is on the enclosing `VariableStatement` rather than on the
/// declaration or its list, so this walks to the statement. Split out of
/// `collect_module_scope`, which is at its line limit.
pub(super) fn declaration_is_exported(probe: &FuncBuilder, id: NodeId) -> bool {
    probe
        .ancestor(id, syntax::VARIABLE_STATEMENT)
        .is_some_and(|statement| {
            probe
                .node(statement)
                .modifiers
                .contains(nts_semantic_schema::DeclarationModifiers::EXPORT)
        })
}

/// The value a **declared** constant carries in its own type.
///
/// `declare const MAX: 512` has no initializer, so nothing else knows what it
/// holds -- and `globals::analyze` seeds a non-exported numeric global with
/// `Facts::constant(initial)`, so every read of one folded to zero. That was a
/// wrong number on every backend with no diagnostic anywhere: `Catalog.MAX`
/// printed `0` where Java says `512`, and `declare const X: 512` reduced it out
/// of interop entirely -- `dconst_0` on the JVM and `v0 = 0.0` in C.
///
/// A literal type is the one place a declaration can carry a value, which is
/// why `nts bind` renders a Java `static final int MAX = 512` as
/// `static readonly MAX: 512`.
pub(super) fn declared_literal(probe: &FuncBuilder, name: NodeId) -> Option<f64> {
    match &probe
        .snapshot
        .types
        .get(probe.snapshot.node_types.get(&name)?.0 as usize)?
        .kind
    {
        TypeKind::Literal(LiteralValue::Number(value)) => Some(*value),
        TypeKind::Literal(LiteralValue::Boolean(value)) => Some(f64::from(u8::from(*value))),
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
        _ => None,
    }
}

/// The text a declaration's string literal type carries, as
/// [`declared_literal`] reads a number's: `declare const GROUP: "Desktop
/// Entry"` is the one way a binding can give a string constant its value.
pub(super) fn declared_string_literal(probe: &FuncBuilder, name: NodeId) -> Option<String> {
    match &probe
        .snapshot
        .types
        .get(probe.snapshot.node_types.get(&name)?.0 as usize)?
        .kind
    {
        TypeKind::Literal(LiteralValue::String(text)) => text.as_utf8().map(str::to_owned),
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
        _ => None,
    }
}

/// Collect what a module declares outside any function.
///
/// A global may hold a managed value. Nothing registers it as a root, because
/// no native provider traces: under reference counting the global owns a count
/// on what it holds, and a store into it releases the value it replaces
/// (`rc::load_slot`).
///
/// An initializer that is not a constant is *deferred* rather than refused: it
/// runs in `module#init`, in source order. The paragraph here used to say it was
/// refused, "because running it needs a module initializer, which is a real
/// thing to design" -- which the module initializer then became, leaving the
/// sentence behind. It is written down because one refusal outlived the same
/// fact: an object literal holding a method was turned away here, on the
/// grounds that "the methods of an object literal are not walked, so they are
/// not lowered and not refused", for as long as that had been false.
///
/// This doc comment sat on an unrelated `impl` block 765 lines above the
/// function it describes until 2026-09-17.
/// The foreign function a `@ntsBoundBy` declaration's reads call, and its
/// name: `nts:dom`'s `window()` for `/** @ntsBoundBy "nts:dom" window */
/// declare var window`. `None` with no tag, or one naming nothing.
pub(super) fn binding_of(probe: &FuncBuilder, id: NodeId) -> Option<(NodeId, String)> {
    let binding = probe
        .node(probe.tagged_statement(id))
        .native
        .as_deref()?
        .bound_by
        .as_deref()?;
    let (module, name) = nts_semantic_schema::binding::parse(binding)?;
    let function = nts_semantic_schema::binding::declared_in(
        probe.snapshot,
        module,
        name,
        syntax::FUNCTION_DECLARATION,
    )?;
    Some((function, name.to_owned()))
}

/// Note a module whose exports the fallback rule passed over -- when passing
/// it over was a *guess* rather than the rule working.
///
/// Only for a module inside an import cycle, and that restriction is the whole
/// of what makes this readable. Under the fallback, every library module in
/// every project is excluded because something imports it, which is correct and
/// is most modules; reporting those buried the case that matters in a list of
/// the case that does not. It was measured doing exactly that: a two-module
/// fixture whose `main.ts` re-exports its `posix.ts` reported `posix.ts` as a
/// lost surface, and nothing was lost -- `main.ts` publishes its names.
///
/// A cycle is different in kind. When a module imports something that imports
/// it back, "nothing imports it" is true of *neither* of them, so the rule has
/// no answer rather than a wrong one, and both surfaces disappear. `fs` is
/// exactly that and it costs 303 exports.
///
/// # What this deliberately does not catch
///
/// `util`, whose `width.ts` imports `main.ts` while `main.ts` never mentions
/// `width.ts`. No cycle: the rule has an answer, it is decidable, and it is
/// wrong -- `width.ts` is an orphan helper and wins on being unimported. That
/// is a fact about intent, and nothing in the graph distinguishes it from
/// `path`'s `main.ts` legitimately winning over `posix.ts`. Naming roots is
/// what fixes it, and reporting every excluded module in the hope of catching
/// it would report every project's every helper.
///
/// The importer is the first module found importing it. There may be several
/// and the first is enough: a reader who has one edge of the cycle can find the
/// rest.
/// Whether a module is reachable from itself through imports.
///
/// The condition under which "a module nothing imports is the entry" has no
/// answer at all: in a cycle, every member is imported, so every member is
/// disqualified and the project publishes nothing.
///
/// Breadth-first over `ModuleRecord::imports`, bounded by the module count
/// because `seen` admits each module once -- a cycle is what this is looking
/// for, so recursing without one would not terminate.
fn in_a_cycle(
    snapshot: &SemanticSnapshot,
    module: &nts_semantic_schema::schema::ModuleRecord,
) -> bool {
    let mut seen = rustc_hash::FxHashSet::default();
    let mut queue: Vec<nts_semantic_schema::schema::ModuleId> = module.imports.clone();
    while let Some(at) = queue.pop() {
        let Some(reached) = snapshot.modules.get(at.0 as usize) else {
            continue;
        };
        if reached.file == module.file {
            return true;
        }
        if !seen.insert(at.0) {
            continue;
        }
        queue.extend(reached.imports.iter().copied());
    }
    false
}

fn record_unpublished(
    snapshot: &SemanticSnapshot,
    module: &nts_semantic_schema::schema::ModuleRecord,
    unpublished: &mut Vec<(String, String, usize)>,
) {
    if module.exports.is_empty() || !in_a_cycle(snapshot, module) {
        return;
    }
    let Some(source) = snapshot.sources.get(module.file.0 as usize) else {
        return;
    };
    let importer = snapshot
        .modules
        .iter()
        .find(|other| {
            other.imports.iter().any(|target| {
                snapshot
                    .modules
                    .get(target.0 as usize)
                    .is_some_and(|reached| reached.file == module.file)
            })
        })
        .and_then(|other| snapshot.sources.get(other.file.0 as usize))
        .map_or_else(|| "another module".to_owned(), |at| at.uri.clone());
    unpublished.push((source.uri.clone(), importer, module.exports.len()));
}

/// Whether a signature has an erased slot the boundary could never satisfy.
///
/// `HirType::Erased` is several things at a boundary and the wrapper cannot tell
/// them apart from the type alone.
///
/// `unknown` means the caller may pass anything and the body will decide.
/// Crossing one is what makes a module's own `validateString` live again, which
/// is 23 exported functions in the node profile.
///
/// `boolean | undefined` -- every optional scalar parameter -- also erases, and
/// **every member of it crosses**. `stream.getDefaultHighWaterMark(objectMode?:
/// boolean)` is that shape and answers correctly for both.
///
/// `Uint8Array | ArrayBuffer` erases too and means something else entirely: two
/// specific types, neither of which the boundary can build. A wrapper for one
/// accepts every argument node offers and throws for all of them --
/// `buffer.isUtf8` went from `typeof` being `"undefined"` to `"function"`, and
/// only a *call* finds out. A presence check that used to fail now passes,
/// which is the wrong-answer shape one level out from the one the erased
/// crossing was careful about.
///
/// So the question is not "is it `unknown`" -- the first version asked that and
/// declined `getDefaultHighWaterMark`, which works. It is **whether any member
/// of the union is something the crossing cannot build**, and a union with no
/// members at all is `unknown`, which is why that case answers `false` here
/// rather than being special-cased.
fn opaque_signature(snapshot: &LoweringSnapshot<'_>, declaration: NodeId) -> bool {
    let probe = FuncBuilder::probe(snapshot);
    let carried = |member: TypeId| -> bool {
        matches!(
            snapshot
                .types
                .get(member.0 as usize)
                .map(|record| &record.kind),
            Some(
                TypeKind::Undefined
                    | TypeKind::Null
                    | TypeKind::Boolean
                    | TypeKind::Number
                    | TypeKind::String
                    | TypeKind::Literal(_)
            )
        )
    };
    let opaque_slot = |node: NodeId| -> bool {
        let Some(ty) = snapshot.node_types.get(&node).copied() else {
            return false;
        };
        if representation(snapshot, ty) != Some(HirType::Erased) {
            return false;
        }
        match snapshot.types.get(ty.0 as usize).map(|record| &record.kind) {
            Some(TypeKind::Union(members)) => !members.iter().copied().all(carried),
            // `unknown` and `any` have no members and are the case the crossing
            // exists for.
            _ => false,
        }
    };
    probe.children(declaration).into_iter().any(|child| {
        match probe.kind_of(child) {
            // A parameter's type is on its *name*, which is where `lower_param`
            // reads it from.
            Some(syntax::PARAMETER) => probe
                .children(child)
                .first()
                .copied()
                .is_some_and(opaque_slot),
            // The return annotation, which is the only type node a declaration
            // has among its direct children.
            Some(kind) if syntax::is_type_node(kind) => opaque_slot(child),
            _ => false,
        }
    })
}

/// Each parameter whose declared type is a scalar and `undefined`, with that
/// scalar.
///
/// An optional parameter whose body observes the absence represents as `Erased`,
/// so the wrapper reads it with `nts_from_napi_value` -- which accepts every
/// JavaScript value. `os.getPriority(pid?: number)` therefore accepted `null`
/// and `false` and returned instead of throwing, and `setPriority(1, "y")`
/// handed the compiled function a string that `unerase` read as a double:
/// `6.9231110677068e-310`, which is the pointer.
///
/// The type is the only thing missing at the boundary. `Param` carries `ty`,
/// which is `Erased`, and `shape`, which says optional -- and neither says what
/// the optional half *was*. A side table rather than a field on `Param`, for the
/// reason `opaque_signatures` is one: no backend has to read it, and twenty
/// construction sites do not have to learn a field they will not use.
///
/// Scalars only. A union of two scalars plus `undefined` is not one of these and
/// is left alone, because the check has one type to name in its message and
/// naming the wrong one is worse than the generic text this replaces.
fn optional_scalars(snapshot: &LoweringSnapshot<'_>, declaration: NodeId) -> Vec<(u32, HirType)> {
    let probe = FuncBuilder::probe(snapshot);
    // **The declaration with a body, which for an overloaded function is not
    // the first one.**
    //
    // A symbol's declarations list the overload *signatures* ahead of the
    // implementation, and `public_api` hands over the first. For
    //
    //     export function overloaded(a: number): string;
    //     export function overloaded(a: number, b: number): string;
    //     export function overloaded(a: number, b?: number): string { ... }
    //
    // that is the one-parameter signature, which has no `b` and therefore no
    // optional scalar at index 1 -- so the wrapper read that argument with
    // `nts_from_napi_value`, which accepts every JavaScript value, and
    // `overloaded(1, "s")` handed a string to a parameter declared `number`.
    //
    // `secondOptional(a: number, b?: number)` is second and optional and not
    // overloaded, and it rejects: the Node lane ruled out "second" and
    // "optional" by measuring both before reporting it, which is what left the
    // overloads as the only thing varying.
    //
    // 52 exported functions in `runtime/node` carry overload declarations --
    // fs 32, os 5, timers 4, stream 3 -- and each of their later parameters was
    // unchecked. `os.setPriority(0, "x")` answered `ERR_OUT_OF_RANGE` where
    // node answers `ERR_INVALID_ARG_TYPE`, because the module's own
    // `typeof value !== "number"` is folded away inside a compiled program and
    // the boundary is what has to stand in for it.
    let declaration = probe.implementation_of(declaration);
    let mut found = Vec::new();
    let mut at = 0u32;
    for child in probe.children(declaration) {
        if probe.kind_of(child) != Some(syntax::PARAMETER) {
            continue;
        }
        let index = at;
        at += 1;
        // The `?`. A parameter with a *default* is not one of these: the callee
        // supplies the value, and the slot is the scalar rather than a union.
        if !probe
            .children(child)
            .iter()
            .any(|part| probe.kind_of(*part) == Some(syntax::QUESTION_TOKEN))
        {
            continue;
        }
        // A parameter's type is on its name, which is where `lower_param` reads
        // it from.
        let Some(name) = probe.children(child).first().copied() else {
            continue;
        };
        let Some(ty) = snapshot.node_types.get(&name).copied() else {
            continue;
        };
        if representation(snapshot, ty) != Some(HirType::Erased) {
            continue;
        }
        let Some(TypeKind::Union(members)) = snapshot.types.get(ty.0 as usize).map(|r| &r.kind)
        else {
            continue;
        };
        let present: Vec<TypeId> = members
            .iter()
            .copied()
            .filter(|member| {
                !matches!(
                    snapshot.types.get(member.0 as usize).map(|r| &r.kind),
                    Some(TypeKind::Undefined | TypeKind::Void)
                )
            })
            .collect();
        let [only] = present.as_slice() else {
            continue;
        };
        match representation(snapshot, *only) {
            Some(scalar @ (HirType::Float { .. } | HirType::Int { .. } | HirType::Bool)) => {
                found.push((index, scalar));
            }
            Some(HirType::Managed(ManagedType::String)) => {
                found.push((index, HirType::Managed(ManagedType::String)));
            }
            _ => {}
        }
    }
    found
}

pub(super) fn public_api(
    snapshot: &LoweringSnapshot<'_>,
    naming: &Naming,
    module: &ModuleScope,
    entry_files: &[String],
) -> PublicSurface {
    let mut imported = vec![false; snapshot.modules.len()];
    for module in &snapshot.modules {
        for target in &module.imports {
            if let Some(flag) = imported.get_mut(target.0 as usize) {
                *flag = true;
            }
        }
    }
    let mut api: Vec<(String, String)> = Vec::new();
    let mut namespaces: Vec<(String, Vec<(String, String)>)> = Vec::new();
    let mut functions: Vec<String> = Vec::new();
    let mut unpublished: Vec<(String, String, usize)> = Vec::new();
    let mut opaque: Vec<String> = Vec::new();
    let mut optional: Vec<(String, u32, HirType)> = Vec::new();
    // Where the surface starts.
    //
    // A project that named its root files said which modules are the product,
    // and nothing else has to be inferred. A project that named none -- every
    // tsconfig that uses only `include` -- leaves the question open, and
    // "nothing imports it" is the answer this has always given.
    //
    // **That answer is wrong whenever a module's own dependency imports it
    // back**, and it is wrong in the loudest possible way: the module
    // contributes no exports, and therefore no *declines* either, so its whole
    // surface goes missing with nothing said about any of it. `fs` publishes
    // none of its 303 exports because `fs/src/utf8-stream.ts` imports four
    // functions from `fs/src/main.ts`. `util` publishes `width.ts`'s three --
    // an orphan helper nothing in the module references -- because `width.ts`
    // imports `main.ts` and so `main.ts` is "imported" and `width.ts` is not.
    //
    // There is no rule over the import graph that picks `main.ts` in both.
    // "Not imported from outside my own cycle" answers `fs`, whose two modules
    // are a genuine cycle, and leaves `util`, whose back edge is one-way. "An
    // importer that is itself a root does not disqualify" answers `util` and
    // makes every `posix.ts` an entry. The fact that `main.ts` is the module
    // and `width.ts` is a helper is not in the type graph. It is in the
    // tsconfig, which is why `entry` exists.
    for (entry, into) in snapshot.modules.iter().zip(&imported) {
        let is_entry = if entry_files.is_empty() {
            !*into
        } else {
            snapshot
                .sources
                .get(entry.file.0 as usize)
                .is_some_and(|source| entry_files.contains(&source.uri))
        };
        if !is_entry {
            if entry_files.is_empty() && *into {
                record_unpublished(snapshot, entry, &mut unpublished);
            }
            continue;
        }
        for (published, symbol) in &entry.exports {
            let Some(record) = snapshot.symbols.get(symbol.0 as usize) else {
                continue;
            };
            // One hop, because the frontend followed the chain already.
            let declaring = record.aliased.unwrap_or(*symbol);
            let record = record
                .aliased
                .and_then(|to| snapshot.symbols.get(to.0 as usize))
                .unwrap_or(record);
            let Some(&declaration) = record.declarations.first() else {
                continue;
            };
            // `export const alias = impl.upper` binds a *const*, not the
            // function: the symbol is `alias` and its declaration is the
            // variable, so the emitted name came out as `alias` and no function
            // answered to it. `export const upper = impl.upper` published only
            // because the two names coincide -- which is to say, it worked in
            // exactly the cases people write first and failed silently
            // otherwise.
            //
            // A declaration whose initializer names a function resolves to that
            // function, so the *binding* decides what the addon calls it and
            // the initializer decides what it calls.
            // A type-only export is erased and has nothing to publish. Left in,
            // it reported as a runtime export the backend could not name --
            // `export type { ParsedPath }` beside a real missing function, in
            // the same words, which is a diagnostic that has stopped meaning
            // "something is absent".
            //
            // By what the symbol DECLARES rather than by the `type` keyword:
            // `export { T }` where `T` is an interface is the same erasure and
            // does not spell it.
            if record.declarations.iter().all(|at| {
                matches!(
                    probe_kind(snapshot, *at),
                    Some(syntax::INTERFACE_DECLARATION | syntax::TYPE_ALIAS_DECLARATION)
                )
            }) {
                continue;
            }
            if let Some(properties) = namespace_of(snapshot, naming, declaration) {
                namespaces.push((published.clone(), properties));
                continue;
            }
            // And the other kind of namespace, which is a module rather than an
            // object literal. Asked second because the literal form is decided
            // by the *declaration* and this one by the symbol's flags, and a
            // declaration that is a variable can never be a module.
            if let Some(properties) = module_namespace_of(snapshot, naming, module, record) {
                namespaces.push((published.clone(), properties));
                continue;
            }
            let resolved = initializer_function(snapshot, declaration);
            if resolved.is_some()
                || probe_kind(snapshot, declaration) == Some(syntax::FUNCTION_DECLARATION)
            {
                functions.push(published.clone());
            }
            // A value export is a *global*, and its emitted name is the
            // global's.
            //
            // `naming.qualified` is a map for function declarations, so a
            // `const` fell through to the symbol's plain name -- and the plain
            // name is not what the global is called whenever something else
            // took it first. `export const version = codec.version` reported
            // `version`, which is `codec`'s global; the one this module made is
            // `version3`. The instrument said "no function of that name" and it
            // was right about the wrong symbol.
            //
            // `ModuleScope::variables` is the symbol-to-global map that decided
            // the name, so this asks it rather than guessing again.
            if resolved.is_none()
                && let Some(global) = module
                    .variables
                    .get(&declaring.0)
                    .and_then(|at| module.globals.get(*at as usize))
            {
                api.push((global.name.clone(), published.clone()));
                continue;
            }
            let (declaration, name) =
                resolved.unwrap_or_else(|| (declaration, record.name.to_string()));
            let emitted = naming.qualified.get(&declaration).cloned().unwrap_or(name);
            if opaque_signature(snapshot, declaration) {
                opaque.push(emitted.clone());
            }
            for (at, scalar) in optional_scalars(snapshot, declaration) {
                optional.push((emitted.clone(), at, scalar));
            }
            api.push((emitted, published.clone()));
        }
    }
    api.sort_unstable();
    api.dedup();
    namespaces.sort_unstable();
    namespaces.dedup();
    functions.sort_unstable();
    functions.dedup();
    unpublished.sort_unstable();
    unpublished.dedup();
    opaque.sort_unstable();
    opaque.dedup();
    optional.sort_unstable_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    optional.dedup();
    (api, namespaces, functions, unpublished, opaque, optional)
}

/// What the entry modules publish: plain names, namespaces of names, and the
/// modules whose exports were never considered at all.
pub(super) type PublicSurface = (
    Vec<(String, String)>,
    Vec<(String, Vec<(String, String)>)>,
    Vec<String>,
    Vec<(String, String, usize)>,
    Vec<String>,
    Vec<(String, u32, HirType)>,
);

/// Record what the entry modules publish, and keep a published global's name.
///
/// Split out of [`lower`](super::lower) because it is one decision with two halves and the
/// second is easy to lose: the addon is a different translation unit from
/// `program.c`, so a `static` global is invisible to it however correctly the
/// surface was computed.
/// Say why an exported name has no storage, using the reason already worked out.
///
/// **`ModuleScope::unsupported` holds it and nothing published it.** A
/// module-scope binding whose type has no global slot is recorded there with a
/// sentence -- *"a module-scope name holding a function, whose closure layout
/// its initializer does not fix"* -- and the six readers of that map are all
/// places that lower a *read* of the name. An export is not a read, so the
/// sentence never reached the one person who needed it: the napi wrapper,
/// which found the name in neither `program.funcs` nor `globals` and fell
/// through to *"is exported and is not a function this backend can name"*.
///
/// That sentence is wrong about `assert`, and the Node lane reported it as
/// wrong twice before the cause was found. `export const deepStrictEqual =
/// looseAssertions.deepStrictEqual` is a function; what it has no storage for
/// is the closure layout, which is a different claim and now the one printed.
///
/// `blockers/a-method-exported-as-a-value` opens on the silence rather than on
/// the construct: *"a construct that lowers to nothing and reports nothing
/// cannot be ranked by any census"*. This does not make the construct work --
/// that needs the binding and the receiver question the blocker states -- it
/// makes it **countable**, which is what has to come first.
fn record_unstorable_exports(
    lowered: &mut Lowered,
    snapshot: &SemanticSnapshot,
    module: &ModuleScope,
    api: &[(String, String)],
) {
    for (symbol, reason) in &module.unsupported {
        let Some(declared) = snapshot
            .symbols
            .get(*symbol as usize)
            .and_then(|record| record.name.public_name())
        else {
            continue;
        };
        // **Not a `static` field**, whose reason belongs to `Owner.field` and
        // never to a bare export name. `collect_static_fields` puts statics in
        // this same `ModuleScope` -- deliberately, and the comment on
        // `no_initializer_for_an_erased_slot` says so -- so `unsupported` holds
        // both kinds and the match below is by *name*. A class writing
        // `static readonly f = f` beside a module-scope `function f` therefore
        // published the static's storage reason against the function, masking
        // the function's own root.
        //
        // `events` is the live instance at three exports: it writes `static
        // readonly listenerCount = listenerCount` (and the same for
        // `getMaxListeners` and `getEventListeners`) beside the free functions,
        // all three of which are refused for `... on an intersection, which is
        // erased here`. Those roots are printed as NTS1003 on the same run and
        // the wrapper said `closure layout` instead, which sends a reader to
        // the wrong family of work.
        //
        // `blockers/a-static-that-shadows-a-refused-function` carries the
        // reduction, whose `alone` arm is the control: the identical body with
        // no same-named static reports the root, and a first reduction that
        // dropped the refusal did not reproduce at all.
        if snapshot
            .symbols
            .get(*symbol as usize)
            .is_some_and(|record| {
                record.declarations.iter().any(|declaration| {
                    snapshot
                        .nodes
                        .get(declaration.0 as usize)
                        .is_some_and(|node| {
                            node.kind == NodeKind::Syntax(syntax::PROPERTY_DECLARATION)
                        })
                })
            })
        {
            continue;
        }
        // Published under the name an importer writes, which is what the
        // wrapper looks the export up by. A binding that is not exported keeps
        // its silence here and is answered at its reads, as before.
        for (_, published) in api.iter().filter(|(_, published)| published == declared) {
            if !lowered
                .program
                .uncompiled
                .iter()
                .map(|entry| (&entry.name, &entry.reason))
                .any(|(at, _)| at == published)
            {
                lowered
                    .program
                    .uncompiled
                    .push(crate::hir::Uncompiled::refused(
                        published.clone(),
                        reason.clone(),
                    ));
            }
        }
    }
}

pub(super) fn publish_surface(
    lowered: &mut Lowered,
    snapshot: &LoweringSnapshot<'_>,
    naming: &Naming,
    module: &ModuleScope,
    entry: &[String],
) {
    let (api, namespaces, functions, unpublished, opaque, optional) =
        public_api(snapshot, naming, module, entry);
    record_unstorable_exports(lowered, snapshot, module, &api);
    // Only the ones that are not functions: a name in `functions` is published
    // by calling something, and a global that happens to share it is a
    // different thing.
    //
    // And only a *settled* one. `Program::global_is_settled` is the whole of
    // why: a live binding published as a copy answers its first value forever,
    // which is a wrong answer no test in either profile would catch because
    // both read an export before anything writes it. An unsettled one keeps its
    // `static` linkage, which is also what keeps `hir::globals` narrowing it --
    // the guard there is about a reader this compiler cannot see, and it has
    // still never met one.
    // A namespace's value members are globals too, and they are not in `api` --
    // `path.win32.sep` is published on the namespace object rather than on
    // `exports`, so nothing above marks it. Without this it stays `static` and
    // the addon, a different translation unit, cannot see it.
    let members = namespaces
        .iter()
        .flat_map(|(_, properties)| properties.iter().map(|(_, emitted)| emitted.clone()));
    let settled: Vec<usize> = api
        .iter()
        .filter(|(_, published)| !functions.contains(published))
        .map(|(emitted, _)| emitted.clone())
        .chain(members)
        .filter_map(|emitted| {
            let at = lowered
                .program
                .globals
                .iter()
                .position(|global| global.name == emitted)?;
            lowered
                .program
                .global_is_settled(u32::try_from(at).unwrap_or(u32::MAX))
                .then_some(at)
        })
        .collect();
    for at in settled {
        lowered.program.globals[at].exported = true;
    }
    lowered.program.public_api = api;
    lowered.program.public_namespaces = namespaces;
    lowered.program.public_functions = functions;
    lowered.program.unpublished_modules = unpublished;
    lowered.program.opaque_signatures = opaque;
    lowered.program.optional_scalars = optional;
}
