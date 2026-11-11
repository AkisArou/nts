//! Resolve and bind JavaScript receivers.

use super::{
    Diagnostic, FuncBuilder, HeritageKind, HirType, ManagedType, NodeId, OpKind, PropertyKey,
    Terminator, TypeId, TypeKind, ValueId, describe, instance_type_of, syntax,
    the_constructor_declared_by,
};

/// Whether a declaration of this kind binds its own `this`, so a `this` inside it
/// is not about the scope around it.
///
/// `ARROW_FUNCTION` is deliberately absent: an arrow inherits. One list for the
/// walks that ask -- down a subtree for the first `this` that belongs to it
/// (`first_this`, `mentions_this`) and up from a `this` to the declaration whose
/// binding it reads (`this_is_never_bound`) -- because two copies of it were
/// already written out when the third was about to be.
pub(super) const fn binds_its_own_this(kind: u16) -> bool {
    matches!(
        kind,
        syntax::FUNCTION_EXPRESSION
            | syntax::FUNCTION_DECLARATION
            | syntax::METHOD_DECLARATION
            | syntax::CONSTRUCTOR
            | syntax::GET_ACCESSOR
            | syntax::SET_ACCESSOR
            | syntax::CLASS_DECLARATION
    )
}

/// What a `this` that a derived constructor reads before its `super()` throws.
///
/// The words are V8's, which is what node prints and what a program comparing
/// messages would see; the class is the specification's.
const UNBOUND_THIS: &str = "Must call super constructor in derived class before accessing 'this' or returning from derived constructor";

/// Why a generic `function` declaration that reads its own `this` is refused
/// as a value: its copies are reached through the canonical generic value,
/// whose kernels name the written entry, which passes `undefined`.
pub(super) const A_GENERIC_DECLARATION_READING_THIS: &str =
    "a generic `function` declaration that reads its own `this`, used as a value";

impl FuncBuilder<'_> {
    /// The program class's instance type, as the checker has `this` in the
    /// constructor being lowered.
    pub(super) fn this_instance_type(&self, id: NodeId) -> Result<TypeId, Diagnostic> {
        let mut node = self.node(id).parent;
        while let Some(at) = node {
            if matches!(
                self.kind_of(at),
                Some(syntax::CLASS_DECLARATION | syntax::CLASS_EXPRESSION)
            ) {
                return instance_type_of(self.snapshot, at)
                    .ok_or_else(|| self.unsupported(id, "a class with no instance type"));
            }
            node = self.node(at).parent;
        }
        Err(self.unsupported(id, "`super(...)` outside a class"))
    }

    /// `this`: the receiver -- after a check where the receiver is one the
    /// language says was never bound.
    pub(super) fn lower_this(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let this = self
            .this
            .ok_or_else(|| self.unsupported(id, "`this` outside a method"))?;
        if self.this_is_never_bound(id) {
            self.throw_unbound_this(id)?;
        }
        Ok(this)
    }

    /// Whether `this` at `id` -- or a constructor ending at `id` -- belongs to a
    /// binding no `super()` initialises: see [`Self::never_binds_this`] for
    /// which constructors those are.
    ///
    /// A derived constructor's `this` is uninitialised until `super()` returns,
    /// so where nothing calls it the binding never is: every read of `this`, and
    /// leaving the constructor without returning an object -- falling off its
    /// end, or a bare `return` -- is a `ReferenceError`. This compiler allocates
    /// the instance before the constructor runs, so `this` was simply the object,
    /// and four recorded test262 cases answered "nothing was thrown" or the next
    /// `throw`.
    ///
    /// **Read off the syntax**, because it is a fact about where the `this` is
    /// written and not about any value: up from `id`, through arrows (which
    /// inherit), to the first declaration that binds its own `this` -- or a field
    /// initialiser or static block, whose `this` is the instance or the class.
    /// TypeScript's own check (TS17009) rejects a `this` written before `super()`
    /// in an ordinary derived constructor; it does not reject one in an
    /// `extends null` constructor, which has no `super()` to have called.
    ///
    /// **Not covered, and recorded:** an arrow that reads `this` called before
    /// `super()` in a constructor whose base is a class. That is a question
    /// about the order things run in, which no syntax can answer.
    pub(super) fn this_is_never_bound(&self, id: NodeId) -> bool {
        let owner =
            std::iter::successors(self.node(id).parent, |at| self.node(*at).parent).find(|at| {
                self.kind_of(*at).is_some_and(|kind| {
                    binds_its_own_this(kind)
                        || matches!(
                            kind,
                            syntax::PROPERTY_DECLARATION | syntax::CLASS_STATIC_BLOCK
                        )
                })
            });
        let Some(constructor) = owner.filter(|at| self.kind_of(*at) == Some(syntax::CONSTRUCTOR))
        else {
            return false;
        };
        // A member is in a list, so its class is a parent or two up.
        std::iter::successors(self.node(constructor).parent, |at| self.node(*at).parent)
            .take(3)
            .find(|at| {
                matches!(
                    self.kind_of(*at),
                    Some(syntax::CLASS_DECLARATION | syntax::CLASS_EXPRESSION)
                )
            })
            .is_some_and(|class| self.never_binds_this(class))
    }

    /// Whether the constructor `class` declares can never bind its `this`: the
    /// class `extends null`, whose `super()` itself throws (`null` is not a
    /// constructor) -- or it extends a class and its constructor calls `super()`
    /// nowhere, arrows included, which a `.js` file may write (TypeScript's
    /// TS2377 refuses it in a `.ts` one). `false` for a class with no `extends`,
    /// whose `this` is bound on entry, and for one with no constructor written,
    /// whose default constructor calls `super(...args)`.
    ///
    /// Only *whether* a call is written: a `super()` behind an `if` not taken
    /// leaves `this` unbound too, and that is a question about what runs.
    pub(super) fn never_binds_this(&self, class: NodeId) -> bool {
        if self.extends_null(class) {
            return true;
        }
        let derived = self
            .children(class)
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::HERITAGE_CLAUSE))
            .any(|clause| HeritageKind::from_data(self.node(clause).data) == HeritageKind::Extends);
        // **A constructor with a body.** One with none is a signature -- a native
        // class's in a `.d.ts` (`class NSString extends NSObject { constructor(…) }`),
        // or an ambient one -- and says nothing about `super()`. Read as "calls it
        // nowhere", every construction of a bound Objective-C subclass counted as
        // throwing, and `interop/macos-notes`' `new NSString(…)` inside a `try` was
        // refused.
        let Some(constructor) = the_constructor_declared_by(self, class)
            .filter(|_| derived)
            .filter(|constructor| {
                self.children(*constructor)
                    .into_iter()
                    .any(|child| self.kind_of(child) == Some(syntax::BLOCK))
            })
        else {
            return false;
        };
        let mut subtree = Vec::new();
        self.subtree(constructor, &mut subtree);
        !subtree.iter().any(|node| {
            self.kind_of(*node) == Some(syntax::CALL_EXPRESSION)
                && self
                    .children(*node)
                    .first()
                    .is_some_and(|callee| self.kind_of(*callee) == Some(syntax::SUPER_KEYWORD))
        })
    }

    /// Whether a class's heritage is the literal `null` -- `extends null`, the one
    /// heritage that is not a class. Only the target itself: `extends Base<null>`
    /// names `null` as a type argument, deeper in the clause.
    fn extends_null(&self, class: NodeId) -> bool {
        self.children(class)
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::HERITAGE_CLAUSE))
            .flat_map(|clause| self.children(clause))
            .any(|target| {
                let expression = if self.kind_of(target) == Some(syntax::NULL_KEYWORD) {
                    Some(target)
                } else {
                    self.children(target).first().copied()
                };
                expression.is_some_and(|expression| {
                    self.kind_of(expression) == Some(syntax::NULL_KEYWORD)
                })
            })
    }

    /// Throw [`UNBOUND_THIS`]'s `ReferenceError` from here, leaving the builder in
    /// a block nothing reaches -- so the expression that asked still has its value,
    /// and `fold::decided_branches` removes the dead edge before anything reads it.
    pub(super) fn throw_unbound_this(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let always = self.push(OpKind::ConstBool(true), HirType::Bool, origin);
        self.refuse_when(id, always, "ReferenceError", UNBOUND_THIS)
    }

    /// Whether a literal's member named `name` is **storage** on its type:
    /// a field the type declares -- `write?: Callback` -- or a method the
    /// type's literals made one (`Hierarchy::stored`). Either way the layout
    /// has the slot, a method written for it is the closure that goes in, and
    /// there is no `T#write` to emit. Asked by the literal that fills the slot
    /// and by the walk that emits member functions, so the two agree.
    pub(super) fn literal_member_is_storage(&self, ty: TypeId, name: &PropertyKey) -> bool {
        if self.hierarchy.stores(ty, name) {
            return true;
        }
        let Some(TypeKind::Object { properties }) = self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        else {
            return false;
        };
        properties
            .iter()
            .any(|property| property.name == *name && property.kind.is_stored())
    }

    /// Whether `id` sits inside `ancestor`'s subtree.
    pub(super) fn is_within(&self, id: NodeId, ancestor: NodeId) -> bool {
        let mut at = self.node(id).parent;
        while let Some(node) = at {
            if node == ancestor {
                return true;
            }
            at = self.node(node).parent;
        }
        false
    }

    /// Whether a `METHOD_DECLARATION` is a member of an object literal that a
    /// closure could stand in for.
    ///
    /// A class's method is never one -- it has a receiver and a slot -- and a
    /// generator method keeps its frame, which a closure has no room for, so
    /// it is left on the path that already refuses it by name.
    pub(super) fn is_a_literal_method(&self, id: NodeId) -> bool {
        self.syntactic_parent(id)
            .is_some_and(|parent| self.kind_of(parent) == Some(syntax::OBJECT_LITERAL_EXPRESSION))
            && !self
                .node(id)
                .modifiers
                .contains(nts_semantic_schema::DeclarationModifiers::GENERATOR)
    }

    /// Whether a `function` declaration lowered as a function of this program
    /// reads its own `this`, and so takes the call's: its body is lowered under
    /// [`receiving_function_name`](super::receiving_function_name) and its name passes `undefined`. A nested
    /// one that captures is a closure instead, and takes it as a `function`
    /// expression does (`ClosureInfo::reads_this`).
    pub(super) fn declaration_reads_this(&self, id: NodeId) -> bool {
        self.kind_of(id) == Some(syntax::FUNCTION_DECLARATION) && self.binds_this(id)
    }

    /// Whether a function expression's own `this` is reachable from its body.
    pub(super) fn binds_this(&self, id: NodeId) -> bool {
        // **The body decides, and a `this` parameter on its own does not.**
        //
        // `function (this: T, ...)` declares nothing at run time: TypeScript's
        // `this` parameter is a type annotation about the *caller's* receiver,
        // erased before any backend sees it -- `lower_param` already answers
        // `Ok(Vec::new())` for it. So a body that never mentions `this` cannot
        // observe which receiver it was called with, and is a closure like any
        // other.
        //
        // This used to return `true` on the parameter alone, and what it cost
        // was one construct behind sixty-four cascades. `events`'
        // `onceRecord` writes
        //
        //     const wrapper: Listener = function (this: unknown, ...args) {
        //         ... target.removeListener(type, wrapper) ...
        //     };
        //
        // whose `this` is annotated and never read, so `EventEmitter#once` and
        // `#prependOnceListener` were refused, and with them `Readable#once`,
        // `Socket#_read`, `Socket#_final` and four `Utf8Stream` methods across
        // ten modules. The refusal also said `uses its own `this`` about a body
        // that does not.
        //
        // **What the old test was protecting is kept, and it is the real
        // hazard:** a wrapper that forwards the caller's receiver -- `util`'s
        // `promisified` and `callbackified` are the live ones -- becomes silently
        // wrong as an arrow, which rebinds `this` to module scope. Such a body
        // takes the call's `this` now (`ClosureInfo::reads_this`). Both read `this` in their bodies (`this,`
        // into `Reflect.apply`, and `maybeCb.bind(this)`), so the body walk
        // still catches them. Checked against those two rather than argued
        // from the example in the doc.
        let mut found = false;
        for child in &self.node(id).children {
            self.mentions_this(*child, &mut found);
        }
        found
    }

    /// The first `this` in a subtree that belongs to the enclosing scope.
    ///
    /// [`Self::mentions_this`] answers whether there is one; this returns it,
    /// because a capture needs a node to take its *type* from and the arrow's
    /// own node has the arrow's type. Same walk, same rule about what rebinds.
    pub(super) fn first_this(&self, id: NodeId) -> Option<NodeId> {
        match self.kind_of(id) {
            Some(syntax::THIS_KEYWORD) => return Some(id),
            Some(kind) if binds_its_own_this(kind) => return None,
            _ => {}
        }
        self.node(id)
            .children
            .iter()
            .find_map(|child| self.first_this(*child))
    }

    /// `this` in a subtree, not counting one that rebinds it.
    fn mentions_this(&self, id: NodeId, found: &mut bool) {
        if *found {
            return;
        }
        match self.kind_of(id) {
            Some(syntax::THIS_KEYWORD) => {
                *found = true;
                return;
            }
            // Binds its own `this`, so anything inside is not about ours.
            Some(kind) if binds_its_own_this(kind) => return,
            _ => {}
        }
        for child in &self.node(id).children {
            self.mentions_this(*child, found);
        }
    }

    /// Whether an object type declares no member at all.
    ///
    /// `{}` is the one that matters: the checker narrows `unknown` to it after
    /// `!== null`, and it names no shape.
    pub(super) fn declares_nothing(&self, ty: TypeId) -> bool {
        matches!(
            self.snapshot.types.get(ty.0 as usize).map(|record| &record.kind),
            Some(TypeKind::Object { properties }) if properties.is_empty()
        )
    }

    /// The value a parameter was lowered to, by its index.
    ///
    /// `lower_param` binds by symbol, which is what a body wants and what a
    /// forwarding wrapper cannot use -- it has no body and no mention of the
    /// name. An index is unique within a function, so this is unambiguous.
    /// The `this` a `function` expression's body reads, from the erased value
    /// the call passed (`ClosureInfo::reads_this`), at the type the body was
    /// checked against: the checker's type for a `this` in it, which is the
    /// declared `this:` parameter, or `any` where there is none.
    ///
    /// **Proven, never trusted.** An `Unerase` is unchecked, and a `this:`
    /// annotation is not checked at a call through a cast: React calls
    /// `(callback as (this: unknown) => unknown).call(context)`. So:
    /// - `unknown` or `any`: the erased value itself, which the body reads as
    ///   it reads any erased value;
    /// - an object type -- a class, an interface, an object literal's type -- an
    ///   `instanceof` test against its layout and the classes under it, and the
    ///   body reads it at that layout, as it reads every object. Where the test
    ///   fails the program **stops, by name**, rather than throwing a
    ///   `TypeError` JavaScript would not: TypeScript's object types are
    ///   structural, so `bump.call({ count: 0 }, 1)` type-checks and runs in
    ///   node, and this compiler cannot read an object at a layout it is not;
    /// - anything else (a union, a primitive) has no such test, and is refused
    ///   by name.
    ///
    /// A generator's `this` is one of its parameters, so its frame keeps it
    /// with them, and the test is in the body, which runs at the first `next()`
    /// -- where node would first read it.
    pub(super) fn receive_this(
        &mut self,
        id: NodeId,
        this: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let read = self
            .node(id)
            .children
            .iter()
            .find_map(|child| self.first_this(*child));
        let Some(declared) = read.and_then(|node| self.snapshot.node_types.get(&node).copied())
        else {
            return Ok(this);
        };
        let ty = self.represent(declared);
        let class = match ty {
            Some(HirType::Erased) => return Ok(this),
            Some(HirType::Managed(ManagedType::Object(class)))
                if self.layout_of(id, class).is_ok() =>
            {
                class
            }
            _ => {
                return Err(self.unsupported(
                    id,
                    &format!(
                        "a `function` whose `this` is declared as {}, which has no test this \
                         compiler can make at the call",
                        describe(self.snapshot, declared)
                    ),
                ));
            }
        };
        let origin = self.origin(id);
        let classes = self.classes_under(class);
        let is = self.push(
            OpKind::InstanceOf {
                value: this,
                classes,
                by_layout: true,
            },
            HirType::Bool,
            origin.clone(),
        );
        let named = describe(self.snapshot, declared);
        let refused = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: is,
            then_target: carry_on,
            then_args: Vec::new(),
            else_target: refused,
            else_args: Vec::new(),
        });
        self.switch_to(refused);
        let what = self.push(
            OpKind::ConstString(
                format!(
                    "a `function` called with a `this` that is not {named}, which its body is \
                 read at"
                )
                .into(),
            ),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        self.runtime_call("nts_refused", vec![what], HirType::Void, origin.clone());
        self.terminate(Terminator::Unreachable);
        self.switch_to(carry_on);
        Ok(self.push(
            OpKind::unerase(this),
            HirType::Managed(ManagedType::Object(class)),
            origin,
        ))
    }

    pub(super) fn param_value(&self, index: u32) -> Option<ValueId> {
        self.values
            .iter()
            .position(|op| matches!(op.kind, OpKind::Param(at) if at == index))
            .map(|at| ValueId(u32::try_from(at).unwrap_or(u32::MAX)))
    }

    /// Whether this parameter name is the **`this` annotation**, which is a type
    /// and not a parameter.
    ///
    /// `deepStrictEqual(this: Assert | void, ...args)` says what `this` is when
    /// the method is called, and TypeScript erases it: the emitted JavaScript
    /// has one parameter, not two. Lowering it as an ordinary one gave every
    /// such method a *second* receiver slot --
    ///
    /// ```text
    /// func Holder#withThis(this: managed<obj#1>, this: managed<obj#1>, n: f64)
    /// ```
    ///
    /// -- while the call site passed the receiver and the real arguments, so
    /// `n` landed in the annotation's slot and the declared `n` was never
    /// written. Where a call existed `verify` stopped the build with
    /// `CallArgumentCount { expected: 3, found: 2 }` -- a whole program refused,
    /// naming neither the method nor the annotation; where none existed the
    /// function was emitted with the extra slot and nothing looked at it.
    ///
    /// `this` is reserved in parameter position, so a parameter *named* `this`
    /// is this and nothing else: the test is exact rather than a guess about a
    /// name. The receiver comes from the declaration rather than from the
    /// parameter list, which is why dropping this loses nothing the body needs
    /// -- `this instanceof Holder ? this.base : 100` still answers both ways.
    ///
    /// Asked here rather than at each caller: every one of them `extend`s the
    /// result and passes an index taken before the call, so an empty answer
    /// leaves the next real parameter numbered correctly.
    pub(super) fn annotates_this(&self, name: NodeId) -> bool {
        self.kind_of(name) == Some(syntax::IDENTIFIER)
            && self
                .node(name)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                == Some("this")
    }

    /// Whether an expression mentions `this`, at any depth.
    ///
    /// Bounded by the node count rather than recursive, and it does **not** descend
    /// into a nested function: an arrow's `this` is the enclosing one and is the same
    /// question, but a `function` expression or a method declares its own and the
    /// answer there is about that one instead.
    pub(super) fn reads_this(&self, root: NodeId) -> bool {
        let mut stack = vec![root];
        for _ in 0..self.snapshot.nodes.len() {
            let Some(id) = stack.pop() else { return false };
            match self.kind_of(id) {
                Some(syntax::THIS_KEYWORD) => return true,
                // A nested `function`, method or class declares its own `this`, so
                // the answer inside one is about that one: not descended into.
                Some(
                    syntax::FUNCTION_EXPRESSION
                    | syntax::FUNCTION_DECLARATION
                    | syntax::METHOD_DECLARATION
                    | syntax::CLASS_DECLARATION
                    | syntax::CLASS_EXPRESSION,
                ) => {}
                _ => stack.extend(self.children(id)),
            }
        }
        false
    }

    /// The type a member is declared with, where the type declares one.
    ///
    /// Asked only when a member is missing from a layout, to tell "there is no
    /// such member" from "there is, and it has no representation". The two
    /// have always been different and read the same.
    pub(super) fn declared_type_of(&self, ty: TypeId, member: &PropertyKey) -> Option<TypeId> {
        let record = self.snapshot.types.get(ty.0 as usize)?;
        let TypeKind::Object { properties } = &record.kind else {
            return None;
        };
        properties
            .iter()
            .find(|property| &property.name == member)
            .map(|property| property.ty)
    }
}
