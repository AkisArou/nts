//! Native link metadata and declared module facts.

use super::{
    Diagnostic, FuncBuilder, HirType, Location, NodeId, NodeKind, OpKind, Program,
    SemanticSnapshot, collect_class_identities, collect_plain_records,
};

/// Record which classes each layout carries, once every layout is final.
///
/// **Per layout *and* symbol, not per symbol.** A generic class has one symbol
/// and one instantiation per type argument, and those have genuinely different
/// layouts -- `Fifo<A>` and `Fifo<B>` are different structs. Grouping by symbol
/// alone put both in one identity, `canonicalize_objects` then rewrote both to
/// the first one's type, and twelve modules stopped building with
/// `incompatible pointer types assigning to 'NtsObj_Fifo_2538_ *' from
/// 'NtsObj_Fifo_8539_ *'`.
///
/// So a symbol says *which class* and a layout says *which instantiation*, and
/// an identity is both. Two ids of one instantiation still share an entry,
/// which is the case it exists for.
///
/// After the merge rather than during it, because a type's final layout is not
/// known until every builder has contributed -- a layout is discovered by
/// whichever function first needs it.
/// What a program states rather than what lowering derives.
///
/// Both of these read declarations the value graph does not reach -- an ambient
/// `declare module` is never lowered -- so they are scans of the snapshot and
/// not products of the walk above.
pub(super) fn collect_declared_facts(
    program: &mut Program,
    snapshot: &SemanticSnapshot,
) -> Vec<Diagnostic> {
    collect_class_identities(program, snapshot);
    collect_plain_records(program);
    collect_native_headers(program, snapshot)
}

/// Gather the headers, macros and pkg-config packages of the native binding
/// modules the program holds a declaration from -- a function it calls, a
/// record it lays out, a virtual function it overrides -- and the frameworks
/// and libraries of the functions it calls. A package a module names that is
/// not one pkg-config could take is refused, at the module.
///
/// A scan rather than a traversal: an ambient `declare module` is not reached
/// by lowering, which follows values, and there is exactly one pass over the
/// nodes here against the many a lookup would repeat.
fn collect_native_headers(program: &mut Program, snapshot: &SemanticSnapshot) -> Vec<Diagnostic> {
    // The modules this program actually holds a declaration from, rather than
    // every module in the snapshot. `runtime/native/libc.d.ts` declares several
    // and a program importing one of them carried all of their headers:
    // `native-stat` compiled with seven and used one.
    //
    // **By identity, not by a rule about names.** An earlier attempt filtered
    // on "does the program reach this module" guessed from node kinds, left
    // sixteen examples and every test green, and emptied a witness -- a binding
    // of `getpid` alone declares no type, the guess said unreached, and the
    // witness compared `extern int getpid(void);` against nothing. Nothing
    // observes a check that stopped checking, so the rule has to be exact.
    let mut reached = rustc_hash::FxHashSet::default();
    let mut seen = rustc_hash::FxHashSet::default();
    for func in &program.funcs {
        for op in &func.values {
            if let OpKind::Call {
                callee: crate::hir::Callee::Native(target),
                ..
            } = &op.kind
            {
                reached.extend(target.declared_at);
                program.objc |= target.send.is_some();
                program
                    .native_frameworks
                    .extend(target.frameworks.iter().cloned());
                program
                    .native_libraries
                    .extend(target.libraries.iter().cloned());
            }
            if let OpKind::ObjcClass { frameworks, .. } = &op.kind {
                program.objc = true;
                program.native_frameworks.extend(frameworks.iter().cloned());
            }
            // A selector is read through the lookups a send uses, which
            // only a program that talks to the runtime declares.
            program.objc |= matches!(op.kind, OpKind::ObjcSelector { .. });
            // A record enters a program through a type, not only through a
            // call: a program may hold a `Ptr<Rusage>` and call nothing from
            // the module that describes it. Every value is walked, parameters
            // included -- a parameter is an `OpKind::Param` with its own type,
            // not a separate list.
            if let HirType::NativePointer(pointee) = &op.ty {
                collect_native_modules(pointee, &mut reached, &mut seen);
            }
        }
    }
    // And a virtual function a class of the program's overrides: the module
    // declaring it is one the program holds a declaration from, whose headers
    // the witness asks about the slot -- whether or not the program also
    // calls into that module.
    for class in &program.foreign_classes {
        reached.extend(class.methods.iter().filter_map(|method| method.declared_at));
    }
    let (mut headers, mut defines) = (Vec::new(), Vec::new());
    let (mut packages, mut refused) = (Vec::new(), Vec::new());
    for (at, node) in snapshot.nodes.iter().enumerate() {
        if !matches!(
            node.kind,
            NodeKind::Syntax(
                nts_semantic_schema::syntax::MODULE_DECLARATION
                    | nts_semantic_schema::syntax::SOURCE_FILE
            )
        ) {
            continue;
        }
        let Some(native) = node.native.as_ref() else {
            continue;
        };
        if !reached.contains(&nts_semantic_schema::NodeId(
            u32::try_from(at).unwrap_or(u32::MAX),
        )) {
            continue;
        }
        headers.extend(native.headers.iter().flatten().cloned());
        defines.extend(native.defines.iter().flatten().cloned());
        // The module's packages, on the same terms as its headers: a program
        // holding any declaration of it compiles and links against them.
        if let Some(names) = &native.packages {
            let module = declared_module_name(snapshot, at, node.origin.location);
            for name in names {
                if (LinkTag::PACKAGE.valid)(name) {
                    packages.push(crate::hir::NativePackage {
                        name: name.clone(),
                        module: module.clone(),
                    });
                } else {
                    refused.push(Diagnostic::error(
                        "NTS0005",
                        format!("{}, and `{name}` is not one", LinkTag::PACKAGE.rule),
                        node.origin.location,
                    ));
                }
            }
        }
    }
    for list in [&mut headers, &mut defines] {
        list.sort();
        list.dedup();
    }
    packages.sort();
    packages.dedup();
    program.native_headers = headers;
    program.native_defines = defines;
    program.native_packages = packages;
    program.native_frameworks.sort();
    program.native_frameworks.dedup();
    program.native_libraries.sort();
    program.native_libraries.dedup();
    refused
}

/// A module as the program imports it, `c:HarfBuzz-0.0`: the checker names a
/// `declare module`'s symbol by its specifier, quotes and all. A file's own
/// tags (`SOURCE_FILE`) have no such symbol, and are named by the file.
fn declared_module_name(snapshot: &SemanticSnapshot, at: usize, location: Location) -> String {
    let id = nts_semantic_schema::NodeId(u32::try_from(at).unwrap_or(u32::MAX));
    snapshot
        .symbols
        .iter()
        .find(|record| record.declarations.contains(&id))
        .and_then(|record| record.name.public_name())
        .map(|name| name.trim_matches('"').to_owned())
        .or_else(|| {
            snapshot
                .sources
                .get(location.file.0 as usize)
                .map(|source| source.display_path.to_string())
        })
        .unwrap_or_default()
}

/// A name as `-l` and pkg-config take one -- `glib-2.0`, `stdc++`,
/// `harfbuzz-gobject` -- and never a flag: letters, digits, `_`, `-`, `+`,
/// `.`, and no leading `-`.
fn is_link_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '+' | '.'))
}

/// Every module a native type reaches a record from, following the views and
/// elements a pointee is made of.
///
/// `seen` stops a record that points at itself, which C has and this walk would
/// otherwise follow forever.
fn collect_native_modules(
    pointee: &crate::hir::native::Pointee,
    into: &mut rustc_hash::FxHashSet<nts_semantic_schema::NodeId>,
    seen: &mut rustc_hash::FxHashSet<String>,
) {
    use crate::hir::native::Pointee;
    match pointee {
        Pointee::Record(layout) => {
            if !seen.insert(layout.name.clone()) {
                return;
            }
            into.extend(layout.declaring_module());
            for field in &layout.fields {
                collect_native_modules(&field.ty, into, seen);
            }
        }
        Pointee::Pointer(inner)
        | Pointee::Const(inner)
        | Pointee::Unaligned(inner)
        | Pointee::Flexible(inner)
        | Pointee::Array { element: inner, .. } => collect_native_modules(inner, into, seen),
        Pointee::Scalar(_) | Pointee::Opaque(_) | Pointee::Void | Pointee::Bits { .. } => {}
        Pointee::FnPointer(signature) => {
            for ty in signature
                .parameters
                .iter()
                .chain(std::iter::once(&*signature.result))
            {
                if let crate::hir::native::Type::Pointer(inner) = ty {
                    collect_native_modules(inner, into, seen);
                }
            }
        }
    }
}

/// A tag naming what a declaration links: where its names are, which names it
/// accepts, and the sentence that says so when one is not.
#[derive(Clone, Copy)]
pub(super) struct LinkTag {
    names: fn(&nts_semantic_schema::NativeAttributes) -> Option<&Vec<String>>,
    valid: fn(&str) -> bool,
    rule: &'static str,
}

impl LinkTag {
    /// An Apple framework, which is named like a C identifier.
    pub(super) const FRAMEWORK: Self = Self {
        names: |n| n.frameworks.as_ref(),
        valid: crate::hir::native::is_c_identifier,
        rule: "@ntsFramework names frameworks by their names, as in `@ntsFramework Foundation`",
    };
    /// A C library, `-l<name>`: what a linker accepts in the name, which is
    /// wider than an identifier (`glib-2.0`, `stdc++`).
    pub(super) const LIBRARY: Self = Self {
        names: |n| n.libraries.as_ref(),
        valid: is_link_name,
        rule: "@ntsLibrary names libraries as `-l` takes them, as in `@ntsLibrary gdi32` or `@ntsLibrary glib-2.0` \
               (letters, digits, `_`, `-`, `+`, `.`)",
    };
    /// A pkg-config package, which a module names (`@ntsPackage`): what
    /// pkg-config takes, and as `-l` takes a library, never a flag.
    const PACKAGE: Self = Self {
        names: |n| n.packages.as_ref(),
        valid: is_link_name,
        rule: "@ntsPackage names pkg-config packages as pkg-config takes them, as in \
               `@ntsPackage gtk4 harfbuzz-gobject` (letters, digits, `_`, `-`, `+`, `.`)",
    };
}

impl FuncBuilder<'_> {
    /// The names a link tag (`@ntsFramework`, `@ntsLibrary`) gives on the
    /// nearest enclosing declaration naming any: the function, or the
    /// `declare module` a binding is written as. One walk for both tags.
    pub(super) fn declared_names(
        &self,
        call: NodeId,
        declaration: NodeId,
        tag: LinkTag,
    ) -> Result<Vec<String>, Diagnostic> {
        let mut at = Some(declaration);
        while let Some(id) = at {
            let node = self.node(id);
            if let Some(names) = node.native.as_ref().and_then(|n| (tag.names)(n)) {
                // A malformed tag is the source's error, not a gap in lowering.
                if let Some(bad) = names.iter().find(|name| !(tag.valid)(name)) {
                    return Err(Diagnostic::error(
                        "NTS0005",
                        format!("{}, and `{bad}` is not one", tag.rule),
                        self.location(call),
                    ));
                }
                return Ok(names.clone());
            }
            at = node.parent;
        }
        Ok(Vec::new())
    }
}
