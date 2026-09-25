//! Types, which the compiler takes as raw Babel JSON.
//!
//! The compiler reads little of a type: its Babel node name (to tell a
//! primitive from an object, or `Array`), and a type reference's name. Each is
//! emitted with its span too, which is what lets the output printer copy the
//! type the user wrote back from the source.

use nts_semantic_schema::NodeId;
use react_compiler_ast::common::RawNode;
use serde_json::{Value, json};

use super::{Converter, k};

impl Converter<'_> {
    fn raw_value(&self, type_name: &str, id: NodeId, start: u32, end: u32) -> serde_json::Map<String, Value> {
        let mut node = serde_json::Map::new();
        node.insert("type".to_owned(), json!(type_name));
        node.insert("start".to_owned(), json!(start));
        node.insert("end".to_owned(), json!(end));
        node.insert("loc".to_owned(), serde_json::to_value(self.text.location(start, end)).unwrap_or(Value::Null));
        node.insert("_nodeId".to_owned(), json!(id.0));
        node
    }

    /// An opaque node of `type_name` spanning the tsgo node `id`.
    pub(super) fn raw(&self, type_name: &str, id: NodeId) -> RawNode {
        self.raw_span(type_name, id, self.start(id), self.end(id))
    }

    pub(super) fn raw_span(&self, type_name: &str, id: NodeId, start: u32, end: u32) -> RawNode {
        RawNode::from_value(&Value::Object(self.raw_value(type_name, id, start, end)))
    }

    /// A type node, as Babel names it.
    pub(super) fn type_node(&self, id: NodeId) -> RawNode {
        RawNode::from_value(&self.type_value(id))
    }

    fn type_value(&self, id: NodeId) -> Value {
        let kind = self.kind(id);
        // Babel does not keep parentheses around a type as a node.
        if kind == k::PARENTHESIZED_TYPE
            && let Some(inner) = self.child(id, "type")
        {
            return self.type_value(inner);
        }
        let name = match kind {
            k::STRING_KEYWORD => "TSStringKeyword",
            k::NUMBER_KEYWORD => "TSNumberKeyword",
            k::BOOLEAN_KEYWORD => "TSBooleanKeyword",
            k::BIG_INT_KEYWORD => "TSBigIntKeyword",
            k::SYMBOL_KEYWORD => "TSSymbolKeyword",
            k::OBJECT_KEYWORD => "TSObjectKeyword",
            k::ANY_KEYWORD => "TSAnyKeyword",
            k::UNKNOWN_KEYWORD => "TSUnknownKeyword",
            k::NEVER_KEYWORD => "TSNeverKeyword",
            k::VOID_KEYWORD => "TSVoidKeyword",
            k::UNDEFINED_KEYWORD => "TSUndefinedKeyword",
            k::INTRINSIC_KEYWORD => "TSIntrinsicKeyword",
            k::THIS_TYPE => "TSThisType",
            k::TYPE_REFERENCE => "TSTypeReference",
            k::ARRAY_TYPE => "TSArrayType",
            k::TUPLE_TYPE => "TSTupleType",
            k::UNION_TYPE => "TSUnionType",
            k::INTERSECTION_TYPE => "TSIntersectionType",
            k::FUNCTION_TYPE => "TSFunctionType",
            k::CONSTRUCTOR_TYPE => "TSConstructorType",
            k::TYPE_LITERAL => "TSTypeLiteral",
            // `null` is a literal type in tsgo and a keyword in Babel.
            k::LITERAL_TYPE if self.child(id, "literal").is_some_and(|l| self.kind(l) == k::NULL_KEYWORD) => "TSNullKeyword",
            k::LITERAL_TYPE => "TSLiteralType",
            k::TYPE_OPERATOR => "TSTypeOperator",
            k::INDEXED_ACCESS_TYPE => "TSIndexedAccessType",
            k::TYPE_QUERY => "TSTypeQuery",
            k::CONDITIONAL_TYPE => "TSConditionalType",
            k::INFER_TYPE => "TSInferType",
            k::MAPPED_TYPE => "TSMappedType",
            k::IMPORT_TYPE => "TSImportType",
            k::TEMPLATE_LITERAL_TYPE => "TSTemplateLiteralType",
            k::TYPE_PREDICATE => "TSTypePredicate",
            k::OPTIONAL_TYPE => "TSOptionalType",
            k::REST_TYPE => "TSRestType",
            k::NAMED_TUPLE_MEMBER => "TSNamedTupleMember",
            k::EXPRESSION_WITH_TYPE_ARGUMENTS => "TSExpressionWithTypeArguments",
            _ => "TSUnknownType",
        };
        let mut node = self.raw_value(name, id, self.start(id), self.end(id));
        if kind == k::TYPE_REFERENCE {
            if let Some(type_name) = self.child(id, "typeName") {
                node.insert("typeName".to_owned(), self.entity_name(type_name));
            }
            if let Some(arguments) = self.type_arguments_value(id) {
                node.insert("typeParameters".to_owned(), arguments);
            }
        }
        // The members of a composite type, so a printer can find each one.
        for property in ["type", "elementType", "types", "elements", "objectType", "indexType"] {
            let children: Vec<NodeId> = match self.child(id, property) {
                Some(child) if self.nodes.kind(child).is_none() => self.nodes.items(child).to_vec(),
                Some(child) => vec![child],
                None => continue,
            };
            let key = match property {
                "type" => "typeAnnotation",
                "types" => "types",
                "elements" => "elementTypes",
                other => other,
            };
            let values: Vec<Value> = children.into_iter().map(|c| self.type_value(c)).collect();
            let value = if matches!(property, "types" | "elements") { Value::Array(values) } else { values.into_iter().next().unwrap_or(Value::Null) };
            node.insert(key.to_owned(), value);
        }
        Value::Object(node)
    }

    /// `A` or `A.B.C`, as Babel's `Identifier` or `TSQualifiedName`.
    fn entity_name(&self, id: NodeId) -> Value {
        if self.kind(id) == k::QUALIFIED_NAME {
            let mut node = self.raw_value("TSQualifiedName", id, self.start(id), self.end(id));
            if let Some(left) = self.child(id, "left") {
                node.insert("left".to_owned(), self.entity_name(left));
            }
            if let Some(right) = self.child(id, "right") {
                node.insert("right".to_owned(), self.entity_name(right));
            }
            return Value::Object(node);
        }
        let mut node = self.raw_value("Identifier", id, self.start(id), self.end(id));
        node.insert("name".to_owned(), json!(self.text_of(id)));
        Value::Object(node)
    }

    /// `: T`, as Babel's `TSTypeAnnotation`, which starts at the colon.
    pub(super) fn type_annotation(&self, type_id: NodeId) -> RawNode {
        let end = self.end(type_id);
        let start = self.token_before(self.start(type_id), ':').unwrap_or_else(|| self.start(type_id));
        let mut node = self.raw_value("TSTypeAnnotation", type_id, start, end);
        // One tsgo node, two Babel nodes: the annotation keeps no id of its own.
        node.remove("_nodeId");
        node.insert("typeAnnotation".to_owned(), self.type_value(type_id));
        RawNode::from_value(&Value::Object(node))
    }

    /// A declaration's `<T, U>`, as Babel's `TSTypeParameterDeclaration`.
    pub(super) fn type_parameters(&self, id: NodeId) -> Option<RawNode> {
        let parameters = self.list(id, "typeParameters");
        let (first, last) = (*parameters.first()?, *parameters.last()?);
        let start = self.token_before(self.start(first), '<').unwrap_or_else(|| self.start(first));
        let end = self.token_at(self.end(last), ">").map_or_else(|| self.end(last), |at| at + 1);
        let mut node = self.raw_value("TSTypeParameterDeclaration", id, start, end);
        node.remove("_nodeId");
        let params = parameters
            .into_iter()
            .map(|parameter| {
                let mut value = self.raw_value("TSTypeParameter", parameter, self.start(parameter), self.end(parameter));
                let name = self.child(parameter, "name").map(|n| self.text_of(n)).unwrap_or_default();
                value.insert("name".to_owned(), json!(name));
                Value::Object(value)
            })
            .collect();
        node.insert("params".to_owned(), Value::Array(params));
        Some(RawNode::from_value(&Value::Object(node)))
    }

    fn type_arguments_value(&self, id: NodeId) -> Option<Value> {
        let arguments = self.list(id, "typeArguments");
        let (first, last) = (*arguments.first()?, *arguments.last()?);
        let start = self.token_before(self.start(first), '<').unwrap_or_else(|| self.start(first));
        let end = self.token_at(self.end(last), ">").map_or_else(|| self.end(last), |at| at + 1);
        let mut node = self.raw_value("TSTypeParameterInstantiation", id, start, end);
        node.remove("_nodeId");
        node.insert("params".to_owned(), Value::Array(arguments.into_iter().map(|a| self.type_value(a)).collect()));
        Some(Value::Object(node))
    }

    /// A call's or an element's `<T>`, as Babel's `TSTypeParameterInstantiation`.
    pub(super) fn type_arguments(&self, id: NodeId) -> Option<RawNode> {
        self.type_arguments_value(id).map(|value| RawNode::from_value(&value))
    }
}
