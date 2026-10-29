use anyhow::{Result, bail};

pub(super) const USAGE: &str = "Usage: nts-bench [--root <tree>] [case ...]
       nts-bench [--root <tree>] --render [run.json]
       nts-bench --help

With no case names, measures every benchmark case. Explicit case names select
only those rows. --render renders a saved run without measuring workloads.";

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Command {
    Help,
    Measure(Vec<String>),
    Render(Option<String>),
    Count,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Arguments {
    pub(super) root: Option<String>,
    pub(super) command: Command,
}

pub(super) fn parse(args: impl IntoIterator<Item = String>) -> Result<Arguments> {
    let mut args = args.into_iter().peekable();
    let mut root = None;
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
            "--render" => {
                let path = args.peek().is_some_and(|next| !next.starts_with('-'));
                let path = path.then(|| args.next().expect("peeked render path"));
                set_command(&mut command, Command::Render(path))?;
            }
            "--count" | "--count-prepare" => set_command(&mut command, Command::Count)?,
            value if value.starts_with('-') => bail!("unknown option `{value}`"),
            _ => cases.push(arg),
        }
    }
    if command.is_some() && !cases.is_empty() {
        bail!("case names cannot be combined with --help, --render or --count");
    }
    Ok(Arguments {
        root,
        command: command.unwrap_or(Command::Measure(cases)),
    })
}

fn set_command(selected: &mut Option<Command>, command: Command) -> Result<()> {
    if selected.replace(command).is_some() {
        bail!("choose one command: --help, --render or measurement");
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
}
