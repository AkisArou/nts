//! Choose an iterator or indexed walk and lower for-in/for-of binding, stepping, and reads across supported representations.

use super::{
    BinOp, Callee, Diagnostic, FuncBuilder, HirType, ManagedType, MemberKey, NodeId, OpKind,
    Origin, PatternScope, PropertyKey, Step, TypeId, TypeKind, UnOp, ValueId,
    abstract_generator_kind, describe, syntax,
};

/// A table walk's cursor: `nts_map_next`'s `int32_t`, below `NTS_MAX_LENGTH`
/// (`runtime::SIGNATURES` and the header beside the helper). Started, tested
/// and stepped in its own type, so the walk converts nothing.
const TABLE_CURSOR: HirType = HirType::Int {
    bits: 32,
    signed: true,
};

/// What a `for...of` head binds. See [`Lowering::for_of_head`].
enum Head {
    /// Names taking the values the walk produces, in order.
    /// **`Option`, because an elision has no name.** `for (const [, v] of m)`
    /// binds one name and consumes two positions, and a hole is exactly the
    /// difference: nothing to bind, and the next element one further along. A
    /// `Vec<NodeId>` could not say that, and the two facts have to travel
    /// together or the count and the binding disagree.
    InOrder(Vec<Option<NodeId>>),
    /// A pattern applied to the one value the walk produces.
    Pattern(NodeId),
    /// A **target that already exists**, assigned once per iteration.
    ///
    /// `for (v of xs)` and `for (o.k of xs)` declare nothing: the language
    /// permits any assignment target in the head, and the loop writes to it
    /// exactly as an assignment statement would. So this carries the target
    /// *expression* rather than a name -- `place_of` is what turns it into
    /// somewhere to write, and it already knows every shape an assignment can
    /// have, including a getter-backed property and a readonly field.
    Assign(NodeId),
}

/// `for await` adds a keyword before the same head/source/body schedule.
pub(super) fn for_each_parts(probe: &FuncBuilder, id: NodeId) -> Option<(bool, [NodeId; 3])> {
    let mut awaiting = false;
    let children: Vec<_> = probe
        .children(id)
        .into_iter()
        .filter(|child| {
            if probe.kind_of(*child) == Some(syntax::AWAIT_KEYWORD) {
                awaiting = true;
                false
            } else {
                true
            }
        })
        .collect();
    Some((awaiting, children.try_into().ok()?))
}

/// How a `for...of` steps through what it was given.
///
/// Three shapes, and each is a cursor and three questions: where it starts,
/// whether it is still going, and what it reads. Naming them together is what
/// lets one loop serve an array, a table and a string -- the alternative was
/// three loops that would drift apart, since `break`, `continue` and the
/// loop-carried names are the same problem in all three.
///
/// The array case still emits exactly the counted loop it emitted before this
/// existed, which is the whole of what "typed code pays nothing" means here.
/// Which of a value's two sequences a `for` loop walks.
///
/// `for...of` walks the elements and `for...in` walks the keys, and for a
/// compiled object the second is the layout's field names. One loop serves both
/// because everything after the sequence is identical -- the cursor, the latch,
/// `break` and `continue`, and the loop-carried names.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Over {
    Elements,
    Keys,
}

/// What a counted walk hands the head, per step.
///
/// The index a counted loop already keeps *is* the key `xs.keys()` yields and
/// the first half of what `xs.entries()` yields, so all three are one walk
/// reading its own cursor rather than three walks over the same array. Nothing
/// is allocated and no pair is built, which is the same argument
/// [`Walk::Entries`] makes for a `Map`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Binds {
    /// `for (const v of xs)` and `of xs.values()`.
    Element,
    /// `for (const i of xs.keys())`. The walk's element *is* the index, so its
    /// element type is a number rather than the array's.
    Position,
    /// `for (const [i, v] of xs.entries())`, in that order.
    PositionAndElement,
}

/// A method a [`Walk::Native`] calls: its name, its declaration, and the
/// signature its instantiation gives it.
type NativeMethod = (String, NodeId, nts_semantic_schema::SignatureRecord);

/// What a [`Walk::Native`] walks by.
#[derive(Clone)]
pub(super) struct NativeWalk {
    pub(super) by: NativeBy,
    pub(super) element: HirType,
    /// The sequence, for what a call through a slot reports against.
    pub(super) site: NodeId,
    /// Whether each element is read as `element` where that is a kind of what
    /// the binding answers: a collection a binding implements, whose lib.dom
    /// type says what it holds ([`FuncBuilder::delegated_walk`]).
    pub(super) narrows: bool,
}

/// The two ways a Windows Runtime sequence is walked, as its
/// `[Symbol.iterator]`'s `@ntsIterate` names them.
#[derive(Clone)]
pub(super) enum NativeBy {
    /// A vector (`IVector<T>`, `IVectorView<T>`): `GetAt(i)` while
    /// `i < get_Size()`, with the vector as `this` -- as an array is walked.
    Vector(Box<VectorMethods>),
    /// Any other `IIterable<T>`: `First()` once, for the iterator walked;
    /// then its `get_Current` each turn, and `MoveNext` in the latch.
    ///
    /// The cursor is whether there is a current element: `get_HasCurrent`
    /// once to start, and then what `MoveNext` answers, which is the same
    /// question asked after moving. So a step is two calls, as `CsWinRT`'s
    /// adapter makes it (`MoveNext`, `Current`), and no iterator object of the
    /// program's is made -- where the iteration protocol would allocate a
    /// result per element.
    Iterator(Box<IteratorMethods>),
}

/// The two methods a [`NativeBy::Vector`] walks by. Boxed, as the
/// iterator's four are, so the choice between them is a pointer.
#[derive(Clone)]
pub(super) struct VectorMethods {
    pub(super) size: NativeMethod,
    pub(super) at: NativeMethod,
}

/// The four methods a [`NativeBy::Iterator`] walks by: the iterable's
/// `First`, and its iterator's `get_HasCurrent`, `get_Current`, `MoveNext`.
#[derive(Clone)]
pub(super) struct IteratorMethods {
    first: NativeMethod,
    has: NativeMethod,
    current: NativeMethod,
    advance: NativeMethod,
}

#[derive(Clone)]
pub(super) enum Walk {
    /// `xs[i]` while `i < xs.length`, stepping by one.
    Counted { element: HirType, binds: Binds },
    /// A Windows Runtime vector (`IVector<T>`, `IVectorView<T>`), walked as
    /// an array is: `GetAt(i)` while `i < get_Size()`, the size asked each
    /// turn as `length` is, each a call through the instantiation's own
    /// table with its HRESULT checked. No iterator object and no query --
    /// C#'s `foreach` over the same vector makes a call a step too. Boxed:
    /// two signatures would make every walk, and every loop step, that size.
    Native(Box<NativeWalk>),
    /// The live entries of a `Map` or a `Set`.
    ///
    /// The cursor is an entry index rather than a position, because the entries
    /// are not contiguous -- a deleted one leaves a hole -- so the runtime is
    /// asked for the next live index rather than told to add one.
    Table {
        /// `nts_map_key_at` or `nts_map_value_at`. A `Set` stores its elements
        /// as keys, so iterating one and iterating `keys()` are the same read.
        read: &'static str,
        element: HirType,
    },
    /// The entries of a `Map`, bound through `[key, value]`.
    ///
    /// Two names and two reads. Nothing materializes the pair: it is what the
    /// *language* says the element is, and building one per iteration to take
    /// apart immediately would be an allocation for nothing. The table holds
    /// keys and values in separate arrays, so this reads one of each.
    Entries {
        key: HirType,
        value: HirType,
        /// `nts_map_value_at` for a `Map`. A `Set` stores no values at all, and
        /// its `entries()` yields `[v, v]` -- node agrees it is the same value
        /// twice -- so the second read is the key again.
        value_read: &'static str,
    },
    /// A user type's own iterator, stepped through `[Symbol.iterator]()` and
    /// `next()`.
    ///
    /// The only walk with no cursor. The other four know where they are from an
    /// index the loop advances; this one's entire state lives inside the
    /// iterator object, and the *call* to `next()` is what moves it. So one
    /// call answers both questions -- whether to go round again, and with what
    /// -- which is why the result is computed in the header and the body reads
    /// the element back out of it rather than reading the sequence at all.
    ///
    /// That is also why the latch is the header: `continue` has to reach the
    /// `next()` call, and a step written anywhere else is a step `continue`
    /// skips. `Step::None` says exactly this.
    Protocol {
        /// The iterator, made once before the loop and never reassigned, so it
        /// is an ordinary dominating value rather than a carried one.
        iterator: ValueId,
        /// `next()` on it, resolved once instead of per iteration.
        next: Callee,
        next_raises: bool,
        /// What `next()` hands back, and where the two fields sit in it.
        result: HirType,
        done: u32,
        value: u32,
        element: HirType,
    },
    /// A generator, stepped by its own resumption.
    ///
    /// The protocol without the object. `[Symbol.iterator]()` on a user type
    /// builds an iterator and `next()` returns a `{ value, done }`; a generator
    /// *is* its iterator -- the frame [`super::suspend`](crate::hir::suspend) builds is the state,
    /// and the resumption both advances it and answers whether it is over. So
    /// there is nothing to allocate per step and no result object at all: the
    /// element is left in the frame and `done` comes back as the return value.
    ///
    /// Cursorless for the same reason [`Walk::Protocol`] is, and with the same
    /// consequence: the header is the latch, because the resumption is called
    /// there and `continue` has to reach it.
    Generator {
        /// The frame, made once by calling the generator before the loop.
        frame: ValueId,
        /// `f__resume(frame)`, which [`super::suspend`](crate::hir::suspend) has not built yet.
        resume: Callee,
        element: HirType,
        /// Whether this is an `async function*`, driven by `for await`.
        ///
        /// A flag on this walk rather than a variant beside it, because it *is*
        /// this walk: the cursorless shape, the header as the latch, the
        /// element read out of the frame and `done` deciding whether to go
        /// round again are all the same. Only the step differs -- one call
        /// against a promise made, a resumption run and a suspension awaited --
        /// and a second variant would have meant an arm in each of the ten
        /// matches that only ever said "the same as a generator".
        asynchronous: bool,
        /// Whether `resume` is a **raising** resumption, so the step has to test
        /// the flag it may set.
        ///
        /// A field rather than a test of `resume`'s spelling, for the reason
        /// [`FuncBuilder::tested_for_a_raise`] is one predicate: the site that
        /// *names* the resumption and the site that *tests* after it are
        /// different functions, and two derivations of "is this one raising"
        /// disagreeing is a `throw` nobody looks for. `outcomes/a-generator-
        /// that-throws-stepped-inside-a-try` is what that looked like -- the
        /// loop read `done`, exited normally, and the flag it left set was read
        /// by an unrelated call, so two arms of one program reported each
        /// other's outcome.
        raises: bool,
    },
    /// The code points of a string, which are one or two units wide.
    ///
    /// Not the code *units*: node yields three items for `"a\u{1F600}b"` where
    /// `length` is four, and stepping by one unit would hand the body the
    /// halves of a surrogate pair as two separate strings.
    Text,
}

impl FuncBuilder<'_> {
    /// A node's children assigned to their declared property slots.
    ///
    /// [`Self::children`] returns only the children that are *present*, so
    /// nothing about a position identifies which property it is. The node's
    /// presence bitmask does, one bit per property in visitor order.
    ///
    /// Reading positionally instead is wrong in two different ways, both of
    /// which happened: `for (;; i++)` becomes an infinite loop with `i++` as its
    /// condition, and `c ? a : b` picks up the `:` token as its true branch —
    /// which at least fails loudly, being a token where an expression belongs.
    /// `for (const x of xs)` over an array.
    ///
    /// Desugared to an index loop, which is what it is: the source names the
    /// element and this names the index. There is no iterator protocol here --
    /// `Symbol.iterator` is a dynamic dispatch through a property, and an array
    /// is the one case where the answer is known and the loop is a counter.
    /// Whether the loop runs again, built rather than lowered: the source has
    /// no node for this test.
    ///
    /// A position runs while it is inside the length; an entry index runs until
    /// the table says there is no next live entry; the protocol runs until the
    /// step it already took said it was done.
    pub(super) fn walk_condition(
        &mut self,
        walk: &Walk,
        at: ValueId,
        sequence: ValueId,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        Ok(match walk {
            // `done` says when to *stop*, so the loop runs while it is false.
            Walk::Protocol { .. } | Walk::Generator { .. } => self.push(
                OpKind::Unary {
                    op: UnOp::Not,
                    operand: at,
                },
                HirType::Bool,
                origin.clone(),
            ),
            Walk::Native(native) => match &native.by {
                NativeBy::Vector(methods) => {
                    let count =
                        self.call_native_walk(native.site, &methods.size, sequence, Vec::new())?;
                    let count = self.coerce(count, &HirType::NUMBER, native.site)?;
                    self.push(
                        OpKind::Binary {
                            op: BinOp::Lt,
                            lhs: at,
                            rhs: count,
                        },
                        HirType::Bool,
                        origin.clone(),
                    )
                }
                // The cursor is whether there is a current element.
                NativeBy::Iterator(_) => {
                    let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
                    self.push(
                        OpKind::Binary {
                            op: BinOp::Ne,
                            lhs: at,
                            rhs: zero,
                        },
                        HirType::Bool,
                        origin.clone(),
                    )
                }
            },
            Walk::Counted { .. } | Walk::Text => {
                let length = self.push(OpKind::Length(sequence), HirType::NUMBER, origin.clone());
                self.push(
                    OpKind::Binary {
                        op: BinOp::Lt,
                        lhs: at,
                        rhs: length,
                    },
                    HirType::Bool,
                    origin.clone(),
                )
            }
            Walk::Table { .. } | Walk::Entries { .. } => {
                let zero = self.push(OpKind::ConstInt(0), TABLE_CURSOR, origin.clone());
                self.push(
                    OpKind::Binary {
                        op: BinOp::Ge,
                        lhs: at,
                        rhs: zero,
                    },
                    HirType::Bool,
                    origin.clone(),
                )
            }
        })
    }

    /// The cursor a walk steps, and `None` for the one that has none.
    ///
    /// A double, like the counter a hand-written `for` produces, so that
    /// specialization decides its machine type by the same rule rather than by
    /// which loop it came from. For an array and for text it is a position and
    /// starts at zero; for a table it is an entry index, and the entries are
    /// not contiguous, so the first live one is asked for rather than assumed.
    ///
    /// The protocol has none at all: the iterator holds its own place and
    /// `next()` is what moves it.
    /// What a walk walks, and its cursor, if it has one: the sequence itself,
    /// except that an iterable is walked by the iterator its `First` makes,
    /// whose cursor starts at whether it has a current element.
    ///
    /// And what the walk keeps on loan until the loop ends, which the caller
    /// gives back after it (`Self::unlend_walked`): the iterable an iterator
    /// was made from. See `nts_com_unlend`.
    pub(super) fn walk_start(
        &mut self,
        walk: &Walk,
        sequence: ValueId,
        origin: &Origin,
    ) -> Result<(ValueId, Option<u32>, Option<ValueId>), Diagnostic> {
        if matches!(walk, Walk::Protocol { .. } | Walk::Generator { .. }) {
            return Ok((sequence, None, None));
        }
        let index = self.synthetic_symbol();
        if let Walk::Native(native) = walk
            && let NativeBy::Iterator(methods) = &native.by
        {
            let iterator =
                self.call_native_walk(native.site, &methods.first, sequence, Vec::new())?;
            let present = self.call_native_walk(native.site, &methods.has, iterator, Vec::new())?;
            let start = self.cursor_of_presence(present, native.site, origin)?;
            self.bindings.insert(index, start);
            return Ok((iterator, Some(index), Some(sequence)));
        }
        let start = match walk {
            Walk::Table { .. } | Walk::Entries { .. } => {
                let zero = self.push(OpKind::ConstInt(0), TABLE_CURSOR, origin.clone());
                self.call_runtime("nts_map_next", vec![sequence, zero], TABLE_CURSOR, origin)
            }
            _ => self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone()),
        };
        self.bindings.insert(index, start);
        Ok((sequence, Some(index), None))
    }

    /// The end of what a walk kept on loan, once its loop is over.
    pub(super) fn unlend_walked(&mut self, lent: Option<ValueId>, origin: &Origin) {
        if let Some(iterable) = lent {
            self.runtime_call(
                "nts_com_unlend",
                vec![iterable],
                HirType::Void,
                origin.clone(),
            );
        }
    }

    /// An iterator's `HasCurrent` or `MoveNext`, as the number a cursor is:
    /// 1 while there is a current element, 0 once there is not.
    fn cursor_of_presence(
        &mut self,
        present: ValueId,
        site: NodeId,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let present = self.coerce(present, &HirType::Bool, site)?;
        Ok(self.push(OpKind::Convert(present), HirType::NUMBER, origin.clone()))
    }

    /// `[Symbol.iterator]()` on a user type, and what stepping it looks like.
    ///
    /// The iterator is built *here* rather than in the loop, because the
    /// language builds it once: `for (const x of thing)` calls
    /// `[Symbol.iterator]` a single time however many elements come out.
    ///
    /// Everything else this returns is resolved once too -- the callee for
    /// `next`, and which fields of its result hold `done` and `value` -- so the
    /// loop emits a call and two loads an iteration and asks no questions.
    fn protocol_walk(
        &mut self,
        sequence: NodeId,
        value: ValueId,
        ty: TypeId,
    ) -> Result<Walk, Diagnostic> {
        let Some(iterator_member) =
            self.well_known_property_key(ty, nts_semantic_schema::WellKnownSymbol::Iterator)
        else {
            return Err(self.unsupported(sequence, "a `for...of` over a type with no iterator"));
        };
        let (callee, raises) =
            self.implicit_method(sequence, ty, &MemberKey::method(iterator_member.clone()))?;
        // **A generator `[Symbol.iterator]()` hands back its frame**, and
        // `member_returns` reads the declared `Generator<T, …>`, which has no
        // representation because this compiler does not build that object. The
        // frame is what the call produces, and it is found the way the explicit
        // call finds it: through the member's declaration.
        //
        // Asked before `member_returns` rather than as a fallback after it,
        // because the declared type is not *missing* here -- it is present and
        // wrong, so a fallback would never run.
        let reserved = self
            .member_declaration(ty, &iterator_member)
            .and_then(|declaration| self.generators.get(&declaration).copied());
        let iterator_ty = reserved
            .map(|index| HirType::Managed(ManagedType::Object(crate::hir::generator_frame(index))))
            .or_else(|| self.member_returns(ty, &iterator_member));
        let Some(iterator_ty) = iterator_ty else {
            return Err(self.unsupported(
                sequence,
                "a `[Symbol.iterator]()` whose result has no representation",
            ));
        };
        let origin = self.origin(sequence);
        let iterator = self.push(
            OpKind::Call {
                callee,
                args: vec![value],
                frame: None,
            },
            iterator_ty.clone(),
            origin.clone(),
        );
        if raises {
            self.implicit_raise_test(sequence, &origin)?;
        }
        let iterator = self.note_generator_call(iterator, reserved);

        // **A generator `[Symbol.iterator]()` is walked as a generator**, not as
        // an iterator object. What came back is a frame, which is *resumed*; it
        // has no `next` method, and asking the hierarchy for one answered `a
        // method `next` with no declaration in the hierarchy` -- a true sentence
        // about a question that should not have been asked.
        //
        // `generator_walk` derives the resumption's name from the call that made
        // the frame, and the call it wants is the one pushed a line above. That
        // is why this is here and not before the push: a generator has to be
        // walked where it was made, and this is where it was made.
        // **`reserved` is what knows a frame was made**, and the paragraph above
        // says so in its own words: "what came back is a frame, which is
        // *resumed*". The test used to be `generator_element_of(&iterator_ty)`,
        // which asks whether the *declared return type* looks like a generator
        // --- and for a receiver whose static type is an **interface** the
        // declared return is `Iterator<T>`, which satisfies it while the value
        // is an ordinary iterator object rather than a frame.
        //
        //     class Two { *[Symbol.iterator](): Iterator<number> { … } }
        //     const s = new Two();             lowered  (iterator_ty is a frame)
        //     const s: Seq = new Two();        refused  (iterator_ty is TypeId(5))
        //
        // Same object, and only the annotation differs. `reserved` is `Some`
        // exactly when the member's declaration is one of this program's
        // generators, which is exactly when the call produced a frame.
        if reserved.is_some() {
            return self.generator_walk(sequence, iterator);
        }

        let HirType::Managed(ManagedType::Object(iterator_id)) = iterator_ty else {
            return Err(self.unsupported(sequence, "an iterator that is not an object"));
        };
        let (next, next_raises) =
            self.implicit_method(sequence, iterator_id, &MemberKey::named("next"))?;
        let Some(result) = self.member_returns(iterator_id, &PropertyKey::Name("next".into()))
        else {
            return Err(self.unsupported(sequence, "a `next()` whose result has no representation"));
        };
        // `{ value, done }`, by name and in whatever order the type declares
        // them. `IteratorResult<T>` from `lib.d.ts` does not reach here: it is a
        // union of two object types whose `value` is `T` in one and `any` in the
        // other, so they lay out differently and the union has no layout at all.
        // A hand-written `{ value: T; done: boolean }` does.
        let HirType::Managed(ManagedType::Object(result_id)) = result else {
            return Err(self.unsupported(sequence, "a `next()` that does not return an object"));
        };
        let layout = self.layout_of(sequence, result_id)?;
        let (Some(done), Some(value_at)) = (layout.index_of("done"), layout.index_of("value"))
        else {
            return Err(self.unsupported(
                sequence,
                "a `next()` result without both `value` and `done`",
            ));
        };
        let element = layout.fields[value_at as usize].ty.clone();
        Ok(Walk::Protocol {
            iterator,
            next,
            next_raises,
            result,
            done,
            value: value_at,
            element,
        })
    }

    /// `m.keys()` in the head of a `for...of`, reduced to `m` and which slot to
    /// read.
    ///
    /// The receiver's **type** decides, never the method name. `xs.keys()` on
    /// an array yields indices where `m.keys()` on a table yields keys, so a
    /// fold that trusted the name would iterate the wrong thing quietly. Both
    /// are folded -- an array's counted loop already keeps the index the three
    /// spellings differ over, so it can answer all of them -- and the name is
    /// carried out as `forced` for [`Self::walk_of`] to hold against the arity.
    ///
    /// Carrying the name rather than deciding here is what keeps
    /// `for (const pair of xs.entries())` **refused** instead of silently
    /// walking elements: the fold has already replaced the call by then, so the
    /// arity check in `walk_of` is the only thing between a one-name head and
    /// the wrong sequence.
    pub(super) fn sequence_source(&self, sequence: NodeId) -> (NodeId, Option<&'static str>) {
        let plain = (sequence, None);
        if self.kind_of(sequence) != Some(syntax::CALL_EXPRESSION)
            || !self.arguments_of(sequence).is_empty()
        {
            return plain;
        }
        let Some(callee) = self.children(sequence).first().copied() else {
            return plain;
        };
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return plain;
        }
        let parts = self.children(callee);
        let [receiver, member] = parts.as_slice() else {
            return plain;
        };
        if !matches!(
            self.type_of(*receiver),
            Some(HirType::Managed(
                ManagedType::Map(_, _)
                    | ManagedType::Set(_)
                    | ManagedType::Array(_)
                    | ManagedType::Template
                    | ManagedType::View(_)
            ))
        ) {
            return plain;
        }
        match self.literal_name(*member).as_deref() {
            Some("keys") => (*receiver, Some("keys")),
            Some("values") => (*receiver, Some("values")),
            Some("entries") => (*receiver, Some("entries")),
            _ => plain,
        }
    }

    /// The walks that bind **two** names, which is a different question from
    /// which walk a sequence supports.
    ///
    /// Three sequences answer it and all three for the same reason: the pair
    /// the language says the element is never exists. A `Map` holds its keys
    /// and values in separate arrays and reads one of each; a `Set`'s
    /// `entries()` yields `[v, v]`, which node agrees is the same value twice;
    /// and an array's counted loop already keeps the index, so `xs.entries()`
    /// is that loop reading its own cursor. Building a pair per iteration to
    /// take apart immediately would be an allocation for nothing in each.
    ///
    /// `None` where the sequence is not one of the three, which leaves the
    /// arity refusal in [`Self::walk_of`] to say so.
    pub(super) fn pair_walk(ty: &HirType, forced: Option<&'static str>) -> Option<Walk> {
        match ty {
            // `for (const [k, v] of map)` and `of map.entries()` are the same
            // walk written two ways, which is why the bare form is admitted.
            HirType::Managed(ManagedType::Map(key, value))
                if matches!(forced, None | Some("entries")) =>
            {
                Some(Walk::Entries {
                    key: (**key).clone(),
                    value: (**value).clone(),
                    value_read: "nts_map_value_at",
                })
            }
            HirType::Managed(ManagedType::Set(element)) if forced == Some("entries") => {
                Some(Walk::Entries {
                    key: (**element).clone(),
                    value: (**element).clone(),
                    value_read: "nts_map_key_at",
                })
            }
            HirType::Managed(ManagedType::Array(element) | ManagedType::View(element))
                if forced == Some("entries") =>
            {
                Some(Walk::Counted {
                    element: (**element).clone(),
                    binds: Binds::PositionAndElement,
                })
            }
            _ => None,
        }
    }

    /// Which walk a lowered sequence supports, or why it supports none.
    pub(super) fn walk_of(
        &mut self,
        sequence: NodeId,
        value: ValueId,
        forced: Option<&'static str>,
        binds: usize,
    ) -> Result<Walk, Diagnostic> {
        let ty = self.values[value.0 as usize].ty.clone();
        if binds == 2
            && let Some(walk) = Self::pair_walk(&ty, forced)
        {
            return Ok(walk);
        }
        if binds != 1 {
            return Err(self.unsupported(
                sequence,
                &format!("a `for...of` binding {binds} names over this sequence"),
            ));
        }
        match (&ty, forced) {
            // A view walks by count exactly as an array does -- `length` and
            // an index, which is what `Walk::Counted` is. The loop it emits
            // reads through `ArrayGet`, and that already takes both.
            //
            // `values()` is the same walk written the other way, which is what
            // JavaScript says too. `entries()` is **not** here: with one name it
            // would bind the `[index, element]` pair, which a collection builds
            // (`collection_walk`) and a `for...of` does not yet, so it falls to
            // the refusal below rather than quietly walking elements -- the
            // hazard `sequence_source` names.
            (
                HirType::Managed(ManagedType::Array(element) | ManagedType::View(element)),
                None | Some("values"),
            ) => Ok(Walk::Counted {
                element: (**element).clone(),
                binds: Binds::Element,
            }),
            // `keys()` yields the positions, so the walk's element *is* the
            // index and its type is a number rather than the array's.
            (HirType::Managed(ManagedType::Array(_) | ManagedType::View(_)), Some("keys")) => {
                Ok(Walk::Counted {
                    element: HirType::NUMBER,
                    binds: Binds::Position,
                })
            }
            (HirType::Managed(ManagedType::String), None) => Ok(Walk::Text),
            // A `Set`'s elements are its keys, so iterating one, its `keys()`
            // and its `values()` are the same walk -- which is what JavaScript
            // says too.
            (HirType::Managed(ManagedType::Set(element)), None | Some("keys" | "values")) => {
                Ok(Walk::Table {
                    read: "nts_map_key_at",
                    element: (**element).clone(),
                })
            }
            (HirType::Managed(ManagedType::Map(key, _)), Some("keys")) => Ok(Walk::Table {
                read: "nts_map_key_at",
                element: (**key).clone(),
            }),
            (HirType::Managed(ManagedType::Map(_, value)), Some("values")) => Ok(Walk::Table {
                read: "nts_map_value_at",
                element: (**value).clone(),
            }),
            // Iterating a `Map` itself yields a `[key, value]` pair. A
            // collection builds one per entry (`collection_walk`); a `for...of`
            // binding one name would bind it, and building it there is a
            // feature of its own, so it says which.
            (HirType::Managed(ManagedType::Map(_, _)), None) => Err(self.unsupported(
                sequence,
                "a `for...of` over a `Map` binding one name, which would be the \
                 `[key, value]` pair itself; bind `[key, value]` instead",
            )),
            // A user type that declares `[Symbol.iterator]`. Last, so every
            // built-in above keeps its own walk: an array is a counted loop and
            // a `Map` is a table read, and routing either through the protocol
            // would allocate an iterator to arrive at the same elements.
            // A generator, recognised by the type its call produced: the frame
            // ids are their own part of the synthetic space, so nothing else
            // can be mistaken for one.
            (HirType::Managed(ManagedType::Object(ty)), None)
                if crate::hir::is_generator_frame(*ty) =>
            {
                self.generator_walk(sequence, value)
            }
            // A generator that arrived rather than being made here, which is
            // typed as the abstract generator and not as any one frame. It has
            // to come before the protocol walk below: `Generator<T, …>` does
            // declare a `[Symbol.iterator]`, so that arm would match and build
            // an iterator for a value that is resumed rather than `next`ed.
            (HirType::Managed(ManagedType::Object(ty)), None)
                if abstract_generator_kind(self.snapshot, *ty).is_some() =>
            {
                self.generator_walk(sequence, value)
            }
            (HirType::Managed(ManagedType::Object(ty)), None)
                if self
                    .well_known_property_key(*ty, nts_semantic_schema::WellKnownSymbol::Iterator)
                    .is_some() =>
            {
                let ty = *ty;
                self.protocol_walk(sequence, value, ty)
            }
            // A Windows Runtime vector, whose `[Symbol.iterator]` names the
            // two methods it is walked by (`@ntsIterate get_Size GetAt`).
            (HirType::NativePointer(_), None) if self.native_iteration(sequence).is_some() => {
                self.native_walk(sequence)
            }
            // A collection a binding implements, which lib.dom declares
            // iterable and the binding spells as `length` and `item`.
            (HirType::NativePointer(_), None) if self.delegated_collection(sequence).is_some() => {
                self.delegated_walk(sequence)
            }
            (_, Some(method)) => Err(self.unsupported(
                sequence,
                &format!("`{method}()` on this type, which needs the iteration protocol"),
            )),
            _ => {
                let named = self
                    .snapshot
                    .node_types
                    .get(&sequence)
                    .map(|ty| describe(self.snapshot, *ty));
                Err(self.unsupported(
                    sequence,
                    &match named {
                        Some(what) => format!("a `for...of` over {what}"),
                        None => "a `for...of` over something with no iteration".to_owned(),
                    },
                ))
            }
        }
    }

    /// What a Windows Runtime sequence's `[Symbol.iterator]` says it is walked
    /// by: a vector's two methods, `@ntsIterate get_Size GetAt`, or an
    /// iterable's one, `@ntsIterate First`, found on the sequence's type.
    fn native_iteration(&self, sequence: NodeId) -> Option<Vec<String>> {
        let ty = self.snapshot.node_types.get(&sequence).copied()?;
        let tag = self
            .members_of(ty, |key| {
                self.snapshot
                    .key_is_well_known(key, nts_semantic_schema::WellKnownSymbol::Iterator)
            })
            .into_iter()
            .find_map(|property| {
                let native = self.node(property.declaration?).native.as_deref()?;
                native.iterate.clone()
            })?;
        let words: Vec<String> = tag.split_whitespace().map(str::to_owned).collect();
        matches!(words.len(), 1 | 2).then_some(words)
    }

    /// Every property of `ty` a predicate accepts by name, through each part
    /// of an intersection: an instantiation's members are its parts'.
    fn members_of(
        &self,
        ty: TypeId,
        wanted: impl Fn(&PropertyKey) -> bool,
    ) -> Vec<&nts_semantic_schema::PropertyRecord> {
        let mut found = Vec::new();
        let mut pending = vec![ty];
        while let Some(ty) = pending.pop() {
            match self
                .snapshot
                .types
                .get(ty.0 as usize)
                .map(|record| &record.kind)
            {
                Some(TypeKind::Intersection(parts)) => pending.extend(parts.iter().copied()),
                Some(TypeKind::Object { properties }) => {
                    found.extend(properties.iter().filter(|p| wanted(&p.name)));
                }
                _ => {}
            }
        }
        found
    }

    /// [`Walk::Native`] for a sequence [`Self::native_iteration`] answered
    /// for: each method's declaration and the signature the instantiation
    /// gives it -- an iterable's iterator methods read from what `First`
    /// answers -- and the element the walk reads.
    fn native_walk(&mut self, sequence: NodeId) -> Result<Walk, Diagnostic> {
        let refuse = |this: &Self| {
            this.unsupported(sequence, "a `for...of` over a Windows Runtime sequence whose `@ntsIterate` names no method it declares")
        };
        let words = self
            .native_iteration(sequence)
            .ok_or_else(|| refuse(self))?;
        let ty = self
            .snapshot
            .node_types
            .get(&sequence)
            .copied()
            .ok_or_else(|| refuse(self))?;
        let method = |this: &Self, on: TypeId, name: &str| this.walk_method(on, name);
        let (by, read) = match words.as_slice() {
            [size, at] => {
                let size = method(self, ty, size).ok_or_else(|| refuse(self))?;
                let at = method(self, ty, at).ok_or_else(|| refuse(self))?;
                let read = at.2.return_type;
                (NativeBy::Vector(Box::new(VectorMethods { size, at })), read)
            }
            [first] => {
                let first = method(self, ty, first).ok_or_else(|| refuse(self))?;
                let iterator = first.2.return_type;
                let on = |this: &Self, name: &str| {
                    method(this, iterator, name).ok_or_else(|| refuse(this))
                };
                let has = on(self, "get_HasCurrent")?;
                let current = on(self, "get_Current")?;
                let advance = on(self, "MoveNext")?;
                let read = current.2.return_type;
                (
                    NativeBy::Iterator(Box::new(IteratorMethods {
                        first,
                        has,
                        current,
                        advance,
                    })),
                    read,
                )
            }
            _ => return Err(refuse(self)),
        };
        let element = self.represent(read).ok_or_else(|| {
            self.unsupported(
                sequence,
                "a Windows Runtime sequence whose element has no representation",
            )
        })?;
        Ok(Walk::Native(Box::new(NativeWalk {
            by,
            element,
            site: sequence,
            narrows: false,
        })))
    }

    /// A walk whose elements are read as the program's type for them
    /// (`NativeWalk::narrows`), given the one name the loop binds: that name's
    /// type, where it is a handle below what the walk reads. Any other head
    /// keeps the walk's own element, and binding it says what does not fit.
    fn element_as_declared(&self, mut walk: Walk, head: &Head) -> Walk {
        if let Walk::Native(native) = &mut walk
            && native.narrows
            && let Head::InOrder(names) = head
            && let [Some(name)] = names.as_slice()
            && let Some(declared) = self.type_of(*name)
            && Self::host_downcast(&native.element, &declared)
        {
            native.element = declared;
        }
        walk
    }

    /// Whether a host handle of type `from` may be read as `to`, a kind of it
    /// along its declared chain: the downcast a binding's lib.dom type
    /// licenses (`narrowed`, `bridges::trusted_downcast`).
    pub(super) fn host_downcast(from: &HirType, to: &HirType) -> bool {
        let handle = |ty: &HirType| match ty {
            HirType::NativePointer(crate::hir::native::Pointee::Opaque(handle))
                if matches!(handle.family, crate::hir::native::Family::Host(_)) =>
            {
                Some(handle.clone())
            }
            _ => None,
        };
        matches!((handle(from), handle(to)), (Some(from), Some(to)) if to.upcasts_to(&from))
    }

    /// A method of `on` a [`Walk::Native`] calls, `this` first among its
    /// parameters as a native call takes it.
    pub(super) fn walk_method(&self, on: TypeId, name: &str) -> Option<NativeMethod> {
        let property = self
            .members_of(on, |member| member.is_name(name))
            .into_iter()
            .next()?;
        let declaration = property.declaration?;
        let TypeKind::Function(signature) = self.snapshot.types.get(property.ty.0 as usize)?.kind
        else {
            return None;
        };
        let mut signature = self.snapshot.signatures.get(signature.0 as usize)?.clone();
        let this_type = signature.this_type?;
        signature.parameters.insert(
            0,
            nts_semantic_schema::ParameterRecord {
                name: "this".to_owned(),
                ty: this_type,
                optional: false,
                rest: false,
            },
        );
        Some((name.to_owned(), declaration, signature))
    }

    /// The `length` and `item` a collection a binding implements is walked
    /// by -- `NodeList`'s, `HTMLCollection`'s, `DOMTokenList`'s -- where the
    /// program's type for it is lib.dom's (`NodeListOf<Element>`, which
    /// `querySelectorAll` returns): the bound type and the two methods.
    pub(super) fn delegated_collection(
        &self,
        sequence: NodeId,
    ) -> Option<(TypeId, NativeMethod, NativeMethod)> {
        let bound = self.delegated_type(*self.snapshot.node_types.get(&sequence)?)?;
        Some((
            bound,
            self.walk_method(bound, "_get_length")?,
            self.walk_method(bound, "item")?,
        ))
    }

    /// [`Walk::Native`] over a collection a binding implements
    /// ([`Self::delegated_collection`]), as `%Array.prototype.values%` walks an
    /// array-like: `item(i)` while `i < length`, the length read again each
    /// turn -- so a live list a loop body changes is seen changed, as page
    /// script sees it. The element is what `item` answers, read as the loop
    /// variable's type ([`Self::element_as_declared`]): lib.dom says what a
    /// `NodeListOf<HTMLLIElement>` holds, as its event maps say what a
    /// listener is passed, and as `narrowed` reads `item(0)` of one.
    pub(super) fn delegated_walk(&mut self, sequence: NodeId) -> Result<Walk, Diagnostic> {
        let Some((_, size, at)) = self.delegated_collection(sequence) else {
            return Err(self.unsupported(
                sequence,
                "a `for...of` over a bound collection with no `length` and `item`",
            ));
        };
        let element = self.represent(at.2.return_type).ok_or_else(|| {
            self.unsupported(
                sequence,
                "a bound collection whose `item` answers a type with no representation",
            )
        })?;
        Ok(Walk::Native(Box::new(NativeWalk {
            by: NativeBy::Vector(Box::new(VectorMethods { size, at })),
            element,
            site: sequence,
            narrows: true,
        })))
    }

    /// A call of one of a [`Walk::Native`]'s methods on the vector or the
    /// iterator, its HRESULT checked.
    pub(super) fn call_native_walk(
        &mut self,
        site: NodeId,
        (name, declaration, signature): &NativeMethod,
        vector: ValueId,
        arguments: Vec<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let callee = self.native_callee(site, Some(*declaration), name.clone(), signature)?;
        let Callee::Native(target) = &callee else {
            return Err(self.unsupported(
                site,
                "a Windows Runtime vector's method that is not a native call",
            ));
        };
        let target = target.clone();
        let count = arguments.len();
        // The cursor is a number; the slot takes what its declaration says.
        let arguments = arguments
            .into_iter()
            .enumerate()
            .map(|(at, argument)| match target.parameters.get(at + 1) {
                Some(parameter) => self.coerce(argument, &parameter.representation(), site),
                None => Ok(argument),
            })
            .collect::<Result<Vec<_>, _>>()?;
        let (args, lent) = self.native_arguments(site, &target, arguments, count, Some(vector))?;
        // The method's own type: the call is not the sequence's node, whose
        // type the checker gave the whole collection.
        let returns = self.represent(signature.return_type);
        self.finish_call_typed(site, callee, args, lent, Some(*declaration), returns)
    }

    /// The cursor of a `for...of`, moved on by one element.
    ///
    /// Built in the loop's latch, which is where `continue` lands.
    pub(super) fn advance(
        &mut self,
        walk: &Walk,
        sequence: ValueId,
        at: ValueId,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        // An iterator steps by `MoveNext`, whose answer -- whether there is a
        // current element now -- is the next cursor.
        if let Walk::Native(native) = walk
            && let NativeBy::Iterator(methods) = &native.by
        {
            let moved =
                self.call_native_walk(native.site, &methods.advance, sequence, Vec::new())?;
            return self.cursor_of_presence(moved, native.site, origin);
        }
        Ok(match walk {
            // The protocol advances itself: `next()` moves the iterator, and
            // there is no cursor for a latch to step. `lower_for_of` gives it
            // `Step::None` for exactly this reason, so nothing reaches here.
            Walk::Protocol { .. } | Walk::Generator { .. } => {
                unreachable!("a cursorless walk has no cursor; its step is `Step::None`")
            }
            Walk::Counted { .. } | Walk::Native(_) => {
                let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
                self.push(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: at,
                        rhs: one,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                )
            }
            // The width is asked for again rather than carried out of the body.
            // It is a pure read of two code units, and carrying it would mean a
            // second loop-carried name existing only to cross one block edge.
            Walk::Text => {
                let width = self.call_runtime(
                    "nts_str_point_width",
                    vec![sequence, at],
                    HirType::NUMBER,
                    origin,
                );
                self.push(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: at,
                        rhs: width,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                )
            }
            Walk::Table { .. } | Walk::Entries { .. } => {
                let one = self.push(OpKind::ConstInt(1), TABLE_CURSOR, origin.clone());
                let after = self.push(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: at,
                        rhs: one,
                    },
                    TABLE_CURSOR,
                    origin.clone(),
                );
                self.call_runtime("nts_map_next", vec![sequence, after], TABLE_CURSOR, origin)
            }
        })
    }

    /// The element a cursor is currently on.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn read_element(
        &mut self,
        walk: &Walk,
        sequence: ValueId,
        at: ValueId,
        origin: &Origin,
    ) -> Result<Vec<ValueId>, Diagnostic> {
        // A table read comes back erased, because that is what the table
        // stores. Where the element type is concrete the payload is read back
        // here, so the body sees a `Socket` rather than sixteen bytes.
        let unerased = |lower: &mut Self, slot: ValueId, want: &HirType| {
            // A counted handle is its family's tag, which `Unerase` checks.
            if *want == HirType::Erased {
                slot
            } else {
                lower.push(OpKind::unerase(slot), want.clone(), origin.clone())
            }
        };
        // A counted walk, which may hand back the position, the element, or
        // both. Here rather than in the single-value match below because
        // `entries()` produces two, exactly as the `Map` case does.
        if let Walk::Counted { element, binds } = walk {
            let element = element.clone();
            let binds = *binds;
            // Checked: the length was read once and the bounds pass is what
            // proves the index inside it.
            let read = |lower: &mut Self| {
                lower.push(
                    OpKind::ArrayGet {
                        array: sequence,
                        index: at,
                        checked: true,
                    },
                    element.clone(),
                    origin.clone(),
                )
            };
            return Ok(match binds {
                Binds::Element => vec![read(self)],
                Binds::Position => vec![at],
                Binds::PositionAndElement => vec![at, read(self)],
            });
        }
        if let Walk::Native(native) = walk {
            let mut element = match &native.by {
                NativeBy::Vector(methods) => {
                    self.call_native_walk(native.site, &methods.at, sequence, vec![at])?
                }
                NativeBy::Iterator(methods) => {
                    self.call_native_walk(native.site, &methods.current, sequence, Vec::new())?
                }
            };
            if native.narrows
                && Self::host_downcast(&self.values[element.0 as usize].ty, &native.element)
            {
                element = self.push(
                    OpKind::Convert(element),
                    native.element.clone(),
                    origin.clone(),
                );
            }
            return Ok(vec![element]);
        }
        if let Walk::Entries {
            key,
            value,
            value_read,
        } = walk
        {
            let k = self.call_runtime(
                "nts_map_key_at",
                vec![sequence, at],
                HirType::Erased,
                origin,
            );
            let k = unerased(self, k, key);
            let v = self.call_runtime(value_read, vec![sequence, at], HirType::Erased, origin);
            let v = unerased(self, v, value);
            return Ok(vec![k, v]);
        }
        Ok(vec![match walk {
            // Handled above, with the other walks that read their own cursor.
            Walk::Counted { .. } | Walk::Native(_) => {
                unreachable!("a counted walk answered already")
            }
            Walk::Table { read, element } => {
                let slot = self.call_runtime(read, vec![sequence, at], HirType::Erased, origin);
                // The table stores erased values. Where the element type is
                // concrete the payload is read back here, so the body sees a
                // `Socket` rather than sixteen bytes it has to unpack itself.
                if *element == HirType::Erased {
                    slot
                } else {
                    self.push(OpKind::unerase(slot), element.clone(), origin.clone())
                }
            }
            Walk::Text => {
                let width = self.call_runtime(
                    "nts_str_point_width",
                    vec![sequence, at],
                    HirType::NUMBER,
                    origin,
                );
                let end = self.push(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: at,
                        rhs: width,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                );
                self.call_runtime(
                    "nts_str_slice",
                    vec![sequence, at, end],
                    HirType::Managed(ManagedType::String),
                    origin,
                )
            }
            // Handled above, before this match: it is the one shape that reads
            // more than a single value.
            Walk::Entries { .. } => unreachable!("entries reads two and returned already"),
            Walk::Protocol { .. } | Walk::Generator { .. } => {
                unreachable!("a cursorless walk reads its element from the step")
            }
        }])
    }

    /// What a `for...of` head binds.
    ///
    /// One identifier is the ordinary case. An array pattern is
    /// `for (const [k, v] of map)`, whose two names are the two values the walk
    /// over a table produces -- positional, and read directly rather than
    /// through a pair object that would be built only to be taken apart.
    ///
    /// An **object** pattern is not positional. `for (const { x, y } of points)`
    /// binds by property name off the one value the walk produces, which is
    /// what [`Self::bind_pattern`] already does for `const { x, y } = p` --
    /// renames, nesting and all. It was refused here only because this returned
    /// names in order, and an order is the one thing an object pattern does not
    /// have.
    /// The binding pattern of a `for...of` head, of the kind asked for.
    ///
    /// One lookup, because [`Self::for_of_head`] finds it to read the names out
    /// and the caller finds it again to hand the whole pattern over when the
    /// sequence turns out not to be a `Map`.
    fn for_of_pattern(&self, initializer: NodeId, kind: u16) -> Option<NodeId> {
        self.children(initializer)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::VARIABLE_DECLARATION))
            .into_iter()
            .flat_map(|declaration| self.children(declaration))
            .find(|part| self.kind_of(*part) == Some(kind))
    }

    /// Which of `[a, b]`'s two readings this sequence asks for.
    ///
    /// **Over a `Map` the names are a key and a value**: the walk produces two
    /// values per step and there is no pair object to take apart, which is what
    /// [`Head::InOrder`] says. **Over an array of tuples** the walk produces one
    /// value per step and the brackets are an ordinary destructuring of it,
    /// exactly as `const [a, b] = pair` is.
    ///
    /// [`Self::for_of_head`] cannot tell them apart -- the pattern is identical
    /// in both and the difference is entirely in what is being walked -- so it
    /// is asked here, of the *lowered* sequence, which is also after
    /// `m.entries()` has been folded back to `m`. Before this the second reading
    /// was refused as ``a `for...of` binding 2 names over this sequence``: a
    /// true sentence, about the first.
    fn head_for_the_sequence(
        &mut self,
        head: Head,
        initializer: NodeId,
        sequence: ValueId,
        forced: Option<&'static str>,
    ) -> Head {
        // `xs.entries()` is the third reading and it is positional like the
        // first: the two names are the position and the element, and there is
        // no pair to take apart -- `sequence_source` has already folded the
        // call away, so by here the value is the array itself and the only
        // thing still saying which of the two readings was written is the name
        // it carried out. Without this, `for (const [i, v] of xs.entries())`
        // became a destructuring of an element and then refused, because an
        // element is not a pair.
        if forced == Some("entries") {
            return head;
        }
        if !matches!(head, Head::InOrder(_))
            || matches!(
                self.values[sequence.0 as usize].ty,
                HirType::Managed(ManagedType::Map(_, _) | ManagedType::Set(_))
            )
        {
            return head;
        }
        // **Whether brackets were written, not how many names are in them.**
        // `Head::InOrder` cannot tell `for (const x of xs)` from
        // `for (const [x] of xs)` -- a bare name and a one-element pattern both
        // arrive as one name -- so counting names answered the first question
        // for `[a, b]` and the wrong one for `[k]`, which bound the whole tuple
        // to `k` and then refused converting it to a string.
        //
        // `for_of_pattern` returns `None` for a bare name, which is the
        // distinction the count could not make.
        match self.for_of_pattern(initializer, syntax::ARRAY_BINDING_PATTERN) {
            Some(pattern) => Head::Pattern(pattern),
            None => head,
        }
    }

    fn for_of_head(&self, initializer: NodeId) -> Result<Head, Diagnostic> {
        let Some(declaration) = self
            .children(initializer)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::VARIABLE_DECLARATION))
        else {
            // **No declaration is not an error, it is the other form.**
            // `for (v of xs)` assigns to something that already exists, which
            // the language allows for any assignment target. The head *is* the
            // target here rather than containing one.
            return Ok(Head::Assign(initializer));
        };
        let parts = self.children(declaration);
        if let Some(name) = parts
            .iter()
            .copied()
            .find(|part| self.kind_of(*part) == Some(syntax::IDENTIFIER))
        {
            return Ok(Head::InOrder(vec![Some(name)]));
        }
        if let Some(pattern) = parts
            .iter()
            .copied()
            .find(|part| self.kind_of(*part) == Some(syntax::OBJECT_BINDING_PATTERN))
        {
            return Ok(Head::Pattern(pattern));
        }
        let pattern = parts
            .iter()
            .copied()
            .find(|part| self.kind_of(*part) == Some(syntax::ARRAY_BINDING_PATTERN))
            .ok_or_else(|| self.unsupported(initializer, "a `for...of` binding of this shape"))?;

        let mut names = Vec::new();
        for element in self.children(pattern) {
            if self.kind_of(element) != Some(syntax::BINDING_ELEMENT) {
                return Err(self.unsupported(element, "a hole in a destructuring pattern"));
            }
            // A name and nothing else. A default carries an initializer, a rest
            // a `...`, and a nested pattern a pattern -- each arrives as a
            // second child.
            let inner = self.children(element);
            // **An elision is a binding element with no children**, which is
            // how `for (const [, v] of m)` -- the way a `Map`'s values are
            // iterated -- reaches here. It binds nothing and still occupies a
            // position, so it is kept as a `None` rather than dropped: the
            // count is what says `v` is the *second* element.
            if inner.is_empty() {
                names.push(None);
                continue;
            }
            // **An element that is more than a name says which reading this
            // is**, rather than being a shape to refuse. A default, a rest or a
            // nested pattern cannot be one of a walk's positional values -- a
            // `Map` hands over a key and a value and there is nothing to
            // default or gather -- so the brackets must be an ordinary
            // destructuring of the single element the walk produces, which is
            // exactly what `Head::Pattern` means and what `bind_pattern`
            // already does for `const [first, ...tail] = xs`.
            //
            // Refusing here instead made the same pattern work in a
            // declaration and fail in a head: `for (const [head, ...tail] of
            // rows)` was `a destructuring element that is more than a name`,
            // which is a true sentence about the reading it was not.
            //
            // Over a `Map` this now falls to `walk_of`'s one-name refusal,
            // which names the pair and says to bind `[key, value]` -- a better
            // sentence for that case than this one was.
            let [name] = inner.as_slice() else {
                return Ok(Head::Pattern(pattern));
            };
            if self.kind_of(*name) != Some(syntax::IDENTIFIER) {
                return Ok(Head::Pattern(pattern));
            }
            names.push(Some(*name));
        }
        Ok(Head::InOrder(names))
    }

    /// Every symbol a binding pattern declares, however deeply.
    ///
    /// The loop needs them so that a name the head binds is not mistaken for one
    /// the body carries round.
    fn pattern_symbols(&self, pattern: NodeId, into: &mut Vec<u32>) {
        for child in self.children(pattern) {
            match self.kind_of(child) {
                Some(syntax::IDENTIFIER) => {
                    if let Some(symbol) = self.node(child).symbol {
                        into.push(symbol.0);
                    }
                }
                _ => self.pattern_symbols(child, into),
            }
        }
    }

    /// Give a `for...of` head the values the walk produced.
    ///
    /// Names take them in order. A pattern takes the one value there is and
    /// goes through [`Self::bind_pattern`], the same function a declaration
    /// uses, so a rename or a nested pattern needs nothing here.
    /// **The head assigns too**, so what it writes is loop-carried.
    ///
    /// `for (v of xs) { s += v }` writes `v` once per iteration and the body
    /// may never mention it, so `assigned_symbols(body)` does not see it -- and
    /// a value written in the loop and read after it has to be carried like any
    /// other. It showed as `NotDominated`, not as a wrong answer.
    ///
    /// Only names already bound here. `for (o.k of xs)` writes through a place
    /// that outlives the loop on its own, and a module-scope global is storage
    /// rather than a carried value.
    fn carry_what_the_head_assigns(&self, head: &Head, carried: &mut Vec<u32>) {
        let Head::Assign(target) = head else {
            return;
        };
        let mut written = Vec::new();
        self.names_written_by(*target, &mut written);
        // **And anything the head's defaults assign.** `for ([a = (flag = 1)]
        // of xss)` writes `flag` inside the loop, on the iterations where the
        // element is absent -- so it is carried for the same reason `a` is, and
        // for a reason `names_written_by` cannot see: it collects *targets*,
        // and this is an assignment in an expression. `assigned_symbols` is the
        // walk that finds those, and it finds nothing for a bare name, so the
        // two are complementary rather than redundant.
        self.assigned_symbols(*target, &mut written);
        for symbol in written {
            if self.bindings.contains_key(&symbol) && !carried.contains(&symbol) {
                carried.push(symbol);
            }
        }
    }

    /// Every name a `for (… of …)` head writes to, as symbols.
    ///
    /// A bare `v` writes one; `[a, b]` and `{ a, b }` write several. Collected
    /// by walking the target rather than through `assigned_symbols`, which
    /// looks for assignment *expressions* -- the head is a target, not an
    /// assignment, so that walk finds nothing and the loop left every one of
    /// these behind. It showed as `NotDominated`, a value written inside the
    /// loop and read after it, rather than as a wrong answer.
    fn names_written_by(&self, target: NodeId, into: &mut Vec<u32>) {
        match self.kind_of(target) {
            Some(syntax::IDENTIFIER) => {
                if let Some(symbol) = self.node(target).symbol {
                    into.push(symbol.0);
                }
            }
            Some(syntax::ARRAY_LITERAL_EXPRESSION | syntax::OBJECT_LITERAL_EXPRESSION) => {
                for child in self.children(target) {
                    self.names_written_by(child, into);
                }
            }
            // A property or element target is storage that outlives the loop on
            // its own, and a shorthand property carries the *property's* symbol
            // rather than the variable's -- which `assign_pattern` resolves by
            // name and this does not have to.
            _ => {
                for child in self.children(target) {
                    if self.kind_of(child) == Some(syntax::IDENTIFIER) {
                        self.names_written_by(child, into);
                    }
                }
            }
        }
    }

    fn bind_head(
        &mut self,
        id: NodeId,
        head: &Head,
        symbols: &[Option<u32>],
        values: Vec<ValueId>,
    ) -> Result<(), Diagnostic> {
        match head {
            Head::InOrder(_) => {
                for (symbol, value) in symbols.iter().zip(values) {
                    // A hole consumed its position above and binds nothing.
                    if let Some(symbol) = symbol {
                        self.bindings.insert(*symbol, value);
                    }
                }
                Ok(())
            }
            Head::Pattern(pattern) => {
                let [element] = values.as_slice() else {
                    return Err(self.unsupported(id, "a `for...of` pattern over a walk of pairs"));
                };
                let (pattern, element) = (*pattern, *element);
                self.bind_pattern(pattern, element, PatternScope::Local)
            }
            // The same write an assignment statement makes, once per iteration
            // -- including when the target is a **destructuring pattern**.
            //
            // `for ([a, b] of pairs)` writes through an array *literal* used as
            // an assignment target, which `assign_pattern` already handles for
            // `[a, b] = p`; `place_of` does not, and refused it as `assignment
            // to a computed target` -- 31 of the 36 files this form appears in.
            // Routed to the same function rather than taught the shape twice.
            Head::Assign(target) => {
                let [element] = values.as_slice() else {
                    return Err(self.unsupported(id, "a `for...of` target over a walk of pairs"));
                };
                let (target, element) = (*target, *element);
                if matches!(
                    self.kind_of(target),
                    Some(syntax::ARRAY_LITERAL_EXPRESSION | syntax::OBJECT_LITERAL_EXPRESSION)
                ) {
                    return self.assign_pattern(target, element);
                }
                let place = self.place_of(target)?;
                self.write_place(target, &place, element)?;
                Ok(())
            }
        }
    }

    pub(super) fn lower_for_of(&mut self, id: NodeId, over: Over) -> Result<(), Diagnostic> {
        // `for await` carries the keyword as a **fourth child**, so the shape
        // here is four rather than three.
        //
        // The keyword does not choose the step -- the sequence's type does,
        // because an `async function*` is what makes a walk asynchronous. What
        // it chooses is whether a *synchronous* sequence is allowed, and that
        // is a separate question with a measured answer. This comment said the
        // keyword need not be read at all, on the argument that it would be a
        // second derivation of one fact; the two facts are different, and the
        // check below is what the measurement asked for.
        let Some((awaiting, [initializer, sequence, body])) = for_each_parts(self, id) else {
            return Err(self.unsupported(id, "a `for...of` of unexpected shape"));
        };

        // What the head binds: one name, the two of `[key, value]`, or a
        // pattern taken apart from the single value the walk produces. Refined
        // below, once the sequence is in hand.
        let head = self.for_of_head(initializer)?;

        // `for (const k of m.keys())` reads the table directly. Lowering the
        // call would build an iterator object, step it once per element and
        // throw it away, to arrive at this same walk with an indirection in
        // it -- so the method is recognized here and never lowered.
        // **`for...in` is this loop over the keys**, which is what it means for
        // a compiled object: the layout's field names in the order the program
        // wrote them, which is the same list `Object.keys` answers and the same
        // order the specification asks for. A class's methods live on the
        // descriptor rather than as own properties, so there is no prototype
        // chain to walk and nothing enumerable to inherit -- the two questions
        // that make `for...in` differ from `Object.keys` in JavaScript both have
        // the answer "none" here.
        //
        // Built as the *same* walk rather than a second one, because a second
        // would be a counted loop over an array written twice.
        let (sequence, forced) = match over {
            Over::Elements => self.sequence_source(sequence),
            Over::Keys => (sequence, None),
        };
        let sequence_value = match over {
            Over::Elements => self.lower_expression(sequence)?,
            // Named for the loop the source wrote rather than for the helper
            // this shares. `decide_object_keys` refuses an array as "an
            // `Object` static over something that is not an object", which is a
            // true sentence about a call the program did not make.
            //
            // An array is the case it refuses, and `for...in` over one is a
            // real thing: node answers its indices **as strings**, `"0"` and
            // `"1"`. That is a different list from the layout's field names and
            // is not built here, so it is refused rather than answered with the
            // wrong list.
            Over::Keys => self.decide_object_keys(id, sequence).map_err(|_| {
                self.unsupported(id, "a `for...in` over something without named fields")
            })?,
        };
        let head = self.head_for_the_sequence(head, initializer, sequence_value, forced);
        let mut element_symbols = Vec::new();
        if let Head::InOrder(names) = &head {
            for name in names {
                let Some(name) = *name else {
                    element_symbols.push(None);
                    continue;
                };
                element_symbols.push(Some(
                    self.node(name)
                        .symbol
                        .ok_or_else(|| self.unsupported(name, "a `for...of` name with no symbol"))?
                        .0,
                ));
            }
        }
        // A pattern reads one value and takes it apart; the names in it are not
        // what the walk hands over.
        let wanted = match &head {
            Head::InOrder(names) => names.len(),
            Head::Pattern(_) | Head::Assign(_) => 1,
        };
        let walk = self.walk_of(sequence, sequence_value, forced, wanted)?;
        let walk = self.element_as_declared(walk, &head);
        // **`for await` over a synchronous iterable awaits each element**, and
        // that is observable rather than academic. Walking one as an ordinary
        // `for...of` computes the same elements in the same order and takes no
        // ticks doing it, so anything else queued runs at a different time.
        //
        // Measured, because a fixture reading the loop's *value* cannot tell:
        // summing `[1, 2]` gives 3 either way. A fixture recording the **order**
        // against a second async function gave `129` here and `912` in node --
        // node's loop suspends before the first element, so the other work runs
        // first, and ours ran the whole loop first. Both controls in the same
        // file agreed: a plain `for...of`, and `for await` over an async
        // generator.
        //
        // Refused rather than approximated. The elements would be right and the
        // interleaving wrong, which is the shape of defect this compiler is
        // least able to find later.
        if awaiting
            && !matches!(
                walk,
                Walk::Generator {
                    asynchronous: true,
                    ..
                }
            )
        {
            return Err(self.unsupported(
                id,
                "a `for await` over a synchronous sequence, which awaits every element",
            ));
        }

        let origin = self.origin(id);
        // The cursor. A double, like the counter a hand-written `for` produces,
        // so that specialization decides its machine type by the same rule
        // rather than by which loop it came from.
        //
        // For an array and for text it is a position and starts at zero. For a
        // table it is an entry index, and the entries are not contiguous, so
        // the first live one is asked for rather than assumed.
        let (sequence_value, index, lent) = self.walk_start(&walk, sequence_value, &origin)?;

        let mut carried: Vec<u32> = index.into_iter().collect();
        self.assigned_symbols(body, &mut carried);
        self.carry_what_the_head_assigns(&head, &mut carried);
        let mut declared: Vec<u32> = element_symbols.iter().flatten().copied().collect();
        if let Head::Pattern(pattern) = &head {
            self.pattern_symbols(*pattern, &mut declared);
        }
        self.declared_symbols(body, &mut declared);
        carried.retain(|symbol| Some(*symbol) == index || !declared.contains(symbol));

        // `steps: true` where there is a cursor, so the loop has a latch of its
        // own: the cursor is advanced there rather than at the end of the body,
        // because `continue` jumps to the latch and would otherwise skip the
        // advance and hang.
        //
        // The protocol takes `false`, which makes the *header* the latch -- and
        // that is not a saving but the requirement. `next()` is called in the
        // header, so `continue` has to arrive there; a protocol loop with a
        // latch of its own would step the iterator nowhere and spin.
        let steps = !matches!(walk, Walk::Protocol { .. } | Walk::Generator { .. });
        let record = self.begin_loop(id, &carried, steps, &origin)?;

        // The test, built rather than lowered: the source has no node for it.
        // A position runs while it is inside the length; an entry index runs
        // until the table says there is no next live entry.
        // For the protocol `at` is the `done` the step answered, and `stepped`
        // is the result it came out of -- read again in the body, which the
        // header dominates. One call answers "again?" here and "with what?"
        // there; calling `next()` for each would drop every other element.
        let (stepped, at) = if let Some(index) = index {
            (None, self.bindings[&index])
        } else {
            let (step, done) = self.protocol_step(id, &walk, &origin)?;
            (Some(step), done)
        };
        let cond = self.walk_condition(&walk, at, sequence_value, &origin)?;
        self.test_loop(cond, &record);
        self.switch_to(record.body);

        let values = if stepped.is_some() {
            vec![self.walk_element(&walk, sequence_value, at, stepped, &origin)?]
        } else {
            self.read_element(&walk, sequence_value, at, &origin)?
        };
        if let Walk::Protocol { iterator, .. } = &walk {
            self.lower_iterator_body(id, *iterator, record.depth, &[initializer, body], |this| {
                this.bind_head(id, &head, &element_symbols, values)?;
                this.lower_statement(body)
            })?;
        } else {
            self.bind_head(id, &head, &element_symbols, values)?;
            self.lower_statement(body)?;
        }
        let step = match index {
            // Nothing between iterations: the header is the latch, and the
            // header is where `next()` is called.
            None => Step::None,
            Some(cursor) => Step::Walk {
                cursor,
                walk,
                sequence: sequence_value,
            },
        };
        self.end_loop(&record, step)?;
        self.unlend_walked(lent, &origin);
        Ok(())
    }
}
