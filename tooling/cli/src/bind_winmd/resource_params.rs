//! Reviewed facts absent from `WinMD`: which text inputs also accept an integer
//! resource identifier, and which callback text projections are unsafe for it.
//! The table is checked against metadata before mapping, never used as a hint.

use std::collections::BTreeSet;

use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use windows_metadata::{ParamAttributes, Type};

use super::read::{Kind, Model, Name};

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Policy {
    parameters: Vec<Input>,
    callbacks: Vec<Callback>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    namespace: String,
    function: String,
    parameter: String,
    documentation: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Callback {
    namespace: String,
    #[serde(rename = "callback")]
    name: String,
    parameter: String,
    documentation: String,
}

impl Policy {
    pub(crate) fn embedded() -> Result<Self> {
        Self::parse(include_str!("resource-params.json"))
    }

    fn parse(text: &str) -> Result<Self> {
        let table: Self = serde_json::from_str(text).context("reading resource-params.json")?;
        let mut seen = BTreeSet::new();
        for (kind, namespace, declaration, parameter, page) in table
            .parameters
            .iter()
            .map(|p| {
                (
                    "function",
                    &p.namespace,
                    &p.function,
                    &p.parameter,
                    &p.documentation,
                )
            })
            .chain(table.callbacks.iter().map(|p| {
                (
                    "callback",
                    &p.namespace,
                    &p.name,
                    &p.parameter,
                    &p.documentation,
                )
            }))
        {
            ensure!(
                !namespace.is_empty()
                    && !declaration.is_empty()
                    && !parameter.is_empty()
                    && page.starts_with("https://learn.microsoft.com/")
                    && !page.chars().any(char::is_whitespace),
                "resource-params.json: invalid {kind} entry {namespace}.{declaration}.{parameter}"
            );
            ensure!(
                seen.insert((kind, namespace, declaration, parameter)),
                "resource-params.json: duplicate {namespace}.{declaration}.{parameter}"
            );
        }
        Ok(table)
    }

    /// A custom `WinMD` need implement only the namespaces requested. The gated
    /// whole-table audit below also validates the entries outside that request.
    pub(crate) fn validate(&self, model: &Model, namespaces: &[String]) -> Result<()> {
        for p in &self.parameters {
            if !namespaces.contains(&p.namespace) {
                continue;
            }
            let label = format!("{}.{}.{}", p.namespace, p.function, p.parameter);
            let function = model
                .functions
                .iter()
                .find(|f| f.namespace == p.namespace && f.name == p.function)
                .with_context(|| format!("resource-params.json: missing function {label}"))?;
            let parameter = function
                .parameters
                .iter()
                .find(|a| a.name == p.parameter)
                .with_context(|| format!("resource-params.json: missing parameter {label}"))?;
            ensure!(
                utf16_type(model, &parameter.ty)
                    && parameter.constant
                    && parameter.flags.contains(ParamAttributes::In)
                    && !parameter.flags.contains(ParamAttributes::Out),
                "resource-params.json: {label} must be a const UTF-16 input"
            );
        }
        for p in &self.callbacks {
            if !namespaces.contains(&p.namespace) {
                continue;
            }
            let label = format!("{}.{}.{}", p.namespace, p.name, p.parameter);
            let Some(Kind::Delegate { parameters, .. }) = model
                .types
                .get(&(p.namespace.clone(), p.name.clone()))
                .map(|t| &t.kind)
            else {
                anyhow::bail!("resource-params.json: missing callback {label}");
            };
            let (_, ty) = parameters
                .iter()
                .find(|(name, _)| name == &p.parameter)
                .with_context(|| {
                    format!("resource-params.json: missing callback parameter {label}")
                })?;
            ensure!(
                utf16_type(model, ty),
                "resource-params.json: {label} must be a UTF-16 pointer"
            );
        }
        Ok(())
    }

    pub(crate) fn input_atom(&self, namespace: &str, function: &str, parameter: &str) -> bool {
        self.parameters
            .iter()
            .any(|p| p.namespace == namespace && p.function == function && p.parameter == parameter)
    }

    pub(crate) fn callback_atom(&self, name: &Name, parameter: &str) -> bool {
        self.callbacks
            .iter()
            .any(|p| p.namespace == name.0 && p.name == name.1 && p.parameter == parameter)
    }
}

pub(crate) fn utf16_type(model: &Model, ty: &Type) -> bool {
    let Type::ValueName(name) = ty else {
        return false;
    };
    matches!(model.types.get(&super::read::name_of(name)).map(|t| &t.kind),
        Some(Kind::Typedef { value: Type::PtrMut(unit, 1) | Type::PtrConst(unit, 1), .. })
            if **unit == Type::Char)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::super::read::{Function, Parameter, TypeInfo};
    use super::*;
    use std::collections::BTreeMap;

    const NS: &str = "Windows.Win32.Test.Resources";
    const ENTRY: &str = r#"{"namespace":"Windows.Win32.Test.Resources","function":"load","parameter":"name","documentation":"https://learn.microsoft.com/example"}"#;

    fn policy() -> Policy {
        Policy::parse(&format!(r#"{{"parameters":[{ENTRY}],"callbacks":[]}}"#)).unwrap()
    }

    fn model() -> Model {
        Model {
            functions: vec![Function {
                namespace: NS.into(),
                name: "load".into(),
                library: "test.dll".into(),
                parameters: vec![Parameter {
                    name: "name".into(),
                    ty: Type::ValueName(windows_metadata::TypeName::named(NS, "text")),
                    flags: ParamAttributes::In,
                    optional: false,
                    constant: true,
                    output: false,
                    attributes: BTreeMap::new(),
                }],
                result: Type::Void,
                documentation: None,
                attributes: BTreeMap::new(),
            }],
            types: [(
                (NS.into(), "text".into()),
                TypeInfo {
                    kind: Kind::Typedef {
                        value: Type::PtrMut(Box::new(Type::Char), 1),
                        parent: None,
                    },
                },
            )]
            .into(),
            ..Model::default()
        }
    }

    #[test]
    fn reviewed_entries_fail_closed_when_metadata_changes() {
        let policy = policy();
        policy.validate(&model(), &[NS.into()]).unwrap();
        for change in [
            "function",
            "parameter",
            "type",
            "const",
            "out",
            "inout",
            "missing-in",
        ] {
            let mut model = model();
            let function = &mut model.functions[0];
            let parameter = &mut function.parameters[0];
            match change {
                "function" => function.name = "renamed".into(),
                "parameter" => parameter.name = "renamed".into(),
                "type" => parameter.ty = Type::U16,
                "const" => parameter.constant = false,
                "out" => parameter.flags = ParamAttributes::Out,
                "inout" => parameter.flags = ParamAttributes::In | ParamAttributes::Out,
                _ => parameter.flags = ParamAttributes(0),
            }
            let error = policy
                .validate(&model, &[NS.into()])
                .unwrap_err()
                .to_string();
            assert!(
                error.contains("resource-params.json") && error.contains("load"),
                "{change}: {error}"
            );
            policy
                .validate(&model, &["an.unrelated.namespace".into()])
                .unwrap();
        }
    }

    #[test]
    fn malformed_or_duplicate_reviewed_data_is_an_error() {
        for text in [
            format!(r#"{{"parameters":[{ENTRY},{ENTRY}],"callbacks":[]}}"#),
            format!(r#"{{"parameters":[{ENTRY}],"callbacks":[],"typo":true}}"#),
            format!(
                r#"{{"parameters":[{}],"callbacks":[]}}"#,
                ENTRY.replace("https://learn.microsoft.com/", "http://example.com/")
            ),
            "{bad json}".into(),
        ] {
            assert!(Policy::parse(&text).is_err(), "{text}");
        }
    }

    fn header_fixture(label: &str, header: &str) -> (std::path::PathBuf, Vec<Vec<String>>) {
        let dir = std::env::temp_dir().join(format!("nts-resource-{label}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("resources.h");
        std::fs::write(&path, header).unwrap();
        (dir, vec![vec![path.to_str().unwrap().into()]])
    }

    fn rendered(model: &Model, policy: &Policy, headers: &[Vec<String>]) -> (String, String) {
        use super::super::{check, emit, map};
        let args = vec!["--target=x86_64-w64-windows-gnu".into()];
        let facts = map::ask(model, headers, &args).unwrap();
        let mut bindings = map::bindings(model, &facts, policy);
        check::against_headers(&mut bindings, headers, &args).unwrap();
        let rendered = emit::render(
            bindings.iter().find(|b| b.namespace == NS).unwrap(),
            "test",
            &BTreeMap::new(),
        );
        (rendered.declarations, rendered.refused)
    }

    #[test]
    fn only_reviewed_parameters_gain_overloads_and_text_stays_last() {
        let mut model = model();
        let mut ordinary = model.functions[0].clone();
        ordinary.name = "ordinary".into();
        model.functions.push(ordinary);
        let mut second = model.functions[0].parameters[0].clone();
        second.name = "kind".into();
        model.functions[0].parameters.push(second);
        let mut policy = policy();
        policy.parameters.push(Input {
            namespace: NS.into(),
            function: "load".into(),
            parameter: "kind".into(),
            documentation: "https://learn.microsoft.com/example".into(),
        });
        let (dir, headers) = header_fixture(
            "overloads",
            "typedef unsigned short *text; void load(const unsigned short *,const unsigned short *); void ordinary(const unsigned short *);",
        );
        let (text, refused) = rendered(&model, &policy, &headers);
        assert!(refused.is_empty(), "{refused}");
        assert_eq!(text.matches("export function load(").count(), 4, "{text}");
        assert_eq!(
            text.matches("export function ordinary(").count(),
            1,
            "{text}"
        );
        assert!(
            text.contains("ordinary(name: Utf16String): void;"),
            "{text}"
        );
        assert!(
            text.contains("load(name: ConstPtr<Uint16>, kind: ConstPtr<Uint16>): void;"),
            "{text}"
        );
        let last = text.rfind("export function load(").unwrap();
        assert!(
            text[last..]
                .starts_with("export function load(name: Utf16String, kind: Utf16String): void;"),
            "{text}"
        );
        // The exact same metadata still refuses a mutable header parameter.
        std::fs::write(dir.join("resources.h"), "typedef unsigned short *text; void load(unsigned short *,const unsigned short *); void ordinary(const unsigned short *);").unwrap();
        let (text, refused) = rendered(&model, &policy, &headers);
        assert!(!text.contains("function load("));
        assert!(
            refused.contains("load\tresource parameter `name`"),
            "{refused}"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn atom_bits_require_utf16_metadata_bounds_and_header_value_agreement() {
        use super::super::read::Constant;
        use windows_metadata::Value;
        let (dir, headers) = header_fixture(
            "bits",
            "typedef unsigned short *text; void load(const unsigned short *);\n#define ATOM ((text)32512)\n",
        );
        for (value, bound) in [
            (Value::I32(32512), true),
            (Value::I32(32513), false),
            (Value::I32(-1), false),
            (Value::U32(65536), false),
            (Value::F64(32512.0), false),
        ] {
            let mut model = model();
            model.constants.push(Constant {
                namespace: NS.into(),
                name: "ATOM".into(),
                ty: model.functions[0].parameters[0].ty.clone(),
                value,
            });
            let (text, refused) = rendered(&model, &policy(), &headers);
            assert_eq!(
                text.contains("export const ATOM: ConstPtr<Uint16>;"),
                bound,
                "{text}\n{refused}"
            );
            assert_eq!(refused.contains("ATOM\t"), !bound, "{refused}");
        }
        // Boundaries are exact; zero remains nullable rather than lying about
        // a null pointer. Missing header macros are refusals, unlike scalar
        // enumerators whose value is supplied by metadata alone.
        for (bits, present, expected) in [
            (65535, true, "ConstPtr<Uint16>"),
            (0, true, "ConstPtr<Uint16> | null"),
            (32512, false, ""),
        ] {
            let header = format!(
                "typedef unsigned short *text; void load(const unsigned short *);\n{}",
                if present {
                    format!("#define ATOM ((text){bits})\n")
                } else {
                    String::new()
                }
            );
            std::fs::write(dir.join("resources.h"), header).unwrap();
            let mut model = model();
            model.constants.push(Constant {
                namespace: NS.into(),
                name: "ATOM".into(),
                ty: model.functions[0].parameters[0].ty.clone(),
                value: Value::I32(bits),
            });
            let (text, refused) = rendered(&model, &policy(), &headers);
            if present {
                assert!(
                    text.contains(&format!("export const ATOM: {expected};")),
                    "{text} {refused}"
                );
            } else {
                assert!(refused.contains("ATOM\t"), "{refused}");
                assert!(!text.contains("export const ATOM:"));
            }
        }
        std::fs::write(dir.join("resources.h"), "typedef unsigned short *text; void load(const unsigned short *);\n#define ATOM ((text)32512)\n").unwrap();
        // Changing just the metadata pointee must not admit an arbitrary pointer.
        let mut model = model();
        let Kind::Typedef { value, .. } = &mut model
            .types
            .get_mut(&(NS.into(), "text".into()))
            .unwrap()
            .kind
        else {
            unreachable!()
        };
        *value = Type::PtrMut(Box::new(Type::Void), 1);
        model.constants.push(Constant {
            namespace: NS.into(),
            name: "ATOM".into(),
            ty: model.functions[0].parameters[0].ty.clone(),
            value: Value::I32(32512),
        });
        let (text, _) = rendered(&model, &Policy::default(), &headers);
        assert!(
            !text.contains("export const ATOM: ConstPtr<Uint16>;"),
            "{text}"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn resource_callbacks_refuse_text_projection_but_keep_raw_pointer_contracts() {
        let mut model = model();
        let text = model.functions[0].parameters[0].ty.clone();
        model.types.insert(
            (NS.into(), "callback".into()),
            TypeInfo {
                kind: Kind::Delegate {
                    parameters: vec![("name".into(), text)],
                    result: Type::Void,
                },
            },
        );
        model.functions[0].parameters[0].ty =
            Type::ClassName(windows_metadata::TypeName::named(NS, "callback"));
        model.functions[0].parameters[0].constant = false;
        let policy = Policy {
            parameters: Vec::new(),
            callbacks: vec![Callback {
                namespace: NS.into(),
                name: "callback".into(),
                parameter: "name".into(),
                documentation: "https://learn.microsoft.com/example".into(),
            }],
        };
        policy.validate(&model, &[NS.into()]).unwrap();
        let (dir, headers) = header_fixture(
            "callbacks",
            "typedef unsigned short *text; typedef void (*callback)(const unsigned short *); void load(callback);",
        );
        let (text, refused) = rendered(&model, &policy, &headers);
        assert!(!text.contains("export type callback"), "{text}");
        assert!(
            refused.contains("callback\t`callback.name` can be an integer resource atom"),
            "{refused}"
        );
        assert!(refused.contains("load\t"), "{refused}");
        std::fs::write(dir.join("resources.h"), "typedef unsigned short *text; typedef void (*callback)(unsigned short *); void load(callback);").unwrap();
        let (text, refused) = rendered(&model, &policy, &headers);
        assert!(refused.is_empty(), "{refused}");
        assert!(
            text.contains("export type callback = (name: Ptr<Uint16>) => void;"),
            "{text}"
        );
        for change in ["callback", "parameter", "type"] {
            let mut changed = Model {
                functions: model.functions.clone(),
                constants: model.constants.clone(),
                types: model.types.clone(),
            };
            if change == "callback" {
                changed.types.remove(&(NS.into(), "callback".into()));
            } else {
                let Kind::Delegate { parameters, .. } = &mut changed
                    .types
                    .get_mut(&(NS.into(), "callback".into()))
                    .unwrap()
                    .kind
                else {
                    unreachable!()
                };
                if change == "parameter" {
                    parameters[0].0 = "renamed".into();
                } else {
                    parameters[0].1 = Type::U16;
                }
            }
            assert!(policy.validate(&changed, &[NS.into()]).is_err(), "{change}");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn whole_reviewed_table_agrees_with_pinned_winmd() {
        let path = super::super::default_winmd();
        if !path.exists() {
            eprintln!("skipping: needs the pinned Win32 metadata");
            return;
        }
        let policy = Policy::embedded().unwrap();
        let namespaces: Vec<_> = policy
            .parameters
            .iter()
            .map(|p| p.namespace.clone())
            .chain(policy.callbacks.iter().map(|p| p.namespace.clone()))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let index = windows_metadata::reader::Index::read(&path).unwrap().leak();
        let model = super::super::read::read(index, &namespaces);
        assert_eq!(policy.parameters.len(), 23);
        assert_eq!(policy.callbacks.len(), 3);
        policy.validate(&model, &namespaces).unwrap();
    }
}
