//! One checker-count setting for both interactive commands and batch workers.

use std::num::NonZeroU16;

use anyhow::{Result, bail};

pub(super) fn from_process() -> Result<Option<NonZeroU16>> {
    parse(
        &std::env::args().collect::<Vec<_>>(),
        std::env::var("NTS_CHECKERS").ok().as_deref(),
    )
}

fn parse(args: &[String], environment: Option<&str>) -> Result<Option<NonZeroU16>> {
    let mut value = environment;
    let mut arguments = args.iter();
    while let Some(argument) = arguments.next() {
        if argument == "--checkers" {
            let Some(next) = arguments.next() else {
                bail!("--checkers requires a count from 1 to 256");
            };
            value = Some(next);
        }
    }
    let Some(value) = value else { return Ok(None) };
    let count = value
        .parse::<NonZeroU16>()
        .ok()
        .filter(|count| count.get() <= 256);
    match count {
        Some(count) => Ok(Some(count)),
        None => bail!(
            "checker count `{value}` must be an integer from 1 to 256 (--checkers or NTS_CHECKERS)"
        ),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn the_cli_count_overrides_the_batch_environment() {
        assert_eq!(parse(&[], None).unwrap(), None);
        assert_eq!(parse(&[], Some("1")).unwrap(), Some(NonZeroU16::MIN));
        assert_eq!(
            parse(&args(&["--checkers", "4"]), Some("1"))
                .unwrap()
                .unwrap()
                .get(),
            4
        );
        // An explicit valid count also replaces an invalid environment value.
        assert!(parse(&args(&["--checkers", "256"]), Some("invalid")).is_ok());
    }

    #[test]
    fn an_invalid_count_is_an_error_before_starting_the_checker() {
        for value in ["0", "257", "-1", "1.5", "", "all"] {
            assert!(parse(&[], Some(value)).is_err(), "{value}");
            assert!(
                parse(&args(&["--checkers", value]), None).is_err(),
                "{value}"
            );
        }
        assert!(parse(&args(&["--checkers"]), None).is_err());
    }
}
