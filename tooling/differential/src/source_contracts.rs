//! Case membership comes from checker signatures, before any body is lowered.

use std::collections::{BTreeSet, HashMap};

use anyhow::{Context, Result, ensure};
use nts_core::hir::{self, Absent, facts::Facts};
use nts_semantic_schema::{
    LiteralValue, NodeId, NodeKind, SemanticSnapshot, SignatureId, TypeId, TypeKind, syntax,
};

use super::{Testable, drivable, inputs};

pub(super) struct Contract {
    pub(super) name: String,
    pub(super) signature: SignatureId,
    declaration: Option<NodeId>,
}

fn node_kind(snapshot: &SemanticSnapshot, node: NodeId) -> Option<u16> {
    match snapshot.nodes[node.0 as usize].kind {
        NodeKind::Syntax(kind) => Some(kind),
        NodeKind::List => None,
    }
}

// Only declaration/initializer links are followed: this discovers source
// annotation policy without lowering or traversing a function's body.
fn callable_declaration(
    snapshot: &SemanticSnapshot,
    roots: &[NodeId],
    cache: &mut HashMap<NodeId, Option<NodeId>>,
    remaining: &mut usize,
) -> Result<Option<NodeId>> {
    let mut pending = roots.iter().rev().copied().collect::<Vec<_>>();
    let mut seen = BTreeSet::new();
    let mut fallback = None;
    ensure!(
        pending.len() <= *remaining,
        "oracle source declaration graph exceeds validation budget"
    );
    while let Some(node) = pending.pop() {
        *remaining = remaining
            .checked_sub(1)
            .context("oracle source declaration graph exceeds validation budget")?;
        if !seen.insert(node) {
            continue;
        }
        if let Some(cached) = cache.get(&node).copied() {
            if let Some(found) = cached {
                for visited in seen {
                    cache.insert(visited, Some(found));
                }
                return Ok(Some(found));
            }
            continue;
        }
        match node_kind(snapshot, node) {
            Some(
                syntax::FUNCTION_DECLARATION | syntax::FUNCTION_EXPRESSION | syntax::ARROW_FUNCTION,
            ) => {
                fallback.get_or_insert(node);
                if node_kind(snapshot, node) == Some(syntax::ARROW_FUNCTION)
                    || hir::written_scalar::children(snapshot, node)
                        .any(|child| node_kind(snapshot, child) == Some(syntax::BLOCK))
                {
                    for visited in seen {
                        cache.insert(visited, Some(node));
                    }
                    return Ok(Some(node));
                }
            }
            Some(
                syntax::VARIABLE_DECLARATION
                | syntax::PARENTHESIZED_EXPRESSION
                | syntax::AS_EXPRESSION
                | syntax::SATISFIES_EXPRESSION
                | syntax::NON_NULL_EXPRESSION,
            ) => {
                let children = hir::written_scalar::children(snapshot, node);
                let next = if node_kind(snapshot, node) == Some(syntax::VARIABLE_DECLARATION) {
                    children.last()
                } else {
                    children.into_iter().next()
                };
                if let Some(next) = next {
                    pending.push(next);
                }
            }
            Some(syntax::IDENTIFIER) => {
                if let Some(symbol) = snapshot.nodes[node.0 as usize].symbol {
                    let symbol = &snapshot.symbols[symbol.0 as usize];
                    let symbol = symbol
                        .aliased
                        .map_or(symbol, |id| &snapshot.symbols[id.0 as usize]);
                    ensure!(
                        symbol.declarations.len() <= *remaining,
                        "oracle source declaration graph exceeds validation budget"
                    );
                    pending.extend(symbol.declarations.iter().rev().copied());
                }
            }
            _ => {}
        }
        ensure!(
            pending.len() <= *remaining,
            "oracle source declaration graph exceeds validation budget"
        );
    }
    for visited in seen {
        cache.insert(visited, fallback);
    }
    Ok(fallback)
}

pub(super) fn exported(
    snapshot: &SemanticSnapshot,
    entry: &camino::Utf8Path,
) -> Result<Vec<Contract>> {
    let Some(module) = snapshot
        .modules
        .iter()
        .find(|module| snapshot.sources[module.file.0 as usize].display_path == entry)
    else {
        return Ok(Vec::new());
    };
    let mut contracts = Vec::new();
    let mut declarations = HashMap::new();
    let mut remaining = 16_384_usize;
    for (name, id) in &module.exports {
        let symbol = &snapshot.symbols[id.0 as usize];
        let symbol = symbol
            .aliased
            .map_or(symbol, |id| &snapshot.symbols[id.0 as usize]);
        let signature = symbol
            .declarations
            .iter()
            .filter_map(|node| snapshot.node_types.get(node).copied())
            .chain(symbol.ty)
            .find_map(|ty| match snapshot.types[ty.0 as usize].kind {
                TypeKind::Function(signature)
                    if !snapshot.signatures[signature.0 as usize].is_construct =>
                {
                    Some(signature)
                }
                _ => None,
            });
        if let Some(signature) = signature {
            contracts.push(Contract {
                name: name.clone(),
                signature,
                declaration: callable_declaration(
                    snapshot,
                    &symbol.declarations,
                    &mut declarations,
                    &mut remaining,
                )?,
            });
        }
    }
    Ok(contracts)
}

/// Declaration samples retain the source population's resting anchor. They
/// never narrow the representation-wide sweep or prove a run-time value.
/// A shared work bound also stops a wide DAG from repeating unbounded work.
fn declared_facts(snapshot: &SemanticSnapshot, ty: TypeId) -> Result<Facts> {
    let mut pending = vec![(ty, 0)];
    let mut facts = Facts::BOTTOM;
    let mut seen = BTreeSet::new();
    let mut remaining = 16_384_usize;
    while let Some((ty, depth)) = pending.pop() {
        remaining = remaining
            .checked_sub(1)
            .context("oracle source type graph exceeds validation budget")?;
        if !seen.insert((ty, depth)) {
            continue;
        }
        if depth > 8 {
            return Ok(Facts::TOP);
        }
        match &snapshot.types[ty.0 as usize].kind {
            TypeKind::Literal(LiteralValue::Number(value)) => {
                facts = facts.join(Facts::constant(*value));
            }
            TypeKind::Union(members) => {
                ensure!(
                    members.len() <= remaining,
                    "oracle source type graph exceeds validation budget"
                );
                pending.extend(members.iter().map(|member| (*member, depth + 1)));
            }
            _ => return Ok(Facts::TOP),
        }
    }
    Ok(facts)
}

fn result_absent(snapshot: &SemanticSnapshot, ty: TypeId) -> Result<Absent> {
    let mut pending = vec![ty];
    let mut seen = BTreeSet::new();
    let mut null = false;
    let mut undefined = false;
    let mut remaining = 16_384_usize;
    while let Some(ty) = pending.pop() {
        remaining = remaining
            .checked_sub(1)
            .context("oracle source return graph exceeds validation budget")?;
        if !seen.insert(ty) {
            continue;
        }
        match &snapshot.types[ty.0 as usize].kind {
            TypeKind::Null => null = true,
            TypeKind::Undefined => undefined = true,
            TypeKind::Union(members) => {
                ensure!(
                    members.len() <= remaining,
                    "oracle source return graph exceeds validation budget"
                );
                pending.extend(members);
            }
            _ => {}
        }
    }
    Ok(match (null, undefined) {
        (true, false) => Absent::Null,
        (false, true) => Absent::Undefined,
        _ => Absent::Impossible,
    })
}

// Use the same written scalar decision and root width as lowering. An
// inferred brand is a TypeScript number, not a request for a narrower ABI.
fn source_representation(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    written: Option<hir::native::Scalar>,
) -> Option<hir::HirType> {
    let representation = hir::lower::representation(snapshot, ty)?;
    if representation == hir::HirType::NUMBER
        && let Some(kind) = written
    {
        return Some(kind.width_on(hir::native::Targets::ALL));
    }
    Some(representation)
}

fn parameter_scalar(
    snapshot: &SemanticSnapshot,
    declaration: NodeId,
) -> Option<hir::native::Scalar> {
    let name = hir::written_scalar::children(snapshot, declaration).find(|node| {
        matches!(
            node_kind(snapshot, *node),
            Some(
                syntax::IDENTIFIER | syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN
            )
        )
    })?;
    let resolved = *snapshot.node_types.get(&name)?;
    hir::written_scalar::parameter(snapshot, declaration, resolved)
}

pub(super) fn cases(
    snapshot: &SemanticSnapshot,
    contract: &Contract,
    domains: &super::domains::Domains,
    exclusions: &super::oracle_exclusions::Policy,
) -> Result<Option<Testable>> {
    let signature = &snapshot.signatures[contract.signature.0 as usize];
    let return_scalar = contract
        .declaration
        .and_then(|node| hir::written_scalar::returned(snapshot, node, signature.return_type));
    let parameter_nodes = contract
        .declaration
        .map(|node| {
            hir::written_scalar::children(snapshot, node)
                .filter(|child| node_kind(snapshot, *child) == Some(syntax::PARAMETER))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let Some(returns) =
        source_representation(snapshot, signature.return_type, return_scalar).filter(drivable)
    else {
        return Ok(None);
    };
    let mut parameters = Vec::new();
    for (position, parameter) in signature.parameters.iter().enumerate() {
        let positions = if parameter.rest {
            let TypeKind::Tuple(positions) = &snapshot.types[parameter.ty.0 as usize].kind else {
                return Ok(None);
            };
            ensure!(
                positions.elements.len() <= 16_384 - parameters.len(),
                "oracle source parameter expansion exceeds validation budget"
            );
            positions
                .elements
                .iter()
                .enumerate()
                .map(|(index, ty)| (format!("{}_{index}", parameter.name), *ty))
                .collect::<Vec<_>>()
        } else {
            vec![(parameter.name.clone(), parameter.ty)]
        };
        ensure!(
            parameters.len() + positions.len() <= 16_384,
            "oracle source parameter expansion exceeds validation budget"
        );
        for (name, source_type) in positions {
            let written = parameter_nodes
                .get(position)
                .and_then(|node| parameter_scalar(snapshot, *node));
            let Some(ty) = source_representation(snapshot, source_type, written).filter(drivable)
            else {
                return Ok(None);
            };
            // Fixed tuple rests have a positional ABI. Its parameters carry
            // no literal facts in lowering, so preserve their existing pools.
            let known = if parameter.rest {
                Facts::TOP
            } else {
                declared_facts(snapshot, source_type)?
            };
            parameters.push((name, ty, known));
        }
    }
    let pools = domains
        .pools_for_parameters(&contract.name, &parameters)?
        .unwrap_or_else(|| {
            parameters
                .iter()
                .map(|(_, ty, known)| inputs(ty, *known))
                .collect()
        });
    Ok(Some(Testable {
        name: contract.name.clone(),
        binding: None,
        returns,
        result_absent: result_absent(snapshot, signature.return_type)?,
        params: parameters
            .into_iter()
            .map(|(_, ty, known)| (ty, known))
            .collect(),
        input_pools: Some(pools),
        excluded_tuples: exclusions.tuples_for(&contract.name),
    }))
}

pub(super) fn validate(expected: &BTreeSet<String>, cases: &[Testable]) -> Result<()> {
    let actual = cases
        .iter()
        .map(|case| case.name.clone())
        .collect::<BTreeSet<_>>();
    ensure!(
        &actual == expected && actual.len() == cases.len(),
        "oracle plan lost or duplicated a source export"
    );
    for case in cases {
        ensure!(
            !case
                .input_pools
                .as_ref()
                .is_some_and(|pools| pools.iter().any(Vec::is_empty)),
            "oracle plan has an empty parameter pool for declared export {}",
            case.name
        );
        ensure!(
            !case.tuples().is_empty(),
            "oracle plan has an empty population for declared export {}",
            case.name
        );
        ensure!(
            !super::interleaved(std::slice::from_ref(case)).is_empty(),
            "oracle exclusions empty the population for declared export {}",
            case.name
        );
    }
    Ok(())
}

/// Keep the source pools; only the calling convention comes from prepared HIR.
pub(super) fn compiled(cases: &[Testable], program: &hir::Program) -> Vec<Testable> {
    compiled_bindings(cases, program.public_api.iter(), program.funcs.iter())
}

// Ambiguous names never become a callable binding, including identical duplicate
// entries. Each inventory is consumed once, independently of the export count.
fn unique_index<'a, T: Copy>(
    entries: impl Iterator<Item = (&'a str, T)>,
) -> HashMap<&'a str, Option<T>> {
    let mut index = HashMap::new();
    for (name, value) in entries {
        index
            .entry(name)
            .and_modify(|entry| *entry = None)
            .or_insert(Some(value));
    }
    index
}

fn compiled_bindings<'a>(
    cases: &[Testable],
    published: impl Iterator<Item = &'a (String, String)>,
    functions: impl Iterator<Item = &'a hir::Func>,
) -> Vec<Testable> {
    let published =
        unique_index(published.map(|(binding, name)| (name.as_str(), binding.as_str())));
    let functions = unique_index(functions.map(|function| (function.name.as_str(), function)));
    cases
        .iter()
        .filter_map(|case| {
            let binding = published.get(case.name.as_str()).copied().flatten()?;
            let function = functions.get(binding).copied().flatten()?;
            if function.params.len() != case.params.len()
                || !drivable(&function.return_type)
                || !function
                    .params
                    .iter()
                    .all(|parameter| drivable(&parameter.ty))
            {
                return None;
            }
            let mut abi = case.clone();
            abi.binding = Some(binding.to_owned());
            abi.returns = function.return_type.clone();
            abi.result_absent = function.result_absent;
            abi.params = function
                .params
                .iter()
                .zip(&case.params)
                // ABI preparation can change its facts; sampling belongs to
                // the source contract, including each resting anchor.
                .map(|(parameter, (_, samples))| (parameter.ty.clone(), *samples))
                .collect();
            Some(abi)
        })
        .collect()
}

pub(super) fn alignment(
    all: &[Testable],
    compiled: &[Testable],
) -> Result<(Vec<usize>, Vec<usize>)> {
    let all = super::results(all);
    let indices = all
        .iter()
        .enumerate()
        .map(|(index, key)| (key, index))
        .collect::<HashMap<_, _>>();
    let selected = super::results(compiled)
        .iter()
        .map(|key| {
            indices
                .get(key)
                .copied()
                .context("compiled driver generated a case outside the source population")
        })
        .collect::<Result<Vec<_>>>()?;
    let selected_set = selected.iter().copied().collect::<BTreeSet<_>>();
    ensure!(
        selected.len() == selected_set.len(),
        "compiled driver duplicated a source case"
    );
    let missing = (0..all.len())
        .filter(|index| !selected_set.contains(index))
        .collect();
    Ok((selected, missing))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use nts_frontend_ts::Frontend;
    use std::fmt::Write;

    fn project(label: &str, source: &str) -> (crate::Scratch, camino::Utf8PathBuf, Frontend) {
        let path = camino::Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!("nts-source-plan-{label}-{}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize_utf8()
            .unwrap();
        let config = path.join("tsconfig.json");
        std::fs::write(
            &config,
            serde_json::json!({"extends":root.join("tsconfig.fixtures.json"),"files":["main.ts"]})
                .to_string(),
        )
        .unwrap();
        std::fs::write(path.join("main.ts"), source).unwrap();
        let frontend = Frontend::new(&path).with_checkers(std::num::NonZeroU16::MIN);
        (crate::Scratch::holding(path), config, frontend)
    }

    // Manufacture a refusal at the eval language boundary. Its one-difference
    // control evaluates the same n + 1 expression directly.
    const REFUSED: &str =
        "export function refused(n: number): number { return eval('n + 1') as number; }";

    #[test]
    fn fully_refused_source_keeps_the_measured_node_population() {
        let (_scratch, config, mut frontend) = project("fully-refused", REFUSED);
        let plan = crate::oracle_plan(&config, &mut frontend, crate::Backend::C).unwrap();
        assert_eq!(plan["source_exports"], serde_json::json!(["refused"]));
        assert_eq!(plan["case_count"], crate::POOL.len());
        let report = crate::check(&config, &mut frontend).unwrap();
        assert_eq!(report.expected, crate::POOL.len());
        assert_eq!(report.refused, report.expected);
        assert_eq!(report.checked, 0);
        assert_eq!(report.disagreements, [] as [(String, String); 0]);
    }

    #[test]
    fn unavailable_bindings_do_not_compare_unexecuted_module_output() {
        let source = format!("console.log('source module output');\n{REFUSED}");
        let (_scratch, config, mut frontend) = project("unavailable-output", &source);
        let report = crate::check(&config, &mut frontend).unwrap();
        assert_eq!(report.status(), crate::check_report::Status::AllUnavailable);
        assert_eq!(report.node_received, crate::POOL.len());
        assert_eq!(report.disagreements, [] as [(String, String); 0]);
    }

    #[test]
    fn a_compiled_control_still_agrees_beside_the_refused_export() {
        let source =
            format!("{REFUSED}\nexport function control(n: number): number {{ return n + 1; }}");
        let (_scratch, config, mut frontend) = project("control", &source);
        let report = crate::check(&config, &mut frontend).unwrap();
        assert_eq!(report.expected, crate::POOL.len() * 2);
        assert_eq!(report.refused, crate::POOL.len());
        assert_eq!(report.checked, crate::POOL.len());
        assert_eq!(report.disagreements, [] as [(String, String); 0]);
    }

    #[test]
    fn a_source_export_alias_uses_the_recorded_abi_binding() {
        let (_scratch, config, mut frontend) = project(
            "alias",
            "function declared(n: number): number { return n + 1; } export { declared as publicName };",
        );
        let report = crate::check(&config, &mut frontend).unwrap();
        assert_eq!(report.expected, crate::POOL.len());
        assert_eq!(report.checked, report.expected);
        assert_eq!(report.refused, 0);
        assert_eq!(report.disagreements, [] as [(String, String); 0]);
    }

    #[test]
    fn fixed_tuple_rest_exports_keep_their_positional_population() {
        let (_scratch, config, mut frontend) = project(
            "fixed-rest",
            "export function rest(...values: [number]): number { return values[0] + 1; }\n\
             export function ordinary(value: number): number { return value + 1; }",
        );
        let plan = crate::oracle_plan(&config, &mut frontend, crate::Backend::C).unwrap();
        assert_eq!(
            plan["source_exports"],
            serde_json::json!(["ordinary", "rest"])
        );
        assert_eq!(plan["case_count"], crate::POOL.len() * 2);
        let report = crate::check(&config, &mut frontend).unwrap();
        assert_eq!(report.expected, crate::POOL.len() * 2);
        assert_eq!(report.checked, report.expected);
        assert_eq!(report.refused, 0);
        assert_eq!(report.disagreements, [] as [(String, String); 0]);
    }

    #[test]
    fn source_discovery_keeps_overloads_arrows_variables_and_aliases() {
        let (_scratch, config, mut frontend) = project(
            "callable-shapes",
            "export function overloaded(n: 64): number;\n\
             export function overloaded(n: number): number;\n\
             export function overloaded(n: number): number { return n + 1; }\n\
             export const arrow = (n: number): number => n + 1;\n\
             export const expression = function(n: number): number { return n + 1; };\n\
             export let variable: (n: number) => number = (n) => n + 1;\n\
             const local = (n: number): number => n + 1; export { local as alias };",
        );
        let plan = crate::oracle_plan(&config, &mut frontend, crate::Backend::C).unwrap();
        let expected = ["alias", "arrow", "expression", "overloaded", "variable"];
        assert_eq!(plan["source_exports"], serde_json::json!(expected));
        // The first overload declares 64, retaining that extra arrival without
        // filtering any representation-wide value. The other exports use TOP.
        assert_eq!(plan["case_count"], crate::POOL.len() * expected.len() + 1);
        for name in expected {
            assert_eq!(
                plan["cases"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|row| { row.as_str().unwrap().starts_with(&format!("{name} ")) })
                    .count(),
                crate::POOL.len() + usize::from(name == "overloaded"),
                "source discovery/drivability must retain {name}"
            );
        }
    }

    #[test]
    fn shared_alias_chains_use_one_bounded_declaration_inventory() {
        let mut source = "export function root(n: number): number { return n + 1; }\n".to_owned();
        for index in 0..256 {
            let previous = if index == 0 {
                "root".to_owned()
            } else {
                format!("alias{}", index - 1)
            };
            writeln!(source, "export const alias{index} = {previous};").unwrap();
        }
        let (_scratch, config, mut frontend) = project("shared-aliases", &source);
        let plan = crate::oracle_plan(&config, &mut frontend, crate::Backend::C).unwrap();
        assert_eq!(plan["source_exports"].as_array().unwrap().len(), 257);
        assert_eq!(plan["case_count"], 257 * crate::POOL.len());
    }

    #[test]
    fn native_scalar_source_pools_match_the_prepared_abi_population() {
        let (_scratch, config, mut frontend) = project(
            "native-source-pools",
            "import type { Int8, Uint8, c_int, Float32, Float64 } from '@nts/scalars';\n\
             export function signedByte(n: Int8): number { return n; }\n\
             export function unsignedByte(n: Uint8): number { return n; }\n\
             export function nativeInt(n: c_int): number { return n; }\n\
             export function single(n: Float32): number { return n; }\n\
             export function double(n: Float64): number { return n; }\n\
             export function typedReturn(n: Uint8): Uint8 { return n; }\n\
             export function inferredReturn(n: Uint8) { return n; }",
        );
        // As in corpus native-scalar fixtures, include their ambient module.
        let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize_utf8()
            .unwrap();
        let mut options: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&config).unwrap()).unwrap();
        options["files"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!(root.join("runtime/native/scalars.d.ts")));
        std::fs::write(&config, options.to_string()).unwrap();
        let checked = crate::prepare_check(&config, &mut frontend, crate::Backend::C).unwrap();
        assert_eq!(
            checked
                .testable
                .iter()
                .map(|case| case.name.as_str())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "signedByte",
                "unsignedByte",
                "nativeInt",
                "single",
                "double",
                "typedReturn",
                "inferredReturn"
            ])
        );
        let selected = compiled(&checked.testable, &checked.prepared.program);
        assert_eq!(selected.len(), 7);
        for source in &checked.testable {
            let abi = selected
                .iter()
                .find(|case| case.name == source.name)
                .unwrap();
            assert_eq!(
                source.params[0].0, abi.params[0].0,
                "{} representation",
                source.name
            );
            assert_eq!(
                source.returns, abi.returns,
                "{} return representation",
                source.name
            );
            let abi_pool = inputs(&abi.params[0].0, Facts::TOP);
            let source_pool = &source.input_pools.as_ref().unwrap()[0];
            assert_eq!(
                source_pool
                    .iter()
                    .map(|value| value.to_bits())
                    .collect::<Vec<_>>(),
                abi_pool
                    .iter()
                    .map(|value| value.to_bits())
                    .collect::<Vec<_>>(),
                "{} population",
                source.name
            );
        }
    }

    #[test]
    fn binding_inventories_are_visited_once_and_ambiguities_are_unavailable() {
        use std::cell::Cell;
        let (_scratch, config, mut frontend) = project(
            "binding-index",
            "export function first(n: number): number { return n + 1; }\n\
             export function second(n: number): number { return n - 1; }",
        );
        let checked = crate::prepare_check(&config, &mut frontend, crate::Backend::C).unwrap();
        let program = &checked.prepared.program;
        let cases = (0..2048)
            .flat_map(|_| checked.testable.iter().cloned())
            .collect::<Vec<_>>();
        let public_visits = Cell::new(0);
        let function_visits = Cell::new(0);
        let selected = compiled_bindings(
            &cases,
            program
                .public_api
                .iter()
                .inspect(|_| public_visits.set(public_visits.get() + 1)),
            program
                .funcs
                .iter()
                .inspect(|_| function_visits.set(function_visits.get() + 1)),
        );
        assert_eq!(selected.len(), cases.len());
        assert_eq!(public_visits.get(), program.public_api.len());
        assert_eq!(function_visits.get(), program.funcs.len());
        let duplicate = &program.public_api[0];
        let ambiguous = compiled_bindings(
            &checked.testable,
            program.public_api.iter().chain(std::iter::once(duplicate)),
            program.funcs.iter(),
        );
        assert_eq!(ambiguous.len(), 1);
        assert_ne!(ambiguous[0].name, duplicate.1);
        let function = program
            .funcs
            .iter()
            .find(|function| function.name == duplicate.0)
            .unwrap();
        let ambiguous = compiled_bindings(
            &checked.testable,
            program.public_api.iter(),
            program.funcs.iter().chain(std::iter::once(function)),
        );
        assert_eq!(ambiguous.len(), 1);
        assert_ne!(ambiguous[0].name, duplicate.1);
    }

    #[test]
    fn abi_facts_cannot_change_the_source_population() {
        let (_scratch, config, mut frontend) = project(
            "abi-sampling",
            "export function claimed(value: 64, extra: number): number { return value + extra; }",
        );
        let mut check = crate::prepare_check(&config, &mut frontend, crate::Backend::C).unwrap();
        for function in &mut check.prepared.program.funcs {
            for parameter in &mut function.params {
                parameter.known = Facts::TOP;
            }
        }
        let available = compiled(&check.testable, &check.prepared.program);
        assert_eq!(available.len(), 1);
        let (selected, missing) = alignment(&check.testable, &available).unwrap();
        assert_eq!(selected.len(), crate::results(&check.testable).len());
        assert_eq!(missing, [] as [usize; 0]);
        assert_eq!(crate::results(&check.testable), crate::results(&available));
    }

    #[test]
    fn dropping_a_source_export_or_emptying_its_pool_is_an_error() {
        let (_scratch, config, mut frontend) = project("drop-control", REFUSED);
        let snapshot = crate::capture(&config, &mut frontend).unwrap();
        let mut population = crate::case_population(&snapshot).unwrap();
        let expected = BTreeSet::from(["refused".to_owned()]);
        validate(&expected, &[]).unwrap_err();
        population.testable[0].input_pools = Some(vec![Vec::new()]);
        validate(&expected, &population.testable).unwrap_err();
    }
}
