# native-inet

An IPv6 address, which is the reason `Anonymous<T>` exists.

    struct in6_addr {
      union { uint8_t __u6_addr8[16]; uint16_t __u6_addr16[8];
              uint32_t __u6_addr32[4]; } __in6_u;
    };

The member is named and **its type is not**. C has no spelling for an
anonymous record: no variable can be declared to point at one, and `_Generic`
cannot ask about one. A tag invented here would be a second type beside the
header's, and `program.h` includes the header.

So the binding marks it, and the compiler reaches its members by byte offset
from the enclosing record — which is what a C programmer does when they cannot
name a type either:

    v1 = (char *)&v0->__in6_u;
    v4 = (uint8_t *)((char *)v3 + 0);

## Why anonymous records came first

They were not next on any list. A survey of twenty-six POSIX records found
that anonymous unions block **four** of them — `sockaddr_in6`, `in6_addr`,
`rusage`, `tcphdr` — against one each for bit-fields and flexible array
members. That count is the reason this exists and bit-fields still do not.

## What checks it

`native/caller.c` parses the same address itself and compares all sixteen
bytes and all four words:

    in6_addr: size=16 align=4
    byteAt: 16 of 16 agree, first=32 last=68
    wordAt: 4 of 4 agree

The address is `2001:db8:1234:5678:9abc:def0:1122:3344` and **not `::1`**,
which is fifteen zero bytes and a one — an address where almost any wrong
offset still reads zero and agrees.

`wordAt` is the second arm and reads the *other* member of the same union: the
same storage, four bytes at a time. A binding describing only the first member
passes every byte check and fails here.

Three changes to the binding, each refused differently:

| change | what refuses it |
|---|---|
| the union missing the member used | `TS2551`, before the compiler |
| `Anonymous` dropped, a tag invented | 11 errors in `program.c`, 10 in the witness |
| `inet_pton`'s `dst` as `Ptr<In6Addr>` | `conflicting types for 'inet_pton'` |

The third was not a deliberate control. This binding's first version declared
`dst` as `Ptr<In6Addr>`, which is what the function is *used* for and not what
`<arpa/inet.h>` declares — it takes `void *`. It typechecked, it lowered, and
the witness refused it. That is the entire reason the prototype is re-declared
beside the real one.

## Build

    sh examples/interop/native-inet/build.sh
