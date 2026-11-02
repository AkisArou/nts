//! Constructors whose base makes the instance.
//!
//! An Objective-C, `GObject` or Windows Runtime base makes its instance in
//! `super(...)`, and so does a builtin whose storage a subclass is: a class
//! extending a typed array that adds no storage *is* that view
//! (`docs/foundations/objects.md`). Such a constructor takes no `this`
//! parameter. `this` is unbound until `super(...)` makes the instance, the
//! body runs with it, and the constructor answers it.

use nts_semantic_schema::{HeritageKind, Library, TypeId};

use super::{
    CONSTRUCTOR_KEY, Callee, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, ObjcConstruct,
    Terminator, ValueId, binds_its_own_this, construction::CheckedGlobalReference,
    declares_a_class, instance_type_of, syntax, the_constructor_declared_by,
};

/// What a constructor's `super(...)` makes `this` with.
#[derive(Clone)]
pub(super) enum MadeBy {
    /// `+alloc` and the superclass's `init...` (`lower_objc_super_init`).
    Objc(ObjcConstruct),
    /// The class's own `GType`, by name (`gobject_super`).
    Gobject(String),
    /// The runtime's composition, by name (`com_super`).
    Com(String),
    /// The builtin storage `class` adds nothing to, built by the nearest
    /// constructor above it ([`NativeConstructor`]).
    Builtin { class: NodeId },
}

/// What builds a native-storage instance: the nearest constructor a class in
/// the chain declares, or the builtin at its root when none does.
pub(super) enum NativeConstructor {
    Source { class: NodeId, constructor: NodeId },
    Builtin(CheckedGlobalReference),
}

enum NativeParent {
    Source(NodeId),
    Builtin(CheckedGlobalReference),
}

/// The collector's repeated questions, in one fixed representation context.
/// Only this memo owns its answers. Generic instance/projection contexts cannot
/// reuse them through the snapshot, and binding readiness remains the caller's.
pub(super) struct ConstructorMemo<'a, 'snapshot> {
    probe: &'a FuncBuilder<'snapshot>,
    above: rustc_hash::FxHashMap<NodeId, Option<std::sync::Arc<NativeConstructor>>>,
}

impl<'a, 'snapshot> ConstructorMemo<'a, 'snapshot> {
    pub(super) fn new(probe: &'a FuncBuilder<'snapshot>) -> Self {
        Self {
            probe,
            above: rustc_hash::FxHashMap::default(),
        }
    }

    pub(super) fn of(&mut self, class: NodeId) -> Option<std::sync::Arc<NativeConstructor>> {
        if !self.probe.is_native_storage(class) {
            return None;
        }
        if let Some(constructor) = the_constructor_declared_by(self.probe, class) {
            return Some(std::sync::Arc::new(NativeConstructor::Source {
                class,
                constructor,
            }));
        }
        self.above(class)
    }

    pub(super) fn above(&mut self, class: NodeId) -> Option<std::sync::Arc<NativeConstructor>> {
        let mut at = class;
        let mut path = Vec::new();
        let mut seen = rustc_hash::FxHashSet::default();
        let answer = loop {
            if let Some(answer) = self.above.get(&at) {
                break answer.clone();
            }
            if !seen.insert(at) {
                break None;
            }
            path.push(at);
            match self.probe.native_constructor_parent(at) {
                Some(NativeParent::Builtin(global)) => {
                    break Some(std::sync::Arc::new(NativeConstructor::Builtin(global)));
                }
                Some(NativeParent::Source(parent)) => {
                    if let Some(constructor) = the_constructor_declared_by(self.probe, parent) {
                        break Some(std::sync::Arc::new(NativeConstructor::Source {
                            class: parent,
                            constructor,
                        }));
                    }
                    at = parent;
                }
                None => break None,
            }
        };
        for at in path {
            self.above.insert(at, answer.clone());
        }
        answer
    }
    #[cfg(test)]
    pub(super) fn owned_binding_elements(&self) -> usize {
        let mut proofs = rustc_hash::FxHashSet::default();
        self.above
            .values()
            .flatten()
            .filter(|proof| proofs.insert(std::sync::Arc::as_ptr(proof)))
            .map(|proof| match proof.as_ref() {
                NativeConstructor::Builtin(global) => global.bindings.len(),
                NativeConstructor::Source { .. } => 0,
            })
            .sum()
    }
}

/// `this` on the paths through an `if`: a `super(...)` in an arm binds it there
/// and nowhere else, so after the `if` it is what the arms that rejoin agree
/// on, or the entry's where none rejoins. `proves_one_super` rules out two arms
/// each making an instance; this refuses it too rather than pick one.
pub(super) struct ThisPaths {
    entry: Option<ValueId>,
    open: Vec<Option<ValueId>>,
}

impl ThisPaths {
    pub(super) const fn enter(entry: Option<ValueId>) -> Self {
        Self {
            entry,
            open: Vec::new(),
        }
    }

    /// After an arm: what it left `this` as where it rejoins, and `this` back
    /// to the entry's for the next arm.
    pub(super) fn arm(&mut self, this: &mut Option<ValueId>, open: bool) {
        let left = std::mem::replace(this, self.entry);
        if open {
            self.open.push(left);
        }
    }

    pub(super) fn rejoin(self) -> Result<Option<ValueId>, &'static str> {
        match self.open.as_slice() {
            [] => Ok(self.entry),
            [first, rest @ ..] if rest.iter().all(|other| other == first) => Ok(*first),
            open if open.contains(&self.entry) => Err(SOME_PATHS),
            _ => Err(REJOINED),
        }
    }
}

/// Where a path through such a constructor stands: before its `super(...)`
/// or after it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Made {
    Before,
    After,
}

type Unproved = (NodeId, &'static str);

const NOT_FOLLOWED: &str = "a `super(...)` that is not a statement of its own at the top of a \
     constructor whose base makes the instance, or of an `if` in it";
const THIS_BEFORE: &str = "`this` read before `super(...)` made the instance";
const SECOND: &str = "a second `super(...)` on one path";
const SOME_PATHS: &str = "a `super(...)` on only some of the paths that rejoin after an `if`";
const REJOINED: &str = "two `super(...)` calls on paths that rejoin, each making its own instance";
const UNMADE: &str = "a path that leaves the constructor before `super(...)` made the instance";
const RETURNED: &str =
    "a constructor returning something other than `this`, whose base made the instance";

impl FuncBuilder<'_> {
    /// `super(...)` in a constructor whose base makes the instance: one
    /// `this` per construction, bound here.
    pub(super) fn make_the_instance(
        &mut self,
        id: NodeId,
        made_by: &MadeBy,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        if self.this.is_some() {
            let second = match made_by {
                MadeBy::Com(_) => "a second `super()`",
                _ => "a second `super(...)`",
            };
            return Err(self.unsupported(id, second));
        }
        match made_by {
            MadeBy::Objc(construct) => self.lower_objc_super_init(id, construct.clone(), arguments),
            MadeBy::Gobject(name) => self.gobject_super(id, name),
            MadeBy::Com(name) => self.com_super(id, name, arguments),
            MadeBy::Builtin { class } => {
                let target = self
                    .native_constructor_above(*class)
                    .ok_or_else(|| self.unsupported(id, super::construction::NOT_ITS_STORAGE))?;
                // The class this copy constructs, or its own.
                let made_as = match self.construct_target {
                    Some(target) => target,
                    None => instance_type_of(self.snapshot, *class).ok_or_else(|| {
                        self.unrepresentable(*class, "the class being constructed")
                    })?,
                };
                let made = self.construct_native(id, target, self.returns.clone(), made_as)?;
                self.this = Some(made);
                Ok(made)
            }
        }
    }

    /// A constructor whose builtin base makes the instance: no receiver, `this`
    /// from its `super(...)` (proved once per path), and the instance
    /// answered. `None` for any other constructor. A subclass that adds
    /// fields has no storage of its own to put them in, and is refused.
    pub(super) fn begin_made_constructor(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
        constructs: bool,
    ) -> Result<Option<HirType>, Diagnostic> {
        let Some(made) = self.native_instance(class, instance).filter(|_| constructs) else {
            return Ok(None);
        };
        if self.declares_instance_fields(class) {
            return Err(self.unsupported(
                member,
                "a subclass of a builtin that declares fields, which its base's storage has \
                 no room for",
            ));
        }
        if let Some(body) = self
            .children(member)
            .into_iter()
            .find(|at| self.kind_of(*at) == Some(syntax::BLOCK))
        {
            self.proves_one_super(body)?;
        }
        self.this = None;
        self.base = self.base_class(class);
        self.made_by = Some(MadeBy::Builtin { class });
        Ok(Some(made))
    }

    /// Falling off the end of such a constructor answers the instance.
    pub(super) fn end_made_constructor(
        &mut self,
        member: NodeId,
        made: bool,
    ) -> Result<(), Diagnostic> {
        if !made || self.is_terminated() {
            return Ok(());
        }
        let instance = self
            .this
            .ok_or_else(|| self.unsupported(member, "a constructor that made no instance"))?;
        self.terminate(Terminator::Return(Some(instance)));
        Ok(())
    }

    /// The instance a builtin base makes for `class`, where the class adds no
    /// storage of its own and so *is* that base's storage. `None` for a class
    /// whose instances are objects of ours, or a handle a foreign runtime
    /// makes.
    pub(super) fn native_instance(
        &self,
        class: NodeId,
        instance: Option<TypeId>,
    ) -> Option<HirType> {
        if instance.is_some() {
            return None;
        }
        // A class is a typed array's view or an object of its own: the other
        // builtins' subclasses have no representation.
        let ty = instance_type_of(self.snapshot, class).and_then(|ty| self.represent(ty))?;
        matches!(ty, HirType::Managed(ManagedType::View(_))).then_some(ty)
    }

    /// Whether `class` is its builtin base's storage: represented as it, and
    /// declaring no instance fields, which that storage has no room for.
    fn is_native_storage(&self, class: NodeId) -> bool {
        self.native_instance(class, None).is_some() && !self.declares_instance_fields(class)
    }

    /// What a `new` of `class` runs, where `class` is a builtin's storage.
    pub(super) fn native_constructor_of(&self, class: NodeId) -> Option<NativeConstructor> {
        if !self.is_native_storage(class) {
            return None;
        }
        if let Some(constructor) = the_constructor_declared_by(self, class) {
            return Some(NativeConstructor::Source { class, constructor });
        }
        self.native_constructor_above(class)
    }

    /// What `class`'s `super(...)` runs: up the `extends` operands, each
    /// authenticated by what it references, to the first class declaring a
    /// constructor or the builtin the chain starts from. Every class between
    /// is that builtin's storage too: a class declaring fields, or one that is
    /// not a subclass of the builtin (a cast as a base), answers `None`.
    pub(super) fn native_constructor_above(&self, class: NodeId) -> Option<NativeConstructor> {
        let mut class = class;
        let mut seen = rustc_hash::FxHashSet::default();
        while seen.insert(class) {
            match self.native_constructor_parent(class)? {
                NativeParent::Builtin(global) => return Some(NativeConstructor::Builtin(global)),
                NativeParent::Source(parent) => {
                    class = parent;
                    if let Some(constructor) = the_constructor_declared_by(self, class) {
                        return Some(NativeConstructor::Source { class, constructor });
                    }
                }
            }
        }
        None
    }

    /// One authenticated parent step. Both the ordinary reader and the
    /// whole-program collector's memo consume this exact identity authority.
    fn native_constructor_parent(&self, class: NodeId) -> Option<NativeParent> {
        #[cfg(test)]
        super::view_class_tests::note_ancestor();
        let base = self.extends_operand(class)?;
        if let Some(global) = self.checked_global_reference(base) {
            return (global.library == Library::Es).then_some(NativeParent::Builtin(global));
        }
        let reference = self.referenced_value(base)?;
        let parent = self
            .referenced_declaration(reference.symbol)
            .filter(|declaration| self.kind_of(*declaration).is_some_and(declares_a_class))
            .filter(|declaration| self.is_native_storage(*declaration))?;
        Some(NativeParent::Source(parent))
    }

    /// The expression a class `extends`, never one it `implements`.
    pub(super) fn extends_operand(&self, class: NodeId) -> Option<NodeId> {
        self.children(class)
            .into_iter()
            .filter(|child| {
                self.kind_of(*child) == Some(syntax::HERITAGE_CLAUSE)
                    && HeritageKind::from_data(self.node(*child).data) == HeritageKind::Extends
            })
            .flat_map(|clause| self.children(clause))
            .find_map(|expression| self.children(expression).first().copied())
    }

    /// Build a native-storage instance at `site` -- a `new` or a `super(...)`
    /// -- from the arguments written there, as `ty`, an instance of `made_as`:
    /// the class the `new` names, which is the class whose constructor runs
    /// only where no subclass inherits it.
    pub(super) fn construct_native(
        &mut self,
        site: NodeId,
        target: NativeConstructor,
        ty: HirType,
        made_as: TypeId,
    ) -> Result<ValueId, Diagnostic> {
        let (class, constructor) = match target {
            NativeConstructor::Builtin(global) => {
                // A cast global as the root (`extends (Float64Array as unknown
                // as Uint8ArrayConstructor)`) builds another element.
                let builds = super::super::builtin::typed_array_element(&global.name).is_some_and(
                    |element| ty == HirType::Managed(ManagedType::View(Box::new(element))),
                );
                if !builds {
                    return Err(self.unsupported(site, super::construction::NOT_ITS_STORAGE));
                }
                self.view_made_as = Some(made_as);
                let made = self.lower_builtin_construction(site, &global);
                self.view_made_as = None;
                return made;
            }
            NativeConstructor::Source { class, constructor } => (class, constructor),
        };
        let owner = self
            .class_name(class)
            .ok_or_else(|| self.unsupported(class, "an anonymous class"))?;
        // Run for a class that inherits it: its copy keyed on that class,
        // whose `super(...)` makes that class's instance.
        let keyed = match instance_type_of(self.snapshot, class) {
            Some(own) if own == made_as => String::new(),
            _ => super::target_suffix(made_as),
        };
        let member_copy = self.constructed_copy(site);
        if !keyed.is_empty() && !member_copy.is_empty() {
            return Err(self.unsupported(
                site,
                "a constructor copied over a union member and run for a class that inherits it",
            ));
        }
        let callee = Callee::Direct(format!(
            "{owner}#{CONSTRUCTOR_KEY}{member_copy}{keyed}{}",
            self.raising_suffix_of(site)
        ));
        let arguments = self.arguments_of(site);
        // The checker's resolution is the arguments' authority only where it
        // reached this constructor; a cast reaches some other one.
        let resolved = self
            .snapshot
            .call_targets
            .get(&site)
            .and_then(|target| target.callee)
            .map(|callee| self.implementation_of(callee));
        let saved = self.argument_declaration;
        if resolved != Some(constructor) {
            self.argument_declaration = Some((site, constructor));
        }
        let result = (|| {
            let (args, lent) = self.lower_call_arguments(site, &callee, &arguments, None)?;
            self.finish_call_typed(site, callee, args, lent, Some(constructor), Some(ty))
        })();
        self.argument_declaration = saved;
        result
    }

    /// The copy a `new` or `super(...)` at `site` names: the constructor's copy
    /// over the union member its argument is (`union_member_retype`), or `""`
    /// for the constructor as declared.
    pub(super) fn constructed_copy(&self, site: NodeId) -> String {
        if self.copied_constructions.contains(&site) {
            self.generic_calls.get(&site).cloned().unwrap_or_default()
        } else {
            String::new()
        }
    }

    /// Whether every path through `body` calls `super(...)` exactly once, as
    /// a statement of its own, before anything reads `this`, with no two
    /// instances rejoining. The lowering binds `this` where the `super(...)`
    /// is, so this is what makes one `this` the instance on every path.
    pub(super) fn proves_one_super(&self, body: NodeId) -> Result<(), Diagnostic> {
        self.made_after(body, Made::Before)
            .and_then(|made| match made {
                Some(Made::Before) => Err((body, UNMADE)),
                _ => Ok(()),
            })
            .map_err(|(at, why)| self.unsupported(at, why))
    }

    /// Where the paths through `statement` stand after it, entered at
    /// `made`. `None` where every path leaves the constructor.
    fn made_after(&self, statement: NodeId, made: Made) -> Result<Option<Made>, Unproved> {
        match self.kind_of(statement) {
            Some(syntax::BLOCK) => {
                let mut made = made;
                for child in self.children(statement) {
                    match self.made_after(child, made)? {
                        Some(next) => made = next,
                        None => return Ok(None),
                    }
                }
                Ok(Some(made))
            }
            Some(syntax::EXPRESSION_STATEMENT) if self.is_super_call_statement(statement) => {
                let call = self.through_assertions(self.children(statement)[0]);
                for argument in self.arguments_of(call) {
                    self.ordinary(argument, made)?;
                }
                if made == Made::After {
                    return Err((call, SECOND));
                }
                Ok(Some(Made::After))
            }
            Some(syntax::IF_STATEMENT) => {
                let children = self.children(statement);
                let (condition, then_branch, else_branch) = match children.as_slice() {
                    [condition, then_branch] => (*condition, *then_branch, None),
                    [condition, then_branch, else_branch] => {
                        (*condition, *then_branch, Some(*else_branch))
                    }
                    _ => return Err((statement, NOT_FOLLOWED)),
                };
                self.ordinary(condition, made)?;
                let then_made = self.made_after(then_branch, made)?;
                let else_made = match else_branch {
                    Some(branch) => self.made_after(branch, made)?,
                    None => Some(made),
                };
                match (then_made, else_made) {
                    (Some(one), Some(other)) if one != other => Err((statement, SOME_PATHS)),
                    (Some(Made::After), Some(_)) if made == Made::Before => {
                        Err((statement, REJOINED))
                    }
                    (None, open) | (open, _) => Ok(open),
                }
            }
            Some(syntax::RETURN_STATEMENT) => {
                if let Some(value) = self.children(statement).first().copied()
                    && self.kind_of(self.through_assertions(value)) != Some(syntax::THIS_KEYWORD)
                {
                    return Err((value, RETURNED));
                }
                if made == Made::Before {
                    return Err((statement, UNMADE));
                }
                Ok(None)
            }
            Some(syntax::THROW_STATEMENT) => {
                self.ordinary(statement, made)?;
                Ok(None)
            }
            _ => {
                self.ordinary(statement, made)?;
                Ok(Some(made))
            }
        }
    }

    /// A statement or expression the paths cross without a `super(...)` of
    /// their own: none may be inside it, nothing before one may read `this`,
    /// and nothing before one may leave the constructor.
    fn ordinary(&self, at: NodeId, made: Made) -> Result<(), Unproved> {
        let mut pending = vec![(at, false)];
        while let Some((node, in_arrow)) = pending.pop() {
            let kind = self.kind_of(node);
            match kind {
                Some(syntax::CALL_EXPRESSION)
                    if self.children(node).first().is_some_and(|callee| {
                        self.kind_of(*callee) == Some(syntax::SUPER_KEYWORD)
                    }) =>
                {
                    return Err((node, NOT_FOLLOWED));
                }
                Some(syntax::THIS_KEYWORD | syntax::SUPER_KEYWORD) if made == Made::Before => {
                    return Err((node, THIS_BEFORE));
                }
                Some(syntax::RETURN_STATEMENT) if !in_arrow => {
                    if let Some(value) = self.children(node).first().copied()
                        && self.kind_of(self.through_assertions(value))
                            != Some(syntax::THIS_KEYWORD)
                    {
                        return Err((value, RETURNED));
                    }
                    if made == Made::Before {
                        return Err((node, UNMADE));
                    }
                }
                Some(kind) if binds_its_own_this(kind) => continue,
                _ => {}
            }
            let in_arrow = in_arrow || kind == Some(syntax::ARROW_FUNCTION);
            pending.extend(
                self.children(node)
                    .into_iter()
                    .map(|child| (child, in_arrow)),
            );
        }
        Ok(())
    }

    fn is_super_call_statement(&self, statement: NodeId) -> bool {
        self.children(statement).first().is_some_and(|expression| {
            let call = self.through_assertions(*expression);
            self.kind_of(call) == Some(syntax::CALL_EXPRESSION)
                && self
                    .children(call)
                    .first()
                    .is_some_and(|callee| self.kind_of(*callee) == Some(syntax::SUPER_KEYWORD))
        })
    }
}
