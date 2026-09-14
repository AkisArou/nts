// Independent C spellings and boundary values, shared by both backend tests.
//
// Two families, because the brands have two source representations and mixing
// them would test neither. A `double` holds every integer to 2^53 exactly and
// nothing beyond, so the 64-bit C spellings are `bigint`-based and the rest are
// `number`-based -- and the values that distinguish them are precisely the ones
// a `number` cannot carry.
pub(crate) const CASES: &[(&str, &str, &str, &str)] = &[
    ("c_int", "int", "-3.75", "-3"),
    ("c_uint", "unsigned int", "4294967295", "4294967295"),
    // `char` is a third type, distinct from both `signed char` and `unsigned
    // char` even where it has one of their representations, and a case of its
    // own because that distinctness is what a `_Generic` witness asserts on.
    // It is signed on this target; a build where it is not fails right here.
    ("c_char", "char", "-127.75", "-127"),
    ("c_int8", "int8_t", "-127.75", "-127"),
    ("c_uint8", "uint8_t", "255.75", "255"),
    ("c_int16", "int16_t", "-32767.75", "-32767"),
    ("c_uint16", "uint16_t", "65535.75", "65535"),
    ("c_int32", "int32_t", "-2147483647.75", "-2147483647"),
    ("c_uint32", "uint32_t", "4294967295", "4294967295"),
    ("c_float", "float", "16777217", "16777216"),
    ("c_double", "double", "1.25", "1.25"),
];

/// The 64-bit spellings, whose values a `number` cannot hold.
///
/// Every literal here is one a double rounds or destroys: 2^53+1 rounds down,
/// and `INT64_MAX` through a double came back as `INT64_MIN` -- a sign flip,
/// measured, with a correct `int64_t` prototype at both ends. The TypeScript
/// literal carries `n`; the C literal is spelled for its own type.
pub(crate) const WIDE_CASES: &[(&str, &str, &str, &str)] = &[
    ("c_int64", "int64_t", "9007199254740993n", "9007199254740993LL"),
    ("c_int64", "int64_t", "-9223372036854775808n", "INT64_MIN"),
    ("c_int64", "int64_t", "9223372036854775807n", "INT64_MAX"),
    ("c_uint64", "uint64_t", "18446744073709551615n", "UINT64_MAX"),
    ("c_uint64", "uint64_t", "9007199254740993n", "9007199254740993ULL"),
    ("c_long", "long", "-9223372036854775808n", "INT64_MIN"),
    ("c_ulong", "unsigned long", "18446744073709551615n", "UINT64_MAX"),
    ("c_size_t", "size_t", "18446744073709551615n", "SIZE_MAX"),
    ("c_ptrdiff_t", "ptrdiff_t", "9223372036854775807n", "PTRDIFF_MAX"),
];
