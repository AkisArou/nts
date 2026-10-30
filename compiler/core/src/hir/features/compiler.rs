//! Source-level compiler capabilities, separate from backend helper names.
//!
//! A member here has a lowering entry point, not every overload or every use
//! as a first-class value. `prototype.` identifies an instance operation; it
//! does not promise a reified prototype object. The resolver must still check
//! the reached use, the backend's helpers, and its conformance record.
//!
//! This table describes today's compiler provider. Planned source providers
//! and native capabilities (structuredClone, host:utf8, host:base64, etc.) do
//! not become available merely because the design assigns their kind.

use serde::Serialize;

use super::super::builtin;

/// How a provider implements its source-level surface. A native capability
/// uses a binding; its TypeScript API surface is a source provider requiring it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    Compiler,
    Source,
    Binding,
}

/// A supported use of the global itself, independent of its members.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Use {
    Call,
    Construct,
    Value,
}

/// One feature in the compiler manifest. Members are qualified within the
/// feature: `isArray` is static, `prototype.slice` is an instance operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CompilerProvider {
    pub feature: String,
    pub global: &'static str,
    pub kind: ProviderKind,
    pub uses: Vec<Use>,
    pub members: Vec<String>,
    pub limits: &'static str,
}

struct Root {
    global: &'static str,
    library: &'static str,
    uses: &'static [Use],
    statics: &'static [&'static str],
    instances: &'static [&'static str],
    limits: &'static str,
}

use Use::{Call, Construct, Value};

// Sorted by global, because the hot refusal classifier binary-searches this
// slice. Error order stays in builtin::ERRORS: it is a runtime identity.
const ROOTS: &[Root] = &[
    Root {
        global: "Array",
        library: "es",
        uses: &[Construct],
        statics: &["from", "isArray"],
        instances: &[
            "at",
            "concat",
            "every",
            "fill",
            "filter",
            "find",
            "findIndex",
            "findLast",
            "findLastIndex",
            "forEach",
            "includes",
            "indexOf",
            "join",
            "lastIndexOf",
            "length",
            "map",
            "pop",
            "push",
            "reduce",
            "reduceRight",
            "reverse",
            "shift",
            "slice",
            "some",
            "sort",
            "splice",
            "toReversed",
            "toSorted",
            "toString",
            "unshift",
            "with",
        ],
        limits: "Callbacks, element representations and argument counts are checked at each use; iterator-producing methods are not general values.",
    },
    Root {
        global: "ArrayBuffer",
        library: "es",
        uses: &[Construct],
        statics: &["isView"],
        instances: &[
            "byteLength",
            "detached",
            "maxByteLength",
            "resizable",
            "resize",
            "slice",
            "transfer",
            "transferToFixedLength",
        ],
        limits: "",
    },
    Root {
        global: "BigInt",
        library: "es",
        uses: &[Call],
        statics: &["asIntN", "asUintN"],
        instances: &[],
        limits: "Machine bigint representation; no boxed BigInt construction.",
    },
    Root {
        global: "Boolean",
        library: "es",
        uses: &[Call],
        statics: &[],
        instances: &[],
        limits: "Primitive conversion; no boxed Boolean construction.",
    },
    Root {
        global: "DataView",
        library: "es",
        uses: &[Construct],
        statics: &[],
        instances: &[
            "buffer",
            "byteLength",
            "byteOffset",
            "getBigInt64",
            "getBigUint64",
            "getFloat32",
            "getFloat64",
            "getInt16",
            "getInt32",
            "getInt8",
            "getUint16",
            "getUint32",
            "getUint8",
            "setBigInt64",
            "setBigUint64",
            "setFloat32",
            "setFloat64",
            "setInt16",
            "setInt32",
            "setInt8",
            "setUint16",
            "setUint32",
            "setUint8",
        ],
        limits: "",
    },
    Root {
        global: "Date",
        library: "es",
        uses: &[Construct],
        statics: &[],
        instances: &["getTime", "valueOf"],
        limits: "Explicit numeric time only; no clock, local calendar, Date.now or Date.parse.",
    },
    Root {
        global: "Infinity",
        library: "es",
        uses: &[Value],
        statics: &[],
        instances: &[],
        limits: "",
    },
    Root {
        global: "JSON",
        library: "es",
        uses: &[],
        statics: &["stringify"],
        instances: &[],
        limits: "Compiler-generated stringify for representable typed or erased values; parse has no compiler provider yet.",
    },
    Root {
        global: "Map",
        library: "es",
        uses: &[Construct],
        statics: &[],
        instances: &[
            "clear", "delete", "entries", "forEach", "get", "has", "keys", "set", "size", "values",
        ],
        limits: "keys/values/entries only as recognised iterable walks; forEach requires an inline callback.",
    },
    Root {
        global: "Math",
        library: "es",
        uses: &[],
        statics: &[
            "E", "LN10", "LN2", "LOG10E", "LOG2E", "PI", "SQRT1_2", "SQRT2", "abs", "acos", "asin",
            "atan", "atan2", "cbrt", "ceil", "cos", "cosh", "exp", "expm1", "floor", "fround",
            "hypot", "imul", "log", "log10", "log1p", "log2", "max", "min", "pow", "round", "sign",
            "sin", "sinh", "sqrt", "tan", "tanh", "trunc",
        ],
        instances: &[],
        limits: "No random or unlisted Math members; arities and numeric coercions are checked at the call.",
    },
    Root {
        global: "NaN",
        library: "es",
        uses: &[Value],
        statics: &[],
        instances: &[],
        limits: "",
    },
    Root {
        global: "Number",
        library: "es",
        uses: &[Call],
        statics: &[
            "EPSILON",
            "MAX_SAFE_INTEGER",
            "MAX_VALUE",
            "MIN_SAFE_INTEGER",
            "MIN_VALUE",
            "NEGATIVE_INFINITY",
            "NaN",
            "POSITIVE_INFINITY",
            "isFinite",
            "isInteger",
            "isNaN",
            "isSafeInteger",
        ],
        instances: &["toFixed", "toString"],
        limits: "Primitive numeric conversion and formatting; no boxed Number construction.",
    },
    Root {
        global: "Object",
        library: "es",
        uses: &[],
        statics: &[
            "assign", "create", "entries", "hasOwn", "is", "keys", "values",
        ],
        instances: &[],
        limits: "create accepts null; keys/values/entries and assign depend on the represented object or dictionary shape.",
    },
    Root {
        global: "Promise",
        library: "es",
        uses: &[Construct],
        statics: &["all", "race", "reject", "resolve", "withResolvers"],
        instances: &["catch", "finally", "then"],
        limits: "Representable payloads; all/race take arrays of promises, not arbitrary thenables or iterables.",
    },
    Root {
        global: "Set",
        library: "es",
        uses: &[Construct],
        statics: &[],
        instances: &[
            "add", "clear", "delete", "entries", "forEach", "has", "keys", "size", "values",
        ],
        limits: "keys/values/entries only as recognised iterable walks; forEach requires an inline callback.",
    },
    Root {
        global: "String",
        library: "es",
        uses: &[Call],
        statics: &["fromCharCode", "fromCodePoint"],
        instances: &[
            "at",
            "charAt",
            "charCodeAt",
            "codePointAt",
            "concat",
            "endsWith",
            "includes",
            "indexOf",
            "isWellFormed",
            "lastIndexOf",
            "length",
            "padEnd",
            "padStart",
            "repeat",
            "replace",
            "replaceAll",
            "slice",
            "split",
            "startsWith",
            "substring",
            "toLowerCase",
            "toUpperCase",
            "toWellFormed",
            "trim",
            "trimEnd",
            "trimStart",
        ],
        limits: "Primitive strings; string separators and patterns, no RegExp or locale overloads; no boxed String construction.",
    },
    Root {
        global: "Symbol",
        library: "es",
        uses: &[Call],
        statics: &["for", "keyFor"],
        instances: &[],
        limits: "Symbol creation and registry; well-known symbols are recognised at their specific protocol sites.",
    },
    Root {
        global: "clearInterval",
        library: "web",
        uses: &[Call],
        statics: &[],
        instances: &[],
        limits: "Compiler timer lowering; the selected loop host must supply the runtime. Clock provider resolution is not implemented here.",
    },
    Root {
        global: "clearTimeout",
        library: "web",
        uses: &[Call],
        statics: &[],
        instances: &[],
        limits: "Compiler timer lowering; the selected loop host must supply the runtime. Clock provider resolution is not implemented here.",
    },
    Root {
        global: "console",
        library: "web",
        uses: &[],
        statics: &["debug", "error", "info", "log", "warn"],
        instances: &[],
        limits: "Direct calls with representable arguments; object inspection, formatting directives and extracted methods have restrictions.",
    },
    Root {
        global: "decodeURI",
        library: "es",
        uses: &[Call],
        statics: &[],
        instances: &[],
        limits: "",
    },
    Root {
        global: "decodeURIComponent",
        library: "es",
        uses: &[Call],
        statics: &[],
        instances: &[],
        limits: "",
    },
    Root {
        global: "encodeURI",
        library: "es",
        uses: &[Call],
        statics: &[],
        instances: &[],
        limits: "",
    },
    Root {
        global: "encodeURIComponent",
        library: "es",
        uses: &[Call],
        statics: &[],
        instances: &[],
        limits: "",
    },
    Root {
        global: "isFinite",
        library: "es",
        uses: &[Call],
        statics: &[],
        instances: &[],
        limits: "",
    },
    Root {
        global: "isNaN",
        library: "es",
        uses: &[Call],
        statics: &[],
        instances: &[],
        limits: "",
    },
    Root {
        global: "parseFloat",
        library: "es",
        uses: &[Call],
        statics: &[],
        instances: &[],
        limits: "",
    },
    Root {
        global: "parseInt",
        library: "es",
        uses: &[Call],
        statics: &[],
        instances: &[],
        limits: "",
    },
    Root {
        global: "setInterval",
        library: "web",
        uses: &[Call],
        statics: &[],
        instances: &[],
        limits: "Compiler timer lowering; the selected loop host must supply the runtime. Clock provider resolution is not implemented here.",
    },
    Root {
        global: "setTimeout",
        library: "web",
        uses: &[Call],
        statics: &[],
        instances: &[],
        limits: "Compiler timer lowering; the selected loop host must supply the runtime. Clock provider resolution is not implemented here.",
    },
    Root {
        global: "undefined",
        library: "es",
        uses: &[Value],
        statics: &[],
        instances: &[],
        limits: "",
    },
];

pub(in crate::hir) fn compiler_global(name: &str) -> bool {
    ROOTS
        .binary_search_by_key(&name, |root| root.global)
        .is_ok()
}

/// Match the checked declaration family as well as the canonical global name.
/// Package/module exports never inherit an ES or web compiler capability.
pub(super) fn provides_binding(library: &nts_semantic_schema::Library, name: &str) -> bool {
    use nts_semantic_schema::Library;
    let namespace = match library {
        Library::Es => "es",
        Library::Dom => "web",
        Library::Node | Library::Package(_) => return false,
    };
    if let Ok(index) = ROOTS.binary_search_by_key(&name, |root| root.global) {
        return ROOTS[index].library == namespace;
    }
    matches!(library, Library::Es)
        && (builtin::is_error(name) || builtin::typed_array_element(name).is_some())
}

/// The compiler's current capabilities, sorted by feature and member. This is
/// generated on demand for tooling, never allocated by the hot global lookup.
#[must_use]
pub fn compiler_providers() -> Vec<CompilerProvider> {
    let mut providers: Vec<_> = ROOTS
        .iter()
        .map(|root| {
            let mut members: Vec<_> = root
                .statics
                .iter()
                .map(|name| (*name).to_owned())
                .chain(
                    root.instances
                        .iter()
                        .map(|name| format!("prototype.{name}")),
                )
                .collect();
            members.sort();
            CompilerProvider {
                feature: format!("{}:{}", root.library, root.global),
                global: root.global,
                kind: ProviderKind::Compiler,
                uses: root.uses.to_vec(),
                members,
                limits: root.limits,
            }
        })
        .collect();
    for &name in builtin::ERRORS {
        let mut members: Vec<_> = builtin::error_fields(name)
            .iter()
            // AggregateError.errors is stored by the constructor, but its
            // read is explicitly refused by lowering. A field layout alone
            // is not a readable source-level member claim.
            .filter(|field| field.name.public_name() != Some("errors"))
            .filter_map(|field| {
                field
                    .name
                    .public_name()
                    .map(|name| format!("prototype.{name}"))
            })
            .collect();
        members.sort();
        providers.push(CompilerProvider {
            feature: format!("es:{name}"), global: name, kind: ProviderKind::Compiler,
            uses: vec![Construct, Value], members,
            limits: "Compiler error layout; stack is absent and AggregateError.errors is stored but not readable. Calling without new is not supplied.",
        });
    }
    for &name in builtin::TYPED_ARRAYS {
        providers.push(CompilerProvider {
            feature: format!("es:{name}"), global: name, kind: ProviderKind::Compiler,
            uses: vec![Construct],
            members: ["buffer", "byteLength", "byteOffset", "copyWithin", "fill", "join", "length", "set", "slice", "subarray"]
                .map(|member| format!("prototype.{member}")).to_vec(),
            limits: "Numeric typed-array views; copyWithin is supported as a statement, not a returned view. No clamped or bigint element arrays, general callback methods, or static from/of.",
        });
    }
    providers.sort_by(|left, right| left.feature.cmp(&right.feature));
    providers
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roots_are_sorted_and_keep_the_existing_global_boundary() {
        assert!(ROOTS.windows(2).all(|pair| pair[0].global < pair[1].global));
        assert_eq!(
            ROOTS.iter().map(|root| root.global).collect::<Vec<_>>(),
            [
                "Array",
                "ArrayBuffer",
                "BigInt",
                "Boolean",
                "DataView",
                "Date",
                "Infinity",
                "JSON",
                "Map",
                "Math",
                "NaN",
                "Number",
                "Object",
                "Promise",
                "Set",
                "String",
                "Symbol",
                "clearInterval",
                "clearTimeout",
                "console",
                "decodeURI",
                "decodeURIComponent",
                "encodeURI",
                "encodeURIComponent",
                "isFinite",
                "isNaN",
                "parseFloat",
                "parseInt",
                "setInterval",
                "setTimeout",
                "undefined",
            ],
            "the pre-table global boundary is unchanged"
        );
        assert!(compiler_global("JSON"));
        assert!(!compiler_global("RegExp"));
        assert!(!compiler_global("structuredClone"));
        assert!(!compiler_global("nts_json_quote"));
        assert!(!compiler_global("host:utf8"));
    }

    #[test]
    fn derived_classes_keep_their_identity_and_partial_members() {
        assert_eq!(
            builtin::ERRORS,
            &[
                "Error",
                "TypeError",
                "RangeError",
                "URIError",
                "SyntaxError",
                "EvalError",
                "ReferenceError",
                "AggregateError"
            ]
        );
        let providers = compiler_providers();
        for provider in &providers {
            assert!(builtin::provides_global(provider.global));
            assert!(provider.members.windows(2).all(|pair| pair[0] < pair[1]));
            assert_eq!(provider.kind, ProviderKind::Compiler);
        }
        let error = providers
            .iter()
            .find(|row| row.global == "AggregateError")
            .expect("AggregateError entry");
        assert!(!error.members.contains(&"prototype.errors".to_owned()));
        assert!(!error.members.contains(&"prototype.stack".to_owned()));
        let json = providers
            .iter()
            .find(|row| row.global == "JSON")
            .expect("JSON entry");
        assert_eq!(json.members, ["stringify"]);
        for &name in builtin::TYPED_ARRAYS {
            assert!(builtin::typed_array_element(name).is_some());
            assert!(providers.iter().any(|row| row.global == name));
        }
        assert!(builtin::typed_array_element("Uint8ClampedArray").is_none());
    }
}
