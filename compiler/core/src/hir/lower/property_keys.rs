//! Resolve property keys and lower string record key operations.
//!
//! String record keys are distinct from a Map's `SameValueZero` keys.
//! Capture a reference's raw key once, but convert at each read and write:
//! `GetValue` and `PutValue` each apply `ToPropertyKey`. This keeps a simple store's
//! conversion after its RHS and leaves compound/update conversions separate.

use super::{
    Absent, BinOp, CONSTRUCTOR_KEY, Diagnostic, FuncBuilder, HirType, LiteralValue, ManagedType,
    NodeId, OpKind, PropertyKey, Terminator, TypeId, TypeKind, ValueId, syntax,
};
use crate::hir::tags;

pub(super) const OBJECT_PROTOTYPE_MEMBERS: &[&str] = &[
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
    "__proto__",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
];

const I32: HirType = HirType::Int {
    bits: 32,
    signed: true,
};

#[derive(Clone, Copy)]
pub(super) enum Action {
    Get,
    Set(ValueId),
    Has,
    In,
    Delete,
}

impl Action {
    const fn helper(self) -> &'static str {
        match self {
            Self::Get => "nts_map_get",
            Self::Set(_) => "nts_map_set",
            Self::Has | Self::In => "nts_map_has",
            Self::Delete => "nts_map_delete",
        }
    }

    const fn result(self) -> HirType {
        match self {
            Self::Get | Self::Set(_) => HirType::Erased,
            Self::Has | Self::In | Self::Delete => HirType::Bool,
        }
    }
}

pub(super) fn string_record(builder: &FuncBuilder<'_>, table: ValueId) -> bool {
    string_record_type(&builder.values[table.0 as usize].ty)
}

pub(super) fn string_record_type(ty: &HirType) -> bool {
    matches!(ty,
        HirType::Managed(ManagedType::Table(key, _))
        if **key == HirType::Managed(ManagedType::String))
}

/// Erasure captures the key's value, including which absence a null string
/// pointer means. It performs no property-key conversion and runs no code.
pub(super) fn capture(
    builder: &mut FuncBuilder<'_>,
    source: NodeId,
    key: ValueId,
) -> Result<ValueId, Diagnostic> {
    builder.coerce(key, &HirType::Erased, source)
}

fn already_string(builder: &FuncBuilder<'_>, key: ValueId) -> bool {
    let OpKind::Erase {
        value,
        absent: Absent::Impossible,
        ..
    } = builder.values[key.0 as usize].kind
    else {
        return false;
    };
    builder.values[value.0 as usize].ty == HirType::Managed(ManagedType::String)
}

/// The string-tagged fast path goes directly to the table operation. Neither
/// a symbol nor an object is ever handed to the string-specialized hash.
pub(super) fn apply(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    table: ValueId,
    key: ValueId,
    action: Action,
) -> ValueId {
    if !string_record(builder, table) || already_string(builder, key) {
        return operate(builder, at, table, key, action);
    }
    let origin = builder.origin(at);
    let tag = builder.push(OpKind::TagOf { value: key }, I32, origin.clone());
    let string = builder.new_block();
    let string_key = builder.push_block_param(string, HirType::Erased, origin.clone());
    let cold = builder.new_block();
    let is_string = is_tag(builder, at, tag, tags::STRING);
    builder.terminate(Terminator::Branch {
        cond: is_string,
        then_target: string,
        then_args: vec![key],
        else_target: cold,
        else_args: Vec::new(),
    });
    builder.switch_to(cold);
    let symbol = builder.new_block();
    let primitive = builder.new_block();
    let is_symbol = is_tag(builder, at, tag, tags::SYMBOL);
    builder.terminate(Terminator::Branch {
        cond: is_symbol,
        then_target: symbol,
        then_args: Vec::new(),
        else_target: primitive,
        else_args: Vec::new(),
    });
    builder.switch_to(primitive);
    let format = builder.new_block();
    for allowed in [
        tags::NUMBER,
        tags::BOOLEAN,
        tags::NULL,
        tags::UNDEFINED,
        tags::BIGINT,
    ] {
        let next = builder.new_block();
        let matches = is_tag(builder, at, tag, allowed);
        builder.terminate(Terminator::Branch {
            cond: matches,
            then_target: format,
            then_args: Vec::new(),
            else_target: next,
            else_args: Vec::new(),
        });
        builder.switch_to(next);
    }
    refuse(
        builder,
        at,
        "an object property key, whose ToPrimitive conversion this compiler does not yet perform",
    );
    builder.switch_to(format);
    let text = builder.runtime_call(
        "nts_value_to_string",
        vec![key],
        HirType::Managed(ManagedType::String),
        origin.clone(),
    );
    // `ToString`'s answer is a string, never absent.
    let formatted = builder.erased(text, Absent::Impossible, &origin);
    builder.terminate(Terminator::Jump {
        target: string,
        args: vec![formatted],
    });

    let merge = builder.new_block();
    let result = builder.push_block_param(merge, action.result(), origin);
    builder.switch_to(string);
    let found = operate(builder, at, table, string_key, action);
    builder.terminate(Terminator::Jump {
        target: merge,
        args: vec![found],
    });
    builder.switch_to(symbol);
    if let Some(missing) = symbol_result(builder, at, action) {
        builder.terminate(Terminator::Jump {
            target: merge,
            args: vec![missing],
        });
    }
    builder.switch_to(merge);
    result
}

fn is_tag(builder: &mut FuncBuilder<'_>, at: NodeId, tag: ValueId, expected: u32) -> ValueId {
    let origin = builder.origin(at);
    let expected = builder.push(OpKind::ConstInt(i128::from(expected)), I32, origin.clone());
    builder.push(
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: tag,
            rhs: expected,
        },
        HirType::Bool,
        origin,
    )
}

fn operate(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    table: ValueId,
    key: ValueId,
    action: Action,
) -> ValueId {
    let origin = builder.origin(at);
    let mut args = vec![table, key];
    let returns = match action {
        Action::Set(value) => {
            args.push(value);
            HirType::Void
        }
        _ => action.result(),
    };
    let table_ty = builder.values[table.0 as usize].ty.clone();
    let call = builder.keyed_call(action.helper(), &table_ty, args, returns, origin.clone());
    match action {
        Action::Set(_) => builder.push(OpKind::ConstUndefined, HirType::Erased, origin),
        // Ordinary property deletion succeeds even if the property was absent.
        Action::Delete => builder.push(OpKind::ConstBool(true), HirType::Bool, origin),
        Action::In => inherited_membership(builder, at, key, call),
        _ => call,
    }
}

fn symbol_result(builder: &mut FuncBuilder<'_>, at: NodeId, action: Action) -> Option<ValueId> {
    let kind = match action {
        // This is the same erased absence nts_map_get returns for a missing
        // string key. Its consumer applies the existing result narrowing.
        Action::Get => OpKind::ConstUndefined,
        Action::Has | Action::In => OpKind::ConstBool(false),
        Action::Delete => OpKind::ConstBool(true),
        Action::Set(_) => {
            refuse(
                builder,
                at,
                "a symbol property stored in a string-keyed record, which this runtime does not hold",
            );
            return None;
        }
    };
    Some(builder.push(kind, action.result(), builder.origin(at)))
}

fn refuse(builder: &mut FuncBuilder<'_>, at: NodeId, reason: &str) {
    let origin = builder.origin(at);
    let text = builder.push(
        OpKind::ConstString(reason.to_owned().into()),
        HirType::Managed(ManagedType::String),
        origin.clone(),
    );
    builder.runtime_call("nts_refused", vec![text], HirType::Void, origin);
    builder.terminate(Terminator::Unreachable);
}

/// A record stores own properties. A computed `in` must not answer false for
/// an inherited Object.prototype name just because the table has no entry.
/// Its prototype is not represented, so that uncommon missing-key case stops
/// by name; the existing literal-key proof stays in `lower_in`.
fn inherited_membership(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    key: ValueId,
    present: ValueId,
) -> ValueId {
    let origin = builder.origin(at);
    let found = builder.new_block();
    let missing = builder.new_block();
    let merge = builder.new_block();
    let result = builder.push_block_param(merge, HirType::Bool, origin.clone());
    builder.terminate(Terminator::Branch {
        cond: present,
        then_target: found,
        then_args: Vec::new(),
        else_target: missing,
        else_args: Vec::new(),
    });
    builder.switch_to(found);
    builder.terminate(Terminator::Jump {
        target: merge,
        args: vec![present],
    });
    builder.switch_to(missing);
    let text = builder.push(
        OpKind::unerase(key),
        HirType::Managed(ManagedType::String),
        origin.clone(),
    );
    let inherited = builder.new_block();
    for name in OBJECT_PROTOTYPE_MEMBERS {
        let next = builder.new_block();
        let name = builder.push(
            OpKind::ConstString((*name).to_owned().into()),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        let matches = builder.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: text,
                rhs: name,
            },
            HirType::Bool,
            origin.clone(),
        );
        builder.terminate(Terminator::Branch {
            cond: matches,
            then_target: inherited,
            then_args: Vec::new(),
            else_target: next,
            else_args: Vec::new(),
        });
        builder.switch_to(next);
    }
    builder.terminate(Terminator::Jump {
        target: merge,
        args: vec![present],
    });
    builder.switch_to(inherited);
    refuse(
        builder,
        at,
        &format!(
            "an inherited record property ({}), whose prototype this runtime does not record",
            OBJECT_PROTOTYPE_MEMBERS.join(", ")
        ),
    );
    builder.switch_to(merge);
    result
}

pub(super) fn delete(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    place: &super::Place,
) -> Result<ValueId, Diagnostic> {
    match place {
        super::Place::Checked { place, guard, .. } => {
            super::access::require_delete(builder, at, guard)?;
            delete(builder, at, place)
        }
        super::Place::Entry { table, key } if string_record(builder, *table) => {
            Ok(apply(builder, at, *table, *key, Action::Delete))
        }
        _ => Err(builder.unsupported(at, "deleting a property of this record representation")),
    }
}

impl FuncBuilder<'_> {
    /// The object and the member name a member access reads, in **either**
    /// spelling. `o.name` and `o["name"]` name the same member, and three
    /// questions were each asked of the dot form only: which member a name is
    /// refused *for* ([`Self::member_read_from`]), whether a callee is a
    /// `Math`/`Number`/`String` intrinsic ([`Self::intrinsic_of`]), and whether
    /// it is a `console` method ([`Self::console_method`]).
    ///
    /// So `console["error"](e)` reached **none** of the three: it refused as
    /// "`console`, a global with no definition here" where `console.error(e)`
    /// gets the principled refusal naming what printing an unknown would take,
    /// and the bracket form never reached the console lowering at all. One
    /// helper rather than three preambles, so the two spellings cannot drift
    /// apart again -- which they had, in three places, for as long as the
    /// question was asked three times.
    ///
    /// **A string literal only, and the two exclusions are not caution.** An
    /// identifier key is a *variable*: reading `o[k]` as the name `k` puts it in
    /// the same slot as `o["k"]`, which is the collision
    /// [`Self::literal_name`] exists to prevent one property further out. And a
    /// numeric key is an *index* here -- `xs[0]` -- where in a declaration's
    /// computed name it really does name `"0"`; that is why this does not defer
    /// to `literal_name` for every literal kind, and why widening it to numbers
    /// would make `someGlobal[0]` refuse as a member named `0`.
    ///
    /// `first`/`last` rather than a two-element destructure, because `?.` is a
    /// token of its own among the children ([`Self::ends_an_optional_chain`]
    /// says so): `console?.error` has three, and it lowers today.
    pub(super) fn member_access(&self, access: NodeId) -> Option<(NodeId, String)> {
        let parts = self.children(access);
        if parts.len() < 2 {
            return None;
        }
        let (object, member) = (*parts.first()?, *parts.last()?);
        let name = match self.kind_of(access)? {
            syntax::PROPERTY_ACCESS_EXPRESSION => self
                .node(member)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                .map(str::to_owned)?,
            syntax::ELEMENT_ACCESS_EXPRESSION
                if self.kind_of(member) == Some(syntax::STRING_LITERAL) =>
            {
                self.literal_name(member)?
            }
            _ => return None,
        };
        Some((object, name))
    }

    /// Semantic member access. String-only analyses project this through
    /// `member_access`; dispatch and field identities keep the full key.
    pub(super) fn member_access_key(&self, access: NodeId) -> Option<(NodeId, PropertyKey)> {
        let parts = self.children(access);
        let (object, member) = (*parts.first()?, *parts.last()?);
        let key = match self.kind_of(access)? {
            syntax::PROPERTY_ACCESS_EXPRESSION => self.property_key(member)?,
            syntax::ELEMENT_ACCESS_EXPRESSION => self.expression_key(member)?,
            _ => return None,
        };
        Some((object, key))
    }

    pub(super) fn member_read_from(&self, id: NodeId) -> Option<String> {
        let parent = self.node(id).parent?;
        let (object, member) = self.member_access(parent)?;
        (object == id).then_some(member)
    }

    /// The name a declaration or a key node spells.
    ///
    /// One function, because a name is asked for in a dozen places that must
    /// agree -- most sharply for a class member, where the name decides both
    /// the function a member is *emitted* as and the table a call site *finds*
    /// it through. Fixing one and not the other produces a method the emitter
    /// names and nothing can reach.
    ///
    /// Three spellings resolve to the same name. `record`, `"record"` and
    /// `["record"]` are one member; the quotes and the brackets are how a
    /// program writes a name the bare grammar will not take. Node's own
    /// `internal/errors` writes `get ["constructor"]()` for exactly that
    /// reason, since `get constructor()` is a type error.
    ///
    /// Only a literal. `[kSymbol]` and `[prefix + n]` are names the program
    /// decides at run time; both want a property map rather than a field, and
    /// reading one as a name would collide two members into a single slot.
    pub(super) fn literal_name(&self, name: NodeId) -> Option<String> {
        // **A numeric literal's text is the authority on its *value*, not on its
        // *name*.** See [`Self::numeric_member_name`], which is the whole of the
        // reason this early return is guarded.
        if self.kind_of(name) == Some(syntax::NUMERIC_LITERAL) {
            return self.numeric_member_name(name);
        }
        if let Some(text) = self
            .node(name)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)
        {
            return Some(text);
        }
        match self.kind_of(name) {
            // The decoder carries no text on a *string* literal. The checker does carry
            // the *symbol* the name binds, and its name is the answer for every
            // spelling -- `"quoted"`, `["bracketed"]` and `[0]` all name a
            // symbol called what they say. That is also the name TypeScript
            // itself does property lookup by, so taking it here means the
            // compiler and the checker cannot disagree about which member a
            // call site meant.
            Some(syntax::STRING_LITERAL | syntax::NUMERIC_LITERAL) => self
                .node(name)
                .symbol
                .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
                .and_then(|record| record.name.public_name().map(str::to_owned))
                // No symbol: a literal in an index position, where the type is
                // the constant. Read from the same place `lower_string` reads.
                .or_else(|| self.constant_member_name(name)),
            // A *literal* child only, and checked here rather than by
            // recursing: an identifier in brackets is a variable, not a name.
            // Reading `[kTag]` as the name `kTag` would put it in the same slot
            // as `["kTag"]`, which is the collision this whole refusal exists
            // to prevent.
            Some(syntax::COMPUTED_PROPERTY_NAME) => match self.children(name).as_slice() {
                [only]
                    if matches!(
                        self.kind_of(*only),
                        Some(syntax::STRING_LITERAL | syntax::NUMERIC_LITERAL)
                    ) =>
                {
                    self.literal_name(*only)
                }
                // **A `const` whose type *is* the string it holds.**
                // `const k = "step"` is typed `"step"` rather than `string`, so
                // `[k]` names exactly one property and the checker has already
                // said which -- the brackets suggest a decision at run time and
                // there is none, the same observation `symbol_member_name`
                // makes about `[Symbol.iterator]`.
                //
                // Annotating it, `const k: string = "step"`, widens the type and
                // this correctly stops answering: then the name really is
                // decided at run time, and TypeScript itself stops resolving
                // `o[k]` to a single member.
                [only] => self.constant_member_name(*only),
                _ => None,
            },
            _ => None,
        }
    }

    /// The name a node's *type* spells, where the type is a literal.
    ///
    /// One derivation for two callers that each want the same fact: a string or
    /// numeric literal the decoder gave no text to, and a `const` standing in
    /// for one inside `[ ]`.
    /// The name a numeric literal gives a member: ECMAScript's `ToString` of the
    /// value it denotes, which is neither its spelling nor, necessarily, the
    /// checker's number.
    ///
    /// `[0x10]` names `"16"`, and so do `[0b10000]`, `[0o20]`, `[1.6e1]` and
    /// `[16.0]`. Taking the **spelling** -- which `ast.rs` attaches to a numeric
    /// literal deliberately, because the checker's value is not always the literal
    /// -- put `"0x10"` in the layout while every read looked for `"16"`. An
    /// accessor or method lookup then found nothing and **the reading statement
    /// was dropped with no diagnostic**; a class field `[0x10] = "f"` reached a
    /// slot that was not there and **segfaulted**. Eighteen test262 cases, in
    /// every non-decimal spelling.
    ///
    /// **And the checker's number is not the answer either.**
    /// `[0.9999999999999999]` is a key named `"0.9999999999999999"` in
    /// JavaScript -- a distinct double whose shortest round-trip string is itself
    /// -- while the pre-switch tsgo answered `1` for that literal, which is exactly why `ast.rs`
    /// carries the text. So the two sources are each wrong for a different set of
    /// spellings, and the name comes from the *exact* value of what was written.
    ///
    /// So the name is `crate::number::to_js_string` of the **exact** value, and
    /// what is left here is only which source that value comes from:
    ///
    /// - **the text**, parsed by Rust, for any spelling Rust accepts. That is
    ///   exact, and it is what keeps the checker's rounding out of the answer.
    /// - **the checker's number** for a spelling Rust's parser rejects -- `0x10`,
    ///   `0b10000`, `0o20`, digits with `_` separators. Every one of those is an
    ///   integer, so there is no rounding for the checker to have done.
    ///
    /// **Two rules that looked right were each refuted by one value**, which is
    /// why this ended up as the algorithm rather than a test on spellings. "Use
    /// the checker's number" dies on `[0.9999999999999999]`, whose key is
    /// `"0.9999999999999999"` while the pre-switch tsgo answered `1`. "Use the text when it
    /// reprints identically" dies on `[1e-7]`, whose key is `"1e-7"` while Rust's
    /// `Display` gives `0.0000001` -- so that rule would have started refusing a
    /// key that works today. The conformance lane found both against node before
    /// any of it was built.
    fn numeric_member_name(&self, name: NodeId) -> Option<String> {
        let value = self
            .node(name)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .and_then(crate::number::parse_literal)
            .or_else(|| self.constant_number(name))?;
        Some(crate::number::to_js_string(value))
    }

    /// The number a node's type says it is, where that type is a literal.
    fn constant_number(&self, node: NodeId) -> Option<f64> {
        match &self
            .snapshot
            .types
            .get(self.snapshot.node_types.get(&node)?.0 as usize)?
            .kind
        {
            TypeKind::Literal(LiteralValue::Number(value)) => Some(*value),
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
            _ => None,
        }
    }

    pub(super) fn constant_member_name(&self, node: NodeId) -> Option<String> {
        match &self
            .snapshot
            .types
            .get(self.snapshot.node_types.get(&node)?.0 as usize)?
            .kind
        {
            TypeKind::Literal(LiteralValue::String(text)) => text.as_utf8().map(str::to_owned),
            TypeKind::Literal(LiteralValue::Number(value)) => {
                Some(crate::number::to_js_string(*value))
            }
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
            _ => None,
        }
    }

    /// Which child of a declaration is spelling its name.
    ///
    /// A declaration's children are its name, its parameters, its return
    /// annotation and its body, and more than one reader has to tell them
    /// apart. Answering by kind alone is what put `["size"]` in the return
    /// annotation's place, so callers exclude the node this found rather than
    /// the kinds it accepts.
    pub(super) fn name_node(&self, declaration: NodeId) -> Option<NodeId> {
        self.children(declaration).into_iter().find(|child| {
            matches!(
                self.kind_of(*child),
                Some(
                    syntax::IDENTIFIER
                        // `#check` is a name, and a node kind of its own rather
                        // than an identifier spelled oddly -- so leaving it out
                        // meant a private *method* had no name at all. It was
                        // refused as "a member whose name the program
                        // computes", and the members declared after it in the
                        // same class were neither lowered nor refused.
                        | syntax::PRIVATE_IDENTIFIER
                        | syntax::STRING_LITERAL
                        | syntax::NUMERIC_LITERAL
                        | syntax::COMPUTED_PROPERTY_NAME
                )
            )
        })
    }

    /// The name a class member is declared under, from the member itself.
    pub(super) fn member_name(&self, member: NodeId) -> Option<String> {
        self.literal_name(self.name_node(member)?)
    }

    pub(super) fn member_key(&self, member: NodeId) -> Option<PropertyKey> {
        if self.kind_of(member) == Some(syntax::CONSTRUCTOR) {
            return Some(PropertyKey::Name(CONSTRUCTOR_KEY.to_owned()));
        }
        self.property_key(self.name_node(member)?)
    }

    /// One key decision for declarations and accesses. A unique-symbol
    /// expression supplies its semantic `TypeId`; its description never does.
    pub(super) fn property_key(&self, node: NodeId) -> Option<PropertyKey> {
        match self.kind_of(node)? {
            syntax::PRIVATE_IDENTIFIER => Some(PropertyKey::Private(
                self.node(node)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)?,
            )),
            syntax::COMPUTED_PROPERTY_NAME => self.expression_key(*self.children(node).first()?),
            _ => self.literal_name(node).map(PropertyKey::Name),
        }
    }

    fn expression_key(&self, expression: NodeId) -> Option<PropertyKey> {
        if let Some(ty) = self.snapshot.node_types.get(&expression)
            && matches!(
                self.snapshot.types.get(ty.0 as usize)?.kind,
                TypeKind::UniqueSymbol
            )
        {
            return Some(PropertyKey::Symbol(*ty));
        }
        self.constant_member_name(expression).map(PropertyKey::Name)
    }

    pub(super) fn access_key(&self, mut at: NodeId, public_fallback: &str) -> Option<PropertyKey> {
        if self.kind_of(at) == Some(syntax::CALL_EXPRESSION)
            && let Some(callee) = self.children(at).first()
        {
            at = *callee;
        }
        match self.kind_of(at) {
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => self
                .children(at)
                .last()
                .and_then(|name| self.property_key(*name)),
            Some(syntax::ELEMENT_ACCESS_EXPRESSION) => self
                .children(at)
                .last()
                .and_then(|index| self.expression_key(*index)),
            _ => Some(PropertyKey::Name(public_fallback.to_owned())),
        }
    }

    pub(super) fn required_access_key(
        &self,
        at: NodeId,
        public_fallback: &str,
    ) -> Result<PropertyKey, Diagnostic> {
        self.access_key(at, public_fallback)
            .ok_or_else(|| self.unsupported(at, "a member whose key the program computes"))
    }

    /// Resolve a symbol property by its unique-symbol type identity.
    fn symbol_property_key(&self, ty: TypeId, key: TypeId) -> Option<PropertyKey> {
        let TypeKind::Object { properties } = &self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        properties
            .iter()
            .find(|property| property.name == PropertyKey::Symbol(key))
            .map(|property| property.name.clone())
    }

    pub(super) fn well_known_property_key(
        &self,
        ty: TypeId,
        key: nts_semantic_schema::WellKnownSymbol,
    ) -> Option<PropertyKey> {
        self.symbol_property_key(ty, *self.snapshot.well_known_symbols.get(&key)?)
    }

    /// Whether an expression names a property of an object.
    ///
    /// `o.x` and `o["x"]` are one thing said two ways, and their node shapes
    /// already agree: an object beside a name. What separates them is the kind
    /// of the name node, which [`Self::literal_name`] resolves either way.
    ///
    /// The object's type is what keeps `xs[0]` out. An array index is also a
    /// literal in brackets, and it means something else entirely -- so this
    /// asks the checker what the receiver is rather than what the brackets
    /// contain.
    /// The member an index names, when its *type* is a single literal.
    ///
    /// `None` unless this access is an element access and the index's type is a
    /// string or numeric literal -- everything else keeps `literal_name`'s
    /// answer, which is the node's text and is right for every position where
    /// the source writes the name.
    /// The member a *call's* name node names.
    ///
    /// [`Self::literal_name`] is right wherever the source writes the name --
    /// `o.twice`, `o["twice"]` -- and wrong for `o[k]`, where the node's text is
    /// the **variable** and the member is whatever its type says.
    /// [`Self::indexed_member_name`] answers that, and the read path has asked
    /// it since `blockers/a-key-held-in-a-variable`. The call paths asked
    /// `literal_name` alone, so `m[key]()` looked for a method called `key`.
    ///
    /// Through the node's parent because a call path holds the *call*, and the
    /// access whose index this is sits between them.
    pub(super) fn called_member_name(&self, member: NodeId) -> Option<String> {
        self.node(member)
            .parent
            .and_then(|access| self.indexed_member_name(access, member))
            .or_else(|| self.literal_name(member))
    }

    pub(super) fn indexed_member_name(&self, id: NodeId, index: NodeId) -> Option<String> {
        if self.kind_of(id) != Some(syntax::ELEMENT_ACCESS_EXPRESSION) {
            return None;
        }
        let ty = self.snapshot.node_types.get(&index)?;
        let record = self.snapshot.types.get(ty.0 as usize)?;
        match &record.kind {
            TypeKind::Literal(LiteralValue::String(text)) => text.as_utf8().map(str::to_owned),
            TypeKind::Literal(LiteralValue::Number(value)) => Some(format!("{value}")),
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
            _ => None,
        }
    }

    /// Whether an index expression denotes exactly one member name.
    ///
    /// A literal does -- the checker types `"a"` as `Literal(String("a"))` and
    /// `0` as `Literal(Number(0))`, one value each. A `unique symbol` does, and
    /// that is what it is *for*: `TypeFlagsUniqueESSymbol` is the checker saying
    /// this is one name distinguishable from every other.
    ///
    /// An ordinary `number` or `string` does not. It is a computed index, and
    /// the fact that its *spelling* could be read as a name is a coincidence of
    /// how identifiers are stored rather than anything about the program.
    pub(super) fn names_one_member(&self, index: NodeId) -> bool {
        let Some(ty) = self.snapshot.node_types.get(&index) else {
            return false;
        };
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        matches!(&record.kind, TypeKind::Literal(_) | TypeKind::UniqueSymbol)
    }

    /// A private name used as an `in` key, which is a key this compiler can see
    /// and is the *only* key it can see completely.
    ///
    /// ```text
    /// if (value === null || typeof value !== "object" || !(#list in value))
    ///     throw new ERR_INVALID_THIS("URLSearchParams");
    /// ```
    ///
    /// [`Self::literal_key`] reads the node's type, and `#list` in this position
    /// is syntax rather than a string literal, so it answered nothing and the
    /// whole brand check refused as "a key the compiler cannot see". It is the
    /// opposite: `#list` cannot be computed, cannot be forged, and is scoped by
    /// the language to the class body that declares it, so the set of classes
    /// declaring it is knowable exactly.
    ///
    /// Six sites, all of this shape, and `URLSearchParams.#brandCheck` alone has
    /// **14 functions cascading on it** -- `append`, `get`, `getAll`, `has`,
    /// `entries`, `keys`, `values`, `sort`, `toString` and `get size` among
    /// them. `URL`'s two are the same idiom over `#record`.
    pub(super) fn private_name_key(&self, lhs: NodeId) -> Option<String> {
        (self.kind_of(lhs) == Some(syntax::PRIVATE_IDENTIFIER))
            .then(|| {
                self.node(lhs)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
            })
            .flatten()
    }

    /// Which class a brand check belongs to, or `None` for an ordinary key.
    ///
    /// Refused rather than answered when a private name has no enclosing class:
    /// that cannot parse, and guessing would be a silent wrong receiver test.
    pub(super) fn brand_owner(
        &self,
        lhs: NodeId,
        is_private: bool,
    ) -> Result<Option<TypeId>, Diagnostic> {
        if !is_private {
            return Ok(None);
        }
        match self.enclosing_class_instance(lhs) {
            Some(owner) => Ok(Some(owner)),
            None => Err(self.unsupported(
                lhs,
                "a private name outside any class, which cannot be a brand",
            )),
        }
    }

    /// The instance type of the class whose body encloses this node.
    ///
    /// What makes a private name answerable: it is in scope only inside the
    /// class that declares it, so the class enclosing `#list in value` is the
    /// one `#list` belongs to, whatever else in the program spells it the same.
    fn enclosing_class_instance(&self, id: NodeId) -> Option<TypeId> {
        let mut at = self.node(id).parent;
        while let Some(parent) = at {
            // Only `CLASS_DECLARATION`: this schema has no separate constant
            // for a class expression, and a private name has to be inside a
            // class body to parse at all.
            if self.kind_of(parent) == Some(syntax::CLASS_DECLARATION) {
                return self.declared_instance_type(parent);
            }
            at = self.node(parent).parent;
        }
        None
    }

    /// The name and value of one property in an object literal.
    /// The name a property writes, without lowering anything.
    ///
    /// Split out so a caller can find the **slot before the value**: the name
    /// says which field this is, and the field's type is what the value should
    /// be built at. An object literal used to lower the value first and coerce
    /// it afterwards, which is the wrong order for any literal that decides
    /// nothing on its own — `{ cells: [{ a: 1 }] }` built the inner array at
    /// its own element type and met a cast it never had to make.
    ///
    /// [`Self::property_parts`] calls this rather than re-deriving the name, so
    /// the two cannot answer differently, and every shape refusal lives here.
    pub(super) fn property_name(&self, id: NodeId) -> Result<PropertyKey, Diagnostic> {
        let children = self.children(id);
        match self.kind_of(id) {
            Some(syntax::PROPERTY_ASSIGNMENT) => {
                let [name, _] = children.as_slice() else {
                    return Err(self.unsupported(id, "a property of unexpected shape"));
                };
                self.property_key(*name)
                    .ok_or_else(|| self.unsupported(*name, "a computed property name"))
            }
            Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => {
                let [name] = children.as_slice() else {
                    return Err(self.unsupported(id, "a shorthand property of unexpected shape"));
                };
                self.node(*name)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
                    .map(PropertyKey::Name)
                    .ok_or_else(|| self.unsupported(*name, "a shorthand without a name"))
            }
            // Named, for the reason the statement dispatch is: a spread, an
            // accessor and a method are three features, and one message over
            // all of them ranks none.
            _ => {
                let what = self
                    .kind_of(id)
                    .and_then(nts_semantic_schema::syntax::name_of)
                    .map_or_else(
                        || "this kind of property".to_owned(),
                        |name| format!("a `{name}` in an object literal"),
                    );
                Err(self.unsupported(id, &what))
            }
        }
    }

    pub(super) fn property_parts(
        &mut self,
        id: NodeId,
        want: Option<&HirType>,
    ) -> Result<(PropertyKey, ValueId), Diagnostic> {
        let text = self.property_name(id)?;
        match self.kind_of(id) {
            Some(syntax::PROPERTY_ASSIGNMENT) => {
                let children = self.children(id);
                let [_, initializer] = children.as_slice() else {
                    return Err(self.unsupported(id, "a property of unexpected shape"));
                };
                let value = match want {
                    Some(want) => self.lower_expecting(*initializer, want)?,
                    None => self.lower_expression(*initializer)?,
                };
                Ok((text, value))
            }
            // `{ x }` — one node serving as both the field name and a reference
            // to a variable, and the checker gives it the *property's* symbol.
            // The variable's symbol is what `getShorthandAssignmentValueSymbol`
            // answers, which the snapshot does not carry yet; until it does, the
            // reference is resolved by name against what is in scope.
            //
            // That is sound only while the name is unambiguous, so a shadowed
            // one is refused rather than guessed at.
            //
            // What the name is resolved *against* is everything a name can
            // denote, and `lower_named_value` is what it means by that. This
            // used to be a two-line lookup in the local bindings and nothing
            // else, which got both halves wrong: a narrowed local was found and
            // handed over unnarrowed, so `{ first }` refused where
            // `{ first: first }` compiled; and a module-scope function was not
            // found at all, so `{ lowers }` read as naming nothing in scope for
            // a function declared in the same file.
            // A shorthand names an existing value, so there is no expression
            // to build at the slot -- `{ x }` hands over whatever `x` already
            // is, and `coerce` at the caller is what reconciles it.
            Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => {
                let children = self.children(id);
                let [name] = children.as_slice() else {
                    return Err(self.unsupported(id, "a shorthand property of unexpected shape"));
                };
                let symbol = self.shorthand_value_symbol(
                    *name,
                    text.public_name().expect("a shorthand has a public name"),
                )?;
                let value = self.lower_named_value(*name, symbol)?;
                Ok((text, value))
            }
            // `property_name` refuses every other kind above, so this cannot be
            // reached -- and saying so is what keeps the refusal in one place.
            _ => unreachable!("`property_name` refuses every other kind of property"),
        }
    }
}
