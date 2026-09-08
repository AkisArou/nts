# ECMA-262 clause 25.5, pinned

`json-25.5.txt` is the normative text of **The JSON Object** — the algorithm the
implementation in `runtime/web-platform/src/json/` is written against. It is here so a
reader can check a cited step without a network round trip, and so that a later editorial
change to the specification is a visible diff rather than a silent drift under the code.

It is a **derived** artifact: tags stripped, list items marked, tables flattened. The source
is authoritative and the hash below is what makes the derivation checkable.

| | |
|---|---|
| Source | `https://tc39.es/ecma262/multipage/structured-data.html` |
| Retrieved | 2026-09-08 |
| Source SHA-256 | `69cd99fe7c496ff8ea45238bddac6f795f3d1d78c3675c61b837f62a01b63287` |
| Extract SHA-256 | `211edb2dec245c7339f8cbef639005d7e99173065db4343fe9311ce6843f99f3` |

The retrieved edition already contains `JSON.rawJSON` (25.5.3), `JSON.isRawJSON` (25.5.1),
`ParseJSON` (25.5.2.1), the JSON Parse Record (25.5.2.2) and the source-text-aware
`InternalizeJSONProperty` (25.5.2.4) — the *json-parse-with-source* proposal is merged, so
this is one pinned source rather than a base text plus a proposal diff.

## Clauses covered

    25.5.1    JSON.isRawJSON ( obj )
    25.5.2    JSON.parse ( text [ , reviver ] )
    25.5.2.1  ParseJSON ( text )
    25.5.2.2  JSON Parse Record
    25.5.2.3  CreateJSONParseRecord ( parseNode, key, value )
    25.5.2.4  InternalizeJSONProperty ( holder, name, reviver, parseRecord )
    25.5.2.5  ShallowestContainedJSONValue ( root )
    25.5.2.6  JSONArrayLiteralContentNodes
    25.5.3    JSON.rawJSON ( text )
    25.5.4    JSON.stringify ( value [ , replacer [ , space ] ] )
    25.5.4.1  JSON Serialization Record
    25.5.4.2  SerializeJSONProperty ( state, key, holder )
    25.5.4.3  QuoteJSONString ( value )
    25.5.4.4  UnicodeEscape ( codeUnit )
    25.5.4.5  SerializeJSONObject ( state, value )
    25.5.4.6  SerializeJSONArray ( state, value )
    25.5.5    JSON [ %Symbol.toStringTag% ]

## To refresh

    curl -sSL -o structured-data.html https://tc39.es/ecma262/multipage/structured-data.html
    # then extract from the offset of `id=sec-json-object` to end of file, stripping tags

Record the new source hash here in the same commit. A refresh that changes the text and not
the table above is the case worth looking at twice.
