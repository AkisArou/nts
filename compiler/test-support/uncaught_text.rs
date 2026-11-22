//! Synchronous throws use the value's fixed message projection on every backend.
pub(crate) const CASES: &[(&str, &str)] = &[
    (
        "class SourceError extends Error {constructor(message:string){super(message)}} throw new SourceError('kept');",
        "nts: uncaught SourceError: kept\n",
    ),
    (
        "throw new RangeError('kept');",
        "nts: uncaught RangeError: kept\n",
    ),
    ("throw 'kept';", "nts: uncaught kept\n"),
    (
        "class Message {constructor(readonly message:string){}} throw new Message('kept');",
        "nts: uncaught Message: kept\n",
    ),
    // Only the field name differs from the non-error object above.
    (
        "class Message {constructor(readonly other:string){}} throw new Message('kept');",
        "nts: uncaught Message\n",
    ),
];
