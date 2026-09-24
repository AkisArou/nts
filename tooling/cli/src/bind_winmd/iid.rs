//! The IID of a generic Windows Runtime interface's instantiation.
//!
//! `IIterable<String>` has no `GuidAttribute`: its IID is computed from the
//! generic interface's own and its arguments', as every projection computes
//! it. The rule is the Windows Runtime's: a signature string --
//! `pinterface({faa585ea-6214-4217-afda-7f46de5869b3};string)` -- hashed
//! under a fixed namespace GUID into a version-5 (SHA-1) UUID.
//!
//! SHA-1 is written out here rather than taken from a crate: it derives an
//! identifier, not a secret, and is pinned by its standard test vectors and
//! by IIDs Windows answers `QueryInterface` for.

use std::fmt::Write as _;

/// `11F47AD5-7B73-42C0-ABAE-878B1E16ADEE`, the namespace every parameterized
/// IID is derived under.
const NAMESPACE: [u8; 16] = [0x11, 0xF4, 0x7A, 0xD5, 0x7B, 0x73, 0x42, 0xC0, 0xAB, 0xAE, 0x87, 0x8B, 0x1E, 0x16, 0xAD, 0xEE];

/// The IID of the instantiation whose signature is `signature`, as
/// `8-4-4-4-12` uppercase hexadecimal.
pub(crate) fn parameterized(signature: &str) -> String {
    let mut data = NAMESPACE.to_vec();
    data.extend_from_slice(signature.as_bytes());
    let hash = sha1(&data);
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    // RFC 4122 version 5, variant 1.
    bytes[6] = (bytes[6] & 0x0F) | 0x50;
    bytes[8] = (bytes[8] & 0x3F) | 0x80;
    let hex = bytes.iter().fold(String::new(), |mut hex, byte| {
        let _ = write!(hex, "{byte:02X}");
        hex
    });
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

/// SHA-1 (FIPS 180-4), in the standard's own names.
#[allow(clippy::many_single_char_names)]
fn sha1(data: &[u8]) -> [u8; 20] {
    let mut state: [u32; 5] = [0x6745_2301, 0xEFCD_AB89, 0x98BA_DCFE, 0x1032_5476, 0xC3D2_E1F0];
    let mut message = data.to_vec();
    let length = u64::try_from(data.len()).unwrap_or(u64::MAX).wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&length.to_be_bytes());
    for block in message.chunks_exact(64) {
        let mut words = [0u32; 80];
        for (at, word) in block.chunks_exact(4).enumerate() {
            words[at] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for at in 16..80 {
            words[at] = (words[at - 3] ^ words[at - 8] ^ words[at - 14] ^ words[at - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = state;
        for (at, word) in words.iter().enumerate() {
            let (f, k) = match at {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let next = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = next;
        }
        for (slot, value) in state.iter_mut().zip([a, b, c, d, e]) {
            *slot = slot.wrapping_add(value);
        }
    }
    let mut out = [0u8; 20];
    for (at, word) in state.iter().enumerate() {
        out[at * 4..at * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{parameterized, sha1};

    fn hex(bytes: &[u8]) -> String {
        use std::fmt::Write as _;
        bytes.iter().fold(String::new(), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        })
    }

    /// FIPS 180-4's own examples.
    #[test]
    fn sha1_is_the_standard_one() {
        assert_eq!(hex(&sha1(b"")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(hex(&sha1(b"abc")), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(
            hex(&sha1(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
            "84983e441c3bd26ebaae4aa1f95129e5e54670f1"
        );
    }

    /// `IIterable<String>`, which C++/WinRT and windows-rs compute alike.
    #[test]
    fn an_instantiation_iid_is_the_windows_runtimes() {
        assert_eq!(
            parameterized("pinterface({faa585ea-6214-4217-afda-7f46de5869b3};string)"),
            "E2FCC7C1-3BFC-5A0B-B2B0-72E769D1CB7E"
        );
    }
}
