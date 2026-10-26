//! Permission to read a narrow field requires a write before publication.
//!
//! The checker permits definite-assignment assertions and constructor calls
//! that expose fields before their writes. Allocator zero is not JavaScript's
//! undefined. This proof licenses accessors only; it does not repair the
//! representation of an unproven field or bless an existing direct read.

use nts_semantic_schema::DeclarationModifiers as Modifiers;
use rustc_hash::{FxHashMap, FxHashSet};

use super::{
    FuncBuilder, NodeId, PropertyRecord, SemanticSnapshot, TypeId, children_that_run,
    declares_a_class, instance_type_of, interfaces, is_static_member, parameters_of, syntax,
    the_constructor_declared_by,
};

#[derive(Debug, Default)]
pub(super) struct Ready {
    declarations: FxHashSet<NodeId>,
}

impl Ready {
    pub(super) fn collect(probe: &FuncBuilder<'_>) -> Self {
        let classes: FxHashMap<TypeId, NodeId> = probe
            .snapshot
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| matches!(node.kind, super::NodeKind::Syntax(kind) if declares_a_class(kind)))
            .filter_map(|(at, _)| {
                let node = NodeId(u32::try_from(at).ok()?);
                Some((instance_type_of(probe.snapshot, node)?, node))
            })
            .collect();
        let exposes: FxHashMap<_, _> = classes
            .values()
            .map(|class| (*class, class_exposes(probe, *class)))
            .collect();
        let mut ready = Self::default();
        for (&ty, &class) in &classes {
            if base_exposes(probe.snapshot, ty, &classes, &exposes) {
                continue;
            }
            ready.class(probe, class);
        }
        ready
    }

    pub(super) fn contains(&self, property: &PropertyRecord) -> bool {
        property
            .declaration
            .is_some_and(|declaration| self.declarations.contains(&declaration))
    }

    fn class(&mut self, probe: &FuncBuilder<'_>, class: NodeId) {
        let mut pending = FxHashMap::default();
        let mut exposed = false;
        for field in probe.children(class) {
            if probe.kind_of(field) != Some(syntax::PROPERTY_DECLARATION)
                || is_static_member(probe.snapshot, field)
            {
                continue;
            }
            let Some(name) = probe.member_key(field) else {
                continue;
            };
            // A property declaration has modifiers, name, ?/!, annotation, initializer.
            // A ! token is not an initializer, unlike a variable declaration's
            // last non-type child. Ask the encoded slots rather than guessing.
            let initializer = probe.child_slots::<5>(field).and_then(|slots| slots[4]);
            if let Some(initializer) = initializer {
                exposed |= exposes_receiver(probe, initializer);
                if !exposed {
                    self.declarations.insert(field);
                }
            } else {
                pending.insert(name, field);
            }
        }
        let Some(constructor) = the_constructor_declared_by(probe, class) else {
            return;
        };
        for parameter in parameters_of(probe, constructor) {
            let initializer = probe.default_of(parameter);
            exposed |= initializer.is_some_and(|at| contains_receiver(probe, at));
        }
        if !exposed {
            for parameter in parameters_of(probe, constructor) {
                if parameter_property(probe, parameter) {
                    self.declarations.insert(parameter);
                }
            }
        }
        let body = probe
            .children(constructor)
            .into_iter()
            .find(|at| probe.kind_of(*at) == Some(syntax::BLOCK));
        for statement in body.into_iter().flat_map(|at| probe.children(at)) {
            exposed |= exposes_receiver(probe, statement);
            if exposed {
                break;
            }
            if let Some(name) = unconditional_write(probe, statement)
                && let Some(field) = pending.remove(&name)
            {
                self.declarations.insert(field);
            }
        }
    }
}

fn parameter_property(probe: &FuncBuilder<'_>, at: NodeId) -> bool {
    let modifiers = probe.node(at).modifiers;
    [
        Modifiers::PUBLIC,
        Modifiers::PRIVATE,
        Modifiers::PROTECTED,
        Modifiers::READONLY,
    ]
    .iter()
    .any(|modifier| modifiers.contains(*modifier))
}

fn unconditional_write(
    probe: &FuncBuilder<'_>,
    statement: NodeId,
) -> Option<nts_semantic_schema::PropertyKey> {
    if probe.kind_of(statement) != Some(syntax::EXPRESSION_STATEMENT) {
        return None;
    }
    let expression = *probe.children(statement).first()?;
    if probe.kind_of(expression) != Some(syntax::BINARY_EXPRESSION) {
        return None;
    }
    let children = probe.children(expression);
    let [left, operator, _] = children.as_slice() else {
        return None;
    };
    if probe.kind_of(*operator) != Some(syntax::EQUALS_TOKEN) {
        return None;
    }
    let (receiver, name) = probe.member_access_key(*left)?;
    (probe.kind_of(receiver) == Some(syntax::THIS_KEYWORD)).then_some(name)
}

fn base_exposes(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    classes: &FxHashMap<TypeId, NodeId>,
    exposes: &FxHashMap<NodeId, bool>,
) -> bool {
    let mut ty = ty;
    for _ in 0..64 {
        let Some(base) = snapshot.base_types.get(&ty).and_then(|bases| bases.first()) else {
            return false;
        };
        let Some(class) = classes.get(base) else {
            // An interface in base_types contributes no constructor. An
            // external class cannot vouch for initialization of derived fields.
            return snapshot
                .types
                .get(base.0 as usize)
                .and_then(|ty| ty.symbol)
                .and_then(|symbol| snapshot.symbols.get(symbol.0 as usize))
                .is_none_or(|symbol| {
                    symbol
                        .flags
                        .contains(nts_semantic_schema::SymbolFlags::CLASS)
                });
        };
        if exposes.get(class).copied().unwrap_or(true) {
            return true;
        }
        ty = *base;
    }
    true
}

fn class_exposes(probe: &FuncBuilder<'_>, class: NodeId) -> bool {
    probe.children(class).into_iter().any(|member| {
        if probe.kind_of(member) == Some(syntax::CONSTRUCTOR) {
            return exposes_receiver(probe, probe.implementation_of(member));
        }
        probe.kind_of(member) == Some(syntax::PROPERTY_DECLARATION)
            && !is_static_member(probe.snapshot, member)
            && probe
                .child_slots::<5>(member)
                .and_then(|slots| slots[4])
                .is_some_and(|at| exposes_receiver(probe, at))
    })
}

fn contains_receiver(probe: &FuncBuilder<'_>, at: NodeId) -> bool {
    let mut nodes = Vec::new();
    probe.subtree(at, &mut nodes);
    nodes
        .into_iter()
        .any(|node| probe.kind_of(node) == Some(syntax::THIS_KEYWORD))
}

/// Whether evaluating `root` can let anything observe the object before its
/// fields are written.
///
/// **An allowlist, because a list of the ways to leak is never finished.** It
/// was one -- calls, `new`, `return`, a declaration, an accessor and a plain
/// `=` -- and a tagged template, `throw this`, `holder ??= this`, a
/// `super.method()` that runs with the receiver, and every construct added
/// since each published `this` with no entry naming it. So the receiver is
/// kept in only where it stays: as the object of a plain field it reads or
/// writes in place and does not call, or stored whole into one of its own
/// fields -- itself, or an arrow that captures it, which runs only when
/// something later calls it, and that call is a publication. Every other
/// appearance, a `super` that is not the base constructor's call, and an arrow
/// capturing it anywhere else, is a publication. A nested function or class
/// has its own receiver and is not this evaluation.
fn exposes_receiver(probe: &FuncBuilder<'_>, root: NodeId) -> bool {
    let mut pending = vec![root];
    while let Some(at) = pending.pop() {
        match probe.kind_of(at) {
            Some(syntax::ARROW_FUNCTION) => {
                if at != root && !stored_whole(probe, at) && contains_receiver(probe, at) {
                    return true;
                }
                continue;
            }
            Some(
                syntax::FUNCTION_EXPRESSION
                | syntax::FUNCTION_DECLARATION
                | syntax::CLASS_DECLARATION
                | syntax::CLASS_EXPRESSION,
            ) => continue,
            // A field initializer that is the receiver itself stores it whole.
            Some(syntax::THIS_KEYWORD) if at != root && !stays(probe, at) => return true,
            Some(syntax::SUPER_KEYWORD) if !constructs_the_base(probe, at) => return true,
            _ => {}
        }
        pending.extend(children_that_run(probe, at));
    }
    false
}

/// `this.field`, read or written in place, where `field` is plain storage and
/// the access is not what a call calls -- a method or a function-valued field
/// called through the receiver runs with it. Or the receiver stored whole into
/// its own field.
fn stays(probe: &FuncBuilder<'_>, receiver: NodeId) -> bool {
    let Some(access) = probe.node(receiver).parent else {
        return false;
    };
    match probe.member_access_key(access) {
        Some((object, name)) if object == receiver => {
            own_field(probe, receiver, &name) && !called(probe, access)
        }
        _ => stored_whole(probe, receiver),
    }
}

/// Asked of the class behind the receiver: the checker types `this` as the
/// polymorphic `this` type, a parameter constrained by the class, which has
/// no properties of its own to answer with.
fn own_field(
    probe: &FuncBuilder<'_>,
    receiver: NodeId,
    name: &nts_semantic_schema::PropertyKey,
) -> bool {
    probe
        .snapshot
        .node_types
        .get(&receiver)
        .and_then(|ty| interfaces::property(probe.snapshot, probe.class_behind(*ty), name))
        .is_some_and(|property| property.kind == nts_semantic_schema::MemberKind::Field)
}

fn called(probe: &FuncBuilder<'_>, access: NodeId) -> bool {
    probe.node(access).parent.is_some_and(|parent| {
        matches!(
            probe.kind_of(parent),
            Some(
                syntax::CALL_EXPRESSION
                    | syntax::NEW_EXPRESSION
                    | syntax::TAGGED_TEMPLATE_EXPRESSION
            )
        ) && probe.children(parent).first() == Some(&access)
    })
}

/// The right operand of a plain `=` into one of the receiver's own fields.
fn stored_whole(probe: &FuncBuilder<'_>, value: NodeId) -> bool {
    let Some(assignment) = probe.node(value).parent else {
        return false;
    };
    if probe.kind_of(assignment) != Some(syntax::BINARY_EXPRESSION) {
        return false;
    }
    let [left, operator, right] = probe.children(assignment)[..] else {
        return false;
    };
    right == value
        && probe.kind_of(operator) == Some(syntax::EQUALS_TOKEN)
        && probe.member_access_key(left).is_some_and(|(object, name)| {
            probe.kind_of(object) == Some(syntax::THIS_KEYWORD) && own_field(probe, object, &name)
        })
}

/// `super(...)`: the base constructor, which [`base_exposes`] answers for.
fn constructs_the_base(probe: &FuncBuilder<'_>, keyword: NodeId) -> bool {
    probe.node(keyword).parent.is_some_and(|call| {
        probe.kind_of(call) == Some(syntax::CALL_EXPRESSION)
            && probe.children(call).first() == Some(&keyword)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use nts_frontend_ts::Frontend;

    #[test]
    fn only_a_write_before_publication_licenses_the_field() {
        let config = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/programs/accessor-initialization/tsconfig.json");
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .unwrap_or_else(|error| panic!("snapshot failed: {error:?}"));
        let snapshot = super::super::LoweringSnapshot::new(&snapshot);
        let probe = FuncBuilder::probe(&snapshot);
        let ready = Ready::collect(&probe);
        for (class, expected) in [
            ("Initializer", true),
            ("Constructor", true),
            ("Parameter", true),
            ("Missing", false),
            ("EarlyCall", false),
            ("LateCall", true),
            ("Alias", false),
            ("Closure", true),
            ("EarlyClosure", false),
            ("Derived", false),
            ("QuietDerived", true),
            ("TaggedEarly", false),
            ("ThrowEarly", false),
            ("NullishEarly", false),
            ("SuperMethodEarly", false),
            ("ForOfAlias", false),
            ("CastEarly", false),
            ("CalledFieldEarly", false),
            ("OwnReadFirst", true),
            ("SelfStored", true),
            ("PrivateReadFirst", true),
            // An exact symbol-key write keeps `this` local, so a later public
            // field write is ready too. Reordering the two writes is the
            // one-change control: it preserves all runtime field values.
            ("SymbolWriteFirst", true),
            ("SymbolWriteLast", true),
        ] {
            let ty = snapshot
                .types
                .iter()
                .enumerate()
                .find_map(|(at, ty)| {
                    let symbol = ty.symbol?;
                    (snapshot.symbols[symbol.0 as usize].name.is_name(class)
                        && matches!(ty.kind, nts_semantic_schema::TypeKind::Object { .. }))
                    .then(|| TypeId(u32::try_from(at).unwrap_or(u32::MAX)))
                })
                .unwrap_or_else(|| panic!("instance type missing: {class}"));
            let field = interfaces::property(&snapshot, ty, &"value".into())
                .unwrap_or_else(|| panic!("field missing: {class}.value"));
            assert_eq!(ready.contains(field), expected, "{class}.value");
        }
    }
}
