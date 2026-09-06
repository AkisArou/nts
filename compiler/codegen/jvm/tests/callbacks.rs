//! The callback ABI, which is written in two places and must be one.
//!
//! `types::CALLBACKS` maps a descriptor to the `nts.rt` interface a generated
//! class of that shape implements; the interfaces themselves are Java. Nothing
//! but this makes the two agree, and the disagreement is silent in the worst
//! way: an interface with the wrong parameter list still compiles, still
//! verifies, and still *loads* -- because the JVM checks conformance at the
//! call rather than at the boundary -- so the first symptom is an
//! `AbstractMethodError` from inside a provider, at run time, on whichever
//! platform ran first.
//!
//! Reads the Java sources rather than the jar, so it runs without a JDK: what
//! is being checked is a claim two files make about each other.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

fn source(interface: &str) -> String {
    let file = interface.rsplit('/').next().unwrap();
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../runtime/jvm/src/nts/rt")
        .join(format!("{file}.java"));
    std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("{} is named by \
         `types::CALLBACKS` and does not exist -- the table is the ABI, so an \
         entry with no interface behind it is a call that will not link", path.display()))
}

/// The JVM descriptor of a Java parameter list, in the small vocabulary these
/// interfaces are allowed to use.
///
/// Deliberately not a Java parser. It handles exactly the types a callback
/// parameter may have and *panics* on anything else, so a future interface
/// taking a type this does not know fails here -- where the message says the
/// vocabulary needs extending -- rather than being skipped and silently
/// unchecked, which is how a drift test becomes decoration.
fn descriptor_of(declaration: &str) -> String {
    let mut spelled = String::from("(");
    let inside = declaration
        .split_once('(')
        .and_then(|(_, rest)| rest.split_once(')'))
        .expect("a `call` declaration")
        .0;
    for parameter in inside.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        let ty = parameter.split_whitespace().next().expect("a parameter type");
        spelled.push_str(match ty {
            "double" => "D",
            "int" => "I",
            "boolean" => "Z",
            "byte[]" => "[B",
            "String" => "Ljava/lang/String;",
            "NtsValue" => "Lnts/rt/NtsValue;",
            other => panic!(
                "`{other}` is not in the vocabulary this test knows how to spell; \
                 add it here rather than leaving the entry unchecked"
            ),
        });
    }
    spelled.push(')');
    spelled.push_str(if declaration.contains("void call") { "V" } else { "?" });
    spelled
}

#[test]
fn every_callback_interface_has_the_shape_the_table_claims() {
    for &(descriptor, interface) in nts_codegen_jvm::types::CALLBACKS {
        let java = source(interface);
        assert!(
            java.contains(&format!("public interface {}", interface.rsplit('/').next().unwrap())),
            "{interface} is named by the callback table and is not an interface -- a \
             generated class can extend only one base, so a callback shape that is a \
             class can never be attached to a closure that already has one"
        );
        let declarations: Vec<&str> =
            java.lines().map(str::trim).filter(|line| line.contains(" call(")).collect();
        assert_eq!(
            declarations.len(),
            1,
            "{interface} declares {} methods named `call`; the ABI is one shape per \
             interface, and an overload would make the descriptor ambiguous at exactly \
             the place the table says it is not",
            declarations.len()
        );
        assert_eq!(
            descriptor_of(declarations[0]),
            descriptor,
            "{interface} declares `{}`, which is not the descriptor the table gives it",
            declarations[0]
        );
    }
}

#[test]
fn the_table_is_a_function_in_both_directions() {
    let mut shapes: Vec<&str> = nts_codegen_jvm::types::CALLBACKS.iter().map(|&(s, _)| s).collect();
    let before = shapes.len();
    shapes.sort_unstable();
    shapes.dedup();
    assert_eq!(before, shapes.len(), "two interfaces claim one descriptor");
    let mut names: Vec<&str> = nts_codegen_jvm::types::CALLBACKS.iter().map(|&(_, n)| n).collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(
        before,
        names.len(),
        "one interface is claimed for two descriptors, so a class implementing it \
         would have to declare both and the second would be an overload the ABI \
         cannot resolve"
    );
    // The predicate the call site uses to decide whether an argument may be
    // coerced, asked about every entry it is supposed to accept. Written twice
    // -- once as a table and once as a string test -- so this is where they
    // are held together.
    for &(_, interface) in nts_codegen_jvm::types::CALLBACKS {
        assert!(
            nts_codegen_jvm::types::is_callback_interface(&format!("L{interface};")),
            "{interface} is in the table and `is_callback_interface` says it is not, so \
             an argument declared as it would be pushed uncoerced"
        );
    }
    assert!(!nts_codegen_jvm::types::is_callback_interface("Ljava/lang/Object;"));
    assert!(!nts_codegen_jvm::types::is_callback_interface("Lnts/rt/NtsResumable;"));
}
