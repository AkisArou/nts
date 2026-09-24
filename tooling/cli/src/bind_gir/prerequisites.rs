//! What only the type system knows about an interface: what every instance
//! of it also is.
//!
//! An interface's prerequisites decide what a handle to one upcasts to --
//! a `GFile` is a `GObject`, so `g_object_unref(file)` is sound -- and GIR
//! leaves the commonest one out: `GFile`, `GListModel` and `GAsyncResult` list
//! no prerequisite at all, while `g_type_interface_prerequisites` answers
//! `GObject` for each. So the binder asks the type system: one small program
//! per namespace calls each interface's `get_type` and prints its classed
//! prerequisites. Which C type the answer names is `g_type_name`'s, which for
//! a `GObject` type is its C type name.
//!
//! **Nothing here is guessed.** A namespace whose probe does not build or run
//! -- no `.pc` for its libraries, no display a type needs -- answers nothing,
//! and its interfaces keep no parent: a handle that does not upcast, rather
//! than one that upcasts wrongly.

use std::collections::BTreeMap;
use std::fmt::Write;

/// Calls so far, which name each call's scratch directory.
static CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// `interface C type -> its first classed prerequisite's C type`, for each
/// of `interfaces` (`(C type, get_type)`) the type system answered for.
pub(crate) fn resolve(
    headers: &[String],
    interfaces: &[(&str, &str)],
    cflags: &[String],
    libs: &[String],
) -> BTreeMap<String, String> {
    if interfaces.is_empty() {
        return BTreeMap::new();
    }
    let mut probe = String::new();
    for header in headers {
        let _ = writeln!(probe, "#include <{header}>");
    }
    probe.push_str("#include <stdio.h>\nint main(void) {\n");
    for (c_type, get_type) in interfaces {
        let _ = writeln!(
            probe,
            "  {{ guint n = 0; GType *p = g_type_interface_prerequisites({get_type}(), &n); \
             for (guint i = 0; i < n; i++) if (G_TYPE_IS_CLASSED(p[i])) {{ printf(\"{c_type} %s\\n\", g_type_name(p[i])); break; }} \
             g_free(p); }}"
        );
    }
    probe.push_str("  return 0;\n}\n");
    let call = CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("nts-bind-gir-prerequisites-{}-{call}", std::process::id()));
    let answer = run(&dir, &probe, cflags, libs).unwrap_or_default();
    let _ = std::fs::remove_dir_all(&dir);
    parse(&answer, interfaces)
}

/// Build and run the probe, answering its output; `None` for any failure.
fn run(dir: &std::path::Path, probe: &str, cflags: &[String], libs: &[String]) -> Option<String> {
    std::fs::create_dir_all(dir).ok()?;
    let source = dir.join("prerequisites.c");
    let program = dir.join("prerequisites");
    std::fs::write(&source, probe).ok()?;
    let built = std::process::Command::new(std::env::var("CC").unwrap_or_else(|_| "clang".to_owned()))
        .args(["-std=c11", "-w", "-o"])
        .arg(&program)
        .args(cflags)
        .arg(&source)
        .args(libs)
        .output()
        .ok()?;
    if !built.status.success() {
        return None;
    }
    let ran = std::process::Command::new(&program).output().ok()?;
    ran.status.success().then(|| String::from_utf8_lossy(&ran.stdout).into_owned())
}

/// `<interface C type> <prerequisite type name>` per line, kept only for an
/// interface that was asked about.
fn parse(output: &str, interfaces: &[(&str, &str)]) -> BTreeMap<String, String> {
    output
        .lines()
        .filter_map(|line| line.split_once(' '))
        .filter(|(interface, _)| interfaces.iter().any(|(c_type, _)| c_type == interface))
        .map(|(interface, prerequisite)| (interface.to_owned(), prerequisite.trim().to_owned()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::parse;

    /// Only the interfaces asked about, and the first answer for each.
    #[test]
    fn an_answer_names_an_interface_that_was_asked_about() {
        let answered = parse("GFile GObject\nGStray GObject\n", &[("GFile", "g_file_get_type")]);
        assert_eq!(answered.get("GFile").map(String::as_str), Some("GObject"));
        assert!(!answered.contains_key("GStray"));
    }
}
