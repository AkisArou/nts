//! JSX elements, fragments, attributes and children.

use nts_semantic_schema::NodeId;
use react_compiler_ast::jsx::{
    JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXChild, JSXClosingElement, JSXClosingFragment,
    JSXElement, JSXElementName, JSXEmptyExpression, JSXExpressionContainer, JSXExpressionContainerExpr, JSXFragment,
    JSXIdentifier, JSXMemberExprObject, JSXMemberExpression, JSXNamespacedName, JSXOpeningElement, JSXOpeningFragment,
    JSXSpreadAttribute, JSXSpreadChild, JSXText,
};
use react_compiler_ast::literals::StringLiteral;

use super::{Converted, Converter, k};

impl Converter<'_> {
    pub(super) fn jsx_element(&self, id: NodeId) -> Converted<JSXElement> {
        let base = self.base(id);
        if self.kind(id) == k::JSX_SELF_CLOSING_ELEMENT {
            return Ok(JSXElement {
                base: base.clone(),
                opening_element: JSXOpeningElement {
                    base,
                    name: self.jsx_name(self.need(id, "tagName")?)?,
                    attributes: self.jsx_attributes(id)?,
                    self_closing: true,
                    type_parameters: self.type_arguments(id),
                },
                closing_element: None,
                children: Vec::new(),
                self_closing: None,
            });
        }
        let opening = self.need(id, "openingElement")?;
        let closing = self.need(id, "closingElement")?;
        Ok(JSXElement {
            base,
            opening_element: JSXOpeningElement {
                base: self.base(opening),
                name: self.jsx_name(self.need(opening, "tagName")?)?,
                attributes: self.jsx_attributes(opening)?,
                self_closing: false,
                type_parameters: self.type_arguments(opening),
            },
            closing_element: Some(JSXClosingElement { base: self.base(closing), name: self.jsx_name(self.need(closing, "tagName")?)? }),
            children: self.jsx_children(id)?,
            self_closing: None,
        })
    }

    pub(super) fn jsx_fragment(&self, id: NodeId) -> Converted<JSXFragment> {
        Ok(JSXFragment {
            base: self.base(id),
            opening_fragment: JSXOpeningFragment { base: self.base(self.need(id, "openingFragment")?) },
            closing_fragment: JSXClosingFragment { base: self.base(self.need(id, "closingFragment")?) },
            children: self.jsx_children(id)?,
        })
    }

    fn jsx_identifier(&self, id: NodeId) -> JSXIdentifier {
        let name = if self.kind(id) == k::THIS_KEYWORD { "this".to_owned() } else { self.text_of(id) };
        JSXIdentifier { base: self.base(id), name }
    }

    fn jsx_name(&self, id: NodeId) -> Converted<JSXElementName> {
        Ok(match self.kind(id) {
            k::IDENTIFIER | k::THIS_KEYWORD => JSXElementName::JSXIdentifier(self.jsx_identifier(id)),
            k::PROPERTY_ACCESS_EXPRESSION => JSXElementName::JSXMemberExpression(self.jsx_member(id)?),
            k::JSX_NAMESPACED_NAME => JSXElementName::JSXNamespacedName(self.jsx_namespaced(id)?),
            _ => return Err(self.unsupported(id, "a JSX tag name this converter does not know")),
        })
    }

    fn jsx_member(&self, id: NodeId) -> Converted<JSXMemberExpression> {
        let object = self.need(id, "expression")?;
        Ok(JSXMemberExpression {
            base: self.base(id),
            object: Box::new(if self.kind(object) == k::PROPERTY_ACCESS_EXPRESSION {
                JSXMemberExprObject::JSXMemberExpression(Box::new(self.jsx_member(object)?))
            } else {
                JSXMemberExprObject::JSXIdentifier(self.jsx_identifier(object))
            }),
            property: self.jsx_identifier(self.need(id, "name")?),
        })
    }

    fn jsx_namespaced(&self, id: NodeId) -> Converted<JSXNamespacedName> {
        Ok(JSXNamespacedName {
            base: self.base(id),
            namespace: self.jsx_identifier(self.need(id, "namespace")?),
            name: self.jsx_identifier(self.need(id, "name")?),
        })
    }

    /// The attributes of an opening or self-closing element.
    fn jsx_attributes(&self, element: NodeId) -> Converted<Vec<JSXAttributeItem>> {
        let Some(attributes) = self.child(element, "attributes") else {
            return Ok(Vec::new());
        };
        self.list(attributes, "properties")
            .into_iter()
            .map(|attribute| {
                if self.kind(attribute) == k::JSX_SPREAD_ATTRIBUTE {
                    return Ok(JSXAttributeItem::JSXSpreadAttribute(JSXSpreadAttribute {
                        base: self.base(attribute),
                        argument: Box::new(self.expression(self.need(attribute, "expression")?)?),
                    }));
                }
                let name = self.need(attribute, "name")?;
                let name = if self.kind(name) == k::JSX_NAMESPACED_NAME {
                    JSXAttributeName::JSXNamespacedName(self.jsx_namespaced(name)?)
                } else {
                    JSXAttributeName::JSXIdentifier(self.jsx_identifier(name))
                };
                let value = self
                    .child(attribute, "initializer")
                    .map(|value| {
                        Converted::Ok(match self.kind(value) {
                            // JSX strings take no escapes: the value is the text between the quotes.
                            k::STRING_LITERAL => JSXAttributeValue::StringLiteral(StringLiteral {
                                base: self.base(value),
                                value: self.text.slice(self.start(value) + 1, self.end(value).saturating_sub(1)).into(),
                            }),
                            k::JSX_EXPRESSION => JSXAttributeValue::JSXExpressionContainer(self.jsx_container(value)?),
                            k::JSX_ELEMENT | k::JSX_SELF_CLOSING_ELEMENT => JSXAttributeValue::JSXElement(Box::new(self.jsx_element(value)?)),
                            k::JSX_FRAGMENT => JSXAttributeValue::JSXFragment(self.jsx_fragment(value)?),
                            _ => return Err(self.unsupported(value, "a JSX attribute value this converter does not know")),
                        })
                    })
                    .transpose()?;
                Ok(JSXAttributeItem::JSXAttribute(JSXAttribute { base: self.base(attribute), name, value }))
            })
            .collect()
    }

    /// `{expression}`, or `{}` holding nothing but, perhaps, a comment.
    fn jsx_container(&self, id: NodeId) -> Converted<JSXExpressionContainer> {
        let expression = if let Some(expression) = self.child(id, "expression") {
            JSXExpressionContainerExpr::Expression(Box::new(self.expression(expression)?))
        } else {
            // Babel's empty expression spans the inside of the braces.
            let (start, end) = (self.start(id) + 1, self.end(id).saturating_sub(1));
            JSXExpressionContainerExpr::JSXEmptyExpression(JSXEmptyExpression { base: self.base_span(id, start, end.max(start)) })
        };
        Ok(JSXExpressionContainer { base: self.base(id), expression })
    }

    fn jsx_children(&self, id: NodeId) -> Converted<Vec<JSXChild>> {
        self.list(id, "children")
            .into_iter()
            .map(|child| {
                Ok(match self.kind(child) {
                    k::JSX_TEXT => JSXChild::JSXText(JSXText { base: self.base(child), value: self.text_of(child) }),
                    k::JSX_ELEMENT | k::JSX_SELF_CLOSING_ELEMENT => JSXChild::JSXElement(Box::new(self.jsx_element(child)?)),
                    k::JSX_FRAGMENT => JSXChild::JSXFragment(self.jsx_fragment(child)?),
                    k::JSX_EXPRESSION if self.child(child, "dotDotDotToken").is_some() => JSXChild::JSXSpreadChild(JSXSpreadChild {
                        base: self.base(child),
                        expression: Box::new(self.expression(self.need(child, "expression")?)?),
                    }),
                    k::JSX_EXPRESSION => JSXChild::JSXExpressionContainer(self.jsx_container(child)?),
                    _ => return Err(self.unsupported(child, "a JSX child this converter does not know")),
                })
            })
            .collect()
    }
}
