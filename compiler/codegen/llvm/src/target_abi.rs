//! Target classification shared by runtime declarations and call adapters.

use crate::{Arch, Platform};
use nts_core::hir::native::PlatformConvention;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RuntimeAbi {
    SysVX86_64,
    WindowsX86_64,
    AppleArm64,
    LinuxArm64,
    WindowsArm64,
}

impl RuntimeAbi {
    pub(crate) fn of(platform: Platform) -> Self {
        use PlatformConvention::{SysV, Win64};
        match (platform.arch, platform.abi.convention, platform.darwin) {
            (Arch::X86_64, SysV, false | true) => Self::SysVX86_64,
            (Arch::X86_64, Win64, false | true) => Self::WindowsX86_64,
            (Arch::Aarch64, SysV | Win64, true) => Self::AppleArm64,
            (Arch::Aarch64, SysV, false) => Self::LinuxArm64,
            (Arch::Aarch64, Win64, false) => Self::WindowsArm64,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_runtime_abi_shares_its_table_and_indirect_rule() {
        use RuntimeAbi::{AppleArm64, LinuxArm64, SysVX86_64, WindowsArm64, WindowsX86_64};
        for abi in [
            SysVX86_64,
            WindowsX86_64,
            AppleArm64,
            LinuxArm64,
            WindowsArm64,
        ] {
            let (platform, table, indirect, arguments): (_, _, _, &[&str]) = match abi {
                SysVX86_64 => (
                    Platform::SYSV_X86_64,
                    crate::signatures::SIGNATURES,
                    false,
                    &["i32", "i64"],
                ),
                WindowsX86_64 => (
                    Platform::WIN64_X86_64,
                    crate::signatures_win64::SIGNATURES_WIN64,
                    true,
                    &["ptr"],
                ),
                AppleArm64 => (
                    Platform::APPLE_ARM64,
                    crate::signatures_arm64::SIGNATURES_ARM64,
                    false,
                    &["[2 x i64]"],
                ),
                LinuxArm64 => (
                    Platform::LINUX_ARM64,
                    crate::signatures_arm64_linux::SIGNATURES_ARM64_LINUX,
                    false,
                    &["[2 x i64]"],
                ),
                WindowsArm64 => (
                    Platform::WINDOWS_ARM64,
                    crate::signatures_arm64_windows::SIGNATURES_ARM64_WINDOWS,
                    false,
                    &["[2 x i64]"],
                ),
            };
            assert_eq!(RuntimeAbi::of(platform), abi);
            assert!(std::ptr::eq(crate::signatures::table(platform), table));
            assert_eq!(crate::indirect::applies(platform), indirect);
            let signature = crate::signatures::signature_on("nts_value_truthy_fn", platform)
                .expect("erased argument declaration");
            assert_eq!(signature.params, arguments);
        }
    }
}
