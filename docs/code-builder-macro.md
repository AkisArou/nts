Discussion with ChatGPT

question: for constructing llvm and C code from rust, instead of plain string concat like we did in typescript scriptc, can we use any elegant rust macro?

answer:Yes. I would **absolutely not go back to giant `String` concatenation emitters**.

For this project, I’d use two slightly different approaches:

- **C:** use a quasi-quote/code-generation library such as `genco`.
- **LLVM:** use our own small typed LLVM IR model + an `llvm! { ... }` macro on top of it.

That gives you readable backend code without sacrificing correctness or source/debug metadata.

## C: `genco` is almost exactly what you want

[`genco`](https://github.com/udoprog/genco) is a whitespace-aware quasiquoter specifically for code generation. It already has built-in C support, interpolation, indentation, string quoting, and lets you add custom languages. ([GitHub][1])

Instead of ScriptC-style:

```ts
out += `static ${returnType} ${name}(`;
out += params.join(", ");
out += `) {\n`;
out += `  return ${expression};\n`;
out += `}\n`;
```

you could have Rust looking approximately like:

```rust
use genco::prelude::*;

fn emit_function(
    name: &str,
    return_type: &str,
    body: c::Tokens,
) -> c::Tokens {
    quote! {
        static $return_type $name(void) {
            $body
        }
    }
}
```

or:

```rust
let body: c::Tokens = quote! {
    $dst = nts_string_concat($runtime, $left, $right);

    if ($dst == NULL) {
        goto $cleanup;
    }
};
```

That's _much_ nicer.

You can compose fragments:

```rust
fn emit_cleanup(values: &[Value]) -> c::Tokens {
    let mut out = c::Tokens::new();

    for value in values {
        quote_in!(out =>
            nts_release($value);
        );
    }

    out
}
```

Then:

```rust
quote! {
    static NtsValue $name(NtsRuntime* runtime) {
        $body

        $cleanup

        return $result;
    }
}
```

So I would likely put:

```text
compiler/codegen/c/
├── ast/
├── quote/
├── types.rs
├── expressions.rs
├── statements.rs
├── functions.rs
├── modules.rs
└── printer.rs
```

with `genco` underneath `quote/`.

---

# But don't make C generation _only_ quasiquotation

This is important.

I would have a small typed C model for dangerous things:

```rust
enum CType {
    Void,
    Bool,
    Int32,
    Int64,
    Double,
    Pointer(Box<CType>),
    Named(Symbol),
}

struct CFunction {
    name: Symbol,
    return_type: CType,
    params: Vec<CParam>,
    body: CBlock,
}
```

And use quasiquotes mostly inside statements/expressions.

Why?

Because you want the compiler to know:

```text
this is a pointer
this is an owned value
this function is static
this declaration precedes its use
this call may throw
```

rather than hiding everything inside text.

So roughly:

```text
MIR
 ↓
typed C AST
 ↓
genco printer
 ↓
.c
```

not:

```text
MIR
 ↓
genco everywhere
 ↓
hope the C compiler catches errors
```

---

# LLVM is different

For LLVM I would be more conservative.

There is `inkwell`, which gives Rust a strongly typed wrapper over LLVM and supports LLVM 11–22 today. Its explicit goal is to mirror LLVM's strong typing and catch mistakes earlier than raw `llvm-sys`. ([GitHub][2])

So you could do:

```rust
let sum = builder
    .build_int_add(lhs, rhs, "sum")?;
```

instead of emitting:

```llvm
%sum = add i64 %lhs, %rhs
```

That is nice.

But it reintroduces something we were explicitly trying to avoid:

> Your compiler becomes linked to LLVM's API and LLVM-version-specific Rust bindings.

`inkwell` is also still pre-1.0 and notes that breaking changes may happen. ([GitHub][2])

So I **wouldn't make Inkwell the canonical backend representation**.

---

# I'd build our own tiny LLVM IR builder

This sounds much bigger than it really is.

You do not need to model every LLVM instruction.

Only model LLVM that Native TypeScript actually emits.

For example:

```rust
pub enum LlvmType {
    Void,
    I1,
    I8,
    I16,
    I32,
    I64,
    F32,
    F64,
    Ptr,
    Struct(Vec<LlvmType>),
    Array(u64, Box<LlvmType>),
}

pub struct ValueId(u32);
pub struct BlockId(u32);

pub enum Instruction {
    Add {
        dst: ValueId,
        ty: LlvmType,
        lhs: Operand,
        rhs: Operand,
    },

    Load {
        dst: ValueId,
        ty: LlvmType,
        ptr: Operand,
        align: u32,
    },

    Store {
        value: Operand,
        ptr: Operand,
        align: u32,
    },

    Call {
        dst: Option<ValueId>,
        signature: FunctionType,
        function: Symbol,
        args: Vec<Operand>,
    },

    Phi { ... },
    Gep { ... },
    Cast { ... },
}
```

Then your backend API becomes:

```rust
let sum = block.add(lhs, rhs);
let result = block.call(runtime_fn, [sum.into()]);
block.ret(result);
```

That is probably the **most maintainable form**.

---

# Then add an `llvm!` macro for ergonomics

This is the fun part.

Make a proc macro or `macro_rules!` layer that constructs your typed IR.

Conceptually:

```rust
llvm! {
    $sum = add i64 $lhs, $rhs;
    $value = call ptr @nts_box_number(ptr $runtime, i64 $sum);
    ret ptr $value;
}
```

But the macro does **not return a String**.

It expands into:

```rust
block.push(Instruction::Add { ... });
block.push(Instruction::Call { ... });
block.push(Terminator::Return { ... });
```

So you get quasiquote readability plus a typed internal representation.

That's the design I'd choose.

---

# An even nicer DSL

You don't necessarily need to imitate LLVM textual syntax exactly.

I might make our macro slightly more Rust-ish:

```rust
llvm! { block =>
    let sum: i64 = add(lhs, rhs);
    let value: ptr = call @nts_box_number(runtime, sum);
    ret value;
}
```

or:

```rust
llvm! {
    in block;

    %sum: i64 = add %lhs, %rhs;
    %boxed: ptr = call @nts_box_number(%runtime, %sum);

    ret %boxed;
}
```

The proc macro can resolve `$foo` interpolations from Rust expressions.

---

# Why our own LLVM model pays off enormously

Because then LLVM output isn't your compiler state.

You have:

```text
NativeTS MIR
      ↓
NativeTS LLVM model
      ↓
      ├── verifier
      ├── textual `.ll` writer
      ├── debug metadata writer
      ├── FileCheck tests
      └── maybe LLVM API encoder someday
```

For example:

```rust
module.verify()?;

let ll = module.to_llvm_ir();

fs::write("output.ll", ll)?;
```

Then:

```bash
clang output.ll -c -o output.o
```

Your compiler does not link against LLVM at all.

That was one of the architectural goals we discussed.

---

# You can make the builder very ergonomic

Something like:

```rust
let mut f = module.function("foo", fn_ty);

let entry = f.block("entry");

let sum = entry.add_i32(a, b);

let positive = entry.icmp(
    IntPredicate::SignedGreaterThan,
    sum,
    entry.const_i32(0),
);

entry.cond_br(positive, then_block, else_block);
```

Then special-purpose helpers:

```rust
entry.runtime_call(RuntimeFn::StringConcat, [lhs, rhs])
```

instead of:

```rust
entry.call(
    module.function("nts_string_concat"),
    ...
)
```

Even better, generate those APIs from your runtime ABI schema:

```rust
runtime.string_concat(runtime, lhs, rhs)
runtime.array_push(runtime, array, value)
runtime.promise_resolve(runtime, promise, value)
```

So your LLVM backend can look almost like compiler pseudocode.

---

# Where a macro helps most

I'd actually use macros for **declarative repetition**, not basic IR manipulation.

For example, runtime intrinsics:

```rust
runtime_functions! {
    StringConcat {
        symbol: "nts_string_concat",
        params: [RuntimePtr, StringRef, StringRef],
        result: StringRef,
        effects: [MayAllocate, MayThrow],
    }

    ArrayPush {
        symbol: "nts_array_push",
        params: [RuntimePtr, ArrayRef, Value],
        result: Void,
        effects: [MayAllocate],
    }
}
```

The macro could generate:

```rust
RuntimeFn::StringConcat
RuntimeFn::ArrayPush

fn string_concat(...)
fn array_push(...)

LLVM declaration
C prototype
ABI verifier
documentation
```

This fits our architecture extremely well.

---

# C could get the same DSL

You could have:

```rust
c! {
    static $ret $name($($params),*) {
        $body
    }
}
```

with interpolation.

`genco` already gives you most of this for C, so I wouldn't write that macro immediately. ([GitHub][1])

But later a NativeTS-specific wrapper could attach provenance:

```rust
c_quote!(origin, {
    if ($value == NULL) {
        goto $cleanup;
    }
});
```

Then generated tokens know:

```text
this C range came from App.ts:42
```

which feeds the debug map we discussed.

---

# Provenance should be integrated into the builder

This is actually another argument against raw strings.

Consider:

```rust
let sum = block
    .at(origin)
    .add(lhs, rhs);
```

or:

```rust
llvm_at!(block, origin => {
    %sum: i64 = add %lhs, %rhs;
});
```

Every instruction automatically gets:

```rust
Instruction {
    origin,
    kind: InstructionKind::Add(...),
}
```

Then LLVM debug metadata comes naturally:

```text
Instruction
   ↓ origin
TypeScript SourceSpan
   ↓
DILocation
```

For C:

```text
C statement
   ↓ origin
generated .c line
   ↓
NTS Debug Map
```

This would have been much harder if the backend were primarily `String`.

---

# `genco` could even be used for LLVM rendering

Interestingly, `genco` supports defining custom output languages. ([GitHub][1])

So you could make:

```rust
pub struct Llvm;
```

and use:

```rust
let tokens: llvm::Tokens = quote! {
    $dst = add $ty $lhs, $rhs
};
```

But I would only use that as the **pretty-printer layer**.

Not as the LLVM model itself.

So:

```text
Instruction::Add
       ↓
LLVM printer
       ↓
genco tokens
       ↓
.ll
```

This gives you nice formatting without making text your IR.

---

# What about the `quote` crate?

The famous Rust `quote!` crate is mainly intended for generating **Rust token streams** for procedural macros, generally paired with `syn`. ([GitHub][3])

It isn't what I'd use for C or LLVM output.

You _could_ create a proc macro that accepts:

```rust
llvm! {
   ...
}
```

using `syn`/`proc_macro2` internally, but the resulting macro should construct our own LLVM structures.

So:

```text
syn / proc_macro2
        ↓
llvm! parser
        ↓
NativeTS LLVM structs
```

rather than trying to use `quote!` as an LLVM renderer.

---

# `llvm-ir` isn't the answer either

There is a nice Rust crate called `llvm-ir` that models LLVM in idiomatic Rust enums and structs.

Unfortunately its own README explicitly says it is currently intended primarily for **consuming/analyzing LLVM IR, not producing it**, and points people toward Inkwell for emission. ([GitHub][4])

It could still be useful inspiration for our type definitions.

I would probably read its design heavily, then create a much smaller emitter-oriented representation suited specifically to NativeTS.

---

# My concrete recommendation

I would build this:

```text
compiler/codegen/
│
├── common/
│   ├── names.rs
│   ├── symbols.rs
│   ├── origin.rs
│   └── layout.rs
│
├── c/
│   ├── ast/
│   │   ├── type.rs
│   │   ├── expr.rs
│   │   ├── stmt.rs
│   │   ├── function.rs
│   │   └── module.rs
│   │
│   ├── builder.rs
│   ├── quote.rs            # genco integration
│   ├── printer.rs
│   ├── debug.rs
│   └── verifier.rs
│
└── llvm/
    ├── ir/
    │   ├── type.rs
    │   ├── value.rs
    │   ├── instruction.rs
    │   ├── block.rs
    │   ├── function.rs
    │   ├── global.rs
    │   ├── metadata.rs
    │   └── module.rs
    │
    ├── builder.rs
    ├── macros/
    │   ├── llvm.rs
    │   └── runtime.rs
    ├── printer/
    │   ├── tokens.rs
    │   └── genco.rs
    ├── debug/
    └── verifier/
```

And backend code should read like:

```rust
fn lower_add(
    cx: &mut FunctionCx,
    lhs: Value,
    rhs: Value,
    origin: Origin,
) -> Value {
    cx.llvm
        .at(origin)
        .add(lhs, rhs)
}
```

for ordinary operations, and macros for bigger templates:

```rust
llvm! { cx, origin =>
    let $ok: i1 = icmp ne $ptr, null;

    cond_br $ok {
        then => $success,
        else => $failure,
    }
}
```

For C:

```rust
c_quote! { cx, origin =>
    if ($ptr == NULL) {
        goto $failure;
    }

    $result = nts_do_something($runtime, $ptr);
}
```

The key principle would be:

> **Macros build typed structures. Printers produce text.**

Not:

> **Macros are prettier string concatenation.**

That one distinction would make your new backend substantially cleaner than the current ScriptC emitter, while also making GC metadata, source mapping, ABI verification, HMR, and future optimizations much easier to implement.

[1]: https://github.com/udoprog/genco?utm_source=chatgpt.com "GitHub - udoprog/genco: A whitespace-aware quasiquoter for beautiful code generation. · GitHub"
[2]: https://github.com/TheDan64/inkwell?utm_source=chatgpt.com "GitHub - TheDan64/inkwell: It's a New Kind of Wrapper for Exposing LLVM (Safely) · GitHub"
[3]: https://github.com/dtolnay/syn?utm_source=chatgpt.com "GitHub - dtolnay/syn: Parser for Rust source code · GitHub"
[4]: https://github.com/cdisselkoen/llvm-ir?utm_source=chatgpt.com "GitHub - cdisselkoen/llvm-ir: LLVM IR in natural Rust data structures · GitHub"
