//! How much of a real jar the escape analysis can prove anything about.
//!
//! ```text
//! cargo run --release -p nts-jvm-emitter --example escape_yield -- <classes-dir>
//! ```
//!
//! The number that decides whether analysing bytecode is the mechanism or
//! whether the overrides file is. Printed rather than asserted, because it is a
//! property of somebody else's jar and will move when they ship a new one.
#![allow(clippy::print_stdout, clippy::exit)]

use nts_jvm_emitter::{escapes, read};
use std::path::{Path, PathBuf};

fn walk(at: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(at) else { return };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, found);
        } else if path.extension().is_some_and(|it| it == "class") {
            found.push(path);
        }
    }
}

fn main() {
    let Some(directory) = std::env::args().nth(1) else {
        eprintln!("usage: escape_yield <classes-dir>");
        std::process::exit(2);
    };
    let root = PathBuf::from(&directory);
    let mut files = Vec::new();
    walk(&root, &mut files);

    let (mut classes, mut methods, mut with_body, mut analysed) = (0usize, 0usize, 0usize, 0usize);
    let (mut any_reference, mut proved_none, mut proved_some) = (0usize, 0usize, 0usize);

    for path in &files {
        let Ok(bytes) = std::fs::read(path) else { continue };
        let Ok(class) = read::class_file(&bytes) else { continue };
        classes += 1;
        for method in &class.methods {
            methods += 1;
            if method.code.is_some() {
                with_body += 1;
            }
            // Only a reference parameter can escape, so a method with none is
            // not evidence either way and would inflate the yield.
            let references = method
                .descriptor
                .split(')')
                .next()
                .unwrap_or("")
                .matches(['L', '['])
                .count();
            if references == 0 {
                continue;
            }
            any_reference += 1;
            let kept = escapes::of(method);
            if !kept.analysed {
                continue;
            }
            analysed += 1;
            if kept.escaping.is_empty() {
                proved_none += 1;
            } else {
                proved_some += 1;
            }
        }
    }

    println!("classes                 {classes}");
    println!("methods                 {methods}");
    println!("  with a body           {with_body}");
    println!("methods taking a ref    {any_reference}");
    println!("  analysed              {analysed}");
    println!("  proved: none escapes  {proved_none}");
    println!("  proved: some escapes  {proved_some}");
    if any_reference > 0 {
        #[allow(clippy::cast_precision_loss)]
        let pct = |n: usize| (n as f64) * 100.0 / (any_reference as f64);
        println!("yield: {:.1}% analysed, {:.1}% proved non-escaping", pct(analysed), pct(proved_none));
    }
}
