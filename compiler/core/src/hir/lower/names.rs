//! Choose stable names for declarations, members, and instantiations.

use super::{
    CONSTRUCTOR_KEY, Diagnostic, FuncBuilder, HirType, LoweringSnapshot, ManagedType, MemberKey,
    MethodAccessor, NodeId, NodeKind, RAISING_SUFFIX, SemanticSnapshot, SymbolId, TypeId,
    declares_a_class, instance_type_of, is_a_generic_declaration, nominal_or_stand_in, syntax,
};

/// Interfaces, which declare methods and implement none of them.
///
/// A method on an interface is a dispatch root: every implementer must be
/// reachable through it, which is exactly what a slot is for. Until this
/// existed, `sink.write(v)` on a `Sink`-typed receiver found no declaration in
/// the hierarchy and was refused -- 739 occurrences across the corpus and the
/// most frequent single shape in two other lanes' inventories.
/// Whether a member's declaration is one with a body, rather than a signature.
///
/// The three kinds [`members_of`](super::members_of) lowers. A `METHOD_SIGNATURE` -- what a type
/// literal or an interface declares -- is a shape and has no function behind it.
pub(super) fn implemented_member(probe: &FuncBuilder, node: NodeId) -> bool {
    matches!(
        probe.kind_of(node),
        Some(syntax::METHOD_DECLARATION | syntax::GET_ACCESSOR | syntax::SET_ACCESSOR)
    )
}

/// The key a member is dispatched under: its name, with `get `/`set ` where it is an
/// accessor, which is the spelling `accessor_callee` and `hierarchy.declares` both use.
pub(super) fn member_dispatch_key(probe: &FuncBuilder, member: NodeId) -> Option<MemberKey> {
    let accessor = match probe.kind_of(member)? {
        syntax::METHOD_DECLARATION | syntax::METHOD_SIGNATURE => MethodAccessor::Method,
        syntax::GET_ACCESSOR => MethodAccessor::Get,
        syntax::SET_ACCESSOR => MethodAccessor::Set,
        _ => return None,
    };
    Some(MemberKey {
        key: probe.property_key(probe.name_node(member)?)?,
        accessor,
    })
}

/// The emitted name of every function and class declaration whose plain name is
/// taken, and the ones nothing here can tell apart.
///
/// Its own function because the class **hierarchy** needs the same answer and is
/// built before [`naming`](super::naming) is. `hierarchy.name` is what an instance method is
/// spelled with, and taking the identifier's text there while
/// [`FuncBuilder::class_name_for`]'s static arm took this map is how two modules
/// exporting a class of one name came to define one `Thing#value`: no vtable was
/// emitted, all three descriptors carried a null method table, and a virtual
/// call went through it. `exit 139`, with no refusal and nothing in the output
/// to read.
///
/// Called twice rather than threaded through four signatures, which is a cost
/// and not a hazard: one function, one input, the same answer. What this file
/// warns about is two *derivations* of a fact, and that is precisely what the
/// bug above was.
pub(super) fn qualified_names(
    snapshot: &LoweringSnapshot<'_>,
) -> (
    rustc_hash::FxHashMap<NodeId, String>,
    rustc_hash::FxHashSet<NodeId>,
) {
    let probe = FuncBuilder::probe(snapshot);
    let mut declarations: rustc_hash::FxHashMap<String, Vec<NodeId>> =
        rustc_hash::FxHashMap::default();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        // Classes as well as functions. A method is spelled `Class#method`, so
        // it cannot collide with a plain function -- but it collides happily
        // with a method of *another class of the same name*, and `dgram` and
        // `net` both export a `Socket`. That emitted two `Socket#ref`, which
        // is one C function defined twice and whichever the linker picked.
        let is_named_declaration =
            matches!(node.kind, NodeKind::Syntax(syntax::FUNCTION_DECLARATION))
                || matches!(node.kind, NodeKind::Syntax(kind) if declares_a_class(kind));
        if !is_named_declaration {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        // A body is what separates an implementation from an overload
        // signature. A class always has one.
        if node.kind == NodeKind::Syntax(syntax::FUNCTION_DECLARATION) && !probe.has_a_body(id) {
            continue;
        }
        if let Some(name) = probe.declared_name(id) {
            declarations.entry(name).or_default().push(id);
        }
    }

    let mut qualified: rustc_hash::FxHashMap<NodeId, String> = rustc_hash::FxHashMap::default();
    let mut ambiguous: rustc_hash::FxHashSet<NodeId> = rustc_hash::FxHashSet::default();
    for (name, ids) in declarations {
        if ids.len() < 2 {
            continue;
        }
        for id in &ids {
            let file = probe.node(*id).origin.location.file;
            // Another declaration of this name in the same file: nothing here
            // tells them apart.
            if ids
                .iter()
                .any(|other| other != id && probe.node(*other).origin.location.file == file)
            {
                ambiguous.insert(*id);
                continue;
            }
            // The shortest tail of the path that tells this declaration from
            // the others of its name. The stem alone is not enough:
            // `path/posix.ts` and `path/win32.ts` differ by it, and
            // `dgram/src/main.ts` and `net/src/main.ts` do not -- both are
            // `main`, so qualifying by the stem produced the same name twice
            // and fixed nothing. The whole path always works and reads like a
            // machine wrote it, so this takes components from the end until
            // they are distinct: `dgram_src_main`, not `_home_akisarou_...`.
            let module = distinguishing_tail(snapshot, &ids, *id);
            qualified.insert(*id, format!("{name}@{module}"));
        }
    }
    (qualified, ambiguous)
}

/// Decide what every function declaration is called in the emitted program.
///
/// Two C functions may not share a name, and two TypeScript functions may.
/// There are two ways it happens and they want opposite answers:
///
/// - **Different modules.** `path/posix.ts` and `path/win32.ts` both declare
///   `basename`, because `path` genuinely has two implementations of one
///   interface and Node ships both. These are ordinary module-private helpers
///   and refusing them refuses the module. They are *qualified* by the file
///   they come from: `basename@posix`. `@` cannot appear in a TypeScript
///   identifier, so the qualified name cannot collide with a plain one.
/// - **The same module.** Two namespaces in one file each exporting `area`.
///   Nothing here distinguishes them — a namespace's members are lowered under
///   their unqualified names — so both are refused. Both, rather than the
///   second: emitting the first and dropping the second is a program that
///   compiles and calls the wrong one.
///
/// Overload signatures share a name legitimately and only the implementation
/// has a body, so a declaration without one does not count. Methods are spelled
/// `Class#method` and cannot collide with a plain function.
/// The shortest tail of a file's path that tells it from the others in a group.
///
/// One component if that is enough -- `posix` against `win32` -- and more where
/// it is not: `dgram/src/main.ts` and `net/src/main.ts` share every component
/// but the third from the end.
fn distinguishing_tail(snapshot: &SemanticSnapshot, group: &[NodeId], id: NodeId) -> String {
    let components = |at: NodeId| -> Vec<String> {
        let file = snapshot
            .nodes
            .get(at.0 as usize)
            .map_or(nts_diagnostics::SourceId(0), |node| {
                node.origin.location.file
            });
        snapshot
            .sources
            .get(file.0 as usize)
            .map_or_else(Vec::new, |source| {
                source
                    .display_path
                    .as_str()
                    .trim_end_matches(".ts")
                    .split('/')
                    .filter(|part| !part.is_empty())
                    .map(|part| part.replace(['.', '-'], "_"))
                    .collect()
            })
    };
    let mine = components(id);
    let others: Vec<Vec<String>> = group
        .iter()
        .filter(|other| **other != id)
        .map(|other| components(*other))
        .collect();
    let tail = |parts: &[String], take: usize| -> String {
        parts[parts.len().saturating_sub(take)..].join("_")
    };
    for take in 1..=mine.len().max(1) {
        let candidate = tail(&mine, take);
        if others.iter().all(|other| tail(other, take) != candidate) {
            return candidate;
        }
    }
    tail(&mine, mine.len())
}

/// A token index for every class the program declares. See
/// [`Naming::class_tokens`](super::Naming::class_tokens).
///
/// In symbol order, which is a property of the snapshot rather than of the walk
/// that reads it -- so one program gives one token the same id on every run,
/// and a dump can be diffed.
pub(super) fn class_token_indices(
    snapshot: &SemanticSnapshot,
) -> rustc_hash::FxHashMap<u32, usize> {
    let mut tokens: rustc_hash::FxHashMap<u32, usize> = rustc_hash::FxHashMap::default();
    for (index, symbol) in snapshot.symbols.iter().enumerate() {
        if symbol
            .flags
            .contains(nts_semantic_schema::SymbolFlags::CLASS)
        {
            let next = tokens.len();
            tokens.insert(u32::try_from(index).unwrap_or(u32::MAX), next);
        }
    }
    tokens
}

/// The name a class member is emitted under, when the declaration is one.
///
/// **The emitted spelling, member kind by member kind**, because a cascade asks
/// with the name the callee was emitted as and a key one character off is a key
/// nobody finds:
///
/// | declaration | key | built by |
/// |---|---|---|
/// | instance method | `Owner#member` | `FuncBuilder::callee_for` |
/// | static method | `Owner.member` | `FuncBuilder::static_method_name` |
/// | instance accessor | `Owner#get x` / `Owner#set x` | `callee_for`; the napi wrapper's `member_kind` documents the space |
/// | static accessor | `Owner.get x` | `Self::static_accessor_place` |
/// | constructor | `Owner#constructor` | `lower_class`, and what the napi wrapper asks with |
///
/// `None` for anything that is not a class member, which is what makes it the
/// test [`note_uncompiled`](super::note_uncompiled) uses for "is this a member" -- and therefore for
/// whether the bare name belongs to this declaration at all.
///
/// Walks to the enclosing `class`, which is syntax rather than the hierarchy
/// lookup the lowering uses -- this runs where a refusal is recorded and has a
/// node, not a resolved type. A constructor is named `constructor` regardless
/// of what `declared_name` found in it, because a constructor has no
/// `IDENTIFIER` child to find.
pub(super) fn qualified_name(
    snapshot: &LoweringSnapshot<'_>,
    id: NodeId,
    declared: Option<&str>,
) -> Option<String> {
    let probe = FuncBuilder::probe(snapshot);
    let member = match snapshot.nodes.get(id.0 as usize)?.kind {
        // **Not `declared` for this one, and that is the whole point.**
        // `declared_name` returns the text of the first `IDENTIFIER` child, and
        // a constructor has none -- `constructor` is a keyword. So it answers
        // `None` here, and this arm was unreachable from `note_uncompiled`
        // until that function stopped requiring a declared name first.
        NodeKind::Syntax(syntax::CONSTRUCTOR) => CONSTRUCTOR_KEY.to_owned(),
        NodeKind::Syntax(syntax::METHOD_DECLARATION) => declared?.to_owned(),
        // **An accessor's emitted name carries the keyword**, which is why it is
        // built here rather than taken from `declared_name`: a getter is emitted
        // as `Owner#get size` (`FuncBuilder::callee_for`) and a static one as
        // `Owner.get size` (`Self::static_accessor_place`). Measured on the
        // control, with a refused getter and a refused method in one class:
        //
        //     calls  it calls `Holder#plain`, and a regular expression literal ...
        //     reads  it calls `Holder#get size`, which was refused above
        //
        // -- the cause recorded under the bare `size`, which is the key a
        // module-scope `function size` also owns, and which nothing asks with.
        NodeKind::Syntax(syntax::GET_ACCESSOR | syntax::SET_ACCESSOR) => {
            member_dispatch_key(&probe, id)?.emitted_name()
        }
        _ => return None,
    };
    let mut at = snapshot.nodes.get(id.0 as usize)?.parent;
    while let Some(node) = at {
        let record = snapshot.nodes.get(node.0 as usize)?;
        if matches!(record.kind, NodeKind::Syntax(kind) if declares_a_class(kind)) {
            // **`.` for a static and `#` for an instance member, because that is
            // the difference between the two emitted names.** A static method is
            // emitted as `Owner.member` (`FuncBuilder::static_method_name`) and an
            // instance method as `Owner#member`, and a cascade asks with the
            // *emitted* name -- so a refused static recorded under `Owner#member`
            // was unfindable, one character from the key that would have answered.
            //
            // Measured on the control, with a class holding one refused static and
            // one refused instance method:
            //
            //     viaInstance  it calls `Holder#instanceNames`, and a regular
            //                  expression literal ...
            //     viaStatic    it calls `Holder.names`, which was refused above
            //
            // "Which was refused above" is the sentence `drop_callers_of_refused`
            // calls a claim that "is not always true", and here it was false in the
            // other direction: the cause was recorded, under a name nobody asks.
            let separator = if is_static_member(snapshot, id) {
                '.'
            } else {
                '#'
            };
            return probe
                .class_name(node)
                .map(|owner| format!("{owner}{separator}{member}"));
        }
        at = record.parent;
    }
    None
}

/// Whether a class member carries `static`.
///
/// Read in two places that have to agree: the loop making one copy per
/// instantiation, which emits a static once, and `lower_method_of`, which names
/// it without the instantiation for the same reason.
/// Whether a symbol is declared `static`, asked of the symbol rather than a node.
///
/// The member-access path has the *name*'s symbol and not the declaration, and
/// a module-scope `const` and a static field both land in
/// `ModuleScope::variables` -- so without this, `o.someName` where `someName`
/// happens to be a module-scope binding's symbol would read that global. It
/// cannot arise today, because a property name and a variable are different
/// symbols, and it is one `flags` test to make the arm say what it means.
pub(super) fn is_static_member_symbol(snapshot: &SemanticSnapshot, symbol: SymbolId) -> bool {
    snapshot
        .symbols
        .get(symbol.0 as usize)
        .into_iter()
        .flat_map(|record| record.declarations.iter())
        .any(|declaration| is_static_member(snapshot, *declaration))
}

pub(super) fn is_static_member(snapshot: &SemanticSnapshot, member: NodeId) -> bool {
    snapshot.nodes.get(member.0 as usize).is_some_and(|node| {
        node.modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::STATIC)
    })
}

fn declaration_identifier(snapshot: &SemanticSnapshot, declaration: NodeId) -> Option<&str> {
    snapshot
        .nodes
        .get(declaration.0 as usize)?
        .children
        .iter()
        .flat_map(|child| {
            let node = &snapshot.nodes[child.0 as usize];
            if node.kind == NodeKind::List {
                node.children.as_slice()
            } else {
                std::slice::from_ref(child)
            }
        })
        .find(|child| snapshot.nodes[child.0 as usize].kind == NodeKind::Syntax(syntax::IDENTIFIER))
        .and_then(|child| {
            snapshot
                .nodes
                .get(child.0 as usize)?
                .text
                .as_ref()?
                .as_utf8()
        })
}

pub(super) fn named_class_source(
    snapshot: &SemanticSnapshot,
    declaration: NodeId,
    symbol: u32,
) -> Option<crate::hir::NamedClassSource> {
    let name = declaration_identifier(snapshot, declaration)?;
    let node = snapshot.nodes.get(declaration.0 as usize)?;
    let module = snapshot
        .sources
        .get(node.origin.location.file.0 as usize)?
        .uri
        .clone();
    let mut scopes = vec![name.to_owned()];
    let mut at = node.parent;
    while let Some(parent) = at {
        let node = snapshot.nodes.get(parent.0 as usize)?;
        if matches!(
            node.kind,
            NodeKind::Syntax(
                syntax::CLASS_DECLARATION
                    | syntax::CLASS_EXPRESSION
                    | syntax::FUNCTION_DECLARATION
                    | syntax::FUNCTION_EXPRESSION
                    | syntax::METHOD_DECLARATION
                    | syntax::MODULE_DECLARATION
            )
        ) && let Some(name) = declaration_identifier(snapshot, parent)
        {
            scopes.push(name.to_owned());
        }
        at = node.parent;
    }
    scopes.reverse();
    Some(crate::hir::NamedClassSource {
        symbol,
        module,
        scopes,
    })
}

/// The symbol of the class a type is the instance of, if it is one.
pub(super) fn class_symbol(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<u32> {
    let record = snapshot.types.get(ty.0 as usize)?;
    let symbol = record.symbol?;
    let declared = snapshot.symbols.get(symbol.0 as usize)?;
    declared
        .flags
        .contains(nts_semantic_schema::SymbolFlags::CLASS)
        .then_some(symbol.0)
}

pub(in crate::hir) fn instantiation_suffix(snapshot: &SemanticSnapshot, ty: TypeId) -> String {
    let instantiated = snapshot
        .type_arguments
        .get(&ty)
        .is_some_and(|arguments| !arguments.is_empty())
        && !is_a_generic_declaration(snapshot, ty);
    if instantiated {
        format!("<{}>", ty.0)
    } else {
        String::new()
    }
}

/// Whether a member of a class over a `GObject` class names an override:
/// `vfunc_measure`, as the `c:` surface and GJS spell one, or `vfuncMeasure`,
/// as the `gi:` surface does. The slot it fills is the overridden
/// declaration's `@ntsVfunc`, whichever the spelling.
pub(super) fn is_override_name(name: &str) -> bool {
    name.strip_prefix("vfunc").is_some_and(|rest| {
        rest.starts_with('_') || rest.starts_with(|c: char| c.is_ascii_uppercase())
    })
}

impl FuncBuilder<'_> {
    pub(super) fn qualified_class_name(&self, identifier: NodeId) -> Option<String> {
        let symbol = self.node(identifier).symbol?;
        let record = self.snapshot.symbols.get(symbol.0 as usize)?;
        let at = record
            .declarations
            .iter()
            .copied()
            .find(|at| self.kind_of(*at).is_some_and(declares_a_class))?;
        self.qualified.get(&at).cloned()
    }

    /// What a member of this class is named for, in the emitted program.
    ///
    /// A `static` member has no receiver, and TypeScript forbids it from
    /// referencing a class type parameter (TS2302). So it is one function
    /// however many copies the class has: there is nothing for a substitution
    /// to change, and a call site writing `Factory.of(n)` names no
    /// instantiation and could not choose between them if it wanted to. Naming
    /// it for a copy emitted `Factory<86>.of` against a call to `Factory.of`,
    /// and the call was dropped as calling something refused.
    pub(super) fn class_name_for(
        &mut self,
        class: NodeId,
        instance: Option<TypeId>,
        is_static: bool,
    ) -> Result<String, Diagnostic> {
        match instance.filter(|_| !is_static) {
            // The layout's name rather than the declaration's, because two
            // instantiations of one class must not produce one function.
            //
            // The hierarchy's first, where it has one. For an instantiation the
            // two agree by construction -- `collect_hierarchy` says so and says
            // why. For an *anonymous* type they do not: the layout may have
            // merged with another shape-identical one, and the call site reads
            // the hierarchy, so taking the layout here would define
            // `Type4#which` against a call to `Type8#which`.
            Some(ty) => match self.hierarchy.name.get(&ty) {
                Some(name) => Ok(name.clone()),
                None => Ok(self.layout_of(class, ty)?.name),
            },
            // Through the same naming that keeps two functions of one name
            // apart. A method is spelled `Class#method`, which cannot collide
            // with a plain function and collides readily with a method of
            // another class of the same name: `dgram` and `net` both export a
            // `Socket`, and both emitted `Socket#ref`.
            //
            // `class_name` and not the identifier directly, because an
            // anonymous class expression has none and its members still have
            // to be called something. It answers with the layout's own
            // stand-in, which is what the call site will have asked
            // `layout_of` for -- the two names meet in the C symbol table and
            // a second derivation of either is a call to a function nothing
            // defines.
            None => self
                .class_name(class)
                .ok_or_else(|| self.unsupported(class, "an anonymous class")),
        }
    }

    /// What a method's compiled form hands back.
    ///
    /// Three answers and the first is the one that is not obvious. A generator's
    /// declared `Generator<T, …>` has no representation and is not what the
    /// compiled method returns -- the **frame** is, exactly as in
    /// `lower_function` -- and it is deliberately *not* materialized, because a
    /// frame has no snapshot type to build a layout from and `hir::suspend` is
    /// the only thing that can. Materializing it anyway answers `an object type
    /// that is not in the snapshot`.
    ///
    /// Lifted out of `lower_method_of` for length, which is the honest reason;
    /// it also puts the three next to each other, which reads better than a
    /// chain in the middle of a longer function.
    pub(super) fn method_return_type(
        &mut self,
        member: NodeId,
        is_constructor: bool,
        generated: Option<&crate::hir::GeneratorFrame>,
    ) -> Result<HirType, Diagnostic> {
        if let Some(frame) = generated {
            return Ok(HirType::Managed(ManagedType::Object(frame.ty)));
        }
        if is_constructor || self.kind_of(member) == Some(syntax::SET_ACCESSOR) {
            self.materialize(member, &HirType::Void)?;
            return Ok(HirType::Void);
        }
        let return_type = self.return_type_of(member)?;
        self.materialize(member, &return_type)?;
        Ok(return_type)
    }

    /// The class's name and the name a member is **emitted** under -- the one
    /// every call site writes and every dispatch table holds.
    ///
    /// Its own function because the *recorder* needs the same answer.
    /// `note_uncompiled` is handed `None` from every member site, so a refused
    /// member is recorded under `qualified_name`'s `Owner#member` while the table
    /// and the callers hold `Owner<12971>#member` -- the class's instantiation
    /// suffix, which `class_name_for` supplies and `qualified_name` cannot. The
    /// entry is written and never found: every cascade through it says "refused
    /// above" about something `nts refusals` cannot show, and a dispatch slot
    /// goes null with no diagnostic at all. `runtime/node/http` ships exactly
    /// that today -- `OutgoingMessage<12971>#destroy` is in the prepared HIR, is
    /// in no emitted C, and is named by neither refusal record.
    ///
    /// Both names, because `lower_method_of` reads the class's for a diagnostic
    /// of its own and a second `class_name_for` there would be one more place
    /// deciding what a class is called. Tonight that was the whole bug, one
    /// table over.
    pub(super) fn emitted_member_name(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<(String, String), Diagnostic> {
        let is_static = is_static_member(self.snapshot, member);
        if self.needs_parameter_entry(member) {
            self.parameter_entry = Some(member);
            self.prepare_parameter_cells(member);
        }
        let class_name = self.class_name_for(class, instance, is_static)?;
        // An accessor shares its *name* with the property it presents, so the
        // emitted name has to say which it is: a class may declare `get x` and
        // `set x` together, and both are functions taking the receiver. The
        // space is punctuation no TypeScript identifier may contain, like the
        // `#` beside it.
        let member_name = if self.kind_of(member) == Some(syntax::CONSTRUCTOR) {
            CONSTRUCTOR_KEY.to_owned()
        } else {
            member_dispatch_key(self, member)
                .map(|key| key.emitted_name())
                .ok_or_else(|| {
                    self.unsupported(member, "a member whose name the program computes")
                })?
        };
        // Neither `#` nor `.` can appear in a TypeScript identifier, so a
        // qualified name cannot collide with a plain function's -- and the two
        // spellings keep `static foo()` and `foo()` apart, which one class is
        // allowed to declare together.
        let emitted = if is_static {
            format!("{class_name}.{member_name}")
        } else {
            format!("{class_name}#{member_name}")
        };
        Ok((class_name, emitted))
    }

    /// The *instance* type a class declaration names.
    ///
    /// A class symbol's own type is the constructor's, and what `new` produces
    /// is a different type sharing that symbol. Found by the symbol rather than
    /// by the name, because two modules may each declare a `Point`.
    pub(super) fn declared_instance_type(&self, class: NodeId) -> Option<TypeId> {
        // The same source `this` takes its type from a few lines below: the
        // checker gives a class declaration's name the *instance* type, not the
        // constructor's. Asked through `type_of` rather than by searching the
        // type table for the class's symbol, because a declaration node in this
        // snapshot carries no symbol at all -- which is what made the first two
        // attempts at this return nothing.
        match self.type_of(class)? {
            HirType::Managed(ManagedType::Object(ty)) => Some(ty),
            _ => None,
        }
    }

    /// The name a plain function is **emitted** under, for this copy.
    ///
    /// Qualified where another module declares the same name, and suffixed
    /// where this is one copy -- generic, structural or raising. Neither `@`
    /// nor `<>` can appear in a TypeScript identifier, so neither can collide
    /// with a plain name.
    ///
    /// Factored out because [`note_uncompiled`](super::note_uncompiled) has to record a refusal under
    /// the name the rest of the compiler will *ask* for. It recorded the
    /// declared name only, so `asRequest` was recorded once while every caller
    /// and every napi wrapper named `asRequest<[erased]x2>` -- the entry was
    /// there and unreachable. Two derivations of the emitted name would drift;
    /// this is the one.
    pub(super) fn emitted_function_name(&self, id: NodeId) -> Option<String> {
        let name = self
            .children(id)
            .iter()
            .find(|child| self.kind_of(**child) == Some(syntax::IDENTIFIER))
            .and_then(|child| {
                self.node(*child)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
            })?;
        let name = self.qualified.get(&id).cloned().unwrap_or(name);
        let raising = if self.raises { RAISING_SUFFIX } else { "" };
        Some(format!("{name}{}{raising}", self.suffix))
    }

    /// The function declaration an expression *names*, if it is a bare name of
    /// one.
    ///
    /// Through the alias, for the reason [`Self::aliased_to`] gives: `const f =
    /// imported` names a function whose declaration is in another file, and the
    /// symbol written here is an import specifier. **Without the hop this answers
    /// `None`, which is `Unsettled`, which refuses a call that was correct
    /// before** -- the one direction this change must not go, since `const kept =
    /// second` compiling is what the sibling blocker's `aliased` control exists to
    /// hold.
    ///
    /// Not a chain of variables: `const g = f; const h = g;` leaves `h` unsettled,
    /// because `g`'s declaration is a variable rather than a function. Following
    /// that would be right and is not needed by anything yet -- and an unsettled
    /// name refuses, which is the direction a missing case should fail in.
    pub(super) fn named_function(&self, at: NodeId) -> Option<NodeId> {
        if self.kind_of(at) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let symbol = self.node(at).symbol?;
        if let Some(declaration) = self.parameter_body_functions.get(&symbol.0) {
            return Some(*declaration);
        }
        self.aliased_to(symbol.0)?
            .declarations
            .iter()
            .copied()
            .find(|at| self.kind_of(*at) == Some(syntax::FUNCTION_DECLARATION))
    }

    /// The name a declaration declares.
    /// `C.twice` as the function name a static method is emitted under.
    ///
    /// A static method has no receiver and no slot -- it is a namespaced
    /// function -- so a closure wrapping one forwards to it directly, and needs
    /// the same typed member spelling as its declaration and direct calls.
    pub(super) fn static_method_name(&self, declaration: NodeId) -> Option<String> {
        if self.kind_of(declaration) != Some(syntax::METHOD_DECLARATION)
            || !is_static_member(self.snapshot, declaration)
        {
            return None;
        }
        let class = self.class_name(self.enclosing_class(declaration)?)?;
        Some(format!(
            "{class}.{}",
            member_dispatch_key(self, declaration)?.emitted_name()
        ))
    }

    pub(super) fn declared_name(&self, declaration: NodeId) -> Option<String> {
        declaration_identifier(self.snapshot, declaration).map(str::to_owned)
    }

    /// The class a node sits inside, of either kind that declares one.
    pub(super) fn enclosing_class(&self, id: NodeId) -> Option<NodeId> {
        let mut at = self.node(id).parent;
        while let Some(parent) = at {
            if self.kind_of(parent).is_some_and(declares_a_class) {
                return Some(parent);
            }
            at = self.node(parent).parent;
        }
        None
    }

    /// What a class is called, where a member of it is being named.
    ///
    /// An anonymous class expression has no identifier to read, so this asks
    /// [`nominal_or_stand_in`] -- the same question `layout_of` asks -- rather
    /// than answering it a second way. Reading the identifier first is not a
    /// different answer for the named case: the checker's symbol for a class is
    /// the name the program wrote.
    pub(super) fn class_name(&self, class: NodeId) -> Option<String> {
        // **The qualified name first**, because this is what a member of the
        // class is *emitted* as and therefore what a call site has to write.
        // Two modules exporting a class of one name get distinct emitted names,
        // and reading the identifier here while `class_name_for` read the map
        // there is how `ThingA.made()` and `ThingB.made()` both emitted
        // `call Thing.made` against definitions named `Thing@a.made` and
        // `Thing@b.made` -- a call to a function nothing defines. Before that
        // map covered classes at all, the two definitions *shared* the name and
        // the linker picked one, which is the same bug with no diagnostic.
        if let Some(name) = self.qualified.get(&class) {
            return Some(name.clone());
        }
        if let Some(name) = self
            .children(class)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|child| {
                self.node(child)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
            })
        {
            return Some(name);
        }
        Some(nominal_or_stand_in(
            self.snapshot,
            instance_type_of(self.snapshot, class)?,
        ))
    }

    /// The name of the class a member is declared on.
    ///
    /// By walking to the declaration's parent rather than reading the name
    /// before the dot: `import { Body as B }` puts `B` at the call site and
    /// `Body` on the function, and the two have to agree.
    pub(super) fn declaring_class_name(&self, member: NodeId) -> Option<String> {
        self.class_name(self.enclosing_class(member)?)
    }
}
