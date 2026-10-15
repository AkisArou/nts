//! Prepared TypeScript → bytes → validator → Node loader → same-source answers.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::path::Path;

fn prepared_project(fixture: &Path) -> hir::Program {
    let tsgo = std::env::var("NTS_TSGO")
        .expect("NTS_TSGO required: wasm execution tests must not silently skip");
    let tsconfig = Utf8PathBuf::from_path_buf(fixture.join("tsconfig.json")).unwrap();
    let snapshot = TsgoApi::for_compilation(Utf8PathBuf::from(tsgo))
        .snapshot(&tsconfig)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:#?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Provider::HostGc,
            ..hir::Options::default()
        },
    )
    .expect("prepared HIR verifies");
    for func in &prepared.program.funcs {
        for block in &func.blocks {
            for &id in &block.ops {
                if let hir::OpKind::Call {
                    callee: hir::Callee::External(name),
                    ..
                } = &func.value(id).kind
                {
                    assert!(
                        nts_codegen_wasm::helper_support(name).is_some(),
                        "unclassified prepared helper {name} in {} ({})",
                        func.name,
                        fixture.display()
                    );
                }
            }
        }
    }
    prepared.program
}

fn emit_project(fixture: &Path) -> nts_codegen_wasm::Emitted {
    let program = prepared_project(fixture);
    nts_codegen_wasm::emit(&program).unwrap_or_else(|error| {
        if let nts_codegen_wasm::EmitError::Invariant { function, .. } = &error {
            eprintln!("{:?}", program.funcs.iter().find(|f| &f.name == function));
        }
        panic!("fixture {}: {error}", fixture.display());
    })
}

/// Two same-shape classes from unrelated dispatch hierarchies are one Wasm
/// type to the engine, but their vtables give one slot two meanings: moving
/// one into the other is refused by name, never run as the wrong method.
///
/// **The lowering refuses it now, before any backend sees it.** A call through
/// `P` names `P`'s methods on every backend, not only through a Wasm vtable,
/// so an object of the unrelated `Q` held at `P` is refused where it is
/// converted (`unrelated_class_keeps_its_methods`); `asP` and its caller never
/// reach this emitter. The Wasm transfer refusal stays for storage the
/// lowering admits -- tests/transfer.rs pins it on a method-less pair.
#[test]
fn a_class_from_an_unrelated_hierarchy_of_one_shape_is_refused() {
    let fixture = common::repository().join("tests/wasm/unrelated-hierarchies");
    let program = prepared_project(&fixture);
    let refused = program
        .uncompiled
        .iter()
        .find(|(name, _)| name == "asP")
        .map(|(_, why)| why.as_str());
    assert!(
        refused.is_some_and(|why| why.contains("where the unrelated class `P` is wanted")),
        "{:?}",
        program.uncompiled
    );
    assert!(
        !program
            .funcs
            .iter()
            .any(|func| func.name == "asP" || func.name == "probe"),
        "neither the conversion nor its caller is compiled"
    );
}

/// Same-shape unrelated classes with fields only: the lowering admits the move,
/// and Wasm's transfer decides it by storage. Storage that one declared parent
/// separates is refused by name; storage of one shape is one type and agrees.
#[test]
fn a_class_whose_storage_has_other_parents_is_refused() {
    let fixture = common::repository().join("tests/wasm/storage-of-other-parents");
    let error = nts_codegen_wasm::emit(&prepared_project(&fixture))
        .map(|_| ())
        .unwrap_err()
        .to_string();
    assert!(
        error.contains(
            "NTS5001: wasm declines `as1`: a `S2` where a `S1` is wanted: no Wasm cast relates their storage"
        ),
        "{error}"
    );
}
#[test]
fn same_shape_classes_without_parents_share_storage_and_agree() {
    let fixture = common::repository().join("tests/wasm/storage-of-one-shape");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "storage-of-one-shape",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 34, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

#[test]
fn source_typed_holes_decline_instead_of_returning_zero() {
    let fixture = common::repository().join("tests/wasm/array-holes");
    let program = prepared_project(&fixture);
    let nts_codegen_wasm::EmitError::Declined(diagnostics) =
        nts_codegen_wasm::emit(&program).unwrap_err()
    else {
        panic!("expected typed-hole decline")
    };
    assert!(
        diagnostics.iter().any(|d| d.code == "NTS5001"
            && d.message.contains("hole")
            && d.message.contains("typed array holes")),
        "{diagnostics:?}"
    );
}

/// Typed array literals whose elements branch (a ternary, `??`, `&&`, a
/// bigint power's exponent check, a call that may raise): the stores after
/// each branch sit in later blocks, and the initialization proof follows them
/// there, so none of these declines as a hole.
#[test]
fn source_branching_array_literals_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/array-literals");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-literals",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 119, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// Typed arrays made with `new Array(n)` and written before they are read: a
/// loop counting from zero to the array's own length fills it (numbers,
/// objects, strings, rows of a grid), and a slot reads back at the index value
/// that stored it. None declines as a hole.
#[test]
fn source_filled_arrays_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/array-fills");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-fills",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 102, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// A `function`'s `this:` read at its type's storage after a layout test,
/// which an instance, a literal typed as the class and a same-shaped class all
/// pass: the test lists each identity laid out there, a class's or not.
#[test]
fn source_layout_tests_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/layout-tests");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "layout-tests",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 51, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

#[test]
fn source_array_helpers_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/array-methods");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-methods-source",
        &emitted,
        "tooling/wasm/check-array-methods-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 1386);
}

#[test]
fn source_array_lookup_agrees_with_node() {
    let fixture = common::repository().join("tests/wasm/array-lookup");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-lookup-source",
        &emitted,
        "tooling/wasm/check-array-lookup-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert!(output["cases"].as_u64().unwrap() > 5000, "{output}");
}

#[test]
fn source_array_element_reads_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/array-element");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-element-source",
        &emitted,
        "tooling/wasm/check-array-element-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 1410, "{output}");
}

#[test]
fn source_array_joins_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/array-join");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-join-source",
        &emitted,
        "tooling/wasm/check-array-join-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 1249, "{output}");
}

#[test]
fn source_array_sorts_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/array-sort");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-sort-source",
        &emitted,
        "tooling/wasm/check-array-sort-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 330, "{output}");
}

/// A run-time refusal names its function and its cause.
#[test]
fn source_refusals_name_their_cause() {
    let fixture = common::repository().join("tests/wasm/refusal-causes");
    let emitted = emit_project(&fixture);
    let output = common::run(
        "refusal-causes",
        &emitted,
        "tooling/wasm/check-refusal-causes.mjs",
        &[],
    );
    // One refusal left: the splice count and the join separator are answered
    // by the lowering now, and only the stored-null shift still needs a name.
    assert_eq!(output["causes"], 1, "{output}");
}

#[test]
fn source_erased_integers_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/erased-integers");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "erased-integers-source",
        &emitted,
        "tooling/wasm/check-erased-integers-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 88, "{output}");
}

/// Calls through method-only interfaces read the receiver's row: unrelated
/// classes, one class behind two interfaces, an extended interface, a void
/// method, a string argument.
#[test]
fn source_interface_calls_through_rows_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/interface-rows");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "interface-rows",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 102, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// An interface with fields is storage that every layout the core names as
/// its prefix receiver extends: literals, a class with more fields, and a
/// class through a base that holds the interface's fields.
#[test]
fn source_interface_fields_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/interface-fields");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "interface-fields",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 85, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// A base shorter than an interface its subclass is held as a prefix of: the
/// interface's storage sits between them, which agrees with node; with a base
/// whose descriptor is its own vtable type, it is refused by name.
#[test]
fn an_interface_between_a_class_and_its_base() {
    let fixture = common::repository().join("tests/wasm/interface-fields-shorter-base");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "interface-fields-shorter-base",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 17, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
    let fixture = common::repository().join("tests/wasm/interface-below-a-vtable");
    let error = nts_codegen_wasm::emit(&prepared_project(&fixture))
        .map(|_| ())
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("would sit below class `Base`, whose descriptor is its own vtable"),
        "{error}"
    );
}

/// Reads and writes through an interface reached by a prefix receiver and by
/// an owner of another field order: the owner's row answers, the prefix
/// receiver takes the default, and the owner's view is the object itself.
#[test]
fn source_interface_views_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/interface-views");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "interface-views",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 51, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// The table under a Map, a Set and a record: growth across rehashes,
/// deleted slots reused, a clear during a walk, erased keys of every kind,
/// copies, and `instanceof Map` and `Set` of an open record, Map and Set.
#[test]
fn source_collection_tables_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/collection-tables");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "collection-tables",
        &emitted,
        "tooling/wasm/check-collection-tables.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 96, "{output}");
}

/// Objects as collection keys compare by identity: same-shaped objects are two
/// keys, an identity hash survives growth, and erased objects and functions
/// hash the same way.
#[test]
fn source_object_keys_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/object-keys");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "object-keys",
        &emitted,
        "tooling/wasm/check-collection-tables.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 48, "{output}");
}

/// One buffer through every width: what a view writes, a view of another
/// width reads, little-endian and from unaligned offsets; a float32 store's
/// rounding; views across a resize; what an open value is; and the methods
/// that cut, copy and convert, overlapping and across kinds; and `DataView`.
#[test]
fn source_buffer_views_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/buffer-views");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "buffer-views",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 374, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// A class used as a value is one immutable token per class: the same object
/// wherever the name is written, `typeof` "function", compared by identity;
/// and an open value compared with a typed object is that object or not.
#[test]
fn source_class_tokens_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/class-tokens");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "class-tokens",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 85, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// An optional chain whose absent arm puts undefined in a numeric slot, on a
/// path the core proved no run takes: it compiles, and every read agrees.
#[test]
fn source_absent_scalars_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/absent-scalars");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "absent-scalars",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 51, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// A reference against the null literal, from either side and in either
/// sense: `ref.is_null` answers what node answers.
#[test]
fn source_null_comparisons_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/null-comparisons");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "null-comparisons",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 68, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// Small direct calls are inlined into their callers, and the program still
/// answers what node answers: no export calls the helpers it used.
#[test]
fn small_direct_calls_are_inlined() {
    let fixture = common::repository().join("tests/wasm/inlined-calls");
    let emitted = emit_project(&fixture);
    let names = common::function_names(&emitted.bytes);
    let index = |name: &str| {
        names
            .iter()
            .position(|it| it == name)
            .unwrap_or_else(|| panic!("no function `{name}` in {names:?}"))
    };
    let imported = imported_functions(&emitted.bytes);
    // A helper and any copy specialised from it (`square#whole`).
    let helpers: Vec<usize> = ["square", "clamp", "sumTo", "Counter#bump", "Counter#read"]
        .into_iter()
        .flat_map(|helper| {
            index(helper);
            names
                .iter()
                .enumerate()
                .filter(move |(_, name)| *name == helper || name.starts_with(&format!("{helper}#")))
                .map(|(at, _)| at)
        })
        .collect();
    for caller in ["squares", "clamped", "sums", "counted"] {
        let called = calls_from(&emitted.bytes, index(caller) - imported);
        let left: Vec<&String> = helpers
            .iter()
            .filter(|helper| called.contains(helper))
            .map(|helper| &names[*helper])
            .collect();
        assert!(left.is_empty(), "`{caller}` still calls {left:?}");
    }
    let output = common::run_with_node_flags(
        "inlined-calls",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 68, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// How many functions the module imports, which precede its own in the
/// function index space.
fn imported_functions(bytes: &[u8]) -> usize {
    let mut count = 0;
    for payload in wasmparser::Parser::new(0).parse_all(bytes) {
        if let wasmparser::Payload::ImportSection(reader) = payload.unwrap() {
            for import in reader.into_imports() {
                if matches!(import.unwrap().ty, wasmparser::TypeRef::Func(_)) {
                    count += 1;
                }
            }
        }
    }
    count
}

/// The function indices the `at`-th defined function calls directly.
fn calls_from(bytes: &[u8], at: usize) -> Vec<usize> {
    let mut seen = 0;
    for payload in wasmparser::Parser::new(0).parse_all(bytes) {
        if let wasmparser::Payload::CodeSectionEntry(body) = payload.unwrap() {
            if seen == at {
                let mut called = vec![];
                let mut reader = body.get_operators_reader().unwrap();
                while !reader.eof() {
                    if let wasmparser::Operator::Call { function_index } = reader.read().unwrap() {
                        called.push(function_index as usize);
                    }
                }
                return called;
            }
            seen += 1;
        }
    }
    panic!("no function body {at}");
}

/// A `string | null` export answers node's `null`, a `string | undefined`
/// one `undefined`, by the declaration's absence.
#[test]
fn source_absent_string_results_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/absent-string-results");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "absent-string-results",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 25, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// `at` on a `(T | null)[]` tells a stored `null` from the `undefined` past
/// its end, as node does.
#[test]
fn source_at_on_null_slots_agrees_with_node() {
    let fixture = common::repository().join("tests/wasm/at-null-slots");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "at-null-slots",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 51, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// `charCodeAt` with an integer index answers NaN past either end of the
/// string, and the code unit inside it.
#[test]
fn source_char_codes_past_the_end_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/char-codes-past-the-end");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "char-codes-past-the-end",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 34, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// `startsWith` and `endsWith`, every string against every affix, answer what
/// node answers.
#[test]
fn source_string_affixes_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/string-affixes");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "string-affixes",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 34, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// A `(T | null)[]` read where its type is gone answers a null slot `null`,
/// from the mark its erasure set, read through a call and in line; its
/// `(T | undefined)[]` control answers `undefined`.
#[test]
fn source_erased_null_slots_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/erased-null-slots");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "erased-null-slots",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 102, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// `sort()` over a `(string | null)[]` sorts a null as its text, stably beside
/// the string "null"; over its `(string | undefined)[]` control, last.
#[test]
fn source_sorted_null_slots_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/sorted-null-slots");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "sorted-null-slots",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 85, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// A built-in error's constructor passed as a constructor-typed value, as
/// `assert.throws(TypeError, fn)` passes it: its storage extends the callable
/// root and the module validates; a class of the program's own is the control.
#[test]
fn source_constructor_values_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/constructor-values");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "constructor-values",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 68, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// Each `return_call` the module makes, as (caller, callee) by name.
fn tail_calls(bytes: &[u8]) -> std::collections::BTreeSet<(String, String)> {
    let mut names = std::collections::BTreeMap::new();
    let mut imported = 0;
    let mut sites = vec![];
    let mut defined = 0;
    for payload in wasmparser::Parser::new(0).parse_all(bytes) {
        match payload.unwrap() {
            wasmparser::Payload::ImportSection(imports) => {
                for import in imports.into_imports() {
                    if matches!(import.unwrap().ty, wasmparser::TypeRef::Func(_)) {
                        imported += 1;
                    }
                }
            }
            wasmparser::Payload::CodeSectionEntry(body) => {
                let mut reader = body.get_operators_reader().unwrap();
                while !reader.eof() {
                    if let wasmparser::Operator::ReturnCall { function_index } =
                        reader.read().unwrap()
                    {
                        sites.push((imported + defined, function_index));
                    }
                }
                defined += 1;
            }
            wasmparser::Payload::CustomSection(section) => {
                if let wasmparser::KnownCustom::Name(reader) = section.as_known() {
                    for name in reader {
                        if let wasmparser::Name::Function(map) = name.unwrap() {
                            for naming in map {
                                let naming = naming.unwrap();
                                names.insert(naming.index, naming.name.to_owned());
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    sites
        .into_iter()
        .map(|(caller, callee)| (names[&caller].clone(), names[&callee].clone()))
        .collect()
}

/// Calls in tail position are `return_call`: a recursion 100,000 deep
/// completes, directly and through a join that only returns the call's
/// answer, where node runs out of stack. A call inside a `try` whose callee
/// may throw, and one whose result is added to, keep their frames and answer
/// the same.
#[test]
fn source_tail_calls_do_not_grow_the_stack() {
    let fixture = common::repository().join("tests/wasm/tail-calls");
    let emitted = emit_project(&fixture);
    let tail = tail_calls(&emitted.bytes);
    for recursive in ["countdown#whole", "throughJoin#whole"] {
        assert!(
            tail.contains(&(recursive.to_owned(), recursive.to_owned())),
            "{recursive} in {tail:?}"
        );
    }
    assert!(
        !tail
            .iter()
            .any(|(caller, _)| caller.starts_with("caught") || caller.starts_with("addedTo")),
        "{tail:?}"
    );
    let output = common::run(
        "tail-calls",
        &emitted,
        "tooling/wasm/check-tail-calls.ts",
        &[],
    );
    assert_eq!(output["cases"], 22, "{output}");
}

/// A null or undefined receiver's `TypeError` names its key as node does: a
/// primitive by its text, a long symbol description cut, an object not at all.
#[test]
fn source_null_receiver_keys_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/null-receiver-keys");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "null-receiver-keys",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 153, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// Symbols: identity by address, descriptions and their absence, the
/// `Symbol.for` registry and `Symbol.keyFor`, an erased symbol's `typeof` and
/// text, and symbols as Map keys.
#[test]
fn source_symbols_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/symbols");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "symbols",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 102, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// Dates: `TimeClip` over the pool and `-0`, identity, an erased date's
/// `typeof`, dates in a growing array, in fields, captured, absent, and as Map
/// keys by identity.
#[test]
fn source_dates_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/dates");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "dates",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 170, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// A whole program, run as test262 runs one (`tooling/wasm/run-program.ts`),
/// ends as the C runtime ends it: these lines on stdout and stderr and this
/// status are what the C backend's program prints for each fixture, so one
/// classifier reads both. A refusal says so in this backend's own words.
#[test]
fn a_whole_program_ends_as_the_c_runtime_ends_one() {
    let refused = "nts: refused at run time: an index past the end, whose undefined this element type cannot hold\n";
    let cases = [
        ("completes", 0, "initializer\njob 1\ntimer\n", "on stderr\n"),
        (
            "throws-an-object",
            1,
            "before\n",
            "nts: uncaught Test262Error: Expected 3 but got 2\n",
        ),
        ("throws-a-number", 1, "before\n", "nts: uncaught 1e+06\n"),
        (
            "throws-in-a-job",
            1,
            "initializer\n",
            "nts: uncaught Test262Error\n",
        ),
        ("refuses", 1, "before\n", refused),
    ];
    let root = common::repository();
    for (name, status, stdout, stderr) in cases {
        let fixture = root.join("tests/wasm/whole-program").join(name);
        let emitted = emit_project(&fixture);
        let artifact = common::write_artifact(
            &format!("whole-program-{name}"),
            &emitted,
            nts_codegen_wasm::Host::Node,
        );
        let result = std::process::Command::new("node")
            .arg(root.join("tooling/wasm/run-program.ts"))
            .arg(&artifact)
            .output()
            .expect("Node installed");
        assert_eq!(
            (
                result.status.code(),
                String::from_utf8_lossy(&result.stdout).as_ref(),
                String::from_utf8_lossy(&result.stderr).as_ref(),
            ),
            (Some(status), stdout, stderr),
            "{name}"
        );
        if common::retained().is_none() {
            std::fs::remove_dir_all(artifact).unwrap();
        }
    }
}

/// An engine without a capability the module needs is named before the
/// module is instantiated (`WasmEngineMissing`), never left to fail at an
/// import in the engine's own words (F6). The fixture throws an object and
/// builds a string, so it needs all three.
#[test]
fn an_engine_without_a_needed_capability_is_named() {
    let root = common::repository();
    let fixture = root.join("tests/wasm/whole-program/throws-an-object");
    let emitted = emit_project(&fixture);
    let artifact = common::write_artifact(
        "engine-capabilities",
        &emitted,
        nts_codegen_wasm::Host::Node,
    );
    let builtins = "the JS string builtins ('wasm:js-string')";
    for (engine, missing, ran) in [
        ("full", None, true),
        ("no-tag", Some("WebAssembly.JSTag"), false),
        ("no-builtins", Some(builtins), false),
        ("no-constants", Some("imported string constants"), false),
    ] {
        let result = std::process::Command::new("node")
            .arg(root.join("tooling/wasm/check-engine.ts"))
            .arg(&artifact)
            .arg(engine)
            .output()
            .expect("Node installed");
        assert!(
            result.status.success(),
            "{engine}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        // The report is the last line: the program writes before it throws.
        let stdout = String::from_utf8_lossy(&result.stdout);
        let report: serde_json::Value =
            serde_json::from_str(stdout.lines().last().unwrap_or_default()).unwrap();
        assert_eq!(
            report,
            serde_json::json!({ "missing": missing, "ran": ran }),
            "{engine}"
        );
    }
    if common::retained().is_none() {
        std::fs::remove_dir_all(artifact).unwrap();
    }
}

/// An abstract class's optional methods, which a subclass leaves out: the
/// class allocates, its absent method's entry refusing by name if a call ever
/// reached it, and `?.()` skips it, as node does.
#[test]
fn source_optional_methods_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/optional-methods");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "optional-methods",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 34, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// Presence: a subclass's own bits after its base's, cleared and written
/// again through the base, `"k" in v` over an open value of either of two
/// families or of none, and the high bits.
#[test]
fn source_presence_agrees_with_node() {
    let fixture = common::repository().join("tests/wasm/presence");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "presence",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 68, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// Tagged templates: the cooked pieces, one object per source site across
/// calls and generic copies, held in a global, an array and a Map, and read
/// through an open value.
#[test]
fn source_templates_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/templates");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "templates",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 102, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// Open values at the public boundary: every primitive kind through and back,
/// `-0`, NaN and numbers past a small integer, `undefined` apart from `null`.
/// An object or an array passed in (10) or made and returned (5) is refused
/// by name.
#[test]
fn source_open_boundary_agrees_with_node() {
    let fixture = common::repository().join("tests/wasm/open-boundary");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "open-boundary",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 171, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(
        output["refused"],
        serde_json::json!({
            "an object, a function, a symbol or a bigint as an open value, which this boundary does not convert": 10,
            "an object, a function, a symbol or a bigint returned as an open value, which this boundary does not convert": 5,
        }),
        "{output}"
    );
}

/// A bigint in 128 bits: arithmetic and its signs, the edges at -2^127 and
/// 2^127 - 1, shifts by negative and huge counts, conversion both ways,
/// asIntN/asUintN and an erased bigint. Where node's answer passes 128 bits
/// (or node throws), Wasm refuses by name: 38 cases, every one checked to be
/// past the width or a throw, and none a different number.
#[test]
fn source_bigints_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/bigints");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "bigints",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 298, "{output}");
    assert_eq!(output["declined"], 43, "{output}");
    assert_eq!(
        output["refused"],
        serde_json::json!({"a bigint past 128 bits, which this runtime does not hold": 84}),
        "{output}"
    );
}

/// An open value made a number by every primitive kind it can hold, an
/// open value's `Array.isArray`, and the number and string services the host
/// answers with node's own methods.
#[test]
fn source_conversions_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/conversions");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "conversions",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 153, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// An override declaring fewer parameters than its slot: through the base
/// with two, one and none, with a covariant result down a chain, and a
/// raising override caught at the call.
#[test]
fn source_narrower_overrides_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/narrower-overrides");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "narrower-overrides",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 51, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// A function's name and a value's text read off its identity: declarations,
/// arrows, methods, bound (twice) functions, a class's own `toString`, a
/// plain object and the error family.
#[test]
fn source_function_text_agrees_with_node() {
    let fixture = common::repository().join("tests/wasm/function-text");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "function-text",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 51, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// A member read through a slot several layouts reach, shared or at each
/// arm's own index: same-shape layouts, a subclass at its base's arm, and an
/// arm never allocated.
#[test]
fn source_open_members_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/open-members");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "open-members",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 102, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
    assert_eq!(output["refused"], serde_json::json!({}), "{output}");
}

/// The string methods the host applies with node's own `String.prototype`,
/// each wrapped to C's contract where a bare call differs.
#[test]
fn source_string_services_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/string-services");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "string-services",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 155, "{output}");
    assert_eq!(output["declined"], 17, "{output}");
    assert_eq!(
        output["refused"],
        serde_json::json!({"a string index outside the string, or not a whole number": 15}),
        "{output}"
    );
}

/// Typed arrays whose kind owns its buffers keep their elements in arrays of
/// their own type: `Float64Array` and `Int32Array` here are owned, and
/// `Int16Array`, given away through `.buffer`, stays on bytes, so `set` crosses
/// between the two. The owned helpers are asserted present, so a fall back to bytes fails
/// here rather than passing on bytes' answers.
#[test]
fn source_owned_views_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/owned-views");
    let emitted = emit_project(&fixture);
    let names = common::function_names(&emitted.bytes);
    for owned in ["owned.View(8)", "owned.View(5)", "owned.Buffer(8)"] {
        assert!(
            names.iter().any(|name| name == owned),
            "{owned} in {names:?}"
        );
    }
    assert!(
        !names.iter().any(|name| name == "owned.View(3)"),
        "Int16Array is exposed and stays on bytes"
    );
    let output = common::run_with_node_flags(
        "owned-views",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 136, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
}

/// The order promise reactions and resumptions run in: each export's return
/// is the checkpoint that drains them, and a second export reads the order,
/// against node's order after a turn.
#[test]
fn source_promise_order_agrees_with_node() {
    let fixture = common::repository().join("tests/wasm/promise-order");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "promise-order",
        &emitted,
        "tooling/wasm/check-promise-order.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 80, "{output}");
}

/// A promise an export answers is a JS promise: settled at once, or watched
/// until a later export's checkpoint settles it; a compiled Error as a reason
/// is refused by name.
#[test]
fn source_promise_boundary_agrees_with_node() {
    let fixture = common::repository().join("tests/wasm/promise-boundary");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "promise-boundary",
        &emitted,
        "tooling/wasm/check-promise-boundary.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 14, "{output}");
}

/// Timers fire through the host inside the checkpoint: a timer callback's
/// microtasks run before the next timer's, an interval clears itself, and a
/// cleared timer never fires.
#[test]
fn source_timer_order_agrees_with_node() {
    let fixture = common::repository().join("tests/wasm/timer-order");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "timer-order",
        &emitted,
        "tooling/wasm/check-timer-order.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 9, "{output}");
}

/// `String(v)` of every erased tag and of a boolean; an object is refused by
/// name, since nothing here records how it prints.
#[test]
fn source_value_text_agrees_with_node() {
    let fixture = common::repository().join("tests/wasm/value-text");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "value-text",
        &emitted,
        "tooling/wasm/check-value-text.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 81, "{output}");
}

/// An owner of another field order whose storage is the same Wasm type as the
/// interface's: the engine canonicalizes them into one type, so only the
/// receiver's descriptor, never a type test, may decide how to read it.
#[test]
fn a_same_shape_owner_of_another_order_reads_by_its_row() {
    let fixture = common::repository().join("tests/wasm/interface-same-shape-owner");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "interface-same-shape-owner",
        &emitted,
        "tooling/wasm/check-interface-same-shape-owner.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 65, "{output}");
}

#[test]
fn source_array_copying_agrees_with_node() {
    let fixture = common::repository().join("tests/wasm/array-copy");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-copy-source",
        &emitted,
        "tooling/wasm/check-array-copy-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert!(output["cases"].as_u64().unwrap() > 2000);
    assert!(output["named_declines"].as_u64().unwrap() > 500);
}

#[test]
fn source_raising_slots_handlers_and_finalizers_agree_with_node() {
    let fixture = common::repository().join("tests/wasm/raising");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "raising-source",
        &emitted,
        "tooling/wasm/check-raising-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert!(output["cases"].as_u64().unwrap() > 150);
    assert!(output["thrownCases"].as_u64().unwrap() > 50);
}

#[test]
fn source_raising_slot_contract_survives_body_renaming() {
    let fixture = common::repository().join("tests/wasm/raising");
    let mut program = prepared_project(&fixture);
    let renames: std::collections::BTreeMap<_, _> = program
        .funcs
        .iter()
        .filter(|f| f.name.contains("@raises"))
        .enumerate()
        .map(|(at, f)| (f.name.clone(), format!("arbitrary_raised_entry_{at}")))
        .collect();
    assert!(!renames.is_empty());
    let rename = |name: &mut String| {
        if let Some(replacement) = renames.get(name) {
            name.clone_from(replacement);
        }
    };
    for f in &mut program.funcs {
        rename(&mut f.name);
        for op in &mut f.values {
            if let hir::OpKind::Call { callee, .. } = &mut op.kind {
                match callee {
                    hir::Callee::Direct(name) | hir::Callee::Virtual { declared: name, .. } => {
                        rename(name);
                    }
                    hir::Callee::External(_)
                    | hir::Callee::Native(_)
                    | hir::Callee::Closure { .. } => {}
                }
            }
        }
    }
    for layout in &mut program.layouts {
        for name in layout.methods.iter_mut().flatten() {
            rename(name);
        }
    }
    for (name, _) in &mut program.public_api {
        rename(name);
    }
    // The native rows are a projection of the layouts' rows, interned by name;
    // project the renamed ones, as preparation would have.
    hir::native_dispatch::plan(&mut program);
    let emitted = nts_codegen_wasm::emit(&program).unwrap();
    let output = common::run_with_node_flags(
        "raising-renamed-source",
        &emitted,
        "tooling/wasm/check-raising-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert!(output["cases"].as_u64().unwrap() > 150);
}

#[test]
fn scalar_typescript_agrees_with_node_exactly() {
    let fixture = common::repository().join("tests/wasm/scalars");
    let emitted = emit_project(&fixture);
    let output = common::run(
        "scalars",
        &emitted,
        "tooling/wasm/check-scalars.mjs",
        &[&fixture.join("src/main.ts")],
    );
    assert!(output["cases"].as_u64().unwrap() >= 150_000, "{output}");
    println!("{output}");
    assert!(
        !emitted.origins.is_empty(),
        "instructions preserve HIR Origins"
    );
}

#[test]
fn existing_loops_and_bitwise_examples_agree_with_node() {
    for (name, expected) in [("loops", 102), ("bitwise", 136)] {
        let fixture = common::repository().join("tests/programs").join(name);
        let emitted = emit_project(&fixture);
        let output = common::run(
            name,
            &emitted,
            "tooling/wasm/check-example.mjs",
            &[&fixture.join("src/main.ts")],
        );
        assert_eq!(output["cases"], expected, "{output}");
        assert_eq!(output["declined"], 0, "{output}");
        assert_eq!(output["refused"], serde_json::json!({}), "{output}");
        println!("{name}: {output}");
    }
}
