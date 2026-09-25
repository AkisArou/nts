//! Binding and assignment targets: parameters, declarators, destructuring.

use nts_semantic_schema::NodeId;
use react_compiler_ast::expressions::{Expression, Identifier, TSAsExpression, TSNonNullExpression, TSSatisfiesExpression, TSTypeAssertion};
use react_compiler_ast::patterns::{
    ArrayPattern, AssignmentPattern, ObjectPattern, ObjectPatternProp, ObjectPatternProperty, PatternLike, RestElement,
};

use super::expr::SECOND_NODE;
use super::{Converted, Converter, k};

impl Converter<'_> {
    /// A function parameter: its name or pattern, with its annotation, `?`,
    /// default and `...` placed as Babel places them.
    pub(super) fn parameter(&self, id: NodeId) -> Converted<PatternLike> {
        let name = self.need(id, "name")?;
        let annotation = self.child(id, "type");
        let (start, end) = (self.start(id), self.end(id));
        if self.child(id, "dotDotDotToken").is_some() {
            // Babel puts a rest parameter's annotation on the rest element.
            return Ok(PatternLike::RestElement(RestElement {
                base: self.base_span(id, start, end),
                argument: Box::new(self.binding_target(name, None)?),
                type_annotation: annotation.map(|t| self.type_annotation(t)),
                decorators: None,
            }));
        }
        let mut target = self.binding_target(name, annotation)?;
        if let Some(question) = self.child(id, "questionToken")
            && let PatternLike::Identifier(identifier) = &mut target
        {
            identifier.optional = Some(true);
            // The `?` sits between the name and its annotation, so an
            // unannotated optional identifier ends after it.
            if annotation.is_none() {
                identifier.base = self.base_span(name, self.start(name), self.end(question));
            }
        }
        let Some(initializer) = self.child(id, "initializer") else {
            return Ok(target);
        };
        Ok(PatternLike::AssignmentPattern(AssignmentPattern {
            base: self.base_span(id, start, end),
            left: Box::new(target),
            right: Box::new(self.expression(initializer)?),
            type_annotation: None,
            decorators: None,
        }))
    }

    /// A declared name or binding pattern. Babel's identifier spans its
    /// annotation (and a definite `!`), so its end is the annotation's.
    pub(super) fn binding_target(&self, name: NodeId, annotation: Option<NodeId>) -> Converted<PatternLike> {
        let end = annotation.map_or_else(|| self.end(name), |t| self.end(t));
        let base = self.base_span(name, self.start(name), end);
        let type_annotation = annotation.map(|t| self.type_annotation(t));
        Ok(match self.kind(name) {
            k::IDENTIFIER => PatternLike::Identifier(Identifier { base, name: self.text_of(name), type_annotation, optional: None, decorators: None }),
            k::OBJECT_BINDING_PATTERN => PatternLike::ObjectPattern(ObjectPattern {
                base,
                properties: self.list(name, "elements").into_iter().map(|e| self.object_binding_element(e)).collect::<Converted<_>>()?,
                type_annotation,
                decorators: None,
            }),
            k::ARRAY_BINDING_PATTERN => PatternLike::ArrayPattern(ArrayPattern {
                base,
                elements: self
                    .list(name, "elements")
                    .into_iter()
                    .map(|e| if self.kind(e) == k::OMITTED_EXPRESSION { Ok(None) } else { self.array_binding_element(e).map(Some) })
                    .collect::<Converted<_>>()?,
                type_annotation,
                decorators: None,
            }),
            _ => return Err(self.unsupported(name, "a binding name this converter does not know")),
        })
    }

    /// A target with its default, if the element has one.
    fn with_default(&self, element: NodeId, target: PatternLike, start: u32) -> Converted<PatternLike> {
        let Some(initializer) = self.child(element, "initializer") else {
            return Ok(target);
        };
        Ok(PatternLike::AssignmentPattern(AssignmentPattern {
            base: self.base_span(element, start, self.end(element)),
            left: Box::new(target),
            right: Box::new(self.expression(initializer)?),
            type_annotation: None,
            decorators: None,
        }))
    }

    fn object_binding_element(&self, element: NodeId) -> Converted<ObjectPatternProperty> {
        let name = self.need(element, "name")?;
        if self.child(element, "dotDotDotToken").is_some() {
            return Ok(ObjectPatternProperty::RestElement(RestElement {
                base: self.base(element),
                argument: Box::new(self.binding_target(name, None)?),
                type_annotation: None,
                decorators: None,
            }));
        }
        let property = self.child(element, "propertyName");
        let target = self.binding_target(name, None)?;
        let value = self.with_default(element, target, self.start(name))?;
        let (key, computed, shorthand) = if let Some(property) = property {
            let (key, computed) = self.property_key(property)?;
            (key, computed, false)
        } else {
            // `{ a }`: the key is a second Babel node for the same name.
            let mut key = self.identifier(name);
            key.base.node_id = Some(name.0 | SECOND_NODE);
            (Box::new(Expression::Identifier(key)), false, true)
        };
        Ok(ObjectPatternProperty::ObjectProperty(ObjectPatternProp {
            base: self.base(element),
            key,
            value: Box::new(value),
            computed,
            shorthand,
            decorators: None,
            method: Some(false),
        }))
    }

    fn array_binding_element(&self, element: NodeId) -> Converted<PatternLike> {
        let name = self.need(element, "name")?;
        let target = self.binding_target(name, None)?;
        if self.child(element, "dotDotDotToken").is_some() {
            return Ok(PatternLike::RestElement(RestElement {
                base: self.base(element),
                argument: Box::new(target),
                type_annotation: None,
                decorators: None,
            }));
        }
        self.with_default(element, target, self.start(element))
    }

    /// The left of an assignment or a `for…of` written as an expression:
    /// object and array literals there are destructuring patterns.
    #[allow(clippy::too_many_lines)]
    pub(super) fn assignment_target(&self, id: NodeId) -> Converted<PatternLike> {
        let base = self.base(id);
        Ok(match self.kind(id) {
            k::IDENTIFIER => PatternLike::Identifier(self.identifier(id)),
            k::PARENTHESIZED_EXPRESSION => self.assignment_target(self.need(id, "expression")?)?,
            k::PROPERTY_ACCESS_EXPRESSION | k::ELEMENT_ACCESS_EXPRESSION => match self.expression(id)? {
                Expression::MemberExpression(member) => PatternLike::MemberExpression(member),
                _ => return Err(self.unsupported(id, "an optional chain as an assignment target")),
            },
            k::NON_NULL_EXPRESSION => PatternLike::TSNonNullExpression(TSNonNullExpression {
                base,
                expression: Box::new(self.expression(self.need(id, "expression")?)?),
            }),
            k::AS_EXPRESSION => PatternLike::TSAsExpression(TSAsExpression {
                base,
                expression: Box::new(self.expression(self.need(id, "expression")?)?),
                type_annotation: self.type_node(self.need(id, "type")?),
            }),
            k::SATISFIES_EXPRESSION => PatternLike::TSSatisfiesExpression(TSSatisfiesExpression {
                base,
                expression: Box::new(self.expression(self.need(id, "expression")?)?),
                type_annotation: self.type_node(self.need(id, "type")?),
            }),
            k::TYPE_ASSERTION_EXPRESSION => PatternLike::TSTypeAssertion(TSTypeAssertion {
                base,
                expression: Box::new(self.expression(self.need(id, "expression")?)?),
                type_annotation: self.type_node(self.need(id, "type")?),
            }),
            k::ARRAY_LITERAL_EXPRESSION => PatternLike::ArrayPattern(ArrayPattern {
                base,
                elements: self
                    .list(id, "elements")
                    .into_iter()
                    .map(|element| match self.kind(element) {
                        k::OMITTED_EXPRESSION => Ok(None),
                        k::SPREAD_ELEMENT => Ok(Some(PatternLike::RestElement(RestElement {
                            base: self.base(element),
                            argument: Box::new(self.assignment_target(self.need(element, "expression")?)?),
                            type_annotation: None,
                            decorators: None,
                        }))),
                        _ => self.target_with_default(element).map(Some),
                    })
                    .collect::<Converted<_>>()?,
                type_annotation: None,
                decorators: None,
            }),
            k::OBJECT_LITERAL_EXPRESSION => PatternLike::ObjectPattern(ObjectPattern {
                base,
                properties: self.list(id, "properties").into_iter().map(|p| self.object_target_member(p)).collect::<Converted<_>>()?,
                type_annotation: None,
                decorators: None,
            }),
            _ => return Err(self.unsupported(id, "an assignment target this converter does not know")),
        })
    }

    /// An element of an array or object target: `a = 1` there is a default.
    fn target_with_default(&self, id: NodeId) -> Converted<PatternLike> {
        if self.kind(id) == k::BINARY_EXPRESSION
            && self.child(id, "operatorToken").is_some_and(|o| self.kind(o) == k::EQUALS_TOKEN)
        {
            return Ok(PatternLike::AssignmentPattern(AssignmentPattern {
                base: self.base(id),
                left: Box::new(self.assignment_target(self.need(id, "left")?)?),
                right: Box::new(self.expression(self.need(id, "right")?)?),
                type_annotation: None,
                decorators: None,
            }));
        }
        self.assignment_target(id)
    }

    fn object_target_member(&self, id: NodeId) -> Converted<ObjectPatternProperty> {
        let base = self.base(id);
        Ok(match self.kind(id) {
            k::SPREAD_ASSIGNMENT => ObjectPatternProperty::RestElement(RestElement {
                base,
                argument: Box::new(self.assignment_target(self.need(id, "expression")?)?),
                type_annotation: None,
                decorators: None,
            }),
            k::PROPERTY_ASSIGNMENT => {
                let (key, computed) = self.property_key(self.need(id, "name")?)?;
                ObjectPatternProperty::ObjectProperty(ObjectPatternProp {
                    base,
                    key,
                    value: Box::new(self.target_with_default(self.need(id, "initializer")?)?),
                    computed,
                    shorthand: false,
                    decorators: None,
                    method: Some(false),
                })
            }
            k::SHORTHAND_PROPERTY_ASSIGNMENT => {
                let name = self.need(id, "name")?;
                let mut key = self.identifier(name);
                key.base.node_id = Some(name.0 | SECOND_NODE);
                let target = PatternLike::Identifier(self.identifier(name));
                let value = match self.child(id, "objectAssignmentInitializer") {
                    Some(initializer) => PatternLike::AssignmentPattern(AssignmentPattern {
                        base: self.base_span(id, self.start(name), self.end(id)),
                        left: Box::new(target),
                        right: Box::new(self.expression(initializer)?),
                        type_annotation: None,
                        decorators: None,
                    }),
                    None => target,
                };
                ObjectPatternProperty::ObjectProperty(ObjectPatternProp {
                    base,
                    key: Box::new(Expression::Identifier(key)),
                    value: Box::new(value),
                    computed: false,
                    shorthand: true,
                    decorators: None,
                    method: Some(false),
                })
            }
            _ => return Err(self.unsupported(id, "a destructuring member this converter does not know")),
        })
    }
}
