//! `nts bind`, as far as this crate can take it: a directory of class files in,
//! TypeScript declarations out.
//!
//! ```text
//! cargo run --release -p nts-jvm-emitter --example bind -- <classes-dir> <package> [class...]
//! ```
//!
//! **A directory rather than a jar, and an example rather than a binary.** A jar
//! is a zip, and the workspace `Cargo.toml` says every external dependency is a
//! maintenance obligation -- taking a zip and a deflate crate to open one would
//! be two. `unzip -o` costs nothing and the caller already has it, so the
//! extraction is the shell's job and this reads what it produced. When `nts
//! bind` becomes a real subcommand it will live wherever the CLI does and call
//! the same two functions this does.
#![allow(clippy::print_stdout, clippy::print_stderr, clippy::exit)]

use nts_jvm_emitter::{bind, escapes, read};
use std::path::{Path, PathBuf};

/// Resolves a superclass out of the same directory, so inherited members work.
struct FromDirectory(PathBuf);

impl bind::Resolve for FromDirectory {
    fn find(&self, binary_name: &str) -> Option<read::ClassFile> {
        let bytes = std::fs::read(self.0.join(format!("{binary_name}.class"))).ok()?;
        read::class_file(&bytes).ok()
    }
}

/// Every `.class` under `root`, as binary names, sorted so the output is stable.
fn every_class(root: &Path, at: &Path, found: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(at) else { return };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_dir() {
            every_class(root, &path, found);
        } else if path.extension().is_some_and(|it| it == "class")
            && let Ok(relative) = path.strip_prefix(root)
        {
            found.push(relative.with_extension("").to_string_lossy().replace('\\', "/"));
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (Some(directory), Some(package)) = (args.first(), args.get(1)) else {
        eprintln!("usage: bind <classes-dir> <package> [class...]");
        std::process::exit(2);
    };
    let root = PathBuf::from(directory);

    let mut names: Vec<String> = if args.len() > 2 {
        args[2..].iter().map(|it| it.replace('.', "/")).collect()
    } else {
        let mut found = Vec::new();
        every_class(&root, &root, &mut found);
        found
    };
    names.sort();

    let resolve = FromDirectory(root.clone());
    let mut bodies: Vec<(String, String, Vec<bind::Bound>)> = Vec::new();
    for name in &names {
        let path = root.join(format!("{name}.class"));
        let Ok(bytes) = std::fs::read(&path) else {
            eprintln!("bind: cannot read {}", path.display());
            std::process::exit(1);
        };
        let class = match read::class_file(&bytes) {
            Ok(class) => class,
            Err(why) => {
                eprintln!("bind: {}: {why}", path.display());
                std::process::exit(1);
            }
        };
        // Refuse by name, never half-emit: a declaration file that silently
        // dropped a member is one a caller trusts.
        match bind::declarations_with(&class, &resolve) {
            Ok((body, rows)) => bodies.push((name.clone(), body, rows)),
            Err(why) => {
                eprintln!("bind: refused {why}");
                std::process::exit(1);
            }
        }
    }
    if std::env::var("NTS_BIND_KEEPS").is_ok() {
        // The escape table rather than the declarations. Emitted as its own
        // artefact because it is consumed by the compiler, not by a person --
        // and because a jar of declarations produces an empty one, which is
        // the signal that the analysis had nothing to read.
        println!("{{");
        let mut first = true;
        for name in &names {
            let Ok(bytes) = std::fs::read(root.join(format!("{name}.class"))) else { continue };
            let Ok(class) = read::class_file(&bytes) else { continue };
            for (key, escaping) in escapes::table(&class) {
                if !first {
                    println!(",");
                }
                first = false;
                let list =
                    escaping.iter().map(ToString::to_string).collect::<Vec<_>>().join(", ");
                print!("  \"{key}\": [{list}]");
            }
        }
        println!("\n}}");
        return;
    }
    let (module, bound) = bind::module_of(package, &bodies);
    if std::env::var("NTS_BIND_TABLE").is_ok() {
        // The binding table rather than the declarations, for the same reason
        // the escape table is its own run: it is read by the compiler, not by a
        // person, and mixing the two on one stream would corrupt both.
        //
        // Emitted from the same `module_of` call that produced the text above,
        // so a row's line number is the line the text actually has. Generating
        // it from a second pass over the file would be a second derivation of
        // one fact, and the failure would be silent -- a call resolving to the
        // wrong overload rather than to none.
        println!("# GENERATED by `nts bind`. The binding table for java:{package}.");
        println!("# Keyed by line in the .d.ts beside it: the checker picks the overload,");
        println!("# and the declaration it picked selects the row.");
        println!("# <line> <column> <call> <owner.member:descriptor>");
        for row in &bound {
            let call = match row.call {
                bind::Call::Static => "static",
                bind::Call::Virtual => "virtual",
                bind::Call::Interface => "interface",
                bind::Call::Special => "special",
                bind::Call::Field => "field",
                bind::Call::StaticField => "staticfield",
            };
            println!("{} {} {call} {}", row.line, row.column, row.key);
        }
        return;
    }
    print!("{module}");
}
