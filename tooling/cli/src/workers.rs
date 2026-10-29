//! Configure one process-wide budget before any compiler work starts.

use std::num::NonZeroU16;

use anyhow::{Result, bail};

pub(super) fn configure(arguments: &mut Vec<String>) -> Result<()> {
    if let Some(workers) = take(arguments)? {
        nts_frontend_tsrs::configure_worker_budget(workers)?;
    }
    Ok(())
}

fn take(arguments: &mut Vec<String>) -> Result<Option<NonZeroU16>> {
    let mut workers = None;
    let mut at = 0;
    while at < arguments.len() {
        if arguments[at] != "--workers" {
            at += 1;
            continue;
        }
        if workers.is_some() {
            bail!("--workers may be specified only once");
        }
        let Some(value) = arguments.get(at + 1) else {
            bail!("--workers requires a count from 1 to 256");
        };
        let Some(count) = value.parse::<NonZeroU16>().ok().filter(|n| n.get() <= 256) else {
            bail!("worker budget `{value}` must be an integer from 1 to 256");
        };
        workers = Some(count);
        arguments.drain(at..at + 2);
    }
    Ok(workers)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn budget_values_are_consumed_before_legacy_project_discovery() {
        let mut args = ["hir", "--workers", "1", "subject"]
            .map(str::to_owned)
            .to_vec();
        assert_eq!(take(&mut args).unwrap(), Some(NonZeroU16::MIN));
        assert_eq!(args, ["hir", "subject"]);
        for values in [
            vec!["--workers"],
            vec!["--workers", "0"],
            vec!["--workers", "257"],
            vec!["--workers", "1", "--workers", "2"],
        ] {
            assert!(take(&mut values.into_iter().map(str::to_owned).collect()).is_err());
        }
    }
}
