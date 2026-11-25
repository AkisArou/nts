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
    /// How the call answers: with its number, or with a promise of one.
    #[serde(default)]
    pub(super) answer: Answer,
}

/// How a workload's call delivers its number.
///
/// An event-loop workload cannot answer synchronously: its timers, promise
/// jobs and I/O completions run only after the call returns to the loop. So
/// it answers with `Promise<number>`, and every driver waits for that promise
/// before the call counts as done -- node and Bun by `await`, a native driver
/// by joining it on the libuv host -- so one call is one fixed amount of
/// event-loop work in every column.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) enum Answer {
    /// `(number) => number`.
    #[default]
    Returned,
    /// `(number) => Promise<number>`.
    Promised,
}

impl Numeric {
    /// A floating literal in C++, Java and JavaScript, including negative zero.
    pub(super) fn input(&self) -> String {
        format!("{:e}", self.seed)
    }
}

impl Workload {
    /// A launch case's workload: the whole program, evaluated from its
    /// module's top level, with no exported call.
    pub(super) fn whole_program() -> Self {
        Self {
            roots: vec![hir::lower::MODULE_INIT.to_owned()],
            numeric: None,
        }
    }

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
                    compatible(snapshot, function.1).is_some(),
                    "{entry}: exported work must have the contract (number) => number or (number) => Promise<number>"
                );
                function
            } else {
                ensure!(
                    !module.exports.iter().any(|(name, _)| name == "work"),
                    "{entry}: exported work is not a numeric benchmark function"
                );
                let mut candidates = functions
                    .iter()
                    .filter(|(_, signature)| compatible(snapshot, *signature).is_some());
                let function = candidates.next().with_context(|| format!(
                    "{entry}: no exported function has the contract (number) => number or (number) => Promise<number>; provide explicit drivers"))?;
                ensure!(
                    candidates.next().is_none(),
                    "{entry}: ambiguous numeric benchmark exports; export work or provide explicit drivers"
                );
                function
            };
            let answer =
                compatible(snapshot, *signature).context("selected benchmark signature changed")?;
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
                    answer,
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
            && walk::parent(snapshot, declaration).and_then(|id| walk::kind_of(snapshot, id))
                == Some(syntax::SOURCE_FILE)
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

/// How a signature answers, when it is a benchmark's: one required number in,
/// and a number or a promise of one out.
fn compatible(snapshot: &SemanticSnapshot, signature: SignatureId) -> Option<Answer> {
    let signature = &snapshot.signatures[signature.0 as usize];
    let takes = signature.type_parameters.is_empty()
        && signature.this_type.is_none()
        && signature.parameters.len() == 1
        && !signature.parameters[0].optional
        && !signature.parameters[0].rest
        && numeric(snapshot, signature.parameters[0].ty);
    if !takes {
        None
    } else if numeric(snapshot, signature.return_type) {
        Some(Answer::Returned)
    } else if promised_number(snapshot, signature.return_type) {
        Some(Answer::Promised)
    } else {
        None
    }
}

/// The library's `Promise<number>`, by the checker's identity and type
/// argument: a class of the program's named `Promise` is not one, and the
/// payload is read from the type, so an inferred `async` return counts.
fn promised_number(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    snapshot.provided_name(ty) == Some("Promise")
        && snapshot.type_arguments.get(&ty).is_some_and(
            |arguments| matches!(arguments.as_slice(), [payload] if numeric(snapshot, *payload)),
        )
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
        (
            "closure",
            "export const work = (n: number): number => n; export const seed = 1;",
        ),
        (
            "overload",
            "export function work(n: number): number; export function work(n: string): number; export function work(n: number | string): number { return Number(n); } export const seed = 1;",
        ),
        (
            "alias",
            "function different(n: number): number { return n; } export { different as work }; export const seed = 1;",
        ),
        (
            "promised",
            "export async function work(n: number): Promise<number> { return n + 1; } export const seed = 13;",
        ),
        (
            "promised-inferred",
            "export async function work(n: number) { return n * 2; } export const seed = 2;",
        ),
        (
            "promised-text",
            "export async function work(n: number): Promise<string> { return `${n}`; } export const seed = 1;",
        ),
        (
            "promised-own",
            "class Promise<T> { constructor(readonly value: T) {} } export function work(n: number): Promise<number> { return new Promise(n); } export const seed = 1;",
        ),
    ];

    /// The producer's serialization, which `workload-identity.ts` encodes.
    const SERIALIZATION: &str = include_str!("../workload-serialization.json");

    /// Every answer, exhaustively: a new variant fails to compile here, and
    /// once listed it changes the serialization the identity contract pins.
    fn every_answer() -> [Answer; 2] {
        let answers = [Answer::Returned, Answer::Promised];
        for answer in answers {
            match answer {
                Answer::Returned | Answer::Promised => {}
            }
        }
        answers
    }

    #[test]
    fn producer_serialization_is_the_identity_contract() -> Result<()> {
        let contract: serde_json::Value = serde_json::from_str(SERIALIZATION)?;
        let mut produced = serde_json::Map::new();
        produced.insert(
            "whole-program".into(),
            serde_json::to_value(Workload::whole_program())?,
        );
        for answer in every_answer() {
            // A struct literal: a new field must be given here, and then
            // appears in the serialization compared below.
            let workload = Workload {
                roots: vec!["work".into(), hir::lower::MODULE_INIT.into()],
                numeric: Some(Numeric {
                    callee: "work".into(),
                    seed: 3.0,
                    answer,
                }),
            };
            produced.insert(format!("{answer:?}"), serde_json::to_value(&workload)?);
        }
        assert_eq!(
            contract["produced"],
            serde_json::Value::Object(produced),
            "the Workload serialization changed: update tooling/bench/workload-serialization.json \
             and decide the new form's identity in tooling/bench/workload-identity.ts"
        );
        // Workloads recorded before a defaulted field existed still read as their form.
        for (name, legacy) in contract["legacy"]
            .as_object()
            .context("legacy serializations")?
        {
            let read: Workload = serde_json::from_value(legacy["serialized"].clone())?;
            let form = legacy["reads-as"].as_str().context("legacy form")?;
            assert_eq!(
                serde_json::to_value(&read)?,
                contract["produced"][form],
                "{name}"
            );
        }
        Ok(())
    }

    #[test]
    fn source_contract_and_driver_controls() -> Result<()> {
        let repository = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("benchmark fixture path")
            .parent()
            .expect("benchmark fixture path");
        let root = crate::scratch::ScratchDir::path_in_target("bench-workload-controls");
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
        assert_eq!(selected.numeric()?.answer, Answer::Returned);
        assert_eq!(recorded.numeric()?.answer, Answer::Returned);
        assert_eq!(plan("legacy", false)?.numeric()?.callee, "scan");
        for name in ["promised", "promised-inferred"] {
            let promised = plan(name, false)?;
            assert_eq!(promised.numeric()?.answer, Answer::Promised, "{name}");
            let recorded: Workload = serde_json::from_str(&serde_json::to_string(&promised)?)?;
            assert_eq!(recorded.numeric()?.answer, Answer::Promised, "{name}");
        }
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
            ("promised-text", "(number) => Promise<number>"),
            ("promised-own", "(number) => Promise<number>"),
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
        exercise_promised_drivers(&cases.join("promised"), &output, &plan("promised", false)?)?;
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
            "let reads = 0;\n\
             export function opaqueInput(value) { reads++; return value; }\n\
             export function measure(run) {\n\
               const answer = run();\n\
               if (reads !== 1) throw new Error('driver did not read its opaque input');\n\
               console.log(answer);\n\
             }\n",
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
        assert!(!driver.contains("nts_bench_settle"));
        Ok(())
    }

    /// A promised workload's drivers wait for its promise: node's awaits it
    /// through `measureAsync`, the native one joins it on the libuv host.
    fn exercise_promised_drivers(
        case: &Utf8Path,
        output: &Utf8Path,
        promised: &Workload,
    ) -> Result<()> {
        // The shared observer `exercise_drivers` wrote, given an async form.
        let common = case
            .parent()
            .and_then(Utf8Path::parent)
            .context("case under benchmarks/cases")?
            .join("common/bench.mjs");
        std::fs::write(
            &common,
            "export function opaqueInput(value) { return value; }\n\
             export function measure() { throw new Error('a promised workload took the synchronous timer'); }\n\
             export async function measureAsync(run) {\n\
               const pending = run();\n\
               if (!(pending instanceof Promise)) throw new Error('the workload did not answer with a promise');\n\
               console.log(await pending);\n\
             }\n",
        )?;
        let harness = crate::node_harness(case, output, "promised", promised)?;
        let result = std::process::Command::new("node")
            .arg(&harness)
            .arg(promised.numeric()?.input())
            .output()?;
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&result.stdout).trim(), "14");
        let native = crate::native_driver(case, output, "promised", false, promised)?;
        let driver = std::fs::read_to_string(native)?;
        assert!(driver.contains("NtsPromise *work(double);"), "{driver}");
        assert!(driver.contains("nts_bench_host_start();"), "{driver}");
        assert!(
            driver.contains("return nts_bench_settle(work(in0));"),
            "{driver}"
        );
        Ok(())
    }
}
