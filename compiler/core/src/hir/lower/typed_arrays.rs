//! Choose typed-array shapes and lower their construction, copying, and methods.

use super::{
    ArrayFill, BinOp, Diagnostic, FuncBuilder, HirType, ManagedType, MemberKey, NodeId,
    NumericBuiltin, OpKind, Origin, Place, SemanticSnapshot, Terminator, TypeId, TypeKind, ValueId,
    provided, syntax, type_bases,
};

/// [`representation`](super::representation), refusing a type that contains itself.
///
/// # Why a type can do that at all
///
/// `class Node { next: Node }` is fine and common, and it terminates here
/// because an object's representation is a *pointer* — the arm returns without
/// looking at the fields. `type Tree = Tree[]` does not: an array's
/// representation names its element type, and the element is the array. There
/// is no finite `HirType` for it, so building one recurses until the stack ends.
///
/// # Why refusing is the answer for now and not forever
///
/// The runtime is already more relaxed than this: an array of references uses
/// one descriptor for all of them, because *every* reference is a pointer and
/// the descriptor describes the element's shape rather than what it points at.
/// So a representation exists; what is missing is a way to *spell* it, which
/// means a recursion marker in `HirType` and every pass agreeing about what it
/// means. That is a type-system change and is refused rather than guessed at.
///
/// The list is a path rather than a set: two sibling fields of the same array
/// type are not a cycle, and treating them as one would refuse ordinary code.
/// The element type of a typed array this type descends from.
///
/// By the same walk `provided_error_base` uses, and for the same reason: the
/// checker's property list is flattened, so nothing in it says a member came
/// from a base whose storage this compiler models itself.
pub(super) fn inherited_typed_array(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<HirType> {
    type_bases::walk(snapshot, ty, type_bases::Order::Reversed)
        .filter_map(|base| provided(snapshot, base))
        .find_map(crate::hir::builtin::typed_array_element)
}

/// Whether a type declares storage of its own.
///
/// Neither a method nor an accessor is a field, and `MemberKind` says which is
/// which. It used to be asked of the *type* -- "a property whose type is a
/// function" -- which cannot tell a method from a field holding a closure.
/// `own` is what separates what the class wrote from what the flattened list
/// inherited.
pub(super) fn declares_storage(properties: &[nts_semantic_schema::PropertyRecord]) -> bool {
    properties
        .iter()
        .any(|property| property.own && property.kind.is_stored())
}

/// The one type a `Property<T>` intersection holds beside its brand -- an
/// object whose properties are the optional `__c_property`, and
/// `__c_required` for a `RequiredProperty<T>` -- or `None` for any other
/// intersection.
pub(super) fn property_branded(snapshot: &SemanticSnapshot, parts: &[TypeId]) -> Option<TypeId> {
    let brand = |id: &TypeId| {
        matches!(snapshot.types.get(id.0 as usize).map(|record| &record.kind), Some(TypeKind::Object { properties })
            if properties.iter().any(|p| p.name.is_name("__c_property"))
                && properties.iter().all(|p| matches!(p.name.public_name(), Some("__c_property" | "__c_required")) && p.optional && p.readonly))
    };
    let [a, b] = parts else { return None };
    match (brand(a), brand(b)) {
        (true, false) => Some(*b),
        (false, true) => Some(*a),
        _ => None,
    }
}

/// What a typed array class stores: its element's width in bytes, the
/// runtime's tag for that element, and the view type. Derived once, by
/// `typed_array_shape`, and handed whole to each way of making the view.
struct ViewShape {
    width: f64,
    kind: crate::hir::builtin::ElementKind,
    ty: HirType,
}

/// Builds one function.
/// A construct `break` can leave.
///
/// A loop is one and so is a `switch`, and the difference between them is
/// exactly `continue`: a loop has a latch to restart, a switch has none, and a
/// `continue` written inside a switch belongs to the loop around it.
/// The array method a name spells, for the three compiled as a loop.
///
/// `xs.forEach(f)` where `f` is a *variable* is a genuine dispatch and is not
/// one of these -- the caller checks that the argument is an arrow written at
/// the call site before taking this path.
/// A method on an array of numbers: the runtime function, how many arguments
/// follow the receiver, and what it evaluates to.
///
/// `absent_result` is the checker having left the `undefined` in. `pop`, `shift`
/// and `at` each have a form that can say `undefined` and a form that cannot,
/// and the one that cannot is what a caller who has narrowed it away gets.
pub(super) fn numeric_array_method(
    name: &str,
    absent_result: bool,
    array: &HirType,
) -> Option<(&'static str, usize, HirType)> {
    Some(match name {
        "pop" if absent_result => ("nts_array_pop_value", 0, HirType::Erased),
        "pop" => ("nts_array_pop", 0, HirType::NUMBER),
        "shift" if absent_result => ("nts_array_shift_value", 0, HirType::Erased),
        "shift" => ("nts_array_shift", 0, HirType::NUMBER),
        "at" if absent_result => ("nts_array_at_value", 1, HirType::Erased),
        "at" => ("nts_array_at", 1, HirType::NUMBER),
        "indexOf" => ("nts_array_index_of", 1, HirType::NUMBER),
        "lastIndexOf" => ("nts_array_last_index_of", 1, HirType::NUMBER),
        "includes" => ("nts_array_includes", 1, HirType::Bool),
        "concat" => ("nts_array_concat", 1, array.clone()),
        "fill" => ("nts_array_fill", 1, array.clone()),
        "reverse" => ("nts_array_reverse", 0, array.clone()),
        "slice" => ("nts_array_slice", 2, array.clone()),
        "splice" => ("nts_array_splice", 2, array.clone()),
        _ => return None,
    })
}

impl FuncBuilder<'_> {
    /// `new Uint8Array(n)`, and the buffer underneath it.
    ///
    /// Two allocations because there are two objects: the specification's
    /// constructor makes an `ArrayBuffer` of `n * width` bytes and returns a
    /// view over the whole of it. That was invisible while a typed array owned
    /// its elements inline, and it is the observable difference now -- `.buffer`
    /// answers, and two views over one buffer alias.
    ///
    /// The length is `ToIndex` and the *byte* length is what the buffer needs,
    /// so the guard is on the element count and the multiplication happens
    /// after it. Guarding the product instead would refuse a count the language
    /// allows on a width the language allows.
    /// A typed array class's storage width, tag and representation.
    ///
    /// One derivation, asked by the constructor and by the `of`/`from`
    /// factories -- which build the same object and would otherwise each decide
    /// what a `Uint8Array` is.
    fn typed_array_shape(
        &self,
        id: NodeId,
        class: &str,
        element: HirType,
    ) -> Result<ViewShape, Diagnostic> {
        let (Some(width), Some(kind)) = (
            crate::hir::builtin::element_width(&element),
            crate::hir::builtin::element_kind(&element),
        ) else {
            return Err(self.unsupported(
                id,
                &format!("a `{class}`, whose element this compiler has no storage kind for"),
            ));
        };
        Ok(ViewShape {
            width: f64::from(width),
            kind,
            ty: HirType::Managed(ManagedType::View(Box::new(element))),
        })
    }

    /// `Uint8Array.from(xs)` -- the constructor's array case, under its other
    /// name.
    ///
    /// Routed to the same code rather than reimplemented: `from` with one array
    /// argument *is* `new Uint8Array(xs)`, and the specification's second
    /// argument -- a mapping function -- is refused by name rather than
    /// ignored, which would silently drop it.
    pub(super) fn lower_typed_array_from(
        &mut self,
        id: NodeId,
        class: &str,
        element: HirType,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let [source] = arguments else {
            return Err(self.unsupported(
                id,
                &format!("a `{class}.from` with a mapping function or with no argument"),
            ));
        };
        let shape = self.typed_array_shape(id, class, element)?;
        let wanted = HirType::Managed(ManagedType::Array(Box::new(HirType::NUMBER)));
        let values = if self.kind_of(*source) == Some(syntax::ARRAY_LITERAL_EXPRESSION) {
            self.lower_expecting(*source, &wanted)?
        } else {
            self.lower_expression(*source)?
        };
        if !matches!(
            self.values[values.0 as usize].ty,
            HirType::Managed(ManagedType::Array(_))
        ) {
            return Err(self.unsupported(
                id,
                &format!(
                    "a `{class}.from` over something that is not an array, which needs the \
                     iteration protocol"
                ),
            ));
        }
        self.view_copied_from_array(id, values, &shape, None)
    }

    /// `Uint8Array.of(1, 2, 3)` -- the arguments, as an array, then the same.
    ///
    /// The array is built here rather than asked for: `of` takes its elements
    /// as arguments, so there is no node to lower as one. Its length is the
    /// argument count, which is why the stores are unchecked -- `ArrayNew` made
    /// exactly those slots a line earlier.
    pub(super) fn lower_typed_array_of(
        &mut self,
        id: NodeId,
        class: &str,
        element: HirType,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let bigint = element == HirType::BigInt;
        let shape = self.typed_array_shape(id, class, element)?;
        let arguments_values =
            self.builtin_arguments(id, NumericBuiltin::TypedOf { bigint }, arguments)?;
        let origin = self.origin(id);
        // `f64::from(u32)` rather than `as`: an argument list longer than a
        // `u32` is not a program, and the cast clippy objects to would round
        // one silently rather than say so.
        let Ok(arity) = u32::try_from(arguments.len()) else {
            return Err(self.unsupported(id, &format!("a `{class}.of` with that many arguments")));
        };
        let count = self.push(
            OpKind::ConstFloat(f64::from(arity)),
            HirType::NUMBER,
            origin.clone(),
        );
        let values = self.push(
            OpKind::ArrayNew {
                length: count,
                fill: ArrayFill::Uninitialized,
            },
            HirType::Managed(ManagedType::Array(Box::new(HirType::NUMBER))),
            origin.clone(),
        );
        for (at, (argument, value)) in arguments.iter().zip(arguments_values).enumerate() {
            let value = self.coerce(value, &HirType::NUMBER, *argument)?;
            let index = self.push(
                OpKind::ConstFloat(f64::from(u32::try_from(at).unwrap_or(u32::MAX))),
                HirType::NUMBER,
                origin.clone(),
            );
            self.push(
                OpKind::ArraySet {
                    array: values,
                    index,
                    value,
                    checked: false,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        self.view_copied_from_array(id, values, &shape, None)
    }

    pub(super) fn lower_new_typed_array(
        &mut self,
        id: NodeId,
        class: &str,
        element: HirType,
    ) -> Result<ValueId, Diagnostic> {
        // Refused by name rather than defaulted. An element with no kind is a
        // typed array this compiler does not know how to store, and saying so
        // is the difference between a refusal and a silent `f64`.
        // Before any argument is lowered: a typed array built among them is
        // not the class being made.
        let made_as = self.view_made_as.take();
        let shape = self.typed_array_shape(id, class, element)?;
        let origin = self.origin(id);
        let arguments = self.arguments_of(id);

        let Some(first) = arguments.first() else {
            // `new Uint8Array()` is an empty one, which is a buffer of no
            // bytes rather than a refusal.
            let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
            return self.view_over_fresh_buffer(id, zero, zero, &shape, made_as);
        };
        // **An array literal is lowered at the view's element type.** `new
        // Uint8Array([])` types its literal `never[]` and falls back to the
        // *contextual* type, which is the constructor's `ArrayLike<number> |
        // Iterable<number>` -- not an array, so the literal refused for the
        // shape it was about to be given. Asked of the node rather than of the
        // lowered value, because the value is what the expectation decides.
        let count = match (
            self.kind_of(*first) == Some(syntax::ARRAY_LITERAL_EXPRESSION),
            &shape.ty,
        ) {
            // **At `number[]`, not at the view's own element.** Expecting
            // `Array(u8)` builds a `u8` array, which is not a representation an
            // array literal otherwise has, and the specialized copy of the
            // enclosing function then read zeroes out of it for small integer
            // arguments while every other value was right. The narrowing
            // belongs at the store into the view, where `a[i] = v` already puts
            // it; this expectation exists only so that `new Uint8Array([])`
            // has an array type to be, rather than the constructor's
            // `ArrayLike<number> | Iterable<number>`.
            (true, HirType::Managed(ManagedType::View(element)))
                if matches!(**element, HirType::Int { .. } | HirType::Float { .. }) =>
            {
                let wanted = HirType::Managed(ManagedType::Array(Box::new(HirType::NUMBER)));
                self.lower_expecting(*first, &wanted)?
            }
            _ => self.lower_expression(*first)?,
        };
        // `new Uint8Array(buffer, offset, length)` is a *window* onto storage
        // that already exists, which is the whole reason a view is a distinct
        // representation: it is how two of them come to name the same bytes.
        if matches!(
            self.values[count.0 as usize].ty,
            HirType::Managed(ManagedType::Buffer)
        ) {
            return self.lower_view_over(id, count, &arguments[1..], &shape, made_as);
        }
        // `new Uint8Array([1, 2, 3])` **copies from** what it is given rather
        // than sizing to it, which is the one case below. Anything else is
        // refused by name rather than read as a length, which would allocate
        // whatever the pointer happened to be.
        if let HirType::Managed(ManagedType::Array(_)) = self.values[count.0 as usize].ty.clone() {
            return self.view_copied_from_array(id, count, &shape, made_as);
        }
        if !matches!(
            self.values[count.0 as usize].ty,
            HirType::Int { .. } | HirType::Float { .. }
        ) {
            return Err(self.unsupported(id, &format!("a `new {class}` from a value")));
        }
        // To a number before the guard and the multiplication. A specialized
        // copy hands this an `i32`, and the guard compares against constants
        // that are doubles: C converts at the comparison and LLVM refuses the
        // IR, so the backend that checks is the one that noticed.
        let count = self.coerce(count, &HirType::NUMBER, id)?;
        self.guard_buffer_length(id, count, "Invalid typed array length")?;
        let width_value = self.push(
            OpKind::ConstFloat(shape.width),
            HirType::NUMBER,
            origin.clone(),
        );
        let bytes = self.push(
            OpKind::Binary {
                op: BinOp::Mul,
                lhs: count,
                rhs: width_value,
            },
            HirType::NUMBER,
            origin,
        );
        self.view_over_fresh_buffer(id, bytes, count, &shape, made_as)
    }

    /// `new Uint8Array(buffer)`, `(buffer, offset)` and `(buffer, offset, length)`.
    ///
    /// A window onto bytes that already exist, and the only way in the language
    /// to make two views name the same storage. Everything the representation
    /// was introduced for is reachable from here.
    ///
    /// Three checks, and node distinguishes all three:
    ///
    ///   * an offset that is not a multiple of the element width --
    ///     `start offset of Uint16Array should be a multiple of 2`
    ///   * an offset past the end -- `Start offset 20 is outside the bounds`
    ///   * a length that does not fit -- `Invalid typed array length: 20`
    ///
    /// Omitting the length is not the same as passing the remainder: the view
    /// **tracks**, so it follows the buffer through `resize`. That is the
    /// observable difference between `new Uint8Array(buffer)` and
    /// `view.subarray(0)`, and it is why `tracking` is a constructor argument
    /// rather than something the runtime infers from a zero.
    fn lower_view_over(
        &mut self,
        id: NodeId,
        buffer: ValueId,
        rest: &[NodeId],
        shape: &ViewShape,
        made_as: Option<TypeId>,
    ) -> Result<ValueId, Diagnostic> {
        let &ViewShape {
            width,
            kind,
            ref ty,
        } = shape;
        let origin = self.origin(id);
        let offset = match rest.first() {
            Some(node) => {
                let value = self.lower_expression(*node)?;
                let value = self.coerce(value, &HirType::NUMBER, id)?;
                self.guard_buffer_length(
                    id,
                    value,
                    "Start offset is outside the bounds of the buffer",
                )?;
                // Past this line the value is an INDEX, and every guard below
                // is written against one. `guard_buffer_length` is the last
                // thing that may look at the argument, because its two bounds
                // are the only ones truncation cannot move: `<= -1` and
                // `>= 2**53` answer the same before and after.
                //
                // Nothing else does. Comparing the argument cost four wrong
                // answers, and each looked like its own bug: `(NaN, 15)` built
                // a fifteen-element window over eight bytes because every
                // comparison against NaN is false; offset `8.7` refused a
                // program node accepts, because `8.7 > 8` and `8 > 8` differ;
                // and `(0, 8.9)` and `(7.9, 1)` refused for the same reason one
                // addition later.
                let value =
                    self.call_runtime("nts_to_index", vec![value], HirType::NUMBER, &origin);
                self.guard_aligned_offset(id, value, width)?;
                value
            }
            None => self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone()),
        };
        let byte_length = self.call_runtime(
            "nts_buffer_byte_length",
            vec![buffer],
            HirType::NUMBER,
            &origin,
        );
        self.guard_within(
            id,
            offset,
            byte_length,
            "Start offset is outside the bounds of the buffer",
        )?;

        let width_value = self.push(OpKind::ConstFloat(width), HirType::NUMBER, origin.clone());
        let kind_value = self.push(
            OpKind::ConstFloat(f64::from(kind)),
            HirType::NUMBER,
            origin.clone(),
        );
        let (count, tracking) = if let Some(node) = rest.get(1) {
            {
                let value = self.lower_expression(*node)?;
                let value = self.coerce(value, &HirType::NUMBER, id)?;
                self.guard_buffer_length(id, value, "Invalid typed array length")?;
                let value =
                    self.call_runtime("nts_to_index", vec![value], HirType::NUMBER, &origin);
                // The window has to fit: `offset + length * width` bytes. Both
                // operands are indices, so the sum is the one the runtime will
                // actually lay out rather than the one the arguments spell.
                let span = self.push(
                    OpKind::Binary {
                        op: BinOp::Mul,
                        lhs: value,
                        rhs: width_value,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                );
                let end = self.push(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: offset,
                        rhs: span,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                );
                self.guard_within(id, end, byte_length, "Invalid typed array length")?;
                let fixed = self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone());
                (value, fixed)
            }
        } else {
            {
                // No length: the view is whatever remains and follows the
                // buffer. The count the runtime is handed is ignored while
                // `tracking` is set, so zero is the honest placeholder.
                let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
                let tracks = self.push(OpKind::ConstBool(true), HirType::Bool, origin.clone());
                (zero, tracks)
            }
        };
        let view = self.call_runtime(
            "nts_view_new",
            vec![buffer, offset, count, kind_value, tracking],
            ty.clone(),
            &origin,
        );
        self.make_view_an_instance(view, made_as, &origin);
        self.guard_allocated_view(id, view)?;
        Ok(view)
    }

    /// `new Uint16Array(buffer, 3)` is a `RangeError`: an element cannot start
    /// half way through itself. One byte wide is always aligned, so the check
    /// is emitted only where it can fail.
    fn guard_aligned_offset(
        &mut self,
        id: NodeId,
        offset: ValueId,
        width: f64,
    ) -> Result<(), Diagnostic> {
        if width <= 1.0 {
            return Ok(());
        }
        let origin = self.origin(id);
        // `offset` is already an index -- see `lower_view_over`, which converts
        // before it guards. This function used to convert again, privately,
        // and was the only guard that had the rule right; it read as this
        // call site's own quirk rather than as the rule, so the four guards
        // around it went on comparing the argument. Truncating once, above,
        // is the same fix stated where it cannot be missed.
        let index = offset;
        let width_value = self.push(OpKind::ConstFloat(width), HirType::NUMBER, origin.clone());
        let remainder = self.push(
            OpKind::Binary {
                op: BinOp::Rem,
                lhs: index,
                rhs: width_value,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let misaligned = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: remainder,
                rhs: zero,
            },
            HirType::Bool,
            origin,
        );
        self.refuse_when(
            id,
            misaligned,
            "RangeError",
            "start offset should be a multiple of the element size",
        )
    }

    /// Refuse when `value` is past `limit`.
    fn guard_within(
        &mut self,
        id: NodeId,
        value: ValueId,
        limit: ValueId,
        message: &str,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let past = self.push(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: value,
                rhs: limit,
            },
            HirType::Bool,
            origin,
        );
        self.refuse_when(id, past, "RangeError", message)
    }

    /// A buffer of `bytes`, and a view of `count` elements over the whole of it.
    /// `new Uint8Array([1, 2, 3])` -- a view sized to the array, then filled.
    ///
    /// **An array only**, and for the same reason `new Set([…])` takes one: any
    /// other iterable needs `Iterable<T>` to be representable, which is library
    /// interface dispatch. `new Uint8Array(anotherView)` is still refused, by
    /// name; it wants `nts_view_set`, which copies between two *views* and is a
    /// different operation from this one.
    ///
    /// **Nothing new in the runtime.** The fill is `Place::Element` per index,
    /// which is what `a[i] = v` already lowers to on a view -- so the narrowing
    /// each element needs (a `double` into a `uint8`) is the one the assignment
    /// path already decides, in one place, rather than a second rule here that
    /// would agree with it until it did not.
    fn view_copied_from_array(
        &mut self,
        id: NodeId,
        source: ValueId,
        shape: &ViewShape,
        made_as: Option<TypeId>,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let length = self.push(OpKind::Length(source), HirType::NUMBER, origin.clone());
        let stride = self.push(
            OpKind::ConstFloat(shape.width),
            HirType::NUMBER,
            origin.clone(),
        );
        let bytes = self.push(
            OpKind::Binary {
                op: BinOp::Mul,
                lhs: length,
                rhs: stride,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let view = self.view_over_fresh_buffer(id, bytes, length, shape, made_as)?;

        let start = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let header = self.new_block();
        let body = self.new_block();
        let exit = self.new_block();
        self.terminate(Terminator::Jump {
            target: header,
            args: vec![start],
        });

        self.switch_to(header);
        let index = self.push_block_param(header, HirType::NUMBER, origin.clone());
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: index,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: more,
            then_target: body,
            then_args: Vec::new(),
            else_target: exit,
            else_args: Vec::new(),
        });

        self.switch_to(body);
        let element = self.values[source.0 as usize].ty.clone();
        let HirType::Managed(ManagedType::Array(element)) = element else {
            return Err(
                self.unsupported(id, "a typed array copied from something with no elements")
            );
        };
        // Checked, because `bounds.rs` is where an index proof is spent or kept.
        let value = self.push(
            OpKind::ArrayGet {
                array: source,
                index,
                checked: true,
            },
            *element,
            origin.clone(),
        );
        self.write_place(id, &Place::Element { array: view, index }, value)?;
        let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
        let next = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: index,
                rhs: one,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.terminate(Terminator::Jump {
            target: header,
            args: vec![next],
        });

        self.switch_to(exit);
        Ok(view)
    }

    fn view_over_fresh_buffer(
        &mut self,
        id: NodeId,
        bytes: ValueId,
        count: ValueId,
        shape: &ViewShape,
        made_as: Option<TypeId>,
    ) -> Result<ValueId, Diagnostic> {
        let &ViewShape { kind, ref ty, .. } = shape;
        let origin = self.origin(id);
        let buffer = self.call_runtime(
            "nts_buffer_new",
            vec![bytes],
            HirType::Managed(ManagedType::Buffer),
            &origin,
        );
        self.guard_allocated(id, buffer)?;
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let kind_value = self.push(
            OpKind::ConstFloat(f64::from(kind)),
            HirType::NUMBER,
            origin.clone(),
        );
        // Not tracking: a view constructed from a length has that length, and
        // only `new Uint8Array(buffer)` follows the buffer through a resize.
        let tracking = self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone());
        let view = self.call_runtime(
            "nts_view_new",
            vec![buffer, zero, count, kind_value, tracking],
            ty.clone(),
            &origin,
        );
        self.make_view_an_instance(view, made_as, &origin);
        self.guard_allocated_view(id, view)?;
        Ok(view)
    }

    /// Make the view just made an instance of `made_as`, a class extending a
    /// typed array, directly after its making ([`OpKind::ViewOfClass`]).
    fn make_view_an_instance(&mut self, view: ValueId, made_as: Option<TypeId>, origin: &Origin) {
        if let Some(class) = made_as {
            self.push(
                OpKind::ViewOfClass { view, class },
                HirType::Void,
                origin.clone(),
            );
        }
    }

    /// The same null check `guard_allocated` makes, for a view.
    pub(super) fn guard_allocated_view(
        &mut self,
        id: NodeId,
        view: ValueId,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let ty = self.values[view.0 as usize].ty.clone();
        let null = self.push(OpKind::ConstNull, ty, origin.clone());
        let failed = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: view,
                rhs: null,
            },
            HirType::Bool,
            origin,
        );
        self.refuse_when(id, failed, "RangeError", "Array buffer allocation failed")
    }

    /// A method call on a typed array.
    ///
    /// Two steps, the same two an array takes: the receiver's *declared* class
    /// first, because `class Bytes extends Uint8Array` writes its own methods
    /// and the representation says how the bytes are arranged rather than what
    /// declared them; then the built-ins.
    ///
    /// The second step is where a view differs. An array falls through to the
    /// runtime's helpers, which read a block at one width and know nothing
    /// about an offset; a view has none of those yet, so the fall-through is a
    /// refusal naming the method rather than a helper handed the wrong shape.
    pub(super) fn lower_view_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        receiver_node: NodeId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        if let Some(declared) = self
            .snapshot
            .node_types
            .get(&receiver_node)
            .copied()
            .map(|ty| self.class_behind(ty))
            && let Some(key) = self.property_key(member)
            && self
                .hierarchy
                .declaring(declared, &MemberKey::method(key))
                .is_some()
        {
            return self.lower_object_method(id, receiver, declared, member, arguments);
        }
        let name = self
            .literal_name(member)
            .unwrap_or_else(|| "a computed name".to_owned());
        self.lower_view_builtin(id, receiver, &name, arguments)
    }

    /// One number an argument to a view method supplies, with its default.
    ///
    /// An *optional parameter* is erased here, and `Buffer#subarray(start?,
    /// end?)` forwards both to `super.subarray(start, end)` -- so the argument
    /// arriving at a view method is routinely an erased value rather than a
    /// number. Coercing it refused with "an erased value where a concrete
    /// representation is wanted", which is true and is not the question: an
    /// absent optional means the default.
    ///
    /// Decided in the runtime rather than by a branch here, because a merge
    /// needs a type and `lower_branching_value` takes it from the *node*, which
    /// at this point is the call and not the endpoint.
    fn view_number(
        &mut self,
        id: NodeId,
        argument: Option<&NodeId>,
        fallback: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let Some(node) = argument else {
            return Ok(fallback);
        };
        let value = self.lower_expression(*node)?;
        if self.values[value.0 as usize].ty != HirType::Erased {
            return self.coerce(value, &HirType::NUMBER, id);
        }
        let origin = self.origin(id);
        Ok(self.call_runtime(
            "nts_value_number_or",
            vec![value, fallback],
            HirType::NUMBER,
            &origin,
        ))
    }

    /// The typed-array methods themselves, with the receiver already lowered.
    ///
    /// Split from [`Self::lower_view_method`] so that `super.fill(...)` can
    /// reach them. `Buffer extends Uint8Array` and declares no storage of its
    /// own, so `this` inside `Buffer#fill` is already a `view<u8>` -- but the
    /// call went through `lower_super`, which builds the name `Uint8Array#fill`
    /// and looks for a compiled function of that name. There is none, and there
    /// never will be: the method is the runtime's.
    ///
    /// Three of `buffer`'s own methods were stopped that way -- `fill`,
    /// `subarray` and `slice` -- and `subarray` was *already implemented* here.
    /// So the missing piece was never the method; it was that one spelling of
    /// the call could reach this and another could not.
    pub(super) fn lower_view_builtin(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        name: &str,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = name.to_owned();
        let origin = self.origin(id);
        let ty = self.values[receiver.0 as usize].ty.clone();
        // The relative-index pair, which the runtime clamps the way
        // `nts_array_slice` does -- a negative endpoint counts from the end and
        // is not an error. `to` defaults to the length, read back rather than
        // spelled, because a tracking view's length is not known here.
        let endpoints = |me: &mut Self| -> Result<(ValueId, ValueId), Diagnostic> {
            let zero = me.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
            let from = me.view_number(id, arguments.first(), zero)?;
            let to = match arguments.get(1) {
                Some(node) => {
                    let length = me.call_runtime(
                        "nts_view_length",
                        vec![receiver],
                        HirType::NUMBER,
                        &origin,
                    );
                    me.view_number(id, Some(node), length)?
                }
                None => {
                    me.call_runtime("nts_view_length", vec![receiver], HirType::NUMBER, &origin)
                }
            };
            Ok((from, to))
        };
        match name.as_str() {
            // Aliases. Two views over one buffer, which is the property the
            // representation exists for.
            "subarray" => {
                let (from, to) = endpoints(self)?;
                let view =
                    self.call_runtime("nts_view_subarray", vec![receiver, from, to], ty, &origin);
                self.guard_allocated_view(id, view)?;
                Ok(view)
            }
            // Copies, and the difference between this and `subarray` is the
            // case that fails if the two are implemented the same way.
            "slice" => {
                let (from, to) = endpoints(self)?;
                let view =
                    self.call_runtime("nts_view_slice", vec![receiver, from, to], ty, &origin);
                self.guard_allocated_view(id, view)?;
                Ok(view)
            }
            "copyWithin" | "set" => self.lower_view_move(id, receiver, &name, arguments),
            // `fill(value, start, end)`, whose endpoints are arguments *one and
            // two* -- so it cannot use the `endpoints` closure above, which
            // reads zero and one for the methods that take only a range.
            //
            // It is what held `string_decoder`: `StringDecoder#constructor`
            // calls `Buffer.alloc`, `alloc` calls `Buffer#fill`, and that calls
            // this. One missing method, three cascades, and a module with no
            // exports at all.
            //
            // Returns the receiver, as the specification says, so
            // `new Uint8Array(4).fill(0)` is an expression rather than a
            // statement.
            "fill" => {
                let Some(node) = arguments.first() else {
                    return Err(self
                        .unsupported(id, "`fill` on a typed array with no value to fill it with"));
                };
                let value = self.lower_expression(*node)?;
                let value = self.coerce(value, &HirType::NUMBER, id)?;
                let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
                let from = self.view_number(id, arguments.get(1), zero)?;
                let length =
                    self.call_runtime("nts_view_length", vec![receiver], HirType::NUMBER, &origin);
                let to = self.view_number(id, arguments.get(2), length)?;
                self.call_runtime(
                    "nts_view_fill",
                    vec![receiver, value, from, to],
                    HirType::Void,
                    &origin,
                );
                Ok(receiver)
            }
            // `join`, which is a *read* of every element rather than a window
            // onto them -- so unlike `subarray` and `slice` it does not have to
            // answer what the result shares with the receiver. The runtime
            // reads elements through `nts_view_get`, which is the one place
            // that knows a view's width and offset.
            //
            // This is `internal/errors.ts:547`, which formats a `Uint8Array`
            // into an error message and stands at the head of the chain through
            // `inspectValueWithin` to `StringDecoder#constructor`.
            "join" => {
                let separator = self.join_separator(id, arguments)?;
                Ok(self.call_runtime(
                    "nts_view_join",
                    vec![receiver, separator],
                    HirType::Managed(ManagedType::String),
                    &origin,
                ))
            }
            other => Err(self.unsupported(
                id,
                &format!("`{other}` on a typed array, which this compiler does not provide yet"),
            )),
        }
    }

    /// `copyWithin` and `set`: the two that move bytes within storage the
    /// receiver may share with the source.
    ///
    /// Both are the family whose whole difficulty is that the ranges can
    /// intersect -- `copyWithin` with its destination past its source reads
    /// what it has already written, and `set` between two windows over one
    /// buffer does the same one level up, at two element widths. The runtime
    /// owns both answers; what is here is the arguments and their defaults.
    fn lower_view_move(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        name: &str,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        if name == "copyWithin" {
            let Some(target_node) = arguments.first() else {
                return Err(self.unsupported(id, "a `copyWithin` with no target"));
            };
            let target = self.lower_expression(*target_node)?;
            let target = self.coerce(target, &HirType::NUMBER, id)?;
            let from = match arguments.get(1) {
                Some(node) => {
                    let value = self.lower_expression(*node)?;
                    self.coerce(value, &HirType::NUMBER, id)?
                }
                None => self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone()),
            };
            let to = match arguments.get(2) {
                Some(node) => {
                    let value = self.lower_expression(*node)?;
                    self.coerce(value, &HirType::NUMBER, id)?
                }
                None => {
                    self.call_runtime("nts_view_length", vec![receiver], HirType::NUMBER, &origin)
                }
            };
            return Ok(self.call_runtime(
                "nts_view_copy_within",
                vec![receiver, target, from, to],
                HirType::Void,
                &origin,
            ));
        }
        // `set`, between two views which may overlap at different element
        // widths -- the runtime snapshots the source when they share a buffer,
        // and converts *values* rather than bytes.
        {
            {
                let Some(source_node) = arguments.first() else {
                    return Err(self.unsupported(id, "a `set` with no source"));
                };
                let source = self.lower_expression(*source_node)?;
                if !matches!(
                    self.values[source.0 as usize].ty,
                    HirType::Managed(ManagedType::View(_))
                ) {
                    return Err(
                        self.unsupported(id, "a `set` from something other than a typed array")
                    );
                }
                let offset = match arguments.get(1) {
                    Some(node) => {
                        let value = self.lower_expression(*node)?;
                        self.coerce(value, &HirType::NUMBER, id)?
                    }
                    None => self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone()),
                };
                Ok(self.call_runtime(
                    "nts_view_set",
                    vec![receiver, source, offset],
                    HirType::Void,
                    &origin,
                ))
            }
        }
    }

    pub(super) fn any_view_property(
        &mut self,
        id: NodeId,
        value: ValueId,
        member_name: &str,
    ) -> Result<ValueId, Diagnostic> {
        let anonymous = matches!(
            self.values[value.0 as usize].ty,
            HirType::Managed(ManagedType::AnyView)
        );
        if anonymous && member_name == "length" {
            return Err(self.unsupported(
                id,
                "`length` of an `ArrayBufferView`, whose element width the declaration does \
                 not give -- `byteLength` is the same question this type can answer",
            ));
        }
        self.view_property(id, value, member_name)
    }

    fn view_property(
        &mut self,
        id: NodeId,
        value: ValueId,
        member_name: &str,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let (helper, ty) = match member_name {
            "length" => ("nts_view_length", HirType::NUMBER),
            "byteLength" => ("nts_view_byte_length", HirType::NUMBER),
            "byteOffset" => ("nts_view_byte_offset", HirType::NUMBER),
            "buffer" => ("nts_view_buffer", HirType::Managed(ManagedType::Buffer)),
            other => {
                return Err(self.unsupported(
                    id,
                    &format!("`{other}` on a typed array, which this compiler does not provide"),
                ));
            }
        };
        Ok(self.call_runtime(helper, vec![value], ty, &origin))
    }
}
