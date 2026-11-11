//! Build supplied Error values and emit the guards that raise them at builtin use sites.

use super::{
    Absent, BinOp, Branch, Diagnostic, FuncBuilder, HirType, Layout, ManagedType, NodeId, OpKind,
    Origin, SemanticSnapshot, Terminator, TypeId, ValueId, provided, syntax, type_bases,
};

/// The runtime-provided errors by checker identity and by synthesized one, each
/// to its index in [`crate::hir::builtin::ERRORS`]. Their `lib.d.ts` declarations do
/// not state the nominal ancestry, so it is this table that does.
pub(super) fn provided_error_identities(
    snapshot: &SemanticSnapshot,
) -> rustc_hash::FxHashMap<TypeId, usize> {
    let mut identities = rustc_hash::FxHashMap::default();
    for (at, _) in snapshot.types.iter().enumerate() {
        let Some(ty) = u32::try_from(at).ok().map(TypeId) else {
            continue;
        };
        if let Some(index) = provided(snapshot, ty).and_then(crate::hir::builtin::error_index) {
            identities.insert(ty, index);
        }
    }
    for index in 0..crate::hir::builtin::ERRORS.len() {
        identities.insert(crate::hir::provided_error_type(index), index);
    }
    identities
}

impl FuncBuilder<'_> {
    /// The provided error classes that satisfy `instanceof class`.
    ///
    /// Both checker-interned and synthesized identities come from the shared
    /// hierarchy. A generated `ReferenceError` exists even if only `Error` was
    /// mentioned in the source.
    pub(super) fn provided_errors_under(&self, class: TypeId) -> Vec<TypeId> {
        self.hierarchy
            .provided_errors
            .keys()
            .copied()
            .filter(|ty| self.descends_from(*ty, class))
            .collect()
    }

    /// `"x".repeat(n)` throws a `RangeError` for a count the language refuses.
    ///
    /// The specification is `ToIntegerOrInfinity(count)` and then **throw**
    /// where that is negative or `+Infinity`. A `NaN` is not one of those:
    /// `ToIntegerOrInfinity(NaN)` is `0`, so `"x".repeat(NaN)` is `""` and the
    /// runtime's clamp is right about it.
    ///
    /// So the test is `ToIntegerOrInfinity(n) < 0 || n === Infinity`, and the
    /// first half is spelled **`n <= -1`** rather than `n < 0`.
    ///
    /// That is not a loosening, it is the exact same predicate: truncation is
    /// toward zero, so `ToIntegerOrInfinity(n) < 0` holds precisely when
    /// `n <= -1`. `-0.5` truncates to `-0`, which is not negative, so
    /// `"x".repeat(-0.5)` is `""` in node -- and `n < 0` threw for it. Every
    /// boundary agrees: `-1` and `-1.5` throw, `-0.999` and `-0` do not,
    /// `-Infinity` does, and a `NaN` fails both halves, which is the answer
    /// (`ToIntegerOrInfinity(NaN)` is `0`).
    ///
    /// The truncation is therefore not emitted at all, which is why this is one
    /// operator and not a call: there is no `ToIntegerOrInfinity` in this IR, and
    /// asking for one would have been the natural way to write a change that the
    /// comparison already expresses.
    ///
    /// Two branches rather than one disjunction, because this IR has no boolean
    /// `||` -- a short circuit is control flow, and `n === Infinity` is
    /// evaluated only where `n < 0` was false, which is what the source says.
    ///
    /// Emitted here and not in `nts_str_repeat`, which clamped a negative count
    /// to zero and answered `""`. That is a **wrong answer** rather than a
    /// missing feature, and a helper cannot fix it: a handler is a block and a
    /// `throw` is a jump this lowering writes, so nothing below it can reach
    /// one. Aborting instead would be a different observable --
    /// `try { s.repeat(-1) } catch {}` catches in node.
    ///
    /// It was invisible for as long as it existed, because the differential's
    /// node driver died on the first synchronous throw and every case after it
    /// went unasked. The driver was fixed and `tests/programs/strings` went red on
    /// five cases the same day.
    /// `[].reduce(f)` throws, and the message is node's word for word.
    ///
    /// The specification has no answer for an empty list and no initial value —
    /// there is nothing to return — so it raises rather than inventing one, and
    /// the raise is observable: `try { xs.reduce(f) } catch` catches it. Emitted
    /// here rather than left to the runtime for `guard_repeat_count`'s reason: a
    /// handler is a block and a `throw` is a jump this lowering writes, so
    /// nothing below it can reach one.
    pub(super) fn guard_reduce_has_elements(
        &mut self,
        id: NodeId,
        length: ValueId,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let empty = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: length,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        let throwing = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: empty,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });
        self.switch_to(throwing);
        self.throw_provided_error(
            id,
            "TypeError",
            "Reduce of empty array with no initial value",
        )?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }
        self.switch_to(carry_on);
        Ok(())
    }

    pub(super) fn guard_repeat_count(
        &mut self,
        id: NodeId,
        count: ValueId,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        // `<= -1` rather than `< 0`: see above -- truncation toward zero makes the
        // two differ exactly on the values whose integer part is `-0`.
        let minus_one = self.push(OpKind::ConstFloat(-1.0), HirType::NUMBER, origin.clone());
        let negative = self.push(
            OpKind::Binary {
                op: BinOp::Le,
                lhs: count,
                rhs: minus_one,
            },
            HirType::Bool,
            origin.clone(),
        );
        let throwing = self.new_block();
        let second = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: negative,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: second,
            else_args: Vec::new(),
        });

        self.switch_to(second);
        let infinite = self.push(
            OpKind::ConstFloat(f64::INFINITY),
            HirType::NUMBER,
            origin.clone(),
        );
        let endless = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: count,
                rhs: infinite,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: endless,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });

        self.switch_to(throwing);
        self.throw_provided_error(id, "RangeError", "Invalid count value")?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }
        self.switch_to(carry_on);
        Ok(())
    }

    /// Build one of the provided error classes and throw it, from here.
    ///
    /// For a check the *language* specifies and a runtime helper cannot make.
    /// The message is a constant this compiler chooses, so there is no
    /// expression to lower and [`Self::throw_erased`] takes the value directly
    /// -- the same entry point a rethrow uses.
    pub(super) fn throw_provided_error(
        &mut self,
        id: NodeId,
        class: &str,
        message: &str,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let message = self.push(
            OpKind::ConstString(message.to_owned().into()),
            HirType::Managed(ManagedType::String),
            origin,
        );
        self.throw_provided_error_text(id, class, message)
    }

    /// The same, for a message this compiler has to *compute* -- node puts the
    /// offending value in `Invalid code point 1.5`, and a constant cannot.
    pub(super) fn throw_provided_error_text(
        &mut self,
        id: NodeId,
        class: &str,
        message: ValueId,
    ) -> Result<(), Diagnostic> {
        let (error, object) = self.provided_error(id, class, message)?;
        let origin = self.origin(id);
        let erased = self.push(
            OpKind::Erase {
                value: error,
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            HirType::Erased,
            origin,
        );
        self.throw_erased(id, error, erased, &object)
    }

    /// One of the provided error classes, built with `message`: the value, and
    /// its type. Thrown by [`Self::throw_provided_error_text`]; a rejection that
    /// is not a throw -- an `import()` of a module this program does not contain
    /// -- takes the value itself.
    pub(super) fn provided_error(
        &mut self,
        id: NodeId,
        class: &str,
        message: ValueId,
    ) -> Result<(ValueId, HirType), Diagnostic> {
        let origin = self.origin(id);
        let name = self.push(
            OpKind::ConstString(class.to_owned().into()),
            HirType::Managed(ManagedType::String),
            origin,
        );
        self.provided_error_named(id, class, message, name)
    }

    /// [`Self::provided_error`], its `name` given: a `DOMException` a host
    /// rejects with is an `Error` named `NotAllowedError`.
    pub(super) fn provided_error_named(
        &mut self,
        id: NodeId,
        class: &str,
        message: ValueId,
        name: ValueId,
    ) -> Result<(ValueId, HirType), Diagnostic> {
        // The snapshot's type where the program named the class, and a
        // synthetic one where it did not.
        //
        // The checker only interns what the source mentions, so
        // `type_named("RangeError")` is `None` for most programs -- and a class
        // this compiler *provides* cannot depend on that. `tests/programs/strings`
        // has no `RangeError` in it and `"x".repeat(-1)` throws one all the
        // same.
        //
        // Where both exist they are one class: `collect_layouts` merges two
        // error layouts of the same name, and refuses only two of different
        // names.
        let found = self
            .type_named(class)
            .and_then(|ty| self.provided_layout(ty).map(|layout| (ty, layout)));
        let (ty, layout) = if let Some(found) = found {
            found
        } else {
            {
                let Some(index) = crate::hir::builtin::error_index(class) else {
                    return Err(self.unsupported(
                        id,
                        &format!("a thrown `{class}`, which this compiler does not provide"),
                    ));
                };
                let ty = crate::hir::provided_error_type(index);
                let layout = self.layout_for_provided_error(ty, class);
                (ty, layout)
            }
        };
        let origin = self.origin(id);
        let object = HirType::Managed(ManagedType::Object(ty));
        self.materialize(id, &object)?;
        let error = self.push(
            OpKind::ObjectNew { frame: false },
            object.clone(),
            origin.clone(),
        );
        for (field, value) in [("message", message), ("name", name)] {
            let Some(at) = layout.index_of(field) else {
                continue;
            };
            self.field_set(error, at, value, &origin);
        }
        Ok((error, object))
    }

    /// The layout of a class this compiler provides, if `ty` names one.
    pub(super) fn provided_layout(&mut self, ty: TypeId) -> Option<Layout> {
        let name = provided(self.snapshot, ty)
            .filter(|name| crate::hir::builtin::is_error(name))?
            .to_owned();
        Some(self.layout_for_provided_error(ty, &name))
    }

    /// Named and synthesized errors share their fields and ancestry. A TDZ
    /// throws `ReferenceError` even when only `Error` was named in the source;
    /// casting that caught value to Error requires the same relation as a
    /// source-written `new ReferenceError`.
    pub(super) fn layout_for_provided_error(&mut self, ty: TypeId, name: &str) -> Layout {
        // `TypeError extends Error`, which the compiler knows and used to
        // discard. The hierarchy has never heard of these four -- they are not
        // declarations in this program -- so `Hierarchy::base` has nothing, and
        // this is where the relation is spelled instead. `lower_instanceof`
        // already spells the same one for the same reason, through
        // `provided_errors_under`.
        //
        // The comment here used to say a base would be *worse* than none:
        // all four would carry `Error`, merge on identical fields, methods and
        // base, and reproduce the defect 0074 names. That was true when it was
        // written and is not now -- `collect_layouts` grew a nominal guard for
        // exactly this family, and two differently-named error layouts do not
        // merge whatever their shape says. The reason outlived the condition it
        // described, which is the third stale comment found this week.
        //
        // Only the JVM can see the difference: an upcast is a pointer here and
        // a nominal relation checked at class load there, so `tests/programs/
        // exceptions` emitted `nts/gen/TypeError` extending `Object` and would
        // not verify.
        let base = (name != "Error")
            .then(|| self.type_named("Error"))
            .flatten();
        if let Some(base) = base
            && !self
                .layouts
                .iter()
                .any(|layout| layout.types.contains(&base))
        {
            self.provided_layout(base);
        }
        let layout = Layout {
            types: vec![ty],
            interfaces: Vec::new(),
            fields: crate::hir::builtin::error_fields(name),
            methods: vec![None; self.hierarchy.table_size()],
            base,
            name: name.to_owned(),
        };
        self.layouts.push(layout.clone());
        layout
    }

    /// `AggregateError.errors` is **stored and not readable**, and the asymmetry
    /// is deliberate rather than unfinished.
    ///
    /// The field holds the array *erased*, because an array of pointers is not
    /// an array of tagged values and a `field.set` is not entitled to insert a
    /// per-element conversion. Reading it back therefore yields an erased value
    /// where the checker says `any[]`, and the narrowing cannot bridge that: the
    /// emission loaded `{ i32, i64 }` and then indexed it as a `ptr`.
    ///
    /// **Refused because of what the two backends did with it**, which is the
    /// whole argument:
    ///
    /// ```text
    /// C       compiled, and agreed with node on every case
    /// LLVM    error: '%v87' defined with type '{ i32, i64 }' but expected 'ptr'
    /// ```
    ///
    /// One backend refusing to compile is loud. The other answering correctly
    /// **by coincidence** is the shape that survives, and it did not merely
    /// compile — it agreed on 203 cases, so every instrument except the one that
    /// could not build it reported the feature working. Before this class was
    /// provided the read was unreachable, so leaving it would have been a path
    /// introduced and handed to clang.
    ///
    /// The write half is what the field exists for: three sites construct one
    /// with an errors array, and a constructor argument accepted and discarded
    /// is a wrong answer that runs. That is precisely what [`builtin::OMITTED`]
    /// cannot express — it names a member so that *reading* it says why it is
    /// absent, and says nothing about writing.
    pub(super) fn no_aggregate_errors_read(
        &self,
        id: NodeId,
        ty: TypeId,
        layout: &Layout,
        field: u32,
        member: &str,
    ) -> Result<(), Diagnostic> {
        let erased = layout
            .fields
            .get(field as usize)
            .is_some_and(|field| matches!(field.ty, HirType::Erased));
        let on_an_error = provided(self.snapshot, ty).is_some_and(crate::hir::builtin::is_error)
            || self.provided_error_base(ty).is_some();
        if member == "errors" && erased && on_an_error {
            return Err(self.unsupported(
                id,
                "`errors` on an `AggregateError`, which is stored erased because its \
                 elements are thrown values and read back as an array by nothing here",
            ));
        }
        Ok(())
    }

    /// Every initializer of an options literal, in the order written, with its
    /// key where it is a plain property: what a call evaluates before the
    /// constructor reads any of them.
    ///
    /// Written for `ErrorOptions`, whose only member is `cause`, and deliberately
    /// narrow: an argument that is not an object *literal* of plain and
    /// shorthand properties -- a spread, an accessor, a method -- answers `None`,
    /// so the caller refuses by name rather than reading a field off a layout
    /// nothing else needs.
    ///
    /// Both spellings, because `{ cause }` is the one React writes and is a
    /// `SHORTHAND_PROPERTY_ASSIGNMENT` whose single child is both the key and the
    /// value -- an identifier, which lowers as the expression it is. The
    /// single-child guard is [`Self::literal_name`]'s reason one construct over:
    /// `{ a = 1 }` is three children and a destructuring *pattern*, not a literal.
    fn option_initializers(&self, argument: NodeId) -> Option<Vec<(Option<String>, NodeId)>> {
        if self.kind_of(argument) != Some(syntax::OBJECT_LITERAL_EXPRESSION) {
            return None;
        }
        let mut found = Vec::new();
        for property in self.children(argument) {
            let parts = self.children(property);
            match self.kind_of(property) {
                Some(syntax::PROPERTY_ASSIGNMENT) if parts.len() >= 2 => {
                    let name = parts.first().copied()?;
                    found.push((self.literal_name(name), parts.last().copied()?));
                }
                Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) if parts.len() == 1 => {
                    let at = parts.first().copied()?;
                    found.push((
                        self.node(at)
                            .text
                            .as_ref()
                            .and_then(|text| text.as_utf8())
                            .map(str::to_owned),
                        at,
                    ));
                }
                _ => return None,
            }
        }
        Some(found)
    }

    /// The `message` an `Error` stores for the argument it was given:
    /// the specification's `ToString(message)`, except that an `undefined`
    /// message leaves the empty one.
    ///
    /// The argument was stored as lowered, which a string-typed field cannot
    /// hold for anything else: `new Error(12345678901234567890n)` -- legal
    /// JavaScript, a type error TypeScript lets through with
    /// `@ts-expect-error` -- stored a bigint in a string field, and the
    /// verifier refused the whole program. A string that cannot be absent is
    /// itself; anything else is erased with its absence and spelled by its
    /// tag, `undefined` as the empty message.
    fn error_message(&mut self, argument: NodeId, value: ValueId) -> Result<ValueId, Diagnostic> {
        let text = HirType::Managed(ManagedType::String);
        let origin = self.origin(argument);
        // Through `as any`: the assertion's type says nothing about absence,
        // and the expression under it does -- `(s as any)` with `s: string |
        // null` is a null pointer the checker knows is `null`.
        let absences = self
            .absences_of(self.through_assertions(argument))
            .unwrap_or_default();
        let ty = self.values[value.0 as usize].ty.clone();
        if ty == text && absences.is_empty() {
            return Ok(value);
        }
        // Which absence a null pointer is, from the checker: a string and its
        // `undefined` share a representation with its `null`, and `coerce`
        // would erase every null pointer as `null` -- "null" where the message
        // is empty.
        let erased = if ty == HirType::Erased {
            value
        } else {
            let absent = match (
                absences.contains(&crate::hir::tags::NULL),
                absences.contains(&crate::hir::tags::UNDEFINED),
            ) {
                (false, false) => Absent::Impossible,
                (true, false) => Absent::Null,
                (false, true) => Absent::Undefined,
                (true, true) => {
                    return Err(self.unsupported(
                        argument,
                        "an `Error` message that can be `null` or `undefined` in one pointer, \
                         which spell different messages",
                    ));
                }
            };
            self.push(
                OpKind::Erase {
                    value,
                    absent,
                    slots: crate::hir::Absent::Impossible,
                },
                HirType::Erased,
                origin.clone(),
            )
        };
        let unsigned = HirType::Int {
            bits: 32,
            signed: false,
        };
        let tag = self.push(
            OpKind::TagOf { value: erased },
            unsigned.clone(),
            origin.clone(),
        );
        let undefined = self.push(
            OpKind::ConstInt(i128::from(crate::hir::tags::UNDEFINED)),
            unsigned,
            origin.clone(),
        );
        let is_undefined = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: tag,
                rhs: undefined,
            },
            HirType::Bool,
            origin.clone(),
        );
        let empty = self.push(OpKind::ConstString("".into()), text.clone(), origin.clone());
        let spelled = self.printer_text(argument, erased)?;
        self.lower_branching_value_at(
            argument,
            text,
            is_undefined,
            Branch::Value(empty),
            Branch::Value(spelled),
        )
    }

    /// `Error`'s constructor, inline.
    ///
    /// This compiler provides the class, so there is no function to call and
    /// nothing to link against: the two field stores *are* the constructor.
    /// Both sites that would otherwise call one come here — `new Error(m)`,
    /// which has no constructor to find, and `super(m)` in a subclass, whose
    /// base declares none. Without this the `super(m)` was a *no-op*: the base
    /// is not in the hierarchy, so the call resolved to nothing and the message
    /// was never stored. That is the silent kind of wrong.
    ///
    /// `name` is the provided class's own name rather than the subclass's,
    /// which is what JavaScript does — `Error.prototype.name` is inherited, so
    /// `new MyError("x").name` is `"Error"` until a constructor assigns it.
    pub(super) fn initialize_error(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        provided: &str,
        arguments: &[NodeId],
    ) -> Result<(), Diagnostic> {
        // **`AggregateError` puts its message second**, and everything in this
        // function was written for a signature where it is first:
        //
        //     new Error(message?, options?)
        //     new AggregateError(errors, message?, options?)
        //
        // Taking `arguments.first()` for both would store the errors *array* in
        // the `message` field. Worth naming even though the checker would catch
        // that one, because the failure it resembles is the one nothing catches:
        // a second signature quietly sharing the first's argument positions.
        let aggregate = provided == "AggregateError";
        // `new Error(message, { cause })`. Counted from where the options argument
        // actually is rather than from a constant: this was `arguments.len() > 1`,
        // which is the same number only while every provided class takes one
        // argument before its options, and it refused
        // `new AggregateError(errors, message)` the moment one did not.
        let options = arguments.get(2 + usize::from(aggregate));
        if options.is_some() {
            return Err(self.unsupported(id, "an `Error` with more than options after its message"));
        }
        let options = arguments.get(1 + usize::from(aggregate)).copied();
        let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[receiver.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(id, "an `Error` that is not an object"));
        };
        let layout = self.layout_of(id, type_id)?;
        let origin = self.origin(id);
        let text = HirType::Managed(ManagedType::String);
        // **Every argument in source order**, as a call evaluates them:
        // `AggregateError`'s errors, then the message, then each initializer of
        // the options literal. The errors were lowered last and the options'
        // other initializers not at all, so `new AggregateError(errors(),
        // message(), { cause: mark(3) })` ran 2, 3, 1 and `{ before: mark(3),
        // cause: mark(4) }` never ran `before`
        // (tests/programs/provided-error-arguments-run-in-source-order).
        let errors = if aggregate {
            let Some(first) = arguments.first() else {
                return Err(self.unsupported(
                    id,
                    "an `AggregateError` with no errors, which its signature requires",
                ));
            };
            Some(self.lower_expression(*first)?)
        } else {
            None
        };
        let raw_message = match arguments.get(usize::from(aggregate)) {
            Some(argument) => Some((*argument, self.lower_expression(*argument)?)),
            None => None,
        };
        // Evaluate all argument expressions before Error's ToString(message).
        // The plain options literal is evaluated here, but its cause is installed
        // only after message conversion succeeds, just as InstallErrorCause is.
        // **The cause, when the options object carries one.**
        //
        // Read out of the literal rather than lowered as an object: `{ cause }` is
        // an anonymous type whose layout nothing else needs, and the only member
        // `ErrorOptions` declares is this one. A variable holding options
        // (`new Error(m, opts)`) is refused by name instead of guessed at -- it
        // would need the object's layout and a field read, which is a different
        // piece of work and not one React's three sites ask for.
        //
        // Lowered **expecting** `Erased`, which is what makes `{ cause: undefined }`
        // right: a bare `undefined` or `null` takes its representation from what it
        // stands in for, and an erased slot has a tag for each. `{ cause: undefined }`
        // is therefore *present and undefined* rather than absent, which is what
        // node says and the distinction the presence bit exists for.
        //
        // The bit is set by the store itself -- `field_set` records presence at
        // every write -- so nothing here asks for it. And no store happens when the
        // options object is absent, which is why `"cause" in new Error("x")` is
        // false.
        let cause = if let Some(options) = options {
            let Some(initializers) = self.option_initializers(options) else {
                return Err(self.unsupported(
                    id,
                    "an `Error` whose options are not written as an object literal of plain properties",
                ));
            };
            // Each initializer runs, in order; the last `cause` is the one
            // installed, as a literal with a repeated key keeps the last.
            let mut cause = None;
            for (key, value) in initializers {
                if key.as_deref() == Some(crate::hir::builtin::CAUSE_FIELD) {
                    let lowered = self.lower_expecting(value, &HirType::Erased)?;
                    // Lowered as an erased value already, so this is the identity.
                    cause = Some(self.erased(lowered, Absent::Impossible, &origin));
                } else {
                    self.lower_expression(value)?;
                }
            }
            cause
        } else {
            None
        };
        let message = match raw_message {
            Some((argument, value)) => self.error_message(argument, value)?,
            // `new Error()` has an empty message, not an absent one, and
            // `new AggregateError(errors)` is the same for the same reason.
            None => self.push(OpKind::ConstString("".into()), text.clone(), origin.clone()),
        };
        let name = self.push(
            OpKind::ConstString(provided.to_owned().into()),
            text,
            origin.clone(),
        );
        for (field, value) in [("message", message), ("name", name)] {
            let Some(field) = layout.index_of(field) else {
                continue;
            };
            self.field_set(receiver, field, value, &origin);
        }
        if let Some(cause) = cause
            && let Some(field) = layout.index_of(crate::hir::builtin::CAUSE_FIELD)
        {
            self.field_set(receiver, field, cause, &origin);
        }

        // The errors it aggregates, which is why it is a separate class at all.
        //
        // Stored rather than dropped. Nothing in `runtime/node` *reads*
        // `.errors`, so discarding it would have cost nothing a reader could
        // see -- and three sites construct one with it, which is a constructor
        // argument accepted and thrown away. That is the shape `builtin::OMITTED`
        // cannot express: it names a member so that reading one says why it is
        // absent, and says nothing about writing.
        if let Some(errors) = errors
            && let Some(field) = layout.index_of("errors")
        {
            self.field_set(receiver, field, errors, &origin);
        }
        Ok(())
    }

    /// The provided error class this type descends from, if any.
    ///
    /// Transitive, because the chains are: `ERR_INVALID_ARG_TYPE` extends
    /// `NodeTypeError` extends `TypeError`, and only the last of those is
    /// provided here.
    pub(super) fn provided_error_base(&self, ty: TypeId) -> Option<String> {
        type_bases::walk(self.snapshot, ty, type_bases::Order::Reversed)
            .filter_map(|base| provided(self.snapshot, base))
            .find(|name| crate::hir::builtin::is_error(name))
            .map(str::to_owned)
    }

    /// Every base in the chain has to be a type this compiler lays out itself.
    ///
    /// The checker's property list is *flattened*: a class that extends
    /// something built in arrives here looking like a plain object, with the
    /// inherited members all present and nothing in the list saying they came
    /// from a base whose storage this compiler does not model.
    ///
    /// `class Bytes extends Uint8Array {}` laid out as five `int32_t` and no
    /// bytes, and `b.length` compiled to a read of the fifth field of a struct
    /// nothing ever allocates. Accepted, compiled, and wrong — while
    /// `Uint8Array` used *directly* was refused, which is the shape of the bug:
    /// the subclass was representable because nothing looked at what it derived
    /// from.
    ///
    /// The test is that each base is laid out as an object here. That is
    /// stronger than being representable — `class S extends String` would pass
    /// the weaker test and inherit a layout it has no storage for — and it is
    /// checked through the whole chain, because a class two steps below a
    /// built-in has the same hole as one directly below it.
    pub(super) fn representable_bases(&self, id: NodeId, ty: TypeId) -> Result<(), Diagnostic> {
        for base in type_bases::walk(self.snapshot, ty, type_bases::Order::Written) {
            if !matches!(
                self.represent(base),
                Some(HirType::Managed(ManagedType::Object(_)))
            ) {
                let named = self
                    .snapshot
                    .types
                    .get(base.0 as usize)
                    .and_then(|record| record.symbol)
                    .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
                    .map_or_else(|| format!("#{}", base.0), |symbol| symbol.name.to_string());
                return Err(self.unrepresentable_member(id, "a base", &named, base));
            }
        }
        Ok(())
    }

    /// Throw a `TypeError` where `condition` holds.
    ///
    /// The shape every buffer precondition has: a runtime predicate, a branch,
    /// and a provided error built here because the helper that would know has
    /// no way to raise one.
    pub(super) fn refuse_when(
        &mut self,
        id: NodeId,
        condition: ValueId,
        class: &str,
        message: &str,
    ) -> Result<(), Diagnostic> {
        let throwing = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: condition,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });
        self.switch_to(throwing);
        self.throw_provided_error(id, class, message)?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }
        self.switch_to(carry_on);
        Ok(())
    }

    /// [`Self::refuse_when`]'s shape for a stop no program can catch: where
    /// `condition` holds, the program ends with `nts: refused at run time:
    /// {what}`, naming a construct this compiler cannot carry past this point.
    pub(super) fn stop_when(&mut self, id: NodeId, condition: ValueId, what: &str) {
        let origin = self.origin(id);
        let stopping = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: condition,
            then_target: stopping,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });
        self.switch_to(stopping);
        let what = self.push(
            OpKind::ConstString(what.to_owned().into()),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        self.runtime_call("nts_refused", vec![what], HirType::Void, origin);
        self.terminate(Terminator::Unreachable);
        self.switch_to(carry_on);
    }
}
