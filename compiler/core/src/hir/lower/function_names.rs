//! What a function is called: `f.name`, and the name in `String(f)`.
//!
//! JavaScript names a function where it is written (`SetFunctionName`, and
//! `NamedEvaluation` for an anonymous one):
//! - a declaration, a method, an accessor (`get x`, `set x`) or a function
//!   expression with a name of its own, by that name -- `"default"` for an
//!   `export default function`;
//! - an anonymous function or arrow, by what it initializes: a variable, an
//!   identifier it is assigned to (`=`, `&&=`, `||=`, `??=`), an object
//!   literal's property, a class field, a parameter's or a destructuring
//!   default, `export default` -- through parentheses and TypeScript's
//!   assertions, which are not there at run time;
//! - anything else, `""`: an argument, an array element, `o.p = () => 1`;
//! - a bound function, `"bound "` and its target's name;
//! - a promise's resolving functions, `""`.
//!
//! **Per closure class, because a closure class is one per declaration.** Every
//! rule but the bound one reads the source around the function, never a value,
//! so the name is a constant of the class: data beside its descriptor, not a
//! function. [`decide`] writes each class's ([`Program::function_names`]),
//! which the runtime reads off the descriptor for a `.name` the type does not
//! settle and for a function's text; where the static type *is* the class,
//! [`FuncBuilder::function_name`] answers at compile time. A bound function
//! whose target is known only at run time is the one name the runtime makes:
//! `"bound "` and its target's.
//!
//! **Never by the function *type*.** A value of `typeof g` can be any function
//! of `g`'s signature, and the name used to be read off the type's declaration:
//! `g`'s, for every function passed. Only the class says.

use std::collections::BTreeMap;

use nts_diagnostics::Diagnostic;
use nts_semantic_schema::{LiteralValue, NodeId, SemanticSnapshot, TypeId, TypeKind, syntax};
use rustc_hash::FxHashMap;

use super::{
    ClosureInfo, ClosureSource, FuncBuilder, HirType, ManagedType, OpKind, Program, ValueId,
    class_token_indices, closure_index,
};
use crate::hir::FunctionName;

/// What a function is called where it is written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Written {
    /// A name the source fixes, `""` included.
    Is(String),
    /// `"bound "` and the target's name, which is a value's.
    Bound,
    /// A key computed at run time (`{ [k]() {} }`), which a compiled program
    /// does not keep.
    Computed,
}

/// What a closure is called where it is written. See the module documentation.
pub(super) fn written(probe: &FuncBuilder, closure: &ClosureInfo) -> Written {
    match closure.source {
        ClosureSource::Bound => Written::Bound,
        ClosureSource::Authored | ClosureSource::Function | ClosureSource::Method => {
            declared(probe, closure.node)
        }
        // Built-ins, which have no name: a promise's resolving functions, and
        // the jobs and reactions no program can read.
        ClosureSource::Job { .. }
        | ClosureSource::Resolving { .. }
        | ClosureSource::Reaction
        | ClosureSource::ModuleJob { .. } => Written::Is(String::new()),
    }
}

/// The name a function's own declaration gives it, or its context's.
fn declared(probe: &FuncBuilder, node: NodeId) -> Written {
    match probe.kind_of(node) {
        Some(syntax::FUNCTION_DECLARATION) => Written::Is(
            probe
                .declared_name(node)
                .unwrap_or_else(|| "default".to_owned()),
        ),
        Some(syntax::METHOD_DECLARATION) => key(probe, node),
        Some(syntax::GET_ACCESSOR) => prefixed("get ", key(probe, node)),
        Some(syntax::SET_ACCESSOR) => prefixed("set ", key(probe, node)),
        Some(syntax::FUNCTION_EXPRESSION) => probe
            .declared_name(node)
            .map_or_else(|| contextual(probe, node), Written::Is),
        Some(syntax::ARROW_FUNCTION) => contextual(probe, node),
        _ => Written::Is(String::new()),
    }
}

fn prefixed(prefix: &str, written: Written) -> Written {
    match written {
        Written::Is(name) => Written::Is(format!("{prefix}{name}")),
        other => other,
    }
}

/// `NamedEvaluation`: the name an anonymous function takes from what it
/// initializes, or `""`.
fn contextual(probe: &FuncBuilder, function: NodeId) -> Written {
    let anonymous = || Written::Is(String::new());
    let mut child = function;
    let mut at = probe.node(function).parent;
    // Through what is not there at run time: `const f = (() => 1) as F` is
    // `const f = () => 1` to JavaScript, and parentheses pass the name on.
    while let Some(parent) = at
        && matches!(
            probe.kind_of(parent),
            Some(
                syntax::PARENTHESIZED_EXPRESSION
                    | syntax::AS_EXPRESSION
                    | syntax::SATISFIES_EXPRESSION
                    | syntax::NON_NULL_EXPRESSION
                    | syntax::TYPE_ASSERTION_EXPRESSION
            )
        )
    {
        child = parent;
        at = probe.node(parent).parent;
    }
    let Some(parent) = at else {
        return anonymous();
    };
    let children = probe.children(parent);
    // The initializer is last in every form below; anywhere else -- a type,
    // a key -- the function names nothing.
    let initializes = children.last() == Some(&child);
    let identifier = |node: NodeId| {
        (probe.kind_of(node) == Some(syntax::IDENTIFIER))
            .then(|| probe.node(node).text.clone())
            .flatten()
    };
    match probe.kind_of(parent) {
        // `const f = …`, and a parameter's default, `(f = …) => …`: the first
        // identifier is the binding, and a pattern has none at this level.
        Some(syntax::VARIABLE_DECLARATION | syntax::PARAMETER) if initializes => children
            .iter()
            .find_map(|node| identifier(*node))
            .map_or_else(anonymous, Written::Is),
        // A destructuring default, `{ a = … }`, `{ a: b = … }`, `[c = …]`: the
        // binding is the element just before the initializer.
        Some(syntax::BINDING_ELEMENT | syntax::SHORTHAND_PROPERTY_ASSIGNMENT) if initializes => {
            children
                .len()
                .checked_sub(2)
                .and_then(|at| identifier(children[at]))
                .map_or_else(anonymous, Written::Is)
        }
        // `f = …` and the logical assignments, to an identifier; `o.p = …`
        // names nothing.
        Some(syntax::BINARY_EXPRESSION) if initializes => match children.as_slice() {
            [left, operator, _]
                if matches!(
                    probe.kind_of(*operator),
                    Some(
                        syntax::EQUALS_TOKEN
                            | syntax::BAR_BAR_EQUALS_TOKEN
                            | syntax::AMPERSAND_AMPERSAND_EQUALS_TOKEN
                            | syntax::QUESTION_QUESTION_EQUALS_TOKEN
                    )
                ) =>
            {
                identifier(*left).map_or_else(anonymous, Written::Is)
            }
            _ => anonymous(),
        },
        // `{ p: … }`, except `__proto__: …`, which sets the prototype and
        // names nothing.
        Some(syntax::PROPERTY_ASSIGNMENT) if initializes => match key(probe, parent) {
            Written::Is(name) if name == "__proto__" && !computed_key(probe, parent) => anonymous(),
            other => other,
        },
        // A class field, `p = …` or `#p = …`.
        Some(syntax::PROPERTY_DECLARATION) if initializes => key(probe, parent),
        Some(syntax::EXPORT_ASSIGNMENT) => Written::Is("default".to_owned()),
        _ => anonymous(),
    }
}

/// The node a member is named by.
fn key_node(probe: &FuncBuilder, member: NodeId) -> Option<NodeId> {
    probe.children(member).into_iter().find(|child| {
        matches!(
            probe.kind_of(*child),
            Some(
                syntax::IDENTIFIER
                    | syntax::PRIVATE_IDENTIFIER
                    | syntax::STRING_LITERAL
                    | syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL
                    | syntax::NUMERIC_LITERAL
                    | syntax::BIGINT_LITERAL
                    | syntax::COMPUTED_PROPERTY_NAME
            )
        )
    })
}

fn computed_key(probe: &FuncBuilder, member: NodeId) -> bool {
    key_node(probe, member)
        .is_some_and(|node| probe.kind_of(node) == Some(syntax::COMPUTED_PROPERTY_NAME))
}

/// A member's key as its name: `m`, `#m`, `"a b"`, `1` for `1.0`, and a
/// computed key the checker knows the value of -- a literal type, or one of
/// the well-known symbols, `[Symbol.iterator]`.
///
/// A literal key is read off its symbol, whose name is the property's: the
/// frontend gives a key written as a literal no text, and its type is the
/// property's, not the literal's. The symbol is what lays the property out, so
/// the name and the layout agree.
fn key(probe: &FuncBuilder, member: NodeId) -> Written {
    let Some(node) = key_node(probe, member) else {
        return Written::Computed;
    };
    let text = match probe.kind_of(node) {
        Some(syntax::IDENTIFIER | syntax::PRIVATE_IDENTIFIER) => probe.node(node).text.clone(),
        Some(syntax::COMPUTED_PROPERTY_NAME) => probe
            .children(node)
            .first()
            .and_then(|expression| computed(probe, *expression)),
        _ => probe
            .node(node)
            .symbol
            .and_then(|symbol| probe.snapshot.symbols.get(symbol.0 as usize))
            .map(|record| record.name.clone()),
    };
    text.map_or(Written::Computed, Written::Is)
}

/// A computed key's name, where the checker settles its value.
fn computed(probe: &FuncBuilder, expression: NodeId) -> Option<String> {
    if let Some(text) = literal(probe, expression) {
        return Some(text);
    }
    // `[Symbol.iterator]`: a well-known symbol, whose description is its own
    // spelling.
    if probe.kind_of(expression) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
        && let [object, member] = probe.children(expression).as_slice()
        && probe.node(*object).text.as_deref() == Some("Symbol")
        && let Some(member) = probe.node(*member).text.as_deref()
    {
        return Some(format!("[Symbol.{member}]"));
    }
    None
}

/// A string or number the checker gives this expression as its literal type.
fn literal(probe: &FuncBuilder, node: NodeId) -> Option<String> {
    let ty = probe.snapshot.node_types.get(&node)?;
    match &probe.snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Literal(LiteralValue::String(text)) => Some(text.clone()),
        TypeKind::Literal(LiteralValue::Number(value)) => Some(crate::number::to_js_string(*value)),
        _ => None,
    }
}

/// Decide [`Program::function_names`]: every closure class, and every class
/// used as a value.
pub(super) fn decide(snapshot: &SemanticSnapshot, closures: &[ClosureInfo], program: &mut Program) {
    let probe = FuncBuilder::probe(snapshot);
    let tokens = class_token_indices(snapshot);
    let mut names = BTreeMap::new();
    for layout in &program.layouts {
        let Some(&ty) = layout.types.first() else {
            continue;
        };
        let name = if super::super::is_closure_type(ty) {
            closure_name(&probe, closures, program, ty)
        } else {
            token_name(snapshot, &tokens, ty).map(FunctionName::Is)
        };
        if let Some(name) = name {
            names.insert(layout.name.clone(), name);
        }
    }
    program.function_names = names;
}

/// A class used as a value: its class's name. `tokens` numbers the program's
/// classes used as values, by symbol ([`class_token_indices`]).
fn token_name(
    snapshot: &SemanticSnapshot,
    tokens: &FxHashMap<u32, usize>,
    ty: TypeId,
) -> Option<String> {
    use crate::hir::{CONSTRUCTOR_TOKENS, PROVIDED_ERRORS, SYNTHETIC_CLASS_TOKENS};
    if ty.0 >= CONSTRUCTOR_TOKENS {
        return super::super::builtin::ERRORS
            .get((ty.0 - CONSTRUCTOR_TOKENS) as usize)
            .map(|name| (*name).to_owned());
    }
    if !(SYNTHETIC_CLASS_TOKENS..PROVIDED_ERRORS).contains(&ty.0) {
        return None;
    }
    let index = (ty.0 - SYNTHETIC_CLASS_TOKENS) as usize;
    let symbol = tokens
        .iter()
        .find_map(|(symbol, at)| (*at == index).then_some(*symbol))?;
    Some(snapshot.symbols.get(symbol as usize)?.name.clone())
}

/// What a closure class is called: the source's name, or for a bound function
/// [`FunctionName::Bound`], for the runtime to read off its target. Always the
/// runtime's: field 0 holds the target at its checked type, a signature that
/// any function of it can be, never a closure class whose name is known.
/// `None` where the key is computed at run time, or field 0 is not the
/// reference the runtime reads -- and the runtime then refuses by name.
fn closure_name(
    probe: &FuncBuilder,
    closures: &[ClosureInfo],
    program: &Program,
    class: TypeId,
) -> Option<FunctionName> {
    match written(probe, closures.get(closure_index(class))?) {
        Written::Is(text) => Some(FunctionName::Is(text)),
        Written::Computed => None,
        Written::Bound => {
            let layout = program
                .layouts
                .iter()
                .find(|layout| layout.types.contains(&class))?;
            matches!(
                layout.fields.first()?.ty,
                HirType::Managed(ManagedType::Object(_))
            )
            .then_some(FunctionName::Bound)
        }
    }
}

impl FuncBuilder<'_> {
    /// `f.name`.
    ///
    /// Where the value's class is known -- a closure class, one per
    /// declaration and final, or a class used as a value -- the source settles
    /// it and this is a constant. Anything else of a function type, and a
    /// bound function whose target is a value, asks the runtime, which reads
    /// it off the descriptor.
    ///
    /// `Ok(None)` where the member is not `name` or the value is not a
    /// function, so the caller carries on to the ordinary refusal.
    pub(super) fn function_name(
        &mut self,
        id: NodeId,
        value: ValueId,
        type_id: TypeId,
        member: &str,
    ) -> Result<Option<ValueId>, Diagnostic> {
        if member != "name" {
            return Ok(None);
        }
        let string = HirType::Managed(ManagedType::String);
        let origin = self.origin(id);
        let closure = super::super::is_closure_type(type_id)
            .then(|| self.closures.get(closure_index(type_id)))
            .flatten();
        match closure.map(|closure| written(self, closure)) {
            Some(Written::Is(text)) => {
                return Ok(Some(self.push(OpKind::ConstString(text), string, origin)));
            }
            Some(Written::Computed) => {
                return Err(self.unsupported(
                    id,
                    "the name of a method whose key is computed at run time, which a compiled \
                     program does not keep",
                ));
            }
            Some(Written::Bound) => {}
            None => {
                if let Some(text) = token_name(self.snapshot, &self.class_tokens, type_id) {
                    return Ok(Some(self.push(OpKind::ConstString(text), string, origin)));
                }
                let is_a_function = self
                    .snapshot
                    .types
                    .get(type_id.0 as usize)
                    .is_some_and(|record| matches!(record.kind, TypeKind::Function(_)));
                if !is_a_function
                    || !matches!(self.values[value.0 as usize].ty, HirType::Managed(_))
                {
                    return Ok(None);
                }
            }
        }
        let erased = self.coerce(value, &HirType::Erased, id)?;
        Ok(Some(self.runtime_call(
            "nts_function_name",
            vec![erased],
            string,
            origin,
        )))
    }
}
