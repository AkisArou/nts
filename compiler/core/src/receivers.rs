//! What a program does with the fields of an interface-typed value.
//!
//! A measurement, not a representation. Nothing here decides how a value is
//! stored and nothing here refuses a program — it exists to put a number on one
//! question before that question is answered by building something, the way
//! [`crate::erasure`] does for `any` and `unknown`.
//!
//! # The question
//!
//! The two largest families of refusals both wait on one design step: what an
//! interface's representation is when both an object literal and a class
//! instance can inhabit it. Nine cheaper repairs have been built, measured and
//! reverted — records 0258, 0294, 0310, 0331 among them — and the only route
//! still open is **indirection**: reach a field through an offset table or an
//! accessor rather than at a fixed offset.
//! `blockers/method-syntax-in-an-interface` calls it "the only option in this
//! list that does not have to choose between correctness and coverage, and …
//! the only one that costs something on every field read rather than at a
//! boundary."
//!
//! The narrow version — indirection only where a class could actually inhabit
//! the interface — would cost nothing on code that compiles today, but record
//! 0294 already ruled on what it needs: *"it needs a set nobody has."* So the
//! implementable rule is the broad one, and **its price is every field access
//! through an interface-typed receiver**, including accesses that are correct
//! and fast today.
//!
//! That price is what this counts. It is deliberately the input to a decision
//! rather than the decision, and it cannot settle that decision on its own:
//! whether the cost is affordable is a benchmark question about a feature that
//! does not exist. What this can say is which programs would pay it and where.
//!
//! # The unit, named in the same breath as the number
//!
//! > **One field access: one syntactic place where a compiled program computes a
//! > field's offset and touches it.**
//!
//! Population: every such place in the program a given `tsconfig.json`
//! describes, **including places inside functions the compiler currently
//! refuses**. That inclusion is the reason this reads the snapshot and not the
//! HIR: 77 of the sites at issue are refused, lowering never sees them, and
//! `OpKind::FieldGet` has keyed them by slot index long before a backend could
//! be asked.
//!
//! The site is the right unit *here* and the wrong one elsewhere.
//! `tooling/conformance/refusal-census.mjs` argues the opposite for ranking
//! work — "a cause is worth what fixing it clears" — and is right about that.
//! A **cost** is paid per access, so it counts accesses; a **repair** is worth
//! what it clears, so that counts declarations. Both columns are printed,
//! because the gap between them is the breadth-of-use factor and reading either
//! as the other is how a number arrives wearing the wrong unit.
//!
//! # Four syntactic forms, two of which are not property accesses
//!
//! A census keyed on `PROPERTY_ACCESS_EXPRESSION` alone would undercount
//! silently, and undercount most in exactly the code that matters:
//!
//! - **Dotted** — `v.name`. The base case.
//! - **Keyed** — `v["name"]`, `v[kRefed]`. `hir::lower`'s `names_a_property`
//!   routes a literal-keyed element access straight into `lower_property_access`,
//!   so these are named fields at fixed offsets and pay exactly what a dot pays.
//!   The discrimination is **the index's type, not its text**: a `Literal`, or a
//!   `unique symbol`. `source[i]` with an ordinary `let i` must not count, and
//!   the comment there records what getting it backwards cost — `Buffer.from`,
//!   `Buffer.alloc`, `indexOf`, and the whole of `string_decoder`.
//! - **Destructured** — `const { name, count } = v` is **two** field reads and
//!   **zero** property-access nodes. `bind_pattern` emits one read per named
//!   element. `runtime/node` is full of this.
//! - **Spread** — `{ ...v }` copies *every* field of the source layout, so one
//!   site is *N* reads. `spread_into` counts 25 such sites in `runtime/node` and
//!   `runtime/web-platform`. Because it is a multiplier over a site rather than a
//!   site, [`Census::spread_sites`] keeps it separately: folding it into the site
//!   total is the unit trap in its purest form.
//!
//! # Reads, writes, and the one that is both
//!
//! Indirection costs on a write too — `FieldSet` goes through the same offset —
//! so reporting only reads because the blocker's sentence says "field read"
//! would be a second misread unit in the same measurement. A compound
//! assignment (`v.count += 1`, `v.count++`) is one access that both loads and
//! stores, so it is its own [`Access`] rather than being double-counted.
//!
//! # What is excluded, each for a reason
//!
//! - A **method or accessor** member: no storage to make indirect.
//!   [`MemberKind::is_stored`](nts_semantic_schema::schema::MemberKind::is_stored)
//!   is the authority and the *type* cannot answer it —
//!   `f(x: number): number` and `f: (x: number) => number` declare members of the
//!   same type and only the second is a field. This is why the test is not
//!   syntactic: `v.callback()` where `callback` is a field holding a closure *is*
//!   a field access, and `const m = v.method` is not.
//! - An interface carrying an **index signature**: a table, not a struct. Its
//!   keys are not known at compile time, so it has no fixed offset to lose.
//! - A receiver that is **not a generated struct** — a primitive, an array, a
//!   `Map`, `any`. Catches `v.name.length`, whose receiver is a `string`.
//! - A **library** type, whose symbol has no declaration in the decoded files.
//!   A read through `Array` or `Iterable` reaches a provided representation.
//!   `hir::lower` records why this must be its own answer rather than folded
//!   either way: a carried protocol such as `Iterable<T>` "has no node", so a
//!   declaration-based test cannot tell a library interface from anything else
//!   out there.
//!
//! # Two things the reader has to be told, not left to infer
//!
//! **This is the post-narrowing count.** `node_types` carries the *narrowed*
//! type at each node, which [`crate::erasure`] also depends on. So
//! `if (v instanceof C) v.name` is counted as a class receiver and excluded —
//! correctly, because after narrowing the offset is the class's. That is the
//! number the cost question wants, and it is not the number "how many accesses
//! are written against an interface-typed name".
//!
//! **`Unclear` is never rounded down.** A receiver whose type the decomposer
//! left as `TypeKind::Structured` has no member list, so the stored/method test
//! cannot run. Those are counted and named, on `erasure`'s reasoning that
//! rounding an unknown down to the cheaper answer "is how a measurement talks
//! itself into the representation it was hoping for."

use nts_semantic_schema::schema::{
    LiteralValue, NodeId, SemanticSnapshot, SymbolId, TypeId, TypeKind,
};
use nts_semantic_schema::{syntax, walk};
use rustc_hash::FxHashSet;

/// The checker's `TypeFlagsUniqueESSymbol`, mirrored from `names_one_member`.
const UNIQUE_SYMBOL: u32 = 1 << 14;

/// What a receiver's type is, for the purpose of one question.
///
/// Read from the type's symbol's **declarations**, never from `SymbolFlags` and
/// never from a name. `SymbolFlags::INTERFACE` is true of `Array`, `String` and
/// every other `lib.d.ts` interface, whose declarations are empty — so it
/// answers "interface" for reads that pay nothing. And a name cannot do it: an
/// anonymous layout is called `Type<id>`, which is the afternoon record 0074
/// lost to `"TypeError".starts_with("Type")`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Shape {
    /// An `INTERFACE_DECLARATION` in this program declares it. The numerator.
    Interface,
    /// A `TYPE_LITERAL` declares it. The same representation hazard —
    /// `hir::lower` pairs the two kinds for exactly this reason — but not what
    /// the design step is phrased about, so it is its own row and not folded in.
    TypeLiteral,
    /// A class instance. Reads at a fixed offset today and would keep doing so.
    ClassInstance,
    /// An object literal's own type: one inhabitant shape, one layout.
    Literal,
    /// Declared outside the decoded files: `lib.d.ts` and friends.
    Library,
    /// An object type the decomposer did not reach. Counted, never rounded down.
    Unclear,
}

impl Shape {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Interface => "interface",
            Self::TypeLiteral => "type literal",
            Self::ClassInstance => "class",
            Self::Literal => "literal",
            Self::Library => "library",
            Self::Unclear => "unclear",
        }
    }

    /// Every shape, in the order a table should print them: the numerator first.
    pub const ALL: [Self; 6] = [
        Self::Interface,
        Self::TypeLiteral,
        Self::ClassInstance,
        Self::Literal,
        Self::Library,
        Self::Unclear,
    ];
}

/// Whether an access loads, stores, or both.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Access {
    Read,
    Write,
    /// `v.count += 1`, `v.count++`: one access that both loads and stores.
    ReadModifyWrite,
}

impl Access {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Write => "write",
            Self::ReadModifyWrite => "rmw",
        }
    }
}

/// How the field was named.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Form {
    Dotted,
    Keyed,
    Destructured,
    /// A multiplier rather than a site. See [`Census::spread_sites`].
    Spread,
}

impl Form {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dotted => "dotted",
            Self::Keyed => "keyed",
            Self::Destructured => "destructured",
            Self::Spread => "spread",
        }
    }
}

/// How a member was named at the access.
///
/// A symbol-keyed access cannot be resolved from the index alone: the checker
/// spells that member `__@kRefed@2` — the bracket's description and its own id
/// for the symbol — so the name depends on the receiver's type. Carrying the
/// description and resolving it where the type is known is what `hir::lower`
/// does, and a census that used the identifier's spelling instead finds no such
/// member: `examples/symbol-keys` reported nine undeclared members against four
/// counted accesses before this existed.
#[derive(Clone, Copy)]
enum Member<'a> {
    /// A dot, a string key, a numeric key. The name is the name.
    Spelled(&'a str),
    /// `v[kRefed]`, carrying the description the brackets spell.
    Described(&'a str),
}

/// One field access.
#[derive(Clone, Debug)]
pub struct Site {
    pub shape: Shape,
    /// The function the access is written in, for `--sites`.
    pub owner: String,
    pub access: Access,
    pub form: Form,
    /// The receiver type's name, for `--sites`.
    pub receiver: String,
    /// The member named, or `..` for a spread, which names all of them.
    pub member: String,
    /// Fields touched. One, except a spread, which touches the whole layout.
    pub fields: u32,
    /// Some class in the program names this interface in a heritage clause.
    pub implemented: bool,
    /// Some class in the program has a same-named member for each of this
    /// interface's required members.
    pub satisfied: bool,
    pub location: nts_diagnostics::Location,
}

/// Accesses that were found and deliberately not counted.
///
/// Reported rather than dropped, because a census that cannot say what it
/// declined to look at is not evidence.
#[derive(Clone, Copy, Debug, Default)]
pub struct Excluded {
    /// The member is a method or an accessor: no storage.
    pub not_stored: u32,
    /// The receiver's type carries an index signature: a table, no fixed offset.
    pub index_signature: u32,
    /// The receiver is a primitive, an array, `any` — not a generated struct.
    pub not_a_struct: u32,
    /// The receiver's type declares no member of that name.
    ///
    /// Either a program the compiler refuses, or a name this derived wrongly —
    /// a symbol key's member name is the checker's own spelling and not the
    /// identifier's. Counted rather than dropped, because the two are
    /// indistinguishable from here and dropping them would make a derivation
    /// error look like an absence of accesses.
    pub member_not_declared: u32,
    /// Interfaces whose declared type carried no member list, so the structural
    /// proxy could not examine them.
    ///
    /// **This is what decides whether the lower arm of the bracket is a bound at
    /// all.** The arm is sound only if the proxy *over*-approximates
    /// inhabitability; an interface it skipped is one it called uninhabitable
    /// without looking, which over-states what a narrow rule would spare. Large
    /// here and the arm is a guess wearing a bound's clothes.
    pub interfaces_unexamined: u32,
    /// Classes whose instance type carried no member list, for the same reason
    /// and with the same consequence.
    pub classes_unexamined: u32,
    /// **The density control.** The receiver expression carried no recorded type,
    /// so nothing could be said about it.
    ///
    /// This number is why the census is allowed to key on receiver expressions
    /// at all. `schema.rs` calls `node_types` "sparse on purpose", which would
    /// make a receiver census undercount *in proportion to what the lowering
    /// happened to ask about* — error correlated with subject, which is worse
    /// than no instrument. But `resolve_types` is documented as resolving "a
    /// type for every addressable node of one file", excluding only list nodes
    /// and an `import.defer` callee. The two disagree, so this counts the
    /// disagreement instead of believing either: near zero and the comment is
    /// stale and the census is sound; large and the census is not yet a number.
    pub untyped_receiver: u32,
}

/// The census.
#[derive(Clone, Debug, Default)]
pub struct Census {
    pub sites: Vec<Site>,
    pub excluded: Excluded,
    /// Spread sites, kept apart from [`Census::sites`] because one spread is
    /// *N* field reads and adding it to a site count mixes two units.
    pub spread_sites: Vec<Site>,
}

impl Census {
    /// Field accesses through an interface receiver: what the broad rule costs.
    #[must_use]
    pub fn through_interfaces(&self) -> u32 {
        self.fields_where(|site| site.shape == Shape::Interface)
    }

    /// The same, where some class *says* it implements the interface.
    ///
    /// Under-approximates inhabitability — a class satisfying an interface by
    /// accident says nothing — so it **over**-states what a narrow rule would
    /// spare. The upper bound of the bracket.
    #[must_use]
    pub fn through_implemented(&self) -> u32 {
        self.fields_where(|site| site.shape == Shape::Interface && site.implemented)
    }

    /// The same, where some class's member *names* cover the interface.
    ///
    /// Over-approximates inhabitability — names are not assignability, which
    /// this cannot compute — so it **under**-states what a narrow rule would
    /// spare. The lower bound of the bracket.
    #[must_use]
    pub fn through_satisfied(&self) -> u32 {
        self.fields_where(|site| site.shape == Shape::Interface && (site.satisfied || site.implemented))
    }

    /// Every counted field access: the denominator.
    #[must_use]
    pub fn total_fields(&self) -> u32 {
        self.fields_where(|_| true)
    }

    /// Field accesses through a receiver of this shape.
    #[must_use]
    pub fn through(&self, shape: Shape) -> u32 {
        self.fields_where(|site| site.shape == shape)
    }

    /// Distinct interface members reached through an interface receiver — what a
    /// repair would have to cover, as against what a cost is paid on.
    #[must_use]
    pub fn distinct_interface_members(&self) -> usize {
        self.sites
            .iter()
            .filter(|site| site.shape == Shape::Interface)
            .map(|site| (site.receiver.as_str(), site.member.as_str()))
            .collect::<FxHashSet<_>>()
            .len()
    }

    fn fields_where(&self, mut keep: impl FnMut(&Site) -> bool) -> u32 {
        self.sites
            .iter()
            .filter(|site| keep(site))
            .map(|site| site.fields)
            .sum()
    }
}

/// Count every field access in a program, by what its receiver is typed as.
#[must_use]
pub fn classify(snapshot: &SemanticSnapshot) -> Census {
    let inhabitable = Inhabitable::of(snapshot);
    let mut out = Census::default();
    out.excluded.interfaces_unexamined = inhabitable.interfaces_unexamined;
    out.excluded.classes_unexamined = inhabitable.classes_unexamined;

    for index in 0..snapshot.nodes.len() {
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let Some(kind) = walk::kind_of(snapshot, id) else {
            continue;
        };
        match kind {
            syntax::PROPERTY_ACCESS_EXPRESSION => dotted(snapshot, id, &inhabitable, &mut out),
            syntax::ELEMENT_ACCESS_EXPRESSION => keyed(snapshot, id, &inhabitable, &mut out),
            syntax::BINDING_ELEMENT => destructured(snapshot, id, &inhabitable, &mut out),
            syntax::SPREAD_ASSIGNMENT => spread(snapshot, id, &inhabitable, &mut out),
            _ => {},
        }
    }

    order(&mut out.sites);
    order(&mut out.spread_sites);
    out
}

fn order(sites: &mut [Site]) {
    sites.sort_by(|a, b| {
        a.location
            .file
            .0
            .cmp(&b.location.file.0)
            .then_with(|| a.location.span.start.cmp(&b.location.span.start))
    });
}

/// `v.name`.
fn dotted(snapshot: &SemanticSnapshot, id: NodeId, known: &Inhabitable, out: &mut Census) {
    let Some([object, member]) = children2(snapshot, id) else {
        return;
    };
    let Some(name) = walk::text_of(snapshot, member) else {
        return;
    };
    record(snapshot, id, object, Member::Spelled(name), Form::Dotted, known, out);
}

/// `v["name"]`, `v[kRefed]` — but never `v[i]`.
fn keyed(snapshot: &SemanticSnapshot, id: NodeId, known: &Inhabitable, out: &mut Census) {
    let Some([object, index]) = children2(snapshot, id) else {
        return;
    };
    // **The index's type, not its text.** Mirrors `names_one_member` and
    // `indexed_member_name`: a `Literal` names one member, a `unique symbol`
    // names one member, an ordinary `number` names none and the fact that its
    // spelling reads like a name is a coincidence of how identifiers are stored.
    let spelled;
    let named = match snapshot
        .node_types
        .get(&index)
        .and_then(|ty| snapshot.types.get(ty.0 as usize))
        .map(|record| &record.kind)
    {
        Some(TypeKind::Literal(LiteralValue::String(text))) => Member::Spelled(text),
        Some(TypeKind::Literal(LiteralValue::Number(value))) => {
            spelled = format!("{value}");
            Member::Spelled(&spelled)
        },
        Some(TypeKind::Structured { flags }) if flags & UNIQUE_SYMBOL != 0 => {
            match walk::text_of(snapshot, index) {
                Some(described) => Member::Described(described),
                None => return,
            }
        },
        _ => return,
    };
    record(snapshot, id, object, named, Form::Keyed, known, out);
}

/// One named element of `const { name, count } = v`.
///
/// Zero property-access nodes and two field reads, which is the form a census
/// keyed on `PROPERTY_ACCESS_EXPRESSION` loses entirely.
fn destructured(snapshot: &SemanticSnapshot, id: NodeId, known: &Inhabitable, out: &mut Census) {
    let Some(pattern) = walk::parent(snapshot, id) else {
        return;
    };
    if walk::kind_of(snapshot, pattern) != Some(syntax::OBJECT_BINDING_PATTERN) {
        return;
    }
    // A rest element builds a new object out of the fields nobody named, which
    // `bind_pattern` refuses outright; it reads no single field.
    let parts = walk::children(snapshot, id);
    if parts
        .iter()
        .any(|part| walk::kind_of(snapshot, *part) == Some(syntax::DOT_DOT_DOT_TOKEN))
    {
        return;
    }
    // `{ a }` names `a`; `{ a: b }` reads `a` and binds `b`. The field read is
    // the first name either way.
    let Some(name) = parts
        .iter()
        .find_map(|part| walk::text_of(snapshot, *part))
        .or_else(|| walk::text_of(snapshot, id))
    else {
        return;
    };
    // The receiver is the pattern itself: the checker types a binding pattern at
    // the type being destructured, which is what a parameter `({a}: Named)` has
    // and what a `const {a} = v` has.
    record(
        snapshot,
        id,
        pattern,
        Member::Spelled(name),
        Form::Destructured,
        known,
        out,
    );
}

/// `{ ...v }`, which copies the whole layout.
fn spread(snapshot: &SemanticSnapshot, id: NodeId, known: &Inhabitable, out: &mut Census) {
    let Some(source) = walk::children(snapshot, id).first().copied() else {
        return;
    };
    let Some(&ty) = snapshot.node_types.get(&source) else {
        out.excluded.untyped_receiver += 1;
        return;
    };
    let Some(shape) = shape_of(snapshot, ty, out) else {
        return;
    };
    // Every *stored* member: a method is not copied, because it is not storage.
    let fields = match &snapshot.types.get(ty.0 as usize).map(|record| &record.kind) {
        Some(TypeKind::Object { properties }) => u32::try_from(
            properties
                .iter()
                .filter(|property| property.kind.is_stored())
                .count(),
        )
        .unwrap_or(u32::MAX),
        // An undecomposed receiver has no field list to walk, so the multiplier
        // is unknown. One is the floor, and the `Unclear` row carries the doubt.
        _ => 1,
    };
    let (receiver, implemented, satisfied) = receiver_of(snapshot, ty, known);
    out.spread_sites.push(Site {
        shape,
        owner: owner_of(snapshot, id),
        access: Access::Read,
        form: Form::Spread,
        receiver,
        member: "..".to_owned(),
        fields,
        implemented,
        satisfied,
        location: snapshot.nodes[id.0 as usize].origin.location,
    });
}

/// Classify one access, or account for why it was not counted.
fn record(
    snapshot: &SemanticSnapshot,
    access: NodeId,
    object: NodeId,
    named: Member<'_>,
    form: Form,
    known: &Inhabitable,
    out: &mut Census,
) {
    let Some(&ty) = snapshot.node_types.get(&object) else {
        out.excluded.untyped_receiver += 1;
        return;
    };
    let Some(shape) = shape_of(snapshot, ty, out) else {
        return;
    };
    // A table has no fixed offset to make indirect, so its reads already cost
    // what indirection would charge. `examples/a-dotted-read-on-an-index-signature`
    // is the case.
    if snapshot.index_signatures.contains_key(&ty) {
        out.excluded.index_signature += 1;
        return;
    }
    // Storage, from the member list rather than from the member's type. An
    // undecomposed receiver has no member list, and `Unclear` is what that is
    // for -- not an excuse to assume a field.
    let mut member = match named {
        Member::Spelled(name) => name.to_owned(),
        Member::Described(described) => described.to_owned(),
    };
    if let Some(TypeKind::Object { properties }) =
        snapshot.types.get(ty.0 as usize).map(|record| &record.kind)
    {
        let found = match named {
            Member::Spelled(name) => properties.iter().find(|property| property.name == name),
            Member::Described(described) => match symbol_member(properties, described) {
                Some(property) => {
                    member.clone_from(&property.name);
                    Some(property)
                },
                None => None,
            },
        };
        match found {
            Some(property) if !property.kind.is_stored() => {
                out.excluded.not_stored += 1;
                return;
            },
            None => {
                out.excluded.member_not_declared += 1;
                return;
            },
            Some(_) => {},
        }
    }
    let (receiver, implemented, satisfied) = receiver_of(snapshot, ty, known);
    out.sites.push(Site {
        shape,
        owner: owner_of(snapshot, access),
        access: access_of(snapshot, access, form),
        form,
        receiver,
        member,
        fields: 1,
        implemented,
        satisfied,
        location: snapshot.nodes[access.0 as usize].origin.location,
    });
}

/// The receiver type's name, and whether a class could inhabit it.
///
/// Through the *symbol*, so a generic interface's instantiations — separate
/// `TypeId`s sharing one symbol — answer alike.
fn receiver_of(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    known: &Inhabitable,
) -> (String, bool, bool) {
    let symbol = snapshot
        .types
        .get(ty.0 as usize)
        .and_then(|record| record.symbol)
        .map(|symbol| walk::denoted(snapshot, symbol));
    let name = symbol
        .and_then(|symbol| snapshot.symbols.get(symbol.0 as usize))
        .map_or_else(|| "?".to_owned(), |record| record.name.clone());
    (
        name,
        symbol.is_some_and(|symbol| known.implemented.contains(&symbol.0)),
        symbol.is_some_and(|symbol| known.satisfied.contains(&symbol.0)),
    )
}

/// Whether the access loads, stores, or both.
///
/// A destructuring or a spread only ever loads. For the two expression forms,
/// the answer is in the parent.
///
/// A prefix `++v.x` is read as a plain read: `syntax` has no `PLUS_PLUS_TOKEN`
/// to test and a prefix operator may equally be `!`, `-` or `~`, so the operator
/// is matched by text where the token carries any. A postfix expression needs no
/// test — `++` and `--` are the only postfix operators there are.
fn access_of(snapshot: &SemanticSnapshot, access: NodeId, form: Form) -> Access {
    if matches!(form, Form::Destructured | Form::Spread) {
        return Access::Read;
    }
    let Some(up) = walk::parent(snapshot, access) else {
        return Access::Read;
    };
    match walk::kind_of(snapshot, up) {
        Some(syntax::BINARY_EXPRESSION) => {
            let parts = walk::children(snapshot, up);
            if parts.first() != Some(&access) {
                return Access::Read;
            }
            match parts.get(1).and_then(|token| walk::kind_of(snapshot, *token)) {
                Some(syntax::EQUALS_TOKEN) => Access::Write,
                Some(token) if assigns_in_place(token) => Access::ReadModifyWrite,
                _ => Access::Read,
            }
        },
        Some(syntax::POSTFIX_UNARY_EXPRESSION) => Access::ReadModifyWrite,
        Some(syntax::PREFIX_UNARY_EXPRESSION) => {
            if walk::children(snapshot, up)
                .iter()
                .any(|part| matches!(walk::text_of(snapshot, *part), Some("++" | "--")))
            {
                Access::ReadModifyWrite
            } else {
                Access::Read
            }
        },
        _ => Access::Read,
    }
}

fn assigns_in_place(token: u16) -> bool {
    matches!(
        token,
        syntax::PLUS_EQUALS_TOKEN
            | syntax::MINUS_EQUALS_TOKEN
            | syntax::ASTERISK_EQUALS_TOKEN
            | syntax::ASTERISK_ASTERISK_EQUALS_TOKEN
            | syntax::SLASH_EQUALS_TOKEN
            | syntax::PERCENT_EQUALS_TOKEN
            | syntax::LESS_THAN_LESS_THAN_EQUALS_TOKEN
            | syntax::GREATER_THAN_GREATER_THAN_EQUALS_TOKEN
            | syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_EQUALS_TOKEN
            | syntax::AMPERSAND_EQUALS_TOKEN
            | syntax::BAR_EQUALS_TOKEN
            | syntax::CARET_EQUALS_TOKEN
            | syntax::BAR_BAR_EQUALS_TOKEN
            | syntax::AMPERSAND_AMPERSAND_EQUALS_TOKEN
            | syntax::QUESTION_QUESTION_EQUALS_TOKEN
    )
}

/// What a receiver type is, or `None` where it is not a generated struct at all.
///
/// Through the symbol's **declarations**, which is the derivation `hir::lower`'s
/// `is_an_instantiation` and `tsgo::decompose`'s `declares_a_form_here` both
/// use — written that way because a generic interface's instantiations are
/// separate `TypeId`s sharing one symbol, so a per-type test answers for one
/// instantiation and not the interface.
fn shape_of(snapshot: &SemanticSnapshot, ty: TypeId, out: &mut Census) -> Option<Shape> {
    let ty = through_a_constraint(snapshot, ty);
    let record = snapshot.types.get(ty.0 as usize)?;
    if !matches!(
        record.kind,
        TypeKind::Object { .. } | TypeKind::Structured { .. }
    ) {
        // A primitive, an array, a `Map`, `any`: no generated struct, nothing to
        // make indirect. This is the arm that keeps `v.name.length` out.
        out.excluded.not_a_struct += 1;
        return None;
    }
    let Some(symbol) = record.symbol else {
        // An anonymous object type. It has one inhabitant shape and reads at a
        // fixed offset.
        return Some(Shape::Literal);
    };
    let symbol = walk::denoted(snapshot, symbol);
    let Some(record) = snapshot.symbols.get(symbol.0 as usize) else {
        out.excluded.not_a_struct += 1;
        return None;
    };
    if record.declarations.is_empty() {
        return Some(Shape::Library);
    }
    let shape = record.declarations.iter().find_map(|at| {
        Some(match walk::kind_of(snapshot, *at)? {
            syntax::INTERFACE_DECLARATION => Shape::Interface,
            syntax::TYPE_LITERAL => Shape::TypeLiteral,
            syntax::CLASS_DECLARATION | syntax::CLASS_EXPRESSION => Shape::ClassInstance,
            syntax::OBJECT_LITERAL_EXPRESSION => Shape::Literal,
            _ => return None,
        })
    });
    Some(shape.unwrap_or(Shape::Unclear))
}

/// Resolve a type parameter to what constrains it.
///
/// **`this` is a type parameter.** TypeScript models the receiver inside a class
/// as a parameter named after its class and constrained to it, so every
/// `this.field = v` in a constructor arrives here as a `TypeParameter` and a
/// census that stopped at the outer type counted none of them: the first run of
/// this pass reported 7 field accesses and 0 writes for
/// `examples/a-structural-cast-that-is-a-prefix`, whose three constructors write
/// five fields between them. The interface column was right and the
/// **denominator** was short by every `this`, which inflated the one percentage
/// the whole census exists to produce.
///
/// Following the constraint is what `hir::lower` does, and its comment says why
/// this works for exactly the case that matters: "For a *non-generic* class the
/// constraint decomposes into an object and `type_of` answers
/// `Managed(Object(..))`." For a generic one it stays a placeholder, and a
/// placeholder is `Unclear` rather than absent.
///
/// The same hop means a constrained parameter — `<T extends Named>` — is counted
/// at its bound. That is the right answer for a cost census: a read through such
/// a slot is a read at the bound's shape, and it is also how the compiler will
/// resolve it. The loop is a bound rather than an algorithm, for the reason
/// `walk::denoted`'s is.
fn through_a_constraint(snapshot: &SemanticSnapshot, ty: TypeId) -> TypeId {
    let mut at = ty;
    for _ in 0..8 {
        match snapshot.types.get(at.0 as usize).map(|record| &record.kind) {
            Some(TypeKind::TypeParameter {
                constraint: Some(constraint),
                ..
            }) => at = *constraint,
            _ => return at,
        }
    }
    at
}

/// The two proxies for "a class could inhabit this interface".
///
/// The real set is the one record 0294 rules out: *"the classes that work by
/// accident are exactly the ones producing no layout evidence."* So neither of
/// these is the answer, and neither is implementable. Together they **bracket**
/// the argument, which is what the design step needs — the way
/// `erasure::Analysis::Local` is a bracket and not a proposal.
struct Inhabitable {
    /// See [`Excluded::interfaces_unexamined`].
    interfaces_unexamined: u32,
    /// See [`Excluded::classes_unexamined`].
    classes_unexamined: u32,
    /// Named in some class's heritage clause. Misses a structural satisfier, so
    /// it over-states what a narrow rule would spare.
    implemented: FxHashSet<u32>,
    /// Some class has a same-named member for each required member. Compares
    /// names and not types, because assignability is the checker's and this does
    /// not have it — so it both over- and under-counts against the real relation.
    satisfied: FxHashSet<u32>,
}

impl Inhabitable {
    fn of(snapshot: &SemanticSnapshot) -> Self {
        let mut implemented = FxHashSet::default();
        let mut class_members: Vec<FxHashSet<&str>> = Vec::new();
        let mut interfaces_unexamined = 0;
        let mut classes_unexamined = 0;

        for index in 0..snapshot.nodes.len() {
            let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
            let Some(kind) = walk::kind_of(snapshot, id) else {
                continue;
            };
            if !matches!(
                kind,
                syntax::CLASS_DECLARATION | syntax::CLASS_EXPRESSION
            ) {
                continue;
            }
            // Heritage clauses, not `base_types`: `lower.rs` records that
            // `base_types` "in fact carries neither for a class that only
            // implements -- `class Counting implements Sink` has no entry at
            // all. That was measured rather than assumed."
            for clause in walk::children(snapshot, id) {
                if walk::kind_of(snapshot, clause) != Some(syntax::HERITAGE_CLAUSE) {
                    continue;
                }
                named_symbols(snapshot, clause, &mut implemented);
            }
            match instance_type_of(snapshot, id)
                .and_then(|ty| snapshot.types.get(ty.0 as usize))
                .map(|record| &record.kind)
            {
                Some(TypeKind::Object { properties }) => class_members
                    .push(properties.iter().map(|p| p.name.as_str()).collect()),
                _ => classes_unexamined += 1,
            }
        }

        let mut satisfied = FxHashSet::default();
        for (index, record) in snapshot.symbols.iter().enumerate() {
            if !record
                .declarations
                .iter()
                .any(|at| walk::kind_of(snapshot, *at) == Some(syntax::INTERFACE_DECLARATION))
            {
                continue;
            }
            let Some(TypeKind::Object { properties }) = record
                .declarations
                .iter()
                .find_map(|at| snapshot.node_types.get(at))
                .and_then(|ty| snapshot.types.get(ty.0 as usize))
                .map(|record| &record.kind)
            else {
                interfaces_unexamined += 1;
                continue;
            };
            let required: Vec<&str> = properties
                .iter()
                .filter(|property| !property.optional)
                .map(|property| property.name.as_str())
                .collect();
            // An interface with no required members is satisfied by every class,
            // which says nothing; it is not evidence that a class inhabits it.
            if required.is_empty() {
                continue;
            }
            if class_members
                .iter()
                .any(|members| required.iter().all(|name| members.contains(name)))
            {
                satisfied.insert(u32::try_from(index).unwrap_or(u32::MAX));
            }
        }

        Self {
            interfaces_unexamined,
            classes_unexamined,
            implemented,
            satisfied,
        }
    }
}

/// The instance type a class node declares.
///
/// Four lines rather than a `pub` in `hir::lower`, which is the same trade
/// `erasure` makes: reading the construct signature's result answers for a
/// declaration and an expression without asking which kind of node this is.
fn instance_type_of(snapshot: &SemanticSnapshot, class: NodeId) -> Option<TypeId> {
    let ty = snapshot.node_types.get(&class).copied()?;
    let TypeKind::Function(signature) = snapshot.types.get(ty.0 as usize)?.kind else {
        return Some(ty);
    };
    Some(snapshot.signatures.get(signature.0 as usize)?.return_type)
}

/// Every symbol a heritage clause mentions, however it is spelled.
///
/// Walked rather than read at a fixed child: `implements Foo<Bar>` and
/// `implements ns.Foo` put the name at different depths, and a fixed index finds
/// one of them.
fn named_symbols(snapshot: &SemanticSnapshot, id: NodeId, out: &mut FxHashSet<u32>) {
    if let Some(symbol) = snapshot
        .nodes
        .get(id.0 as usize)
        .and_then(|node| node.symbol)
    {
        out.insert(walk::denoted(snapshot, SymbolId(symbol.0)).0);
    }
    for child in walk::children(snapshot, id) {
        named_symbols(snapshot, child, out);
    }
}

/// The property a type declares under a symbol with this description.
///
/// `__@kRefed@2`: the description the brackets spell and the checker's own id for
/// the symbol. Mirrors `hir::lower`'s `symbol_property_name`, including its
/// refusal: the id is tsgo's and not reproducible here, so the match is on the
/// description alone, and **two symbols sharing one description on one type
/// resolve to nothing** rather than to whichever came first. Counting such an
/// access against the wrong member would be worse than not counting it, and the
/// undeclared-member row is where it lands.
fn symbol_member<'a>(
    properties: &'a [nts_semantic_schema::schema::PropertyRecord],
    described: &str,
) -> Option<&'a nts_semantic_schema::schema::PropertyRecord> {
    let prefix = format!("__@{described}@");
    let mut found = properties.iter().filter(|property| {
        property.name.starts_with(&prefix)
            && property.name[prefix.len()..]
                .bytes()
                .all(|byte| byte.is_ascii_digit())
    });
    let first = found.next()?;
    found.next().is_none().then_some(first)
}

/// The function an access is written in.
///
/// Mirrors `erasure`'s walk of the same name: a class body rather than a method
/// means a field initializer, and an arrow has no name to report.
fn owner_of(snapshot: &SemanticSnapshot, id: NodeId) -> String {
    let mut at = walk::parent(snapshot, id);
    while let Some(node) = at {
        match walk::kind_of(snapshot, node) {
            Some(
                syntax::FUNCTION_DECLARATION
                | syntax::METHOD_DECLARATION
                | syntax::CLASS_DECLARATION
                | syntax::CONSTRUCTOR
                | syntax::GET_ACCESSOR
                | syntax::SET_ACCESSOR,
            ) => {
                return walk::children(snapshot, node)
                    .into_iter()
                    .find(|child| walk::kind_of(snapshot, *child) == Some(syntax::IDENTIFIER))
                    .and_then(|name| walk::text_of(snapshot, name))
                    .unwrap_or("<anonymous>")
                    .to_owned();
            },
            Some(syntax::ARROW_FUNCTION) => return "<arrow>".to_owned(),
            _ => at = walk::parent(snapshot, node),
        }
    }
    "<module>".to_owned()
}

/// Exactly two children, flattened — a receiver and a member.
fn children2(snapshot: &SemanticSnapshot, id: NodeId) -> Option<[NodeId; 2]> {
    match walk::children(snapshot, id).as_slice() {
        [first, second] => Some([*first, *second]),
        _ => None,
    }
}
