//! Resolve namespace values and imports, materialize dynamic import jobs, and construct their namespace layouts.

use super::{
    AsyncResult, Callee, ClosureInfo, ClosureSource, Diagnostic, Facts, Func, FuncBuilder, HirType,
    Layout, LoweringSnapshot, ManagedType, ModuleRoles, ModuleScope, Naming, NodeId, OpKind, Param,
    ParamShape, SemanticSnapshot, SymbolRecord, Terminator, TypeId, TypeKind, ValueId,
    closure_names, closure_type, initializer_function, module_evaluate_name, module_job_fields,
    probe_kind, syntax,
};

pub(super) fn module_jobs(
    snapshot: &SemanticSnapshot,
    roles: &ModuleRoles,
    closures: &mut Vec<ClosureInfo>,
) {
    for (module, namespace) in roles.namespace.iter().enumerate() {
        if namespace.is_some() {
            closures.push(ClosureInfo {
                source: ClosureSource::ModuleJob { module },
                ..ClosureInfo::as_written(snapshot.modules[module].root)
            });
        }
    }
}

/// Whether a node is `import(...)`: a call whose callee is the keyword.
pub(super) fn is_a_dynamic_import(probe: &FuncBuilder, id: NodeId) -> bool {
    probe.kind_of(id) == Some(syntax::CALL_EXPRESSION)
        && probe
            .children(id)
            .first()
            .is_some_and(|callee| probe.kind_of(*callee) == Some(syntax::IMPORT_KEYWORD))
}

/// The module an `import(...)` names, and its namespace type: the checker's
/// resolution, through `Promise<namespace>` -- the key a static import is
/// resolved by. `None` where the checker resolved nothing.
pub(super) fn dynamic_import_target(
    snapshot: &SemanticSnapshot,
    call: NodeId,
) -> Option<(usize, TypeId)> {
    let namespace = dynamic_import_namespace(snapshot, call)?;
    Some((module_of_namespace(snapshot, namespace)?, namespace))
}

/// What an `import()`'s second argument asks of the import, where the compiler
/// can see it: nothing, or a rejection because it is not an object.
///
/// Import attributes -- a `with` object naming any key -- are not here: node
/// supports `type` only, and which module types it accepts is its own work.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ImportOptions {
    /// `undefined`, or an object asking for no attributes: the import as if
    /// there were no second argument.
    None,
    /// A primitive, which `import()` rejects with a `TypeError` before it loads
    /// anything.
    NotAnObject,
}

/// [`ImportOptions`] from an options value's type, where every value of it
/// answers the same: all `undefined`, or all a primitive other than it. `None`
/// for anything that could be an object, or could be either.
fn import_options_of_type(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<ImportOptions> {
    let kind = |ty: TypeId| snapshot.types.get(ty.0 as usize).map(|record| &record.kind);
    let parts = match kind(ty)? {
        TypeKind::Union(parts) => parts.as_slice(),
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        TypeKind::NonPrimitive | TypeKind::UniqueSymbol => std::slice::from_ref(&ty),
        _ => std::slice::from_ref(&ty),
    };
    let answer = |part: TypeId| match kind(part)? {
        TypeKind::Undefined | TypeKind::Void => Some(ImportOptions::None),
        TypeKind::Null
        | TypeKind::Boolean
        | TypeKind::Number
        | TypeKind::BigInt
        | TypeKind::String
        | TypeKind::Symbol
        | TypeKind::UniqueSymbol
        | TypeKind::Literal(_) => Some(ImportOptions::NotAnObject),
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        TypeKind::NonPrimitive => None,
        _ => None,
    };
    let first = answer(*parts.first()?)?;
    parts
        .iter()
        .all(|part| answer(*part) == Some(first))
        .then_some(first)
}

/// Whether an `import(...)` the checker did not resolve names a file that *is* in
/// the program anyway -- the importer's directory joined with a relative
/// specifier, exactly.
///
/// **A guard, not a resolver.** It decides only which way an unresolved import
/// fails: a specifier that names nothing at all compiles to the rejection node
/// gives it, and one that names a file the checker declined to resolve -- a test
/// importing itself, a file TypeScript reads as a script -- is refused by name,
/// because rejecting it would be a wrong answer where node loads the file.
fn names_a_file_of_the_program(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    call: NodeId,
    written: &str,
) -> bool {
    if !(written.starts_with("./") || written.starts_with("../")) {
        return false;
    }
    let Some(importer) = std::iter::successors(Some(call), |at| probe.node(*at).parent)
        .find_map(|at| snapshot.modules.iter().position(|module| module.root == at))
    else {
        return false;
    };
    let Some(from) = snapshot
        .sources
        .get(snapshot.modules[importer].file.0 as usize)
        .map(|source| source.uri.as_str())
    else {
        return false;
    };
    join_relative(from, written)
        .is_some_and(|resolved| snapshot.sources.iter().any(|source| source.uri == resolved))
}

/// `specifier`, relative to the directory of the file at `uri`: `.` and `..`
/// segments resolved, nothing else -- no extension added and no index file
/// looked for, because the guard it serves asks only about a file named exactly.
fn join_relative(uri: &str, specifier: &str) -> Option<String> {
    let (scheme, path) = uri.split_once(":///")?;
    let mut segments: Vec<&str> = path.split('/').collect();
    segments.pop();
    for segment in specifier.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            name => segments.push(name),
        }
    }
    Some(format!("{scheme}:///{}", segments.join("/")))
}

/// The namespace type an `import(...)` resolves with: the argument of the
/// `Promise` the checker types the call as.
fn dynamic_import_namespace(snapshot: &SemanticSnapshot, call: NodeId) -> Option<TypeId> {
    let promise = snapshot.node_types.get(&call)?;
    snapshot.type_arguments.get(promise)?.first().copied()
}

/// The module whose namespace `ty` is, by module index: an object type whose
/// symbol is a module's root symbol.
pub(super) fn module_of_namespace(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<usize> {
    let record = snapshot.types.get(ty.0 as usize)?;
    if !matches!(record.kind, TypeKind::Object { .. }) {
        return None;
    }
    let symbol = record.symbol?;
    snapshot.modules.iter().position(|module| {
        snapshot
            .nodes
            .get(module.root.0 as usize)
            .and_then(|root| root.symbol)
            == Some(symbol)
    })
}

/// The functions a *module namespace* export re-exports, if it is one.
///
/// `export * as posix from "./posix.ts"` publishes a module under a name, and
/// `node:path` is built out of nothing else -- `export * from "./posix.ts"` for
/// the platform's own half and `export * as posix` / `export * as win32` so both
/// are reachable, which is upstream's structure rather than a choice made here.
///
/// The same shape as [`namespace_of`] and a different source: that one reads an
/// object literal's properties, this one reads a module's export list. They
/// produce the same pairs because the wrapper builds both the same way -- an
/// object of functions, made on the JavaScript side, which is what node's own
/// addons do.
///
/// # Finding the module, and what does not identify one
///
/// The symbol's declaration *is* the module's root node -- the field
/// [`ModuleRecord::root`] holds -- so the module is the one whose root this
/// symbol declares. No path resolution, no re-reading of the specifier: two
/// facts already in the snapshot, matched against each other.
///
/// **Not `SymbolFlags::MODULE`.** The obvious test, and it is `SymbolFlags(0)`
/// for both of `path`'s: measured, `posix` declares `NodeId(14877)` and `win32`
/// declares `NodeId(17028)`, and both are module roots, with no flag set on
/// either. The frontend maps the checker's `MODULE` bit when it sees one and a
/// namespace-export symbol arrives without it. Testing the flag first was one
/// line and published nothing.
///
/// Re-measured 2026-09-14, because `bits::MODULE` turned out to be wrong when
/// this was written -- it read `NamespaceModule | TypeLiteral` under a comment
/// saying `ValueModule | NamespaceModule`, so the flag genuinely was unusable,
/// though not for the reason given above. **Correcting it does not change this
/// paragraph.** `posix` and `win32` still arrive `SymbolFlags(0)`. Before the
/// native switch, compiling this module set `ValueModule` on nine symbols and `NamespaceModule`
/// on none, and not one of the nine is a namespace-export symbol: the broken
/// constant matched nothing here and the fixed one matches those nine.
///
/// So the sentence above was right, and it is right for its own reason rather
/// than by accident of the bug. The root match stays. Do not put the flag test
/// back on the strength of the constant having been fixed -- that was the
/// inference this note exists to stop, and it was measured wrong once already.
///
/// So the root match is the whole test rather than a confirmation of it. That
/// is also the stronger claim: a symbol declared by a module's root node *is*
/// that module, whatever any flag says.
pub(super) fn module_namespace_of(
    snapshot: &LoweringSnapshot<'_>,
    naming: &Naming,
    scope: &ModuleScope,
    record: &SymbolRecord,
) -> Option<Vec<(String, String)>> {
    let module = snapshot
        .modules
        .iter()
        .find(|module| record.declarations.contains(&module.root))?;
    let mut properties = Vec::new();
    for (published, symbol) in &module.exports {
        let Some(symbol_record) = snapshot.symbols.get(symbol.0 as usize) else {
            continue;
        };
        let member = symbol_record
            .aliased
            .and_then(|to| snapshot.symbols.get(to.0 as usize))
            .unwrap_or(symbol_record);
        let Some(&declaration) = member.declarations.first() else {
            continue;
        };
        // A function, however it was written: a declaration, or a `const` bound
        // to one. `_makeLong = toNamespacedPath` is the second, and it is the
        // reason this asks `initializer_function` rather than only the kind --
        // resolving by name alone published `_makeLong` under a function that
        // does not exist.
        let resolved = initializer_function(snapshot, declaration);
        let is_function = resolved.is_some()
            || probe_kind(snapshot, declaration) == Some(syntax::FUNCTION_DECLARATION);
        if !is_function {
            // A value member: `export const sep = "/"`. It is a *global*, not a
            // function, and the name recorded is the global's -- which is not
            // the property's whenever something else took the plain name first,
            // the same reason `public_api` asks `ModuleScope::variables` rather
            // than guessing.
            //
            // `path.win32.sep` is `"\\"` and `path.posix.sep` is `"/"`: the one
            // member where the two namespaces disagree in a way callers depend
            // on, and the reason this is worth carrying at all.
            let declaring = symbol_record.aliased.unwrap_or(*symbol);
            if let Some(global) = scope
                .variables
                .get(&declaring.0)
                .and_then(|at| scope.globals.get(*at as usize))
            {
                properties.push((published.clone(), global.name.clone()));
            }
            continue;
        }
        let (declaration, name) =
            resolved.unwrap_or((declaration, member.name.public_name()?.to_owned()));
        let emitted = naming.qualified.get(&declaration).cloned().unwrap_or(name);
        properties.push((published.clone(), emitted));
    }
    (!properties.is_empty()).then_some(properties)
}

/// The functions an exported object literal's properties name, if all of them
/// are functions.
///
/// See [`super::Program::public_namespaces`]. A literal with anything else in
/// it is not one, and the backend reports it as an export it cannot name --
/// half a namespace is worse than none, because the half that is there looks
/// like the whole.
/// The binding a shorthand property names, by name, within its own file.
///
/// A shorthand's node carries the **property's** symbol rather than the
/// referenced binding's -- `getShorthandAssignmentValueSymbol` answers the other
/// one and the snapshot does not carry it. `FuncBuilder::shorthand_value_symbol`
/// resolves it against the bindings it has in hand; this has only a snapshot, so
/// it matches on the name and narrows by file.
///
/// **Scoped to the file, and that is correctness rather than tidiness.**
/// `snapshot.symbols` is one table for the whole linked program, so an unscoped
/// match would let `punycode`'s `{ decode }` resolve to `querystring`'s `decode`
/// and publish the wrong function under the right name.
///
/// **The property's own symbol is excluded by its declaration's kind.** It is
/// spelled the same and declared by the shorthand node, so without that test it
/// is a second candidate and every shorthand answers ambiguous.
///
/// Two surviving candidates answer `None` and the whole literal stops being a
/// namespace. That is the rule `shorthand_value_symbol` states as *a shorthand
/// naming a shadowed binding*: with two bindings of one name in scope, either
/// answer is a coin toss, and a namespace published from a coin toss is worse
/// than one not published.
fn shorthand_target(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    file: nts_diagnostics::SourceId,
    text: &str,
) -> Option<nts_semantic_schema::SymbolId> {
    let mut found: Option<(nts_semantic_schema::SymbolId, NodeId)> = None;
    for (index, record) in snapshot.symbols.iter().enumerate() {
        if !record.name.is_name(text.as_ref()) {
            continue;
        }
        // Spelled here, so another module's function of the same name is not a
        // candidate. For an import it is the specifier that is in this file.
        if !record
            .declarations
            .iter()
            .any(|at| probe.node(*at).origin.location.file == file)
        {
            continue;
        }
        // **And it has to name a function**, which is the same thing the tail
        // below requires and is what excludes the two property kinds without a
        // list of them. An object literal's key gets a symbol of its own,
        // spelled identically and declared by the property node -- a
        // `PROPERTY_ASSIGNMENT` for `{ decode: decode }` and a
        // `SHORTHAND_PROPERTY_ASSIGNMENT` for `{ decode }` -- so a name test
        // alone finds three records for one function and calls it ambiguous.
        // Neither property kind declares a function, and this asks that.
        let denoted = record
            .aliased
            .and_then(|to| snapshot.symbols.get(to.0 as usize))
            .unwrap_or(record);
        let Some(declaration) = denoted
            .declarations
            .iter()
            .copied()
            .find(|at| probe.kind_of(*at) == Some(syntax::FUNCTION_DECLARATION))
        else {
            continue;
        };
        // **Two records naming one function are one candidate**, compared by the
        // declaration they resolve to rather than by the record. `export { one }`
        // beside `const held = { one }` gives the export specifier a symbol of
        // its own, spelled `one` and aliased to the same function -- so counting
        // records called that shadowed and refused a fixture whose whole subject
        // is the shorthand. Only two *different* functions of one name are the
        // coin toss this refuses.
        match found {
            Some((_, already)) if already != declaration => return None,
            Some(_) => {}
            None => {
                found = Some((
                    nts_semantic_schema::SymbolId(u32::try_from(index).unwrap_or(u32::MAX)),
                    declaration,
                ));
            }
        }
    }
    found.map(|(symbol, _)| symbol)
}

pub(super) fn namespace_of(
    snapshot: &LoweringSnapshot<'_>,
    naming: &Naming,
    declaration: NodeId,
) -> Option<Vec<(String, String)>> {
    let probe = FuncBuilder::probe(snapshot);
    if probe.kind_of(declaration) != Some(syntax::VARIABLE_DECLARATION) {
        return None;
    }
    let children = probe.children(declaration);
    let name = children.first().copied();
    let literal = children.iter().rev().find(|child| {
        Some(**child) != name && !syntax::is_type_node(probe.kind_of(**child).unwrap_or_default())
    })?;
    if probe.kind_of(*literal) != Some(syntax::OBJECT_LITERAL_EXPRESSION) {
        return None;
    }
    let members = probe.children(*literal);
    if members.is_empty() {
        return None;
    }
    // The literal's own file, which scopes the shorthand lookup below.
    let file = probe.node(*literal).origin.location.file;
    let mut properties = Vec::with_capacity(members.len());
    for member in members {
        let parts = probe.children(member);
        // **Shorthand counts, and leaving it out cost a module.**
        //
        // `{ decode, encode }` is `{ decode: decode, encode: encode }` and a
        // reader would not call the difference a difference -- but only the
        // second was a `PROPERTY_ASSIGNMENT`, so the first fell out of this
        // function, out of the namespace surface, and into a plain **value**
        // export. A value export has to cross, and an object whose fields are
        // functions does not, so the whole export was declined as
        // `is exported as a value of type `an object`, which does not cross`.
        //
        // One shorthand member was enough: `querystring`'s `QueryString` writes
        // five shorthand keys and two explicit ones, and refused all seven.
        // `punycode` publishes the same shape only because its values are member
        // accesses on an import, which forced explicit keys on it -- so the
        // module that worked did not work for anything it knew.
        //
        // **A shorthand's symbol is the property's, not the binding's**, and
        // that is why widening the kind test alone is a no-op: the property's
        // only declaration is the shorthand node itself, so the
        // `FUNCTION_DECLARATION` search below finds nothing and this returns
        // `None` exactly as before. `lower.rs`'s own `shorthand_value_symbol`
        // says so -- `getShorthandAssignmentValueSymbol` answers the other
        // symbol and the snapshot does not carry it -- and resolves by name for
        // the same reason. This does too, with only a snapshot in hand.
        let (key, symbol) = match probe.kind_of(member) {
            Some(syntax::PROPERTY_ASSIGNMENT) => {
                let key = parts.first().and_then(|at| {
                    probe
                        .node(*at)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        .map(str::to_owned)
                })?;
                // The value, which is the last part rather than the second: a
                // key may be computed and carry children of its own.
                let value = parts.last().copied()?;
                let symbol = probe.node(value).symbol.or_else(|| {
                    probe
                        .children(value)
                        .last()
                        .and_then(|member| probe.node(*member).symbol)
                })?;
                (key, symbol)
            }
            // Guarded on the single child, because `{ a = 1 }` is three children
            // and is a destructuring *pattern* rather than a literal --
            // unreachable from here, and cheaper to exclude than to reason about
            // again later.
            Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) if parts.len() == 1 => {
                let at = parts.first().copied()?;
                let text = probe
                    .node(at)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)?;
                let symbol = shorthand_target(snapshot, &probe, file, &text)?;
                (text, symbol)
            }
            // A spread, an accessor or a method still disqualifies the literal.
            // Half a namespace is worse than none.
            _ => return None,
        };
        let record = snapshot.symbols.get(symbol.0 as usize)?;
        let record = record
            .aliased
            .and_then(|to| snapshot.symbols.get(to.0 as usize))
            .unwrap_or(record);
        let at = record
            .declarations
            .iter()
            .copied()
            .find(|at| probe.kind_of(*at) == Some(syntax::FUNCTION_DECLARATION))?;
        let emitted = naming
            .qualified
            .get(&at)
            .cloned()
            .unwrap_or_else(|| record.name.to_string());
        properties.push((key, emitted));
    }
    Some(properties)
}

impl FuncBuilder<'_> {
    /// The import a name came in through, when it came in through one.
    ///
    /// This is what tells a missing *builtin* apart from a name whose package
    /// has no implementation in the program, and the schema states the
    /// discriminator: `SymbolRecord::declarations` is "empty for a symbol
    /// declared outside the decoded file set". A `lib.d.ts` builtin has none.
    /// An imported name declares at its own import specifier, which is decoded
    /// because this program wrote it -- even though what it names is not.
    ///
    /// Returns the `ImportDeclaration` rather than the module specifier's text:
    /// a string literal's text lives in the extended section of the wire format
    /// and only template literals are decoded from it, so `text` is `None`
    /// here. The node is enough for what the message needs, and `nts deps` has
    /// already named the package.
    pub(super) fn imported_from(&self, callee: NodeId) -> Option<NodeId> {
        use nts_semantic_schema::{NodeKind, syntax};

        let symbol = self.node(callee).symbol?;
        let record = self.snapshot.symbols.get(symbol.0 as usize)?;
        let mut at = *record.declarations.first()?;
        // Up to the enclosing import: specifier, list, named imports, clause,
        // declaration. Bounded, so a malformed parent chain cannot spin.
        for _ in 0..8 {
            let node = self.snapshot.nodes.get(at.0 as usize)?;
            if matches!(
                node.kind,
                NodeKind::Syntax(syntax::IMPORT_DECLARATION | syntax::EXPORT_DECLARATION)
            ) {
                return Some(at);
            }
            at = node.parent?;
        }
        None
    }

    /// Whether `object` names a module and reading it does nothing: a namespace
    /// import (`C`), or a namespace value held in a name (`ns`). Either way a
    /// member of it is the export, and nothing about the receiver needs running.
    pub(super) fn names_a_module_without_effects(&self, object: NodeId) -> bool {
        self.denotes_a_module(object)
            || (self.kind_of(object) == Some(syntax::IDENTIFIER) && self.holds_a_namespace(object))
    }

    /// Whether an expression's value is a module namespace: its checker type is
    /// one, as `await import("./m")` and anything it is stored in are.
    pub(super) fn holds_a_namespace(&self, id: NodeId) -> bool {
        self.snapshot
            .node_types
            .get(&id)
            .is_some_and(|ty| module_of_namespace(self.snapshot, *ty).is_some())
    }

    /// Whether an expression names a module rather than a value.
    ///
    /// `import * as C from "./m"` binds `C` to the module itself. `C.x` is a
    /// reference to `m`'s export `x` -- resolved by the checker to that
    /// export's own symbol -- and not a field of an object this program
    /// allocates. There is no value for `C`, which is why lowering one asked
    /// for "a name from an enclosing scope" and named a module path.
    pub(super) fn denotes_a_module(&self, id: NodeId) -> bool {
        let Some(local) = self.node(id).symbol else {
            return false;
        };
        // Declared by `* as ns`, which binds a name to the module and to
        // nothing in it. Asked of the *local* binding rather than of what it
        // aliases, because the module symbol is not reliably described: with a
        // default export in the imported file it arrives with no declarations
        // at all, and a predicate that looked for a source file among them
        // said no. The import is the thing that is actually written down.
        let declared_as_a_namespace =
            self.snapshot
                .symbols
                .get(local.0 as usize)
                .is_some_and(|record| {
                    record
                        .declarations
                        .iter()
                        .any(|node| self.kind_of(*node) == Some(syntax::NAMESPACE_IMPORT))
                });
        declared_as_a_namespace
            || self
                .snapshot
                .symbols
                .get(self.denoted_symbol(local).0 as usize)
                .is_some_and(|record| {
                    record
                        .declarations
                        .iter()
                        .any(|node| self.kind_of(*node) == Some(syntax::SOURCE_FILE))
                })
    }

    /// `import(specifier)`: a promise of the module's namespace, settled by the
    /// module's job (see [`Self::lower_module_job`]) once it has been evaluated.
    ///
    /// The specifier must be a string the checker resolved to a module this
    /// program contains; anything else refuses by name, because the program is
    /// closed and a specifier computed at run time names a module only a
    /// run-time resolver could find. A second argument, the options, is
    /// evaluated and validated before anything loads (see
    /// [`Self::import_options`]).
    pub(super) fn lower_dynamic_import(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let (specifier, options) = match self.arguments_of(id)[..] {
            [] => return Err(self.unsupported(id, "a dynamic `import()` with no specifier")),
            [specifier] => (specifier, None),
            [specifier, options] => (specifier, Some(options)),
            _ => {
                return Err(self.unsupported(
                    id,
                    "a dynamic `import()` with more than a specifier and options",
                ));
            }
        };
        if !matches!(
            self.kind_of(specifier),
            Some(syntax::STRING_LITERAL | syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL)
        ) {
            return Err(self.unsupported(
                specifier,
                "a dynamic `import()` whose specifier is computed, which names a module only a run-time resolver could find",
            ));
        }
        // After the specifier, which is a constant and so has no effect to order
        // against; before the module is looked for, as node validates them.
        if let Some(options) = options
            && self.import_options(options)? == ImportOptions::NotAnObject
        {
            return self.rejected_import(
                id,
                "TypeError",
                "The second argument to import() must be an object".to_owned(),
            );
        }
        let Some((module, namespace)) = dynamic_import_target(self.snapshot, id) else {
            return self.import_of_nothing(id, specifier);
        };
        let Some(index) = self
            .closures
            .iter()
            .position(|closure| closure.source == ClosureSource::ModuleJob { module })
        else {
            return Err(self.unsupported(id, "a dynamic `import()` whose module has no job"));
        };
        let Some(slot) = self.hierarchy.closure_slot else {
            return Err(
                self.unsupported(id, "a dynamic `import()` in a program with no closure slot")
            );
        };
        let origin = self.origin(id);
        // The job's promise type, which every import of this module shares; the
        // site's own type is the checker's for the same promise.
        let promise_ty = HirType::Managed(ManagedType::Promise(Box::new(HirType::Managed(
            ManagedType::Object(namespace),
        ))));
        self.materialize(id, &promise_ty)?;
        let promise = self.runtime_call(
            "nts_promise_new",
            Vec::new(),
            promise_ty.clone(),
            origin.clone(),
        );
        let job = self.push(
            OpKind::ObjectNew { frame: false },
            HirType::Managed(ManagedType::Object(closure_type(index))),
            origin.clone(),
        );
        self.field_set(job, 0, promise, &origin);
        self.layouts
            .push(self.closure_layout(index, module_job_fields(promise_ty)));
        self.used_closures.push(index);
        let slot = self.push(OpKind::DispatchSlot(slot), HirType::NUMBER, origin.clone());
        self.runtime_call("nts_enqueue_job", vec![job, slot], HirType::Void, origin);
        Ok(promise)
    }

    /// `import()` of a relative specifier that names nothing this program contains
    /// -- a missing file: a promise rejected with an `Error` saying so, as node
    /// rejects one. The specifier is a constant, so this is decided here; the
    /// rejection is what a program observes, and only when it asks. Where it names
    /// a file the program *does* contain, see [`names_a_file_of_the_program`].
    fn import_of_nothing(&mut self, id: NodeId, specifier: NodeId) -> Result<ValueId, Diagnostic> {
        let written = self.literal_name(specifier).unwrap_or_default();
        // **Only a relative path is known to name nothing.** `''` is a URL that
        // resolves to the importer itself -- node loads the importing file, it
        // does not reject -- and a bare specifier is a package lookup this
        // compiler does not model; rejecting either was a wrong answer (nine
        // syntax/valid tests ended on an unhandled rejection node never makes).
        // Both refuse by name, as an unresolved file the program does contain does.
        if !(written.starts_with("./") || written.starts_with("../")) {
            return Err(self.unsupported(
                specifier,
                "a dynamic `import()` whose specifier is not a relative path the checker resolved -- `''` is the \
                 importing module itself, and a bare specifier a package lookup",
            ));
        }
        if names_a_file_of_the_program(self.snapshot, self, id, &written) {
            return Err(self.unsupported(
                specifier,
                "a dynamic `import()` of a file this program contains that the checker did not resolve as a module",
            ));
        }
        self.rejected_import(id, "Error", format!("Cannot find module '{written}'"))
    }

    /// An `import()` that fails before it loads anything: a promise rejected
    /// with a provided `class` of error saying `message`.
    fn rejected_import(
        &mut self,
        id: NodeId,
        class: &str,
        message: String,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let promise_ty = self.type_of(id).ok_or_else(|| {
            self.unrepresentable(id, "the promise a dynamic `import()` hands back")
        })?;
        self.materialize(id, &promise_ty)?;
        let promise = self.runtime_call("nts_promise_new", Vec::new(), promise_ty, origin.clone());
        let message = self.push(
            OpKind::ConstString(message.into()),
            HirType::Managed(ManagedType::String),
            origin,
        );
        // Through `reject_with`, the one rejection path, which hands the runtime a
        // reference: a reason erased here first answered `typeof` "function" on
        // the JVM where C and node answer "object".
        let (error, _) = self.provided_error(id, class, message)?;
        self.reject_with(id, promise, Some(error))?;
        Ok(promise)
    }

    /// Evaluates an `import()`'s options for their effects and answers what they
    /// ask of the import. Decided from what the compiler can see: an object
    /// literal member by member, anything else by its type
    /// ([`import_options_of_type`]); everything else refuses by name.
    ///
    /// An object literal is read rather than built, because building it is not
    /// observable and reading `with` from it is: each data member's value is
    /// evaluated in order, and `with` must be `undefined` or `{}` -- no
    /// attributes. A getter, a method, a spread or a computed key could each run
    /// code or name `with` where the compiler cannot see it, so each refuses.
    fn import_options(&mut self, options: NodeId) -> Result<ImportOptions, Diagnostic> {
        let literal = self.through_parentheses(options);
        if self.kind_of(literal) != Some(syntax::OBJECT_LITERAL_EXPRESSION) {
            let decided = self
                .snapshot
                .node_types
                .get(&options)
                .and_then(|ty| import_options_of_type(self.snapshot, *ty))
                .ok_or_else(|| {
                    self.unsupported(
                        options,
                        "a dynamic `import()` whose options could be an object, read at run time",
                    )
                })?;
            self.lower_for_its_effects(options)?;
            return Ok(decided);
        }
        for member in self.children(literal) {
            let parts = self.children(member);
            let (Some(syntax::PROPERTY_ASSIGNMENT), [key, .., value]) =
                (self.kind_of(member), parts.as_slice())
            else {
                return Err(self.unsupported(
                    member,
                    "an `import()` options member other than `name: value`",
                ));
            };
            if self.kind_of(*key) == Some(syntax::COMPUTED_PROPERTY_NAME) {
                return Err(
                    self.unsupported(member, "an `import()` options member with a computed name")
                );
            }
            if self.literal_name(*key).as_deref() == Some("with") {
                let attributes = self.through_parentheses(*value);
                if self.kind_of(attributes) == Some(syntax::OBJECT_LITERAL_EXPRESSION)
                    && self.children(attributes).is_empty()
                {
                    continue;
                }
                let no_attributes = self
                    .snapshot
                    .node_types
                    .get(value)
                    .and_then(|ty| import_options_of_type(self.snapshot, *ty))
                    == Some(ImportOptions::None);
                if !no_attributes {
                    return Err(
                        self.unsupported(*value, "a dynamic `import()` with import attributes")
                    );
                }
            }
            self.lower_for_its_effects(*value)?;
        }
        Ok(ImportOptions::None)
    }

    /// An `import()`'s job: evaluate the module if it is lazy, then fulfil the
    /// import's promise with its namespace -- or reject it with what evaluation
    /// threw, which is the same error for every import of a module that failed.
    ///
    /// A job rather than evaluating at the call: `import()` returns before the
    /// module runs, and code after the call sees it not yet evaluated, as node
    /// does.
    pub(super) fn lower_module_job(
        &mut self,
        index: usize,
        module: usize,
    ) -> Result<Func, Diagnostic> {
        let (_, name) = closure_names(index);
        let root = self.snapshot.modules[module].root;
        let origin = self.origin(root);
        let receiver_ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let receiver = self.push(OpKind::Param(0), receiver_ty.clone(), origin.clone());
        let params = vec![Param {
            name: "this".to_owned(),
            shape: ParamShape::Ordinary,
            ty: receiver_ty,
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        let Some(namespace) = self.module.roles.namespace.get(module).copied().flatten() else {
            return Err(self.unsupported(
                root,
                "a module job for a module nothing imports dynamically",
            ));
        };
        let payload = HirType::Managed(ManagedType::Object(namespace));
        let promise_ty = HirType::Managed(ManagedType::Promise(Box::new(payload.clone())));
        self.materialize(root, &promise_ty)?;
        self.layouts
            .push(self.closure_layout(index, module_job_fields(promise_ty.clone())));
        let promise = self.push(
            OpKind::FieldGet {
                object: receiver,
                field: 0,
            },
            promise_ty,
            origin.clone(),
        );
        if let Some(lazy) = self.module.evaluated.get(module).copied().flatten() {
            let ok = self.push(
                OpKind::Call {
                    callee: Callee::Direct(module_evaluate_name(module)),
                    args: Vec::new(),
                    frame: None,
                },
                HirType::Bool,
                origin.clone(),
            );
            let fulfils = self.new_block();
            let rejects = self.new_block();
            self.terminate(Terminator::Branch {
                cond: ok,
                then_target: fulfils,
                then_args: Vec::new(),
                else_target: rejects,
                else_args: Vec::new(),
            });
            self.switch_to(rejects);
            let thrown = self.push(
                OpKind::GlobalGet(lazy.error),
                HirType::Erased,
                origin.clone(),
            );
            self.runtime_call(
                "nts_promise_reject_value",
                vec![promise, thrown],
                HirType::Void,
                origin.clone(),
            );
            self.terminate(Terminator::Return(None));
            self.switch_to(fulfils);
        }
        // The module's one namespace object.
        let value = self.push(OpKind::ClosureStatic, payload.clone(), origin.clone());
        self.fulfil(
            root,
            &AsyncResult {
                promise,
                payload,
                written: None,
            },
            Some(value),
        )?;
        self.terminate(Terminator::Return(None));
        Ok(self.finish(name, params, HirType::Void, origin, false))
    }

    /// A module namespace's layout: no fields, because a read of one goes to the
    /// export through the type. One for a checker's namespace type and for the
    /// compiler's own ([`super::namespace_type`]) alike.
    pub(super) fn namespace_layout(&mut self, module: usize, ty: TypeId) -> Layout {
        let layout = Layout {
            types: vec![ty],
            name: format!("module{module}#namespace"),
            interfaces: Vec::new(),
            fields: Vec::new(),
            methods: Vec::new(),
            base: None,
        };
        self.layouts.push(layout.clone());
        layout
    }
}
