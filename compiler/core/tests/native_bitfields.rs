//! The bit-field allocator against clang's own numbers.
//!
//! Every expectation here was produced by `clang -Xclang -fdump-record-layouts`
//! on the same declaration, not derived from the ABI document. The probe
//! structs exist to separate cases the document states together, and the
//! comment beside each records what clang printed.
use nts_core::hir::layout::{native_place, BitPlace};
use nts_core::hir::native::{Naming, Pointee, Record, RecordKind, Scalar};

fn bits(unit: Scalar, width: u32) -> Pointee {
    Pointee::Bits { unit, width }
}

fn record(fields: &[(&str, Pointee)]) -> Record {
    Record {
        name: "probe".to_owned(),
        fields: fields
            .iter()
            .map(|(name, ty)| nts_core::hir::native::Field {
                name: (*name).to_owned(),
                ty: ty.clone(),
            })
            .collect(),
        kind: RecordKind::Struct,
        naming: Naming::Tagged { from_header: true },
        packed: false,
    }
}

/// Each row is `(byte, lo, width)` as clang prints `byte:lo-hi`.
fn placed(record: &Record) -> (Vec<(u32, Option<BitPlace>)>, u32, u32) {
    let place = native_place(record).expect("a record of bit-fields has a layout");
    let rows = place
        .offsets
        .iter()
        .copied()
        .zip(place.bits.iter().copied())
        .collect();
    (rows, place.size, place.align)
}

#[test]
fn a_bit_field_continues_across_a_byte_boundary() {
    //     0:0-2 |   unsigned int a
    //     0:3-9 |   unsigned int b
    //    1:2-21 |   unsigned int c
    //         4 |   unsigned char d
    //     5:0-4 |   unsigned int e
    //           | [sizeof=8, align=4]
    let (rows, size, align) = placed(&record(&[
        ("a", bits(Scalar::UInt, 3)),
        ("b", bits(Scalar::UInt, 7)),
        ("c", bits(Scalar::UInt, 20)),
        ("d", Pointee::Scalar(Scalar::UInt8)),
        ("e", bits(Scalar::UInt, 5)),
    ]));
    assert_eq!(
        rows,
        vec![
            (0, Some(BitPlace { lo: 0, width: 3 })),
            (0, Some(BitPlace { lo: 3, width: 7 })),
            (1, Some(BitPlace { lo: 2, width: 20 })),
            (4, None),
            (5, Some(BitPlace { lo: 0, width: 5 })),
        ]
    );
    assert_eq!((size, align), (8, 4));
}

#[test]
fn a_bit_field_that_would_straddle_its_unit_starts_a_new_one() {
    //    0:0-29 |   unsigned int a
    //     4:0-4 |   unsigned int b
    //           | [sizeof=8, align=4]
    //
    // Without the bump `b` would sit at bit 30 and the struct would be five
    // bytes of content rather than the header's eight.
    let (rows, size, align) = placed(&record(&[
        ("a", bits(Scalar::UInt, 30)),
        ("b", bits(Scalar::UInt, 5)),
    ]));
    assert_eq!(
        rows,
        vec![
            (0, Some(BitPlace { lo: 0, width: 30 })),
            (4, Some(BitPlace { lo: 0, width: 5 })),
        ]
    );
    assert_eq!((size, align), (8, 4));
}

/// The arm that reads where the unit width comes from.
///
/// Added because it was missing: hard-coding the unit to 32 bits left the other
/// four tests **all passing**. In every one of them a 32-bit assumption and the
/// field's real unit happen to bump at the same place, so none of them was
/// asking the question its name claimed.
///
///     0:0-5 |   unsigned char a
///     1:0-4 |   unsigned char b
///           | [sizeof=2, align=1]
///
/// An 8-bit unit has no room for `b` at bit 6 and bumps it to bit 8. A 32-bit
/// unit has room, and would leave it at `0:6-10` in a one-byte-larger struct.
#[test]
fn a_narrow_unit_bumps_where_a_wide_one_would_not() {
    let (rows, size, align) = placed(&record(&[
        ("a", bits(Scalar::UInt8, 6)),
        ("b", bits(Scalar::UInt8, 5)),
    ]));
    assert_eq!(
        rows,
        vec![
            (0, Some(BitPlace { lo: 0, width: 6 })),
            (1, Some(BitPlace { lo: 0, width: 5 })),
        ]
    );
    assert_eq!((size, align), (2, 1));
}

#[test]
fn the_unit_that_decides_the_bump_is_the_arriving_field_s() {
    //    0:0-5  |   unsigned char p
    //    4:0-29 |   unsigned int q
    //           | [sizeof=8, align=4]
    //
    // The discriminating case. `p` ends at bit 6 and an 8-bit unit has room,
    // so a rule reading the *previous* field's unit would leave `q` at bit 6.
    // It is `q`'s own 32-bit unit that it would straddle.
    let (rows, size, align) = placed(&record(&[
        ("p", bits(Scalar::UInt8, 6)),
        ("q", bits(Scalar::UInt, 30)),
    ]));
    assert_eq!(
        rows,
        vec![
            (0, Some(BitPlace { lo: 0, width: 6 })),
            (4, Some(BitPlace { lo: 0, width: 30 })),
        ]
    );
    assert_eq!((size, align), (8, 4));
}

#[test]
fn struct_iphdr_is_the_consumer_and_matches_the_header() {
    //     0:0-3 |   unsigned int ihl
    //     0:4-7 |   unsigned int version
    //         1 |   uint8_t tos
    //        ...
    //        16 |   uint32_t daddr
    //           | [sizeof=20, align=4]
    let (rows, size, align) = placed(&record(&[
        ("ihl", bits(Scalar::UInt, 4)),
        ("version", bits(Scalar::UInt, 4)),
        ("tos", Pointee::Scalar(Scalar::UInt8)),
        ("tot_len", Pointee::Scalar(Scalar::UInt16)),
        ("id", Pointee::Scalar(Scalar::UInt16)),
        ("frag_off", Pointee::Scalar(Scalar::UInt16)),
        ("ttl", Pointee::Scalar(Scalar::UInt8)),
        ("protocol", Pointee::Scalar(Scalar::UInt8)),
        ("check", Pointee::Scalar(Scalar::UInt16)),
        ("saddr", Pointee::Scalar(Scalar::UInt32)),
        ("daddr", Pointee::Scalar(Scalar::UInt32)),
    ]));
    assert_eq!(rows[0], (0, Some(BitPlace { lo: 0, width: 4 })));
    assert_eq!(rows[1], (0, Some(BitPlace { lo: 4, width: 4 })));
    assert_eq!(rows[2], (1, None), "the first ordinary member is on byte 1");
    assert_eq!(rows[10], (16, None), "daddr");
    assert_eq!((size, align), (20, 4));
}

/// The packed rule, read off clang the way the unpacked one was.
///
/// ```text
/// packed:  unsigned int x : 30;  unsigned int y : 5;      0:0-29  3:6-10
/// packed:  unsigned char p : 6;  unsigned int  q : 30;    0:0-5   0:6-35
/// packed:  unsigned int m : 4;   unsigned char n;         0:0-3   1
/// ```
///
/// A packed bit-field is **never** bumped, so `y` continues at absolute bit 30
/// -- byte 3, six bits in -- rather than starting a fifth byte. `q` is the case
/// that matters to a reader: six bits into the record and thirty wide, it ends
/// at bit 35, four bits past the 32-bit unit it is declared in. Anything that
/// loads "the unit containing it" gets 26 of its 30 bits.
#[test]
fn a_packed_bit_field_is_never_bumped_and_may_straddle_its_unit() {
    let packed = |fields: &[(&str, Pointee)]| {
        let mut record = record(fields);
        record.packed = true;
        placed(&record)
    };
    let (rows, size, align) = packed(&[
        ("x", bits(Scalar::UInt, 30)),
        ("y", bits(Scalar::UInt, 5)),
    ]);
    assert_eq!(
        rows,
        vec![
            (0, Some(BitPlace { lo: 0, width: 30 })),
            (3, Some(BitPlace { lo: 6, width: 5 })),
        ]
    );
    assert_eq!((size, align), (5, 1));

    let (rows, size, align) = packed(&[
        ("p", bits(Scalar::UInt8, 6)),
        ("q", bits(Scalar::UInt, 30)),
    ]);
    assert_eq!(
        rows,
        vec![
            (0, Some(BitPlace { lo: 0, width: 6 })),
            (0, Some(BitPlace { lo: 6, width: 30 })),
        ],
        "q straddles its unit rather than starting a new one"
    );
    assert_eq!((size, align), (5, 1));

    // An ordinary member after a bit-field: on the next byte, and at no
    // alignment of its own.
    let (rows, size, align) = packed(&[
        ("m", bits(Scalar::UInt, 4)),
        ("n", Pointee::Scalar(Scalar::UInt8)),
    ]);
    assert_eq!(rows, vec![(0, Some(BitPlace { lo: 0, width: 4 })), (1, None)]);
    assert_eq!((size, align), (2, 1));
}

/// The arm that makes the three above about *packing*: unpacked, the same
/// fields bump and round, and every number differs.
#[test]
fn the_same_fields_unpacked_bump_and_round() {
    let (rows, size, align) = placed(&record(&[
        ("x", bits(Scalar::UInt, 30)),
        ("y", bits(Scalar::UInt, 5)),
    ]));
    assert_eq!(
        rows,
        vec![
            (0, Some(BitPlace { lo: 0, width: 30 })),
            (4, Some(BitPlace { lo: 0, width: 5 })),
        ]
    );
    assert_eq!((size, align), (8, 4));
}
