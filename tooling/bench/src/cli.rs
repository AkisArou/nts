use anyhow::{Result, bail};

pub(super) const USAGE: &str = "Usage: nts-bench [--root <tree>] [case ...]
       nts-bench [--root <tree>] --group <name>
       nts-bench [--root <tree>] --count [case ...]
       nts-bench [--root <tree>] --render [run.json]
       nts-bench --help

With no case names, measures every benchmark case. Explicit case names select
only those rows. `--group <name>` measures exactly the rows the foundation
page naming that group declares, and combines with `--count`. --count prints
each selected row's instruction counts per column instead of timing it: fixed
work counted on any CPU outside 4-5, with no measurement lock. --render
renders a saved run without measuring workloads.";

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Command {
    Help,
    Measure(Vec<String>),
    Render(Option<String>),
    Count(Vec<String>),
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Arguments {
    pub(super) root: Option<String>,
    pub(super) journal: Option<String>,
    pub(super) group: Option<String>,
    pub(super) command: Command,
}

pub(super) fn parse(args: impl IntoIterator<Item = String>) -> Result<Arguments> {
    let mut args = args.into_iter().peekable();
    let mut root = None;
    let mut journal = None;
    let mut group = None;
    let mut command = None;
    let mut cases = Vec::new();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--root" => {
                let path = args.next().filter(|next| !next.starts_with('-'));
                let Some(path) = path else {
                    bail!("`--root` needs a path after it");
                };
                if root.replace(path).is_some() {
                    bail!("`--root` was supplied more than once");
                }
            }
            "--help" | "-h" => set_command(&mut command, Command::Help)?,
            "--journal" => {
                let Some(path) = args.next().filter(|next| !next.starts_with('-')) else {
                    bail!("`--journal` needs a path after it");
                };
                if journal.replace(path).is_some() {
                    bail!("`--journal` was supplied more than once");
                }
            }
            "--group" => {
                let Some(name) = args.next().filter(|next| !next.starts_with('-')) else {
                    bail!("`--group` needs a name after it");
                };
                if group.replace(name).is_some() {
                    bail!("`--group` was supplied more than once");
                }
            }
            "--render" => {
                let path = args.peek().is_some_and(|next| !next.starts_with('-'));
                let path = path.then(|| args.next().expect("peeked render path"));
                set_command(&mut command, Command::Render(path))?;
            }
            "--count" | "--count-prepare" => set_command(&mut command, Command::Count(vec![]))?,
            value if value.starts_with('-') => bail!("unknown option `{value}`"),
            _ => cases.push(arg),
        }
    }
    if matches!(command, Some(Command::Help | Command::Render(_))) && !cases.is_empty() {
        bail!("case names cannot be combined with --help or --render");
    }
    if group.is_some()
        && (matches!(command, Some(Command::Help | Command::Render(_))) || !cases.is_empty())
    {
        bail!(
            "`--group` selects its rows on its own; it cannot be combined with case names, --help or --render"
        );
    }
    if matches!(command, Some(Command::Count(_))) && journal.is_some() {
        bail!("`--count` records no run to journal");
    }
    Ok(Arguments {
        root,
        journal,
        group,
        command: match command {
            Some(Command::Count(_)) => Command::Count(cases),
            command => command.unwrap_or(Command::Measure(cases)),
        },
    })
}

fn set_command(selected: &mut Option<Command>, command: Command) -> Result<()> {
    if selected.replace(command).is_some() {
        bail!("choose one command: --help, --render, --count or measurement");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(args: &[&str]) -> impl Iterator<Item = String> {
        args.iter().map(|arg| (*arg).to_owned())
    }

    #[test]
    fn help_is_a_command_before_any_repository_or_measurement_setup() {
        for flag in ["--help", "-h"] {
            let args = parse(argv(&["--root", "/does/not/exist", flag]))
                .expect("valid benchmark arguments");
            assert_eq!(args.command, Command::Help);
            assert!(USAGE.contains("Usage: nts-bench"));
        }
    }

    #[test]
    fn unknown_options_refuse_by_name_instead_of_selecting_all_cases() {
        for flag in ["--helpp", "--unknown=value", "-x"] {
            let error = parse(argv(&[flag]))
                .expect_err("unknown flags are rejected")
                .to_string();
            assert_eq!(error, format!("unknown option `{flag}`"));
        }
    }

    #[test]
    fn measurement_and_render_inputs_have_one_parse() {
        assert_eq!(
            parse(argv(&[])).expect("valid benchmark arguments").command,
            Command::Measure(vec![])
        );
        let args =
            parse(argv(&["--root", "/tree", "fib", "loop"])).expect("valid benchmark arguments");
        assert_eq!(args.root.as_deref(), Some("/tree"));
        assert_eq!(
            args.command,
            Command::Measure(vec!["fib".into(), "loop".into()])
        );
        assert_eq!(
            parse(argv(&["--render"]))
                .expect("valid benchmark arguments")
                .command,
            Command::Render(None)
        );
        assert_eq!(
            parse(argv(&["--render", "run.json"]))
                .expect("valid benchmark arguments")
                .command,
            Command::Render(Some("run.json".into()))
        );
        assert!(parse(argv(&["--root"])).is_err());
        assert!(parse(argv(&["--root", "--help"])).is_err());
        assert!(parse(argv(&["--root", "a", "--root", "b"])).is_err());
        assert!(parse(argv(&["--render", "run.json", "fib"])).is_err());
    }

    #[test]
    fn a_group_is_its_own_selection() {
        let args = parse(argv(&["--root", "/tree", "--group", "maps"]))
            .expect("valid benchmark arguments");
        assert_eq!(args.group.as_deref(), Some("maps"));
        assert_eq!(args.command, Command::Measure(vec![]));
        for case in [
            &["--group"][..],
            &["--group", "maps", "--group", "json"],
            &["--group", "maps", "fib"],
            &["fib", "--group", "maps"],
            &["--group", "maps", "--render"],
            &["--group", "maps", "--help"],
        ] {
            assert!(parse(argv(case)).is_err(), "{case:?}");
        }
    }

    #[test]
    fn count_takes_case_names_and_combines_with_a_group() {
        assert_eq!(
            parse(argv(&["--count"]))
                .expect("valid benchmark arguments")
                .command,
            Command::Count(vec![])
        );
        let args = parse(argv(&["--count", "fib", "loop"])).expect("valid benchmark arguments");
        assert_eq!(
            args.command,
            Command::Count(vec!["fib".into(), "loop".into()])
        );
        let grouped =
            parse(argv(&["--count", "--group", "maps"])).expect("valid benchmark arguments");
        assert_eq!(grouped.group.as_deref(), Some("maps"));
        assert_eq!(grouped.command, Command::Count(vec![]));
        assert!(parse(argv(&["--count", "--journal", "run.log"])).is_err());
        assert!(parse(argv(&["--count", "--count"])).is_err());
        assert!(parse(argv(&["--count", "--render"])).is_err());
    }
}
