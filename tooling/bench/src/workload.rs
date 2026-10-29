//! The source contract every generated benchmark driver executes.
//!
//! Plan before lowering: a refused `work` remains the subject, and a string
//! renderer appearing before it can never become a numeric native ABI.

use anyhow::{Context, Result, bail, ensure};
use camino::Utf8Path;
use nts_core::hir;
use nts_semantic_schema::{
    LiteralValue, NodeData, NodeId, NodeKind, SemanticSnapshot, SignatureId, SymbolId, TypeId,
    TypeKind, VariableKind, children, syntax, walk,
};

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct Workload {
    pub(super) roots: Vec<String>,
    numeric: Option<Numeric>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct Numeric {
    pub(super) callee: String,
    seed: f64,
}

impl Numeric {
    /// A floating literal in C++, Java and JavaScript, including negative zero.
    pub(super) fn input(&self) -> String {
        format!("{:e}", self.seed)
    }
}

impl Workload {
    pub(super) fn numeric(&self) -> Result<&Numeric> {
        self.numeric
            .as_ref()
            .context("benchmark requires an explicit driver")
    }

    pub(super) fn from_source(
        snapshot: &SemanticSnapshot,
        entry: &Utf8Path,
        custom: bool,
    ) -> Result<Self> {
        let module = snapshot
            .modules
            .iter()
            .find(|module| snapshot.sources[module.file.0 as usize].display_path == entry)
            .with_context(|| format!("benchmark source module is missing: {entry}"))?;
        let functions: Vec<_> = module
            .exports
            .iter()
            .filter_map(|(name, symbol)| {
                signature(snapshot, *symbol).map(|signature| (name, signature))
            })
            .collect();
        ensure!(
            !functions.is_empty(),
            "{entry} exports no benchmark function"
        );
        let (mut roots, numeric) = if custom {
            (
                functions.iter().map(|(name, _)| (*name).clone()).collect(),
                None,
            )
        } else {
            let named = functions.iter().find(|(name, _)| name.as_str() == "work");
            let (name, signature) = if let Some(function) = named {
                ensure!(
                    compatible(snapshot, function.1),
                    "{entry}: exported work must have the contract (number) => number"
                );
                function
            } else {
                ensure!(
                    !module.exports.iter().any(|(name, _)| name == "work"),
                    "{entry}: exported work is not a numeric benchmark function"
                );
                let mut candidates = functions
                    .iter()
                    .filter(|(_, signature)| compatible(snapshot, *signature));
                let function = candidates.next().with_context(|| format!(
                    "{entry}: no exported function has the contract (number) => number; provide explicit drivers"))?;
                ensure!(
                    candidates.next().is_none(),
                    "{entry}: ambiguous numeric benchmark exports; export work or provide explicit drivers"
                );
                function
            };
            let _ = signature;
            let symbol = module
                .exports
                .iter()
                .find(|(export, _)| export == *name)
                .map(|(_, symbol)| *symbol)
                .context("selected benchmark binding disappeared")?;
            direct_binding(snapshot, symbol, entry, name)?;
            let seed_symbol = module
                .exports
                .iter()
                .find(|(name, _)| name == "seed")
                .map(|(_, symbol)| *symbol)
                .with_context(|| format!("{entry}: missing exported const seed benchmark input"))?;
            let seed = seed(snapshot, seed_symbol)
                .with_context(|| format!("{entry}: invalid benchmark input seed"))?;
            (
                vec![(*name).clone()],
                Some(Numeric {
                    callee: (*name).clone(),
                    seed,
                }),
            )
        };
        roots.push(hir::lower::MODULE_INIT.to_owned());
        Ok(Self { roots, numeric })
    }
}

/// A scalar C entry has no closure environment, overload implementation ABI,
/// or renamed import to guess. Other shapes retain the explicit-driver path.
fn direct_binding(
    snapshot: &SemanticSnapshot,
    id: SymbolId,
    entry: &Utf8Path,
    name: &str,
) -> Result<()> {
    let symbol = &snapshot.symbols[walk::denoted(snapshot, id).0 as usize];
    let declarations: Vec<_> = symbol
        .declarations
        .iter()
        .copied()
        .filter(|id| walk::kind_of(snapshot, *id) == Some(syntax::FUNCTION_DECLARATION))
        .collect();
    ensure!(
        declarations.len() == 1,
        "{entry}: numeric benchmark requires one direct function declaration; provide explicit drivers"
    );
    let declaration = declarations[0];
    let file = snapshot.nodes[declaration.0 as usize].origin.location.file;
    ensure!(
        snapshot.sources[file.0 as usize].display_path == entry
            && child(snapshot, declaration, "name").and_then(|id| walk::text_of(snapshot, id))
                == Some(name)
            && child(snapshot, declaration, "body").is_some(),
        "{entry}: benchmark binding must name its local implementation; provide explicit drivers"
    );
    Ok(())
}

fn signature(snapshot: &SemanticSnapshot, id: SymbolId) -> Option<SignatureId> {
    let symbol = &snapshot.symbols[walk::denoted(snapshot, id).0 as usize];
    symbol
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
        })
}

fn compatible(snapshot: &SemanticSnapshot, signature: SignatureId) -> bool {
    let signature = &snapshot.signatures[signature.0 as usize];
    signature.type_parameters.is_empty()
        && signature.this_type.is_none()
        && signature.parameters.len() == 1
        && !signature.parameters[0].optional
        && !signature.parameters[0].rest
        && numeric(snapshot, signature.parameters[0].ty)
        && numeric(snapshot, signature.return_type)
}

fn numeric(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    matches!(
        snapshot.types[ty.0 as usize].kind,
        TypeKind::Number | TypeKind::Literal(LiteralValue::Number(_))
    )
}

fn seed(snapshot: &SemanticSnapshot, id: SymbolId) -> Result<f64> {
    let symbol = &snapshot.symbols[walk::denoted(snapshot, id).0 as usize];
    ensure!(
        symbol
            .declarations
            .iter()
            .filter_map(|id| snapshot.node_types.get(id).copied())
            .chain(symbol.ty)
            .any(|ty| numeric(snapshot, ty)),
        "seed must have numeric type"
    );
    let declaration = symbol
        .declarations
        .iter()
        .copied()
        .find(|id| walk::kind_of(snapshot, *id) == Some(syntax::VARIABLE_DECLARATION))
        .context("seed must be a const variable declaration")?;
    let parent = walk::parent(snapshot, declaration).context("seed has no declaration list")?;
    ensure!(
        walk::kind_of(snapshot, parent) == Some(syntax::VARIABLE_DECLARATION_LIST)
            && VariableKind::from_flags(snapshot.nodes[parent.0 as usize].flags)
                == VariableKind::Const,
        "seed must be const"
    );
    let mut at = child(snapshot, declaration, "initializer").context("seed has no initializer")?;
    let mut negative = false;
    for _ in 0..64 {
        match walk::kind_of(snapshot, at) {
            Some(syntax::NUMERIC_LITERAL) => {
                // Read the initializer's value, never the binding's asserted
                // literal type: `13 as 12` still supplies thirteen at runtime.
                let ty = snapshot
                    .node_types
                    .get(&at)
                    .context("seed literal has no type")?;
                let TypeKind::Literal(LiteralValue::Number(value)) =
                    snapshot.types[ty.0 as usize].kind
                else {
                    bail!("seed initializer is not a numeric literal");
                };
                let value = if negative { -value } else { value };
                ensure!(value.is_finite(), "seed must be finite");
                return Ok(value);
            }
            Some(
                syntax::PARENTHESIZED_EXPRESSION
                | syntax::AS_EXPRESSION
                | syntax::TYPE_ASSERTION_EXPRESSION
                | syntax::NON_NULL_EXPRESSION,
            ) => {
                at = child(snapshot, at, "expression").context("seed expression is missing")?;
            }
            Some(syntax::PREFIX_UNARY_EXPRESSION) => {
                let small = match snapshot.nodes[at.0 as usize].data {
                    NodeData::Children { small, .. } | NodeData::Flags { small } => {
                        small & syntax::prefix_operator::MASK
                    }
                    NodeData::ListLength(_) => bail!("seed unary operator is missing"),
                };
                match small {
                    syntax::prefix_operator::MINUS => negative = !negative,
                    syntax::prefix_operator::PLUS => {}
                    _ => bail!("seed must be a static numeric literal"),
                }
                at = child(snapshot, at, "operand").context("seed unary operand is missing")?;
            }
            _ => bail!("seed must be a static numeric literal"),
        }
    }
    bail!("benchmark seed expression exceeds validation budget")
}

/// Decode named semantic child roles, including annotations and `JSDoc`, from
/// the schema's own property table. Source formatting never participates.
fn child(snapshot: &SemanticSnapshot, id: NodeId, role: &str) -> Option<NodeId> {
    let node = &snapshot.nodes[id.0 as usize];
    let NodeKind::Syntax(kind) = node.kind else {
        return None;
    };
    let at = children::properties(kind)
        .iter()
        .position(|name| *name == role)?;
    let NodeData::Children { present, .. } = node.data else {
        return None;
    };
    if present & (1 << at) == 0 {
        return None;
    }
    let offset = (present & ((1 << at) - 1)).count_ones() as usize;
    node.children
        .iter()
        .filter(
            |id| !matches!(walk::kind_of(snapshot, **id), Some(kind) if children::is_jsdoc(kind)),
        )
        .nth(offset)
        .copied()
}

#[cfg(test)]
mod tests {
    use super::*;
    use camino::Utf8PathBuf;

    const SOURCES: &[(&str, &str)] = &[
        (
            "render-first",
            "export function render(n: number): string { return `result ${n}`; }\nexport function\nwork(n: number): number { return n + 1; }\nexport const seed: number = (13 as 12);",
        ),
        (
            "legacy",
            "export function scan(n: number): number { return n; } export const seed = 3;",
        ),
        (
            "negative-zero",
            "export function work(n: number): number { return 1 / n; } export const seed = -(0);",
        ),
        (
            "missing",
            "export function work(n: number): number { return n; }",
        ),
        (
            "ambiguous",
            "export function f(n: number): number { return n; } export function g(n: number): number { return n; } export const seed = 1;",
        ),
        (
            "wrong-work",
            "export function work(n: number): string { return `${n}`; } export function f(n: number): number { return n; } export const seed = 1;",
        ),
        (
            "mutable",
            "export function work(n: number): number { return n; } export let seed = 1;",
        ),
        (
            "computed",
            "export function work(n: number): number { return n; } export const seed = Math.random();",
        ),
        (
            "custom",
            "export function scale(values: number[]): number { return values.length; }",
        ),
    ];

    #[test]
    fn benchmark_corpus_uses_source_contracts() -> Result<()> {
        let repository = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("benchmark fixture path")
            .parent()
            .expect("benchmark fixture path");
        let root = repository.join(format!(
            "target/bench-corpus-contracts-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root)?;
        let config = root.join("tsconfig.json");
        std::fs::write(
            &config,
            serde_json::to_vec(&serde_json::json!({
                "extends": repository.join("tsconfig.fixtures.json"),
                "include": [repository.join("benchmarks/cases/*/case.ts")]
            }))?,
        )?;
        let snapshot = crate::capture_snapshot(&config)?;
        let cases = repository.join("benchmarks/cases");
        let mut count = 0;
        for case in std::fs::read_dir(cases)? {
            let case = Utf8PathBuf::from_path_buf(case?.path()).expect("benchmark fixture path");
            if !case.join("case.ts").is_file() {
                continue;
            }
            let custom = ["driver.cpp", "driver.java", "driver.mjs"]
                .iter()
                .all(|driver| case.join(driver).exists());
            let workload = Workload::from_source(&snapshot, &case.join("case.ts"), custom)?;
            if case
                .file_name()
                .is_some_and(|name| name.starts_with("clbg-"))
            {
                assert_eq!(workload.numeric()?.callee, "work", "{case}");
            }
            count += 1;
        }
        assert!(
            count >= 100,
            "must cover the benchmark corpus, not an empty glob"
        );
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn source_contract_and_driver_controls() -> Result<()> {
        let repository = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("benchmark fixture path")
            .parent()
            .expect("benchmark fixture path");
        let root = repository.join(format!(
            "target/bench-workload-controls-{}",
            std::process::id()
        ));
        let cases = root.join("benchmarks/cases");
        let output = root.join("generated");
        std::fs::create_dir_all(&output)?;
        for (name, source) in SOURCES.iter().copied() {
            let dir = cases.join(name);
            std::fs::create_dir_all(&dir)?;
            std::fs::write(dir.join("case.ts"), source)?;
        }
        let config = root.join("tsconfig.json");
        std::fs::write(
            &config,
            serde_json::to_vec(&serde_json::json!({
                "extends": repository.join("tsconfig.fixtures.json"), "include": ["benchmarks/cases/**/*.ts"]
            }))?,
        )?;
        let snapshot = crate::capture_snapshot(&config)?;
        let plan = |name: &str, custom| {
            Workload::from_source(&snapshot, &cases.join(name).join("case.ts"), custom)
        };
        let selected = plan("render-first", false)?;
        assert_eq!(selected.numeric()?.callee, "work");
        assert_eq!(selected.numeric()?.seed, 13.0);
        let recorded: Workload = serde_json::from_str(&serde_json::to_string(&selected)?)?;
        assert_eq!(recorded.numeric()?.callee, "work");
        assert_eq!(recorded.numeric()?.seed, 13.0);
        assert_eq!(selected.roots, ["work", hir::lower::MODULE_INIT]);
        assert_eq!(plan("legacy", false)?.numeric()?.callee, "scan");
        assert_eq!(
            plan("negative-zero", false)?.numeric()?.seed.to_bits(),
            (-0.0_f64).to_bits()
        );
        for (name, reason) in [
            ("missing", "missing exported const seed"),
            ("ambiguous", "ambiguous numeric benchmark"),
            ("wrong-work", "contract (number) => number"),
            ("mutable", "seed must be const"),
            ("computed", "static numeric literal"),
            ("closure", "one direct function declaration"),
            ("overload", "one direct function declaration"),
            ("alias", "name its local implementation"),
        ] {
            let error = plan(name, false)
                .err()
                .context("invalid contract was accepted")?;
            assert!(format!("{error:#}").contains(reason), "{name}: {error:#}");
        }
        let custom = plan("custom", true)?;
        assert!(custom.numeric().is_err());
        assert_eq!(custom.roots, ["scale", hir::lower::MODULE_INIT]);

        exercise_drivers(&root, &cases.join("render-first"), &output, &selected)?;
        std::fs::remove_dir_all(root)?;
        Ok(())
    }
    fn exercise_drivers(
        root: &Utf8Path,
        case: &Utf8Path,
        output: &Utf8Path,
        selected: &Workload,
    ) -> Result<()> {
        let common = root.join("benchmarks/common");
        std::fs::create_dir_all(&common)?;
        // A completion-only test observer; no timing or calibration in a test.
        std::fs::write(
            common.join("bench.mjs"),
            "export function measure(run) { console.log(run()); }\n",
        )?;
        let harness = crate::node_harness(case, output, "selected", selected)?;
        let invoke = |argument: Option<&str>| -> Result<std::process::Output> {
            let mut command = std::process::Command::new("node");
            command.arg(&harness);
            if let Some(argument) = argument {
                command.arg(argument);
            }
            Ok(command.output()?)
        };
        let result = invoke(Some(&selected.numeric()?.input()))?;
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&result.stdout).trim(), "14");
        let missing = invoke(None)?;
        assert!(!missing.status.success());
        assert!(String::from_utf8_lossy(&missing.stderr).contains("benchmark input missing"));
        let invalid = invoke(Some("not-a-number"))?;
        assert!(!invalid.status.success());
        assert!(String::from_utf8_lossy(&invalid.stderr).contains("not a finite number"));
        let native: Utf8PathBuf = crate::native_driver(case, output, "selected", false, selected)?;
        let driver = std::fs::read_to_string(native)?;
        assert!(driver.contains("double work(double);"));
        assert!(driver.contains("volatile double in0 = 1.3e1;"));
        assert!(!driver.contains("render("));
        Ok(())
    }
}
