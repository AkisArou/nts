//! Command-specific options, checked before acquisition or output.
//!
//! The legacy readers still receive argv. Keep their declarations checked in
//! both directions by `tests/arguments.rs` until parsed options replace them.

use std::fmt::Write as _;

#[derive(Clone, Copy)]
pub(crate) struct Flag {
    pub name: &'static str,
    value: Option<&'static str>,
    inline: bool,
    forwarded: bool,
}

const fn switch(name: &'static str) -> Flag {
    Flag {
        name,
        value: None,
        inline: false,
        forwarded: false,
    }
}
const fn value(name: &'static str, label: &'static str) -> Flag {
    Flag {
        name,
        value: Some(label),
        inline: false,
        forwarded: false,
    }
}
const fn inline(name: &'static str, label: &'static str) -> Flag {
    Flag {
        inline: true,
        ..value(name, label)
    }
}
const fn forwarded(name: &'static str, label: &'static str) -> Flag {
    Flag {
        forwarded: true,
        ..value(name, label)
    }
}

const HELP: &[Flag] = &[switch("--help"), switch("-h")];
const CHECKER_COUNT: Flag = value("--checkers", "1..256");
const CHECKERS: &[Flag] = &[CHECKER_COUNT];
const PROJECT: &[Flag] = &[switch("--no-acquire"), CHECKER_COUNT];
const ROOTS: &[Flag] = &[value("--entry", "name[,name]"), value("--product", "name")];
const PROVIDER: &[Flag] = &[switch("--rc")];
const SHAPE: &[Flag] = &[switch("--main"), switch("--napi"), switch("--glib")];
const LISTING: &[Flag] = &[value("--backend", "c|llvm|jvm")];
const OUT: &[Flag] = &[value("--out", "path")];

pub(crate) struct Command {
    pub name: &'static str,
    positional: &'static str,
    groups: &'static [&'static [Flag]],
}

impl Command {
    pub(crate) fn flags(&self) -> impl Iterator<Item = &Flag> {
        HELP.iter()
            .chain(self.groups.iter().flat_map(|group| group.iter()))
    }

    fn usage(&self) -> String {
        let mut text = format!(
            "usage: nts {}{} [options]\nvalid flags:",
            self.name, self.positional
        );
        for flag in self.flags() {
            let _ = write!(text, "\n  {}", flag.name);
            if let Some(label) = flag.value {
                let _ = write!(text, " <{label}>");
            }
        }
        text
    }
}

const fn command(
    name: &'static str,
    positional: &'static str,
    groups: &'static [&'static [Flag]],
) -> Command {
    Command {
        name,
        positional,
        groups,
    }
}

pub(crate) const COMMANDS: &[Command] = &[
    command("frontend", " [project]", &[PROJECT]),
    command(
        "build",
        " [project]",
        &[
            PROJECT,
            OUT,
            ROOTS,
            PROVIDER,
            &[value("--os", "os"), switch("--nogc"), switch("--partial")],
        ],
    ),
    command("check", " [project]", &[PROJECT, PROVIDER]),
    command("node-deps", " <request.json>", &[]),
    command(
        "bind-c",
        "",
        &[
            OUT,
            &[
                value("--header", "header"),
                value("--define", "definition"),
                value("--module", "name"),
                value("--record", "name"),
                value("--fn", "name"),
                forwarded("--clang", "argument"),
                value("--const", "name[:brand]"),
                value("--no-escape", "function:parameter"),
                value("--alias", "tag=name"),
                value("--constants-out", "path"),
            ],
        ],
    ),
    command(
        "bind-objc",
        "",
        &[
            OUT,
            &[
                value("--sdk", "path"),
                value("--framework", "name"),
                value("--module", "name"),
                value("--class", "name"),
                value("--protocol", "name"),
                value("--function", "name"),
                value("--name", "name"),
                switch("--package"),
                value("--target", "target"),
                value("--symbols", "path"),
                value("--header", "path"),
                value("--project-symbols", "path"),
                value("--include", "path"),
                value("--framework-search", "path"),
                value("--witness", "path"),
                value("--values", "path"),
            ],
        ],
    ),
    command(
        "bind-gir",
        " <namespace>",
        &[
            OUT,
            &[
                value("--gir-dir", "path"),
                value("--header", "namespace:header"),
                value("--package", "namespace:package"),
                value("--define", "namespace:definition"),
            ],
        ],
    ),
    command(
        "bind-winmd",
        " <namespace>...",
        &[OUT, &[value("--winmd", "path"), value("--arch", "arch")]],
    ),
    command(
        "bind",
        "",
        &[
            OUT,
            &[
                value("--jar", "path"),
                value("--classes", "path"),
                value("--package", "name"),
                switch("--prelude"),
                switch("--self-contained"),
                value("--members", "path"),
                value("--overrides", "path"),
            ],
        ],
    ),
    command(
        "emit",
        " [project]",
        &[
            PROJECT,
            ROOTS,
            PROVIDER,
            SHAPE,
            &[
                inline("--out", "path"),
                inline("--backends", "c,llvm,jvm"),
                value("--os", "os"),
                switch("--text"),
            ],
        ],
    ),
    command(
        "emit-c",
        " [project]",
        &[PROJECT, OUT, ROOTS, PROVIDER, SHAPE],
    ),
    command(
        "emit-llvm",
        " [project]",
        &[PROJECT, OUT, ROOTS, PROVIDER, SHAPE, &[value("--os", "os")]],
    ),
    command(
        "emit-jvm",
        " [project]",
        &[PROJECT, OUT, ROOTS, PROVIDER, SHAPE, &[switch("--text")]],
    ),
    command("emit-wasm", " (retired)", &[]),
    command("types", " [project]", &[PROJECT]),
    command(
        "hir",
        " [project]",
        &[
            PROJECT,
            ROOTS,
            PROVIDER,
            SHAPE,
            LISTING,
            &[switch("--prepared")],
        ],
    ),
    command(
        "stats",
        " [project]",
        &[PROJECT, ROOTS, PROVIDER, SHAPE, LISTING],
    ),
    command(
        "regions",
        " [project]",
        &[PROJECT, ROOTS, PROVIDER, SHAPE, LISTING],
    ),
    command(
        "contents-census",
        " [project]",
        &[PROJECT, ROOTS, PROVIDER, SHAPE, LISTING],
    ),
    command(
        "expect-ir",
        " [project]",
        &[PROJECT, ROOTS, PROVIDER, SHAPE],
    ),
    command(
        "facts",
        " [project]",
        &[
            PROJECT,
            &[
                switch("--obligations"),
                switch("--tsv"),
                switch("--strict"),
                switch("--prepared"),
            ],
        ],
    ),
    command("refusals", " [project]", &[PROJECT]),
    command("layouts", " [project]", &[PROJECT]),
    command("modules", " [project]", &[PROJECT]),
    command("erasure", " [project]", &[PROJECT, &[switch("--sites")]]),
    command("receivers", " [project]", &[PROJECT, &[switch("--sites")]]),
    command(
        "deps",
        " [project]",
        &[
            CHECKERS,
            &[switch("--dry-run"), switch("--verbose"), switch("--json")],
        ],
    ),
    command("version", "", &[]),
    command("help", "", &[]),
];

/// Whether an option's next argument is its value, for positional discovery.
///
/// `nts emit-jvm --out /tmp/x proj` once compiled `/tmp/x`: an empty class,
/// exit zero, and an hour spent looking for an emitter bug. Missing `--entry`
/// and `--product` later made their values become project paths too, so flag
/// order decided whether a command worked. Keep this metadata with the flags.
pub(crate) fn takes_value(name: &str) -> bool {
    COMMANDS
        .iter()
        .flat_map(Command::flags)
        .any(|flag| flag.name == name && flag.value.is_some())
}

/// Return whether help was requested. Values (including a forwarded `--help`)
/// are never scanned again as options, and validation precedes all side effects.
pub(crate) fn validate(args: &[String]) -> Result<bool, String> {
    let Some(name) = args.first() else {
        return Ok(false);
    };
    let command = if matches!(name.as_str(), "--help" | "-h") {
        "help"
    } else {
        name
    };
    let Some(command) = COMMANDS.iter().find(|entry| entry.name == command) else {
        return if name.starts_with('-') {
            Err(format!(
                "unknown flag `{name}`\nusage: nts <command> [project] [options]\nvalid flags: --help, -h"
            ))
        } else {
            Ok(false)
        };
    };
    let mut help = matches!(name.as_str(), "--help" | "-h");
    let mut at = 1;
    while let Some(arg) = args.get(at) {
        if !arg.starts_with('-') {
            // Keep examining arguments after the project. Breaking there once
            // silently ignored `proj -o /tmp/x`; the empty output directory
            // was read as another emitter bug.
            at += 1;
            continue;
        }
        let (name, assigned) = arg
            .split_once('=')
            .map_or((arg.as_str(), None), |(key, value)| (key, Some(value)));
        // Only `-h` is a short flag. Reject other single-dash spellings such
        // as `-o` explicitly: silently accepting them loses the requested
        // output, and they are not aliases for this CLI's long options.
        let flag = command
            .flags()
            .find(|flag| flag.name == name && (assigned.is_none() || flag.inline))
            .ok_or_else(|| {
                format!(
                    "unknown flag `{arg}` for `nts {}`\n{}",
                    command.name,
                    command.usage()
                )
            })?;
        help |= matches!(name, "--help" | "-h");
        if let Some(label) = flag.value {
            let value = if let Some(value) = assigned {
                value
            } else {
                at += 1;
                args.get(at)
                    .map(String::as_str)
                    .filter(|value| flag.forwarded || !value.starts_with('-'))
                    .ok_or_else(|| {
                        format!("`{name}` needs a value <{label}>\n{}", command.usage())
                    })?
            };
            if value.is_empty() {
                return Err(format!(
                    "`{name}` needs a nonempty value <{label}>\n{}",
                    command.usage()
                ));
            }
        }
        at += 1;
    }
    Ok(help)
}
