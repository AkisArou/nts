//! Expressions and the parts functions share.

use nts_semantic_schema::NodeId;
use react_compiler_ast::common::RawNode;
use react_compiler_ast::expressions::{
    ArrayExpression, ArrowFunctionBody, ArrowFunctionExpression, AssignmentExpression, AwaitExpression,
    BinaryExpression, CallExpression, ClassExpression, ConditionalExpression, Expression, FunctionExpression,
    Identifier, Import, LogicalExpression, MemberExpression, MetaProperty, NewExpression, ObjectExpression,
    ObjectExpressionProperty, ObjectMethod, ObjectMethodKind, ObjectProperty, OptionalCallExpression,
    OptionalMemberExpression, PrivateName, SequenceExpression, SpreadElement, Super, TSAsExpression,
    TSInstantiationExpression, TSNonNullExpression, TSSatisfiesExpression, TSTypeAssertion, TaggedTemplateExpression,
    TemplateLiteral, ThisExpression, UnaryExpression, UpdateExpression, YieldExpression,
};
use react_compiler_ast::literals::{
    BigIntLiteral, BooleanLiteral, NullLiteral, NumericLiteral, NumericLiteralExtra, RegExpLiteral, StringLiteral,
    TemplateElement, TemplateElementValue,
};
use react_compiler_ast::operators::{AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator, UpdateOperator};
use react_compiler_ast::patterns::PatternLike;

use super::{Converted, Converter, k};

/// tsgo's `NodeFlags.OptionalChain`: a link of a chain rooted at a `?.`.
const FLAG_OPTIONAL_CHAIN: u32 = 1 << 5;

/// A second Babel node made from one tsgo node -- the value beside the key of
/// `{ a }` -- gets the tsgo id with this bit set, so no two Babel nodes share an
/// id and either still leads back to its tsgo node.
pub const SECOND_NODE: u32 = 1 << 31;

/// What a function, an arrow and a method have in common.
pub(super) struct FunctionParts {
    pub params: Vec<PatternLike>,
    pub is_async: bool,
    pub generator: bool,
    pub return_type: Option<RawNode>,
    pub type_parameters: Option<RawNode>,
}

enum BinaryKind {
    Binary(BinaryOperator),
    Logical(LogicalOperator),
    Assignment(AssignmentOperator),
    Comma,
}

impl Converter<'_> {
    pub(super) fn identifier(&self, id: NodeId) -> Identifier {
        Identifier { base: self.base(id), name: self.text_of(id), type_annotation: None, optional: None, decorators: None }
    }

    pub(super) fn function_parts(&self, id: NodeId) -> Converted<FunctionParts> {
        Ok(FunctionParts {
            params: self.list(id, "parameters").into_iter().map(|p| self.parameter(p)).collect::<Converted<_>>()?,
            is_async: self.has_modifier(id, k::ASYNC_KEYWORD),
            generator: self.child(id, "asteriskToken").is_some(),
            return_type: self.child(id, "type").map(|t| self.type_annotation(t)),
            type_parameters: self.type_parameters(id),
        })
    }

    fn arguments(&self, id: NodeId) -> Converted<Vec<Expression>> {
        self.list(id, "arguments").into_iter().map(|a| self.expression(a)).collect()
    }

    fn boxed(&self, id: NodeId, property: &str) -> Converted<Box<Expression>> {
        Ok(Box::new(self.expression(self.need(id, property)?)?))
    }

    fn in_optional_chain(&self, id: NodeId) -> bool {
        self.flags(id) & FLAG_OPTIONAL_CHAIN != 0
    }

    #[allow(clippy::too_many_lines)]
    pub(super) fn expression(&self, id: NodeId) -> Converted<Expression> {
        let base = self.base(id);
        Ok(match self.kind(id) {
            k::IDENTIFIER => Expression::Identifier(self.identifier(id)),
            k::PRIVATE_IDENTIFIER => Expression::PrivateName(PrivateName {
                base,
                id: Identifier {
                    base: self.base_span(id, self.start(id) + 1, self.end(id)),
                    name: self.text_of(id).trim_start_matches('#').to_owned(),
                    type_annotation: None,
                    optional: None,
                    decorators: None,
                },
            }),
            k::STRING_LITERAL => Expression::StringLiteral(StringLiteral { base, value: self.string_value(id) }),
            k::NUMERIC_LITERAL => {
                let raw = self.text.slice(self.start(id), self.end(id));
                let value = super::literal::numeric_value(&raw);
                Expression::NumericLiteral(NumericLiteral { base, value, extra: Some(NumericLiteralExtra { raw_value: Some(value), raw }) })
            }
            k::BIG_INT_LITERAL => {
                let raw = self.text.slice(self.start(id), self.end(id));
                Expression::BigIntLiteral(BigIntLiteral { base, value: raw.trim_end_matches('n').replace('_', "") })
            }
            k::REGULAR_EXPRESSION_LITERAL => {
                let raw = self.text.slice(self.start(id), self.end(id));
                let close = raw.rfind('/').unwrap_or(raw.len());
                Expression::RegExpLiteral(RegExpLiteral {
                    base,
                    pattern: raw.get(1..close).unwrap_or_default().to_owned(),
                    flags: raw.get(close + 1..).unwrap_or_default().to_owned(),
                })
            }
            k::TRUE_KEYWORD => Expression::BooleanLiteral(BooleanLiteral { base, value: true }),
            k::FALSE_KEYWORD => Expression::BooleanLiteral(BooleanLiteral { base, value: false }),
            k::NULL_KEYWORD => Expression::NullLiteral(NullLiteral { base }),
            k::THIS_KEYWORD => Expression::ThisExpression(ThisExpression { base }),
            k::SUPER_KEYWORD => Expression::Super(Super { base }),
            k::IMPORT_KEYWORD => Expression::Import(Import { base }),
            // Babel does not keep parentheses as nodes.
            k::PARENTHESIZED_EXPRESSION => self.expression(self.need(id, "expression")?)?,
            k::NO_SUBSTITUTION_TEMPLATE_LITERAL | k::TEMPLATE_EXPRESSION => Expression::TemplateLiteral(self.template(id)?),
            k::TAGGED_TEMPLATE_EXPRESSION => Expression::TaggedTemplateExpression(TaggedTemplateExpression {
                base,
                tag: self.boxed(id, "tag")?,
                quasi: self.template(self.need(id, "template")?)?,
                type_parameters: self.type_arguments(id),
            }),
            k::ARRAY_LITERAL_EXPRESSION => Expression::ArrayExpression(ArrayExpression {
                base,
                elements: self
                    .list(id, "elements")
                    .into_iter()
                    .map(|e| if self.kind(e) == k::OMITTED_EXPRESSION { Ok(None) } else { self.expression(e).map(Some) })
                    .collect::<Converted<_>>()?,
            }),
            k::OBJECT_LITERAL_EXPRESSION => Expression::ObjectExpression(ObjectExpression {
                base,
                properties: self.list(id, "properties").into_iter().map(|p| self.object_member(p)).collect::<Converted<_>>()?,
            }),
            k::SPREAD_ELEMENT => Expression::SpreadElement(SpreadElement { base, argument: self.boxed(id, "expression")? }),
            k::PROPERTY_ACCESS_EXPRESSION | k::ELEMENT_ACCESS_EXPRESSION => self.member(id)?,
            k::CALL_EXPRESSION => {
                let callee = self.boxed(id, "expression")?;
                let arguments = self.arguments(id)?;
                if self.in_optional_chain(id) {
                    Expression::OptionalCallExpression(OptionalCallExpression {
                        base,
                        callee,
                        arguments,
                        optional: self.child(id, "questionDotToken").is_some(),
                        type_parameters: self.type_arguments(id),
                        type_arguments: None,
                    })
                } else {
                    Expression::CallExpression(CallExpression {
                        base,
                        callee,
                        arguments,
                        type_parameters: self.type_arguments(id),
                        type_arguments: None,
                        optional: None,
                    })
                }
            }
            k::NEW_EXPRESSION => Expression::NewExpression(NewExpression {
                base,
                callee: self.boxed(id, "expression")?,
                arguments: self.arguments(id)?,
                type_parameters: self.type_arguments(id),
                type_arguments: None,
            }),
            k::PREFIX_UNARY_EXPRESSION => {
                let argument = self.boxed(id, "operand")?;
                match self.small(id) {
                    4 => Expression::UpdateExpression(UpdateExpression { base, operator: UpdateOperator::Increment, argument, prefix: true }),
                    5 => Expression::UpdateExpression(UpdateExpression { base, operator: UpdateOperator::Decrement, argument, prefix: true }),
                    operator => Expression::UnaryExpression(UnaryExpression {
                        base,
                        operator: match operator {
                            1 => UnaryOperator::Neg,
                            2 => UnaryOperator::BitNot,
                            3 => UnaryOperator::Not,
                            _ => UnaryOperator::Plus,
                        },
                        prefix: true,
                        argument,
                    }),
                }
            }
            k::POSTFIX_UNARY_EXPRESSION => Expression::UpdateExpression(UpdateExpression {
                base,
                operator: if self.small(id) == 1 { UpdateOperator::Decrement } else { UpdateOperator::Increment },
                argument: self.boxed(id, "operand")?,
                prefix: false,
            }),
            k::TYPE_OF_EXPRESSION | k::VOID_EXPRESSION | k::DELETE_EXPRESSION => Expression::UnaryExpression(UnaryExpression {
                base,
                operator: match self.kind(id) {
                    k::TYPE_OF_EXPRESSION => UnaryOperator::TypeOf,
                    k::VOID_EXPRESSION => UnaryOperator::Void,
                    _ => UnaryOperator::Delete,
                },
                prefix: true,
                argument: self.boxed(id, "expression")?,
            }),
            k::AWAIT_EXPRESSION => Expression::AwaitExpression(AwaitExpression { base, argument: self.boxed(id, "expression")? }),
            k::YIELD_EXPRESSION => Expression::YieldExpression(YieldExpression {
                base,
                argument: self.child(id, "expression").map(|e| self.expression(e).map(Box::new)).transpose()?,
                delegate: self.child(id, "asteriskToken").is_some(),
            }),
            k::BINARY_EXPRESSION => self.binary(id)?,
            k::CONDITIONAL_EXPRESSION => Expression::ConditionalExpression(ConditionalExpression {
                base,
                test: self.boxed(id, "condition")?,
                consequent: self.boxed(id, "whenTrue")?,
                alternate: self.boxed(id, "whenFalse")?,
            }),
            k::ARROW_FUNCTION => {
                let parts = self.function_parts(id)?;
                let body = self.need(id, "body")?;
                let block = self.kind(body) == k::BLOCK;
                Expression::ArrowFunctionExpression(ArrowFunctionExpression {
                    base,
                    params: parts.params,
                    body: Box::new(if block {
                        ArrowFunctionBody::BlockStatement(self.function_body(body)?)
                    } else {
                        ArrowFunctionBody::Expression(Box::new(self.expression(body)?))
                    }),
                    id: None,
                    generator: false,
                    is_async: parts.is_async,
                    // An ESTree field; Babel's parser leaves it unset.
                    expression: None,
                    return_type: parts.return_type,
                    type_parameters: parts.type_parameters,
                    predicate: None,
                })
            }
            k::FUNCTION_EXPRESSION => {
                let parts = self.function_parts(id)?;
                Expression::FunctionExpression(FunctionExpression {
                    base,
                    params: parts.params,
                    body: self.function_body(self.need(id, "body")?)?,
                    id: self.child(id, "name").map(|n| self.identifier(n)),
                    generator: parts.generator,
                    is_async: parts.is_async,
                    return_type: parts.return_type,
                    type_parameters: parts.type_parameters,
                    predicate: None,
                })
            }
            k::CLASS_EXPRESSION => Expression::ClassExpression(ClassExpression {
                base,
                id: self.child(id, "name").map(|n| self.identifier(n)),
                super_class: self.super_class(id)?,
                body: self.class_body(id)?,
                decorators: None,
                implements: None,
                super_type_parameters: None,
                type_parameters: self.type_parameters(id),
            }),
            k::AS_EXPRESSION => Expression::TSAsExpression(TSAsExpression {
                base,
                expression: self.boxed(id, "expression")?,
                type_annotation: self.type_node(self.need(id, "type")?),
            }),
            k::SATISFIES_EXPRESSION => Expression::TSSatisfiesExpression(TSSatisfiesExpression {
                base,
                expression: self.boxed(id, "expression")?,
                type_annotation: self.type_node(self.need(id, "type")?),
            }),
            k::TYPE_ASSERTION_EXPRESSION => Expression::TSTypeAssertion(TSTypeAssertion {
                base,
                expression: self.boxed(id, "expression")?,
                type_annotation: self.type_node(self.need(id, "type")?),
            }),
            k::NON_NULL_EXPRESSION => Expression::TSNonNullExpression(TSNonNullExpression { base, expression: self.boxed(id, "expression")? }),
            k::EXPRESSION_WITH_TYPE_ARGUMENTS => Expression::TSInstantiationExpression(TSInstantiationExpression {
                base,
                expression: self.boxed(id, "expression")?,
                type_parameters: self.type_arguments(id).ok_or_else(|| self.unsupported(id, "an instantiation without type arguments"))?,
            }),
            k::META_PROPERTY => {
                let meta_start = self.start(id);
                let (meta, length) = if self.small(id) == 1 { ("new", 3) } else { ("import", 6) };
                Expression::MetaProperty(MetaProperty {
                    base,
                    meta: Identifier {
                        base: self.base_span(id, meta_start, meta_start + length),
                        name: meta.to_owned(),
                        type_annotation: None,
                        optional: None,
                        decorators: None,
                    },
                    property: self.identifier(self.need(id, "name")?),
                })
            }
            k::JSX_ELEMENT | k::JSX_SELF_CLOSING_ELEMENT => Expression::JSXElement(Box::new(self.jsx_element(id)?)),
            k::JSX_FRAGMENT => Expression::JSXFragment(self.jsx_fragment(id)?),
            _ => return Err(self.unsupported(id, "an expression this converter does not know")),
        })
    }

    /// `a.b`, `a[b]`, and their optional-chain forms. In Babel every link of a
    /// chain after its `?.` is an `OptionalMemberExpression`; tsgo marks those
    /// links with the `OptionalChain` flag.
    fn member(&self, id: NodeId) -> Converted<Expression> {
        let base = self.base(id);
        let object = self.boxed(id, "expression")?;
        let (property, computed) = if self.kind(id) == k::PROPERTY_ACCESS_EXPRESSION {
            (self.boxed(id, "name")?, false)
        } else {
            (self.boxed(id, "argumentExpression")?, true)
        };
        Ok(if self.in_optional_chain(id) {
            Expression::OptionalMemberExpression(OptionalMemberExpression {
                base,
                object,
                property,
                computed,
                optional: self.child(id, "questionDotToken").is_some(),
            })
        } else {
            Expression::MemberExpression(MemberExpression { base, object, property, computed })
        })
    }

    fn binary_kind(&self, operator: NodeId) -> Option<BinaryKind> {
        use AssignmentOperator as A;
        use BinaryOperator as B;
        use LogicalOperator as L;
        Some(match self.kind(operator) {
            k::PLUS_TOKEN => BinaryKind::Binary(B::Add),
            k::MINUS_TOKEN => BinaryKind::Binary(B::Sub),
            k::ASTERISK_TOKEN => BinaryKind::Binary(B::Mul),
            k::SLASH_TOKEN => BinaryKind::Binary(B::Div),
            k::PERCENT_TOKEN => BinaryKind::Binary(B::Rem),
            k::ASTERISK_ASTERISK_TOKEN => BinaryKind::Binary(B::Exp),
            k::EQUALS_EQUALS_TOKEN => BinaryKind::Binary(B::Eq),
            k::EQUALS_EQUALS_EQUALS_TOKEN => BinaryKind::Binary(B::StrictEq),
            k::EXCLAMATION_EQUALS_TOKEN => BinaryKind::Binary(B::Neq),
            k::EXCLAMATION_EQUALS_EQUALS_TOKEN => BinaryKind::Binary(B::StrictNeq),
            k::LESS_THAN_TOKEN => BinaryKind::Binary(B::Lt),
            k::LESS_THAN_EQUALS_TOKEN => BinaryKind::Binary(B::Lte),
            k::GREATER_THAN_TOKEN => BinaryKind::Binary(B::Gt),
            k::GREATER_THAN_EQUALS_TOKEN => BinaryKind::Binary(B::Gte),
            k::LESS_THAN_LESS_THAN_TOKEN => BinaryKind::Binary(B::Shl),
            k::GREATER_THAN_GREATER_THAN_TOKEN => BinaryKind::Binary(B::Shr),
            k::GREATER_THAN_GREATER_THAN_GREATER_THAN_TOKEN => BinaryKind::Binary(B::UShr),
            k::BAR_TOKEN => BinaryKind::Binary(B::BitOr),
            k::CARET_TOKEN => BinaryKind::Binary(B::BitXor),
            k::AMPERSAND_TOKEN => BinaryKind::Binary(B::BitAnd),
            k::IN_KEYWORD => BinaryKind::Binary(B::In),
            k::INSTANCE_OF_KEYWORD => BinaryKind::Binary(B::Instanceof),
            k::BAR_BAR_TOKEN => BinaryKind::Logical(L::Or),
            k::AMPERSAND_AMPERSAND_TOKEN => BinaryKind::Logical(L::And),
            k::QUESTION_QUESTION_TOKEN => BinaryKind::Logical(L::NullishCoalescing),
            k::EQUALS_TOKEN => BinaryKind::Assignment(A::Assign),
            k::PLUS_EQUALS_TOKEN => BinaryKind::Assignment(A::AddAssign),
            k::MINUS_EQUALS_TOKEN => BinaryKind::Assignment(A::SubAssign),
            k::ASTERISK_EQUALS_TOKEN => BinaryKind::Assignment(A::MulAssign),
            k::SLASH_EQUALS_TOKEN => BinaryKind::Assignment(A::DivAssign),
            k::PERCENT_EQUALS_TOKEN => BinaryKind::Assignment(A::RemAssign),
            k::ASTERISK_ASTERISK_EQUALS_TOKEN => BinaryKind::Assignment(A::ExpAssign),
            k::LESS_THAN_LESS_THAN_EQUALS_TOKEN => BinaryKind::Assignment(A::ShlAssign),
            k::GREATER_THAN_GREATER_THAN_EQUALS_TOKEN => BinaryKind::Assignment(A::ShrAssign),
            k::GREATER_THAN_GREATER_THAN_GREATER_THAN_EQUALS_TOKEN => BinaryKind::Assignment(A::UShrAssign),
            k::BAR_EQUALS_TOKEN => BinaryKind::Assignment(A::BitOrAssign),
            k::CARET_EQUALS_TOKEN => BinaryKind::Assignment(A::BitXorAssign),
            k::AMPERSAND_EQUALS_TOKEN => BinaryKind::Assignment(A::BitAndAssign),
            k::BAR_BAR_EQUALS_TOKEN => BinaryKind::Assignment(A::OrAssign),
            k::AMPERSAND_AMPERSAND_EQUALS_TOKEN => BinaryKind::Assignment(A::AndAssign),
            k::QUESTION_QUESTION_EQUALS_TOKEN => BinaryKind::Assignment(A::NullishAssign),
            k::COMMA_TOKEN => BinaryKind::Comma,
            _ => return None,
        })
    }

    fn binary(&self, id: NodeId) -> Converted<Expression> {
        let base = self.base(id);
        let operator = self.need(id, "operatorToken")?;
        let kind = self.binary_kind(operator).ok_or_else(|| self.unsupported(operator, "a binary operator this converter does not know"))?;
        let left = self.need(id, "left")?;
        let right = self.need(id, "right")?;
        Ok(match kind {
            BinaryKind::Binary(operator) => Expression::BinaryExpression(BinaryExpression {
                base,
                operator,
                left: Box::new(self.expression(left)?),
                right: Box::new(self.expression(right)?),
            }),
            BinaryKind::Logical(operator) => Expression::LogicalExpression(LogicalExpression {
                base,
                operator,
                left: Box::new(self.expression(left)?),
                right: Box::new(self.expression(right)?),
            }),
            BinaryKind::Assignment(operator) => Expression::AssignmentExpression(AssignmentExpression {
                base,
                operator,
                left: Box::new(self.assignment_target(left)?),
                right: Box::new(self.expression(right)?),
            }),
            BinaryKind::Comma => {
                // `a, b, c` nests to the left in tsgo; Babel flattens it.
                let mut expressions = match self.expression(left)? {
                    Expression::SequenceExpression(sequence) if self.kind(left) != k::PARENTHESIZED_EXPRESSION => sequence.expressions,
                    other => vec![other],
                };
                expressions.push(self.expression(right)?);
                Expression::SequenceExpression(SequenceExpression { base, expressions })
            }
        })
    }

    /// A template literal, its pieces spanning what lies between the backticks
    /// and the `${`/`}` delimiters, as Babel's `TemplateElement`s do.
    fn template(&self, id: NodeId) -> Converted<TemplateLiteral> {
        let base = self.base(id);
        if self.kind(id) == k::NO_SUBSTITUTION_TEMPLATE_LITERAL {
            return Ok(TemplateLiteral { base, quasis: vec![self.template_element(id, true)], expressions: Vec::new() });
        }
        let mut quasis = vec![self.template_element(self.need(id, "head")?, false)];
        let mut expressions = Vec::new();
        for span in self.list(id, "templateSpans") {
            expressions.push(self.expression(self.need(span, "expression")?)?);
            let literal = self.need(span, "literal")?;
            quasis.push(self.template_element(literal, self.kind(literal) == k::TEMPLATE_TAIL));
        }
        Ok(TemplateLiteral { base, quasis, expressions })
    }

    fn template_element(&self, id: NodeId, tail: bool) -> TemplateElement {
        let start = self.start(id) + 1;
        let end = self.end(id).saturating_sub(if tail { 1 } else { 2 }).max(start);
        TemplateElement {
            base: self.base_span(id, start, end),
            value: TemplateElementValue { raw: self.text.slice(start, end), cooked: Some(self.text_of(id)) },
            tail,
        }
    }

    /// A property name as Babel keys an object member: the key and whether it
    /// is computed.
    pub(super) fn property_key(&self, name: NodeId) -> Converted<(Box<Expression>, bool)> {
        if self.kind(name) == k::COMPUTED_PROPERTY_NAME {
            Ok((self.boxed(name, "expression")?, true))
        } else {
            Ok((Box::new(self.expression(name)?), false))
        }
    }

    fn object_member(&self, id: NodeId) -> Converted<ObjectExpressionProperty> {
        let base = self.base(id);
        Ok(match self.kind(id) {
            k::PROPERTY_ASSIGNMENT => {
                let (key, computed) = self.property_key(self.need(id, "name")?)?;
                ObjectExpressionProperty::ObjectProperty(ObjectProperty {
                    base,
                    key,
                    value: self.boxed(id, "initializer")?,
                    computed,
                    shorthand: false,
                    decorators: None,
                    method: Some(false),
                })
            }
            k::SHORTHAND_PROPERTY_ASSIGNMENT => {
                let name = self.need(id, "name")?;
                let key = self.identifier(name);
                let mut value = self.identifier(name);
                value.base.node_id = Some(name.0 | SECOND_NODE);
                ObjectExpressionProperty::ObjectProperty(ObjectProperty {
                    base,
                    key: Box::new(Expression::Identifier(key)),
                    value: Box::new(Expression::Identifier(value)),
                    computed: false,
                    shorthand: true,
                    decorators: None,
                    method: Some(false),
                })
            }
            k::SPREAD_ASSIGNMENT => ObjectExpressionProperty::SpreadElement(SpreadElement { base, argument: self.boxed(id, "expression")? }),
            k::METHOD_DECLARATION | k::GET_ACCESSOR | k::SET_ACCESSOR => {
                let (key, computed) = self.property_key(self.need(id, "name")?)?;
                let parts = self.function_parts(id)?;
                ObjectExpressionProperty::ObjectMethod(ObjectMethod {
                    base,
                    method: self.kind(id) == k::METHOD_DECLARATION,
                    kind: match self.kind(id) {
                        k::GET_ACCESSOR => ObjectMethodKind::Get,
                        k::SET_ACCESSOR => ObjectMethodKind::Set,
                        _ => ObjectMethodKind::Method,
                    },
                    key,
                    params: parts.params,
                    body: self.function_body(self.need(id, "body")?)?,
                    computed,
                    id: None,
                    generator: parts.generator,
                    is_async: parts.is_async,
                    decorators: None,
                    return_type: parts.return_type,
                    type_parameters: parts.type_parameters,
                    predicate: None,
                })
            }
            _ => return Err(self.unsupported(id, "an object member this converter does not know")),
        })
    }
}
