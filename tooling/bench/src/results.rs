//! The latest benchmark result for each target, in `results/benchmarks/`.
//!
//! **Every run records what it measured.** The README table is rewritten only
//! by a clean full run, which last happened on 2026-09-10, so the table a
//! reader found was six weeks older than the numbers being quoted. A partial
//! run (`NTS_BENCH_LANES`, a few cases) measures real cells too: it updates
//! those and no others, and each row says when and at which commit it was
//! measured, so a table made of several runs reads as what it is.
//!
//! - `cells.tsv` -- the data: the newest measurement of each case and column,
//!   one line each, so it grows with the table and not with the runs.
//! - `c.md`, `llvm.md`, `jvm.md`, `wasm.md` -- one table per target: nts
//!   against node and against that target's own reference.
//!
//! Written in the tree the run is made from, and landed like any change.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use anyhow::{Context, Result};
use camino::Utf8Path;

use super::{Row, human, lane_matches};

/// The columns kept: the key in `cells.tsv`, and the label a lane filter
/// matches.
const COLUMNS: [(&str, &str); 9] = [
    ("cpp", "C++"),
    ("nts_c", "nts"),
    ("nts_llvm", "nts (LLVM)"),
    ("nts_jvm", "nts (JVM)"),
    ("java", "Java"),
    ("nts_wasm", "nts (Wasm)"),
    ("cpp_wasm", "C++ (wasm)"),
    ("node", "V8"),
    ("bun", "Bun"),
];

/// Each target's file: its name, its nts column, its reference column and
/// what the reference is called.
const TARGETS: [(&str, &str, &str, &str); 4] = [
    ("c", "nts_c", "cpp", "C++"),
    ("llvm", "nts_llvm", "cpp", "C++"),
    ("jvm", "nts_jvm", "java", "Java"),
    ("wasm", "nts_wasm", "cpp_wasm", "C++ (wasm)"),
];

const HEADER: &str = "case\tcolumn\tns_per_call\tmeasured\tcommit\tnote";

/// One measured cell: nanoseconds per call, or `None` where the program was
/// refused.
#[derive(Debug, Clone, PartialEq)]
struct Cell {
    ns: Option<f64>,
    measured: String,
    commit: String,
    note: String,
}

/// Where and when a run was made, and what it measured.
pub(super) struct Run<'a> {
    pub measured: String,
    pub commit: String,
    pub lanes: Option<&'a [String]>,
    pub spoiled: &'a [String],
}

/// The run's date and commit, asked of the clock and of git.
pub(super) fn stamp(root: &Utf8Path) -> (String, String) {
    let measured = command_line("date", &["-u", "+%Y-%m-%d %H:%M UTC"], root)
        .unwrap_or_else(|| "unknown".to_owned());
    let mut commit = command_line("git", &["rev-parse", "--short=12", "HEAD"], root)
        .unwrap_or_else(|| "unknown".to_owned());
    if command_line(
        "git",
        &["status", "--porcelain", "--untracked-files=no"],
        root,
    )
    .is_some_and(|status| !status.is_empty())
    {
        commit.push_str("+dirty");
    }
    (measured, commit)
}

fn command_line(program: &str, args: &[&str], root: &Utf8Path) -> Option<String> {
    let output = std::process::Command::new(program)
        .args(args)
        .current_dir(root)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// Merge a run's cells into `cells.tsv` and rewrite each target's table.
///
/// # Errors
/// A results file cannot be read or written.
pub(super) fn record(root: &Utf8Path, rows: &[Row], run: &Run<'_>) -> Result<()> {
    let fresh = cells_of(rows, run);
    if fresh.is_empty() {
        return Ok(());
    }
    let dir = root.join("results/benchmarks");
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {dir}"))?;
    let path = dir.join("cells.tsv");
    let mut cells = read(&path);
    cells.extend(fresh);
    let mut data = String::from(HEADER);
    data.push('\n');
    for ((case, column), cell) in &cells {
        let ns = cell
            .ns
            .map_or_else(|| "refused".to_owned(), |ns| format!("{ns:.1}"));
        let note = cell.note.replace(['\t', '\n'], " ");
        let _ = writeln!(
            data,
            "{case}\t{column}\t{ns}\t{}\t{}\t{note}",
            cell.measured, cell.commit
        );
    }
    std::fs::write(&path, data).with_context(|| format!("writing {path}"))?;
    for (target, nts, reference, named) in TARGETS {
        let file = dir.join(format!("{target}.md"));
        std::fs::write(&file, render(&cells, target, nts, (reference, named)))
            .with_context(|| format!("writing {file}"))?;
    }
    println!("\nResults recorded in {dir}");
    Ok(())
}

/// The cells this run measured: every column its lane filter let through, for
/// every row it assembled.
fn cells_of(rows: &[Row], run: &Run<'_>) -> BTreeMap<(String, String), Cell> {
    let measured = |label: &str| {
        label == "V8"
            || run
                .lanes
                .is_none_or(|lanes| lanes.iter().any(|lane| lane_matches(lane, label)))
    };
    let mut found = BTreeMap::new();
    for row in rows {
        let spoiled = run.spoiled.contains(&row.case);
        for (key, label) in COLUMNS {
            if !measured(label) {
                continue;
            }
            let (ns, refused) = value(row, key);
            // NaN is how a row says a lane was not run; it is no time.
            let ns = ns.filter(|ns| !ns.is_nan());
            // A column the case has no implementation for -- no `ref.cpp`, no
            // Bun installed -- is not a measurement.
            if ns.is_none() && !refused {
                continue;
            }
            let mut note = Vec::new();
            if spoiled {
                note.push("measured beside other work".to_owned());
            }
            if let Some((_, spread)) = row.varied.iter().find(|(name, _)| name == label) {
                note.push(format!("varied {:.0}%", spread * 100.0));
            }
            found.insert(
                (row.case.clone(), key.to_owned()),
                Cell {
                    ns,
                    measured: run.measured.clone(),
                    commit: run.commit.clone(),
                    note: note.join("; "),
                },
            );
        }
    }
    found
}

/// A row's value for one column, and whether its absence is a refusal (an nts
/// column) rather than a reference the case does not have.
fn value(row: &Row, key: &str) -> (Option<f64>, bool) {
    let nts = |ns: Option<f64>| (ns, ns.is_none());
    match key {
        "cpp" => (row.cpp, false),
        "nts_c" => nts(row.nts),
        "nts_llvm" => nts(row.llvm),
        "nts_jvm" => nts(row.jvm),
        "java" => (row.java, false),
        "nts_wasm" => nts(row.wasm),
        "cpp_wasm" => (row.cpp_wasm, false),
        "node" => (Some(row.node), false),
        "bun" => (row.bun, false),
        _ => (None, false),
    }
}

fn read(path: &Utf8Path) -> BTreeMap<(String, String), Cell> {
    let mut cells = BTreeMap::new();
    let Ok(text) = std::fs::read_to_string(path) else {
        return cells;
    };
    for line in text.lines().skip(1) {
        let fields: Vec<&str> = line.split('\t').collect();
        let [case, column, ns, measured, commit, note] = fields.as_slice() else {
            continue;
        };
        cells.insert(
            ((*case).to_owned(), (*column).to_owned()),
            Cell {
                ns: ns.parse().ok(),
                measured: (*measured).to_owned(),
                commit: (*commit).to_owned(),
                note: (*note).to_owned(),
            },
        );
    }
    cells
}

/// One target's table: every case it has a cell for.
fn render(
    cells: &BTreeMap<(String, String), Cell>,
    target: &str,
    nts: &str,
    (reference, named): (&str, &str),
) -> String {
    let get = |case: &str, column: &str| cells.get(&(case.to_owned(), column.to_owned()));
    let mut cases: Vec<&str> = cells
        .keys()
        .filter(|(_, column)| column == nts)
        .map(|(case, _)| case.as_str())
        .collect();
    cases.dedup();
    let ratio = |top: Option<&Cell>, bottom: Option<&Cell>| match (
        top.and_then(|cell| cell.ns),
        bottom.and_then(|cell| cell.ns),
    ) {
        (Some(top), Some(bottom)) if bottom > 0.0 => Some(top / bottom),
        _ => None,
    };
    let losing = cases
        .iter()
        .filter(|case| ratio(get(case, nts), get(case, "node")).is_some_and(|r| r > 1.0))
        .count();
    let refused = cases
        .iter()
        .filter(|case| get(case, nts).is_some_and(|cell| cell.ns.is_none()))
        .count();

    let mut out = String::new();
    let _ = writeln!(out, "# nts ({target}): latest results\n");
    let _ = writeln!(
        out,
        "{} cases; nts is slower than node on **{losing}**, and refuses {refused}. \
         Time per call; `x` is nts divided by the column named. \
         Written by `nts-bench`; a row is from its own run.\n",
        cases.len()
    );
    let _ = writeln!(
        out,
        "| case | nts | node | nts/node | {named} | nts/{named} | measured |\n| --- | ---: | ---: | ---: | ---: | ---: | --- |"
    );
    for case in &cases {
        let mine = get(case, nts);
        let shown = |cell: Option<&Cell>| {
            cell.map_or_else(
                || "--".to_owned(),
                |cell| cell.ns.map_or_else(|| "refused".to_owned(), human),
            )
        };
        let times = |r: Option<f64>| r.map_or_else(|| "--".to_owned(), |r| format!("{r:.2}x"));
        let against_node = ratio(mine, get(case, "node"));
        let flag = if against_node.is_some_and(|r| r > 1.0) {
            " ▲"
        } else {
            ""
        };
        let when = mine.map_or("", |cell| cell.measured.as_str());
        let note = mine
            .filter(|cell| !cell.note.is_empty())
            .map_or_else(String::new, |cell| format!(" ({})", cell.note));
        let _ = writeln!(
            out,
            "| {case} | {} | {} | {}{flag} | {} | {} | {when}{note} |",
            shown(mine),
            shown(get(case, "node")),
            times(against_node),
            shown(get(case, reference)),
            times(ratio(mine, get(case, reference))),
        );
    }
    out.push_str("\n▲ slower than node.\n");
    out
}

#[cfg(test)]
mod tests {
    use super::{BTreeMap, Cell, render};

    fn cell(ns: Option<f64>, measured: &str) -> Cell {
        Cell {
            ns,
            measured: measured.to_owned(),
            commit: "abc".to_owned(),
            note: String::new(),
        }
    }

    /// A row slower than node is counted and marked, a refusal says so, and a
    /// case the target has no cell for is not in its table.
    #[test]
    fn a_target_table_marks_what_loses_to_node() {
        let mut cells = BTreeMap::new();
        let put = |cells: &mut BTreeMap<_, _>, case: &str, column: &str, ns| {
            cells.insert(
                (case.to_owned(), column.to_owned()),
                cell(ns, "2026-10-21 20:00 UTC"),
            );
        };
        put(&mut cells, "a", "node", Some(100.0));
        put(&mut cells, "a", "nts_c", Some(150.0));
        put(&mut cells, "a", "cpp", Some(75.0));
        put(&mut cells, "b", "node", Some(100.0));
        put(&mut cells, "b", "nts_c", None);
        put(&mut cells, "c", "node", Some(100.0));
        let text = render(&cells, "c", "nts_c", ("cpp", "C++"));
        assert!(
            text.contains("2 cases; nts is slower than node on **1**, and refuses 1."),
            "{text}"
        );
        assert!(
            text.contains("| a | 150.0 ns | 100.0 ns | 1.50x ▲ | 75.0 ns | 2.00x |"),
            "{text}"
        );
        assert!(text.contains("| b | refused |"), "{text}");
        assert!(!text.contains("| c |"), "{text}");
    }
}
