//! Every declaration a binding keeps has compiled against the headers.
//!
//! The C spelling each declaration carries is what nts will emit for it, so
//! the question is the build witness's own, asked of every declaration rather
//! than only the ones a program happens to call: `__builtin_types_compatible_p`
//! between the header's declaration and ours, one assertion per line, one
//! clang run per namespace. Whatever clang rejects is dropped, with its reason,
//! and so is everything that named it.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result};

use super::map::{Binding, TypeDecl};
use super::read::Name;

enum Line {
    Function(String),
    Field(String),
    Constant(String),
    Method(String, String),
}

/// The check file, and which declaration each assertion line is about.
#[derive(Default)]
struct Probe {
    text: String,
    lines: BTreeMap<usize, Line>,
    count: usize,
}

impl Probe {
    fn line(&mut self, text: &str, about: Option<Line>) {
        self.count += 1;
        self.text.push_str(text);
        self.text.push('\n');
        if let Some(about) = about {
            self.lines.insert(self.count, about);
        }
    }
}

pub(crate) fn against_headers(
    bindings: &mut [Binding],
    headers: &[Vec<String>],
    clang_args: &[String],
) -> Result<()> {
    let mut dropped: BTreeSet<Name> = BTreeSet::new();
    for binding in bindings.iter_mut() {
        let probe = probe(binding, headers);
        let stderr = compile(&binding.namespace, &probe.text, clang_args)?;
        drop_rejected(binding, &stderr, &probe.lines, &mut dropped)?;
    }
    cascade(bindings, dropped);
    Ok(())
}

/// One assertion per declaration, after what a generated program includes.
fn probe(binding: &Binding, headers: &[Vec<String>]) -> Probe {
    let mut probe = Probe::default();
    // What a generated program always has, through the runtime: the
    // spellings nts emits (`uint16_t`, `bool`) need these, and `windows.h`
    // includes neither.
    probe.line("#include <stdint.h>", None);
    probe.line("#include <stddef.h>", None);
    probe.line("#include <stdbool.h>", None);
    for line in super::facts::include_lines(headers) {
        probe.line(&line, None);
    }
    for function in &binding.functions {
        probe.line(
            &format!(
                "_Static_assert(__builtin_types_compatible_p(__typeof__(&{}), {}), \"{}\");",
                function.name, function.c_type, function.name
            ),
            Some(Line::Function(function.name.clone())),
        );
    }
    for decl in &binding.types {
        if let TypeDecl::Record {
            name, c, layout, ..
        } = decl
        {
            probe.line(
                &format!(
                    "_Static_assert(sizeof({c}) == {} && _Alignof({c}) == {}, \"{name} layout\");",
                    layout.size, layout.align
                ),
                Some(Line::Field(name.clone())),
            );
        }
    }
    for (record, record_c, field, field_c) in &binding.field_checks {
        let assertion = match field_c.strip_suffix(']').and_then(|s| s.rsplit_once('[')) {
            Some((element, count)) => format!(
                "__builtin_types_compatible_p(__typeof__((({record_c} *)0)->{field}[0]), {element}) && \
                 sizeof((({record_c} *)0)->{field}) / sizeof((({record_c} *)0)->{field}[0]) == {count}"
            ),
            None => format!(
                "__builtin_types_compatible_p(__typeof__((({record_c} *)0)->{field}), {field_c})"
            ),
        };
        probe.line(
            &format!("_Static_assert({assertion}, \"{record}.{field}\");"),
            Some(Line::Field(record.clone())),
        );
    }
    for decl in &binding.types {
        let TypeDecl::Interface { name, methods, .. } = decl else {
            continue;
        };
        for method in methods {
            let field = &method.signature.name;
            probe.line(&format!("_Static_assert(__builtin_types_compatible_p(__typeof__((({name}Vtbl *)0)->{field}), {}) && offsetof({name}Vtbl, {field}) == {} * sizeof(void *), \"{name}.{field}\");", method.signature.c_type, method.slot), Some(Line::Method(name.clone(), field.clone())));
        }
    }
    for constant in &binding.constants {
        // Only a macro can be compared here: an enumerator, or a value the
        // headers do not define, is Microsoft's word, which is the source.
        probe.line(&format!("#ifdef {}", constant.name), None);
        probe.line(
            &format!(
                "_Static_assert((long long)({0}) == (long long)({1}), \"{0}\");",
                constant.name, constant.value
            ),
            Some(Line::Constant(constant.name.clone())),
        );
        probe.line("#endif", None);
    }
    probe
}

/// clang's diagnostics for `text`, compiled once with every error reported.
///
/// `NTS_BIND_WINMD_KEEP=1` keeps the probe and clang's answer beside it, which
/// is where a refusal's reason is read in full.
fn compile(namespace: &str, text: &str, clang_args: &[String]) -> Result<String> {
    compile_with_ready(namespace, text, clang_args, || {})
}

static CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// `ready` lets the concurrency guard keep both probes live before clang reads
/// either. Production takes exactly the same path with a no-op callback.
fn compile_with_ready(
    namespace: &str,
    text: &str,
    clang_args: &[String],
    ready: impl FnOnce(),
) -> Result<String> {
    let dir = std::env::temp_dir().join(format!(
        "nts-bind-winmd-check-{}-{}",
        std::process::id(),
        CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let probe = dir.join(format!("{}.c", namespace.replace('.', "_")));
    std::fs::write(&probe, text).with_context(|| format!("writing {}", probe.display()))?;
    ready();
    let output = std::process::Command::new("clang")
        .args(clang_args)
        .args(["-std=c11", "-fsyntax-only", "-ferror-limit=0", "-w"])
        .arg(&probe)
        .output()
        .context("running clang on the binding's self-check")?;
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if std::env::var_os("NTS_BIND_WINMD_KEEP").is_some() {
        std::fs::write(probe.with_extension("stderr"), stderr.as_bytes()).ok();
        eprintln!("kept {}", probe.display());
    } else {
        let _ = std::fs::remove_dir_all(&dir);
    }
    Ok(stderr)
}

/// Remove from `binding` what an error line names. An error on no assertion
/// line means the headers themselves did not compile, and says so.
fn drop_rejected(
    binding: &mut Binding,
    stderr: &str,
    lines: &BTreeMap<usize, Line>,
    dropped: &mut BTreeSet<Name>,
) -> Result<()> {
    let file = format!("{}.c", binding.namespace.replace('.', "_"));
    let mut functions = BTreeSet::new();
    let mut records = BTreeSet::new();
    let mut constants = BTreeSet::new();
    let mut methods = BTreeSet::new();
    for error in stderr
        .lines()
        .filter(|line| line.contains(": error:") && line.contains(&file))
    {
        let Some(number) = error
            .split(':')
            .nth(1)
            .and_then(|n| n.parse::<usize>().ok())
        else {
            continue;
        };
        match lines.get(&number) {
            Some(Line::Function(name)) => functions.insert(name.clone()),
            Some(Line::Field(record)) => records.insert(record.clone()),
            Some(Line::Constant(name)) => constants.insert(name.clone()),
            Some(Line::Method(interface, name)) => {
                methods.insert((interface.clone(), name.clone()))
            }
            None => anyhow::bail!("the Windows headers did not compile for the check: {error}"),
        };
    }
    for record in &records {
        dropped.insert((binding.namespace.clone(), record.clone()));
        binding.refused.push((
            record.clone(),
            "a field's type disagrees with the header".into(),
        ));
    }
    binding.types.retain(|decl| !records.contains(decl.name()));
    let mut refused = Vec::new();
    for decl in &mut binding.types {
        if let TypeDecl::Interface {
            name,
            methods: entries,
            ..
        } = decl
        {
            entries.retain(|method| {
                let keep = !methods.contains(&(name.clone(), method.signature.name.clone()));
                if !keep {
                    refused.push((
                        format!("{name}.{}", method.signature.name),
                        "its method type or slot disagrees with the header".into(),
                    ));
                }
                keep
            });
        }
    }
    binding.functions.retain(|function| {
        let keep = !functions.contains(&function.name);
        if !keep {
            refused.push((
                function.name.clone(),
                "its type disagrees with the header".into(),
            ));
        }
        keep
    });
    binding.constants.retain(|constant| {
        let keep = !constants.contains(&constant.name);
        if !keep {
            refused.push((
                constant.name.clone(),
                "its value disagrees with the header".into(),
            ));
        }
        keep
    });
    binding.refused.extend(refused);
    Ok(())
}

/// Whatever named a dropped type goes too, until nothing more does.
fn cascade(bindings: &mut [Binding], mut dropped: BTreeSet<Name>) {
    loop {
        let mut more = BTreeSet::new();
        for binding in bindings.iter_mut() {
            let namespace = binding.namespace.clone();
            let mut refused = Vec::new();
            for decl in &mut binding.types {
                if let TypeDecl::Interface { name, methods, .. } = decl {
                    methods.retain(|method| {
                        let named = method.signature.uses.iter().any(|u| dropped.contains(u));
                        if named {
                            refused.push((
                                format!("{name}.{}", method.signature.name),
                                "it names a type that was dropped".into(),
                            ));
                        }
                        !named
                    });
                }
            }
            binding.types.retain(|decl| {
                let named = decl
                    .uses()
                    .is_some_and(|uses| uses.iter().any(|u| dropped.contains(u)));
                if named {
                    more.insert((namespace.clone(), decl.name().to_owned()));
                    refused.push((
                        decl.name().to_owned(),
                        "it names a type that was dropped".into(),
                    ));
                }
                !named
            });
            binding.functions.retain(|function| {
                let named = function.uses.iter().any(|u| dropped.contains(u));
                if named {
                    refused.push((
                        function.name.clone(),
                        "it names a type that was dropped".into(),
                    ));
                }
                !named
            });
            binding.constants.retain(|constant| {
                let named = constant.uses.iter().any(|u| dropped.contains(u));
                if named {
                    refused.push((
                        constant.name.clone(),
                        "it names a type that was dropped".into(),
                    ));
                }
                !named
            });
            binding.refused.extend(refused);
        }
        if more.is_empty() {
            break;
        }
        dropped.extend(more);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::collections::BTreeSet;

    use super::super::map::{Binding, Constant};

    #[test]
    fn concurrent_header_checks_keep_their_own_probe() {
        const NAMESPACE: &str = "Concurrent.Probe";
        const GOOD: &str = "int valid_probe;\n";
        const BAD: &str = "#error expected_second_probe\n";
        // The serial control differs only in scheduling. Both inputs must
        // already produce the expected independent clang answers.
        assert!(super::compile(NAMESPACE, GOOD, &[]).unwrap().is_empty());
        assert!(
            super::compile(NAMESPACE, BAD, &[])
                .unwrap()
                .contains("expected_second_probe")
        );

        let ready = std::sync::Barrier::new(2);
        let (good, bad) = std::thread::scope(|scope| {
            let good = scope.spawn(|| {
                super::compile_with_ready(NAMESPACE, GOOD, &[], || {
                    ready.wait();
                })
            });
            let bad = scope.spawn(|| {
                super::compile_with_ready(NAMESPACE, BAD, &[], || {
                    ready.wait();
                })
            });
            (good.join().unwrap().unwrap(), bad.join().unwrap().unwrap())
        });
        // Both files exist before either compiler starts. With a PID-only
        // directory one input overwrites the other, or one cleanup removes it.
        assert!(
            good.is_empty(),
            "clean probe read another call's input: {good}"
        );
        assert!(
            bad.contains("expected_second_probe"),
            "error probe lost its own input: {bad}"
        );
    }

    #[test]
    fn header_values_distinguish_sign_extension_from_zero_extension() {
        let dir =
            std::env::temp_dir().join(format!("nts-winmd-sentinel-values-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let header = dir.join("sentinels.h");
        std::fs::write(
            &header,
            "_Static_assert(sizeof(void *) == 8, \"a 64-bit pointer target\");\n\
             #define EXTENDED ((void *)(intptr_t)-1)\n\
             #define ZERO_EXTENDED ((void *)(uintptr_t)0xFFFFFFFFU)\n\
             #define NULL_HANDLE ((void *)0)\n",
        )
        .unwrap();
        let mut bindings = [Binding {
            namespace: "SentinelValues".into(),
            constants: [
                ("EXTENDED", "-1"),
                ("ZERO_EXTENDED", "-1"),
                ("NULL_HANDLE", "0"),
            ]
            .into_iter()
            .map(|(name, value)| Constant {
                name: name.into(),
                value: value.into(),
                ts: "TestHandle".into(),
                uses: BTreeSet::new(),
            })
            .collect(),
            ..Binding::default()
        }];
        super::against_headers(
            &mut bindings,
            &[vec![header.to_str().unwrap().to_owned()]],
            &[],
        )
        .unwrap();
        assert_eq!(
            bindings[0]
                .constants
                .iter()
                .map(|c| c.name.as_str())
                .collect::<Vec<_>>(),
            ["EXTENDED", "NULL_HANDLE"]
        );
        assert_eq!(
            bindings[0].refused,
            [(
                "ZERO_EXTENDED".into(),
                "its value disagrees with the header".into()
            )]
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_constant_depending_on_a_dropped_handle_is_refused_too() {
        let handle = ("Types".into(), "DroppedHandle".into());
        let mut bindings = [Binding {
            constants: [
                ("dependent", BTreeSet::from([handle.clone()])),
                ("control", BTreeSet::new()),
            ]
            .into_iter()
            .map(|(name, uses)| Constant {
                name: name.into(),
                value: "1".into(),
                ts: "Handle".into(),
                uses,
            })
            .collect(),
            ..Binding::default()
        }];
        super::cascade(&mut bindings, BTreeSet::from([handle]));
        assert_eq!(bindings[0].constants.len(), 1);
        assert_eq!(bindings[0].constants[0].name, "control");
        assert_eq!(
            bindings[0].refused,
            [(
                "dependent".into(),
                "it names a type that was dropped".into()
            )]
        );
    }
}
