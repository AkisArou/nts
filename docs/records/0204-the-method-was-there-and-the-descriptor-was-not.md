# The method was there and the descriptor was not

`NtsStore.close` ended with this:

```java
for (Long handle : new ArrayList<>(WRITES.keySet())) {
    discard(handle);
}
```

62 checks passed on the desktop JVM. On ART it died before printing anything:

    java.lang.NoSuchMethodError: No virtual method
      keySet()Ljava/util/concurrent/ConcurrentHashMap$KeySetView;
      in class Ljava/util/concurrent/ConcurrentHashMap;
      (declaration of 'java.util.concurrent.ConcurrentHashMap'
       appears in /system/framework/core-oj.jar)

**`ConcurrentHashMap.keySet()` exists on Android.** It has existed since the
class did. What Java 8 changed was its *return type* — covariantly, from `Set`
to the new `ConcurrentHashMap.KeySetView` — and Android's `core-oj` kept the
older signature. A method reference in a class file carries the descriptor, so
`javac --release 8` wrote the JDK-8 one into the call site, and resolution on
ART looked for a method that is not there under that name.

## Why nothing in this repository saw it

Every guard we have was pointed at a different question and all of them passed:

- `--release 8` fixes the *language* level and the platform signatures javac
  compiles against. It says nothing about which of those signatures Android
  kept, and it is the thing that *wrote* the bad descriptor.
- `-Xlint:all -Werror` is about the source, and the source is fine.
- `d8 --min-api 26` proves the bytecode is acceptable at the floor. It is.
- The no-`invokedynamic` ratchet and the class-version check are about features
  the platform lacks. This needs no feature.
- `the_library_compiles_against_the_api_level_it_declares` puts `android.jar` on
  the *classpath*, which supplies `android.*`. `java.util.*` still comes from
  the JDK, so the divergence is invisible to it.

And ART resolves lazily, so even `Class.forName(name, true, loader)` over the
corpus — which is what the `unverifiable class` row does — would not have found
it. Only executing that line does.

## Why the obvious fix is not available

Recompile the runtime against Android's bootclasspath and the descriptor is
right for ART — and now wrong for every desktop JVM, where `keySet()` really
does return `KeySetView` and a call site asking for `Set` does not resolve
either. The two platforms disagree, one jar has to run on both, and no compiler
flag reconciles them.

So the only rule that works is to avoid the members where they disagree. That
set is small and known, and now there is a test that reads the shipped jar's
constant pool for it — because a method reference is in the pool whether or not
anything calls it, which is the property that makes the artifact checkable with
no device attached. The fix in the code was `entrySet()`, which has no covariant
override on either platform.

## What I take from it

**The device is not a formality at the end of the lane.** I have written down
twice that `--min-api 26` proves bytecode acceptability rather than member
existence — record 0186 for ALPN, where the API-26 stub over-declares methods
that are absent at run time. This is the same sentence one level further in:
the member is present, and the *shape* of it is what Android does not have. I
would not have predicted that variant, and the only thing that found it was
running the class on the platform it ships to.

The check I added is a list rather than a rule, and it says so. It cannot find
the next one. The device suite can, which is the argument for the store's own
driver being in it rather than only in the desktop suite — and it is the reason
that driver was written to be run twice in a row.
