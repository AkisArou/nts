# The fields were populated and unreachable

A class crossed the boundary with its constructor and its prototype methods and
**none of its data**. `Object.keys(instance)` was `[]`, every declared field read
`undefined`, and the methods that read those fields answered correctly.

    fs.Stats   ten fields all undefined, eight predicates all right

That combination is why nothing found it. The fields were populated and
unreachable, not unset, so every question anybody thought to ask had the right
answer. It was found by the Node lane asking a question nobody had: what does
`Object.keys` say.

## The cause, which is one line of the emitter

`napi_define_class` is handed a descriptor list built by walking
`program.funcs` for `Class#member`. A field is not a function, so a field is
never in that list. Nothing was wrong; something was absent, and the absence had
no diagnostic because no code path considered it.

`fs.Stats` now matches node on all fourteen fields, read against a real
`statSync` of a real file and compared field by field against node's own `Stats`
for the same inode.

## Right answers, wrong object

Getting the reads right was not enough, and stopping there was tempting because
every field then had node's value.

`napi_define_class` puts its descriptors on the **prototype**. So:

    s.size            correct
    Object.keys(s)    []            node: fourteen names
    JSON.stringify(s) {}            node: fourteen fields
    Object.hasOwn(s, "size")  false node: true

An object that answers every question correctly and is a different kind of
object. The Node lane hit the identical shape an hour earlier from the other
direction -- a probe printing `e.code ?? e.name` reported twelve of twelve
agreeing on an artifact that has no `code` at all, because the `??` fell through
to `name`, which happens to be the code string. Their sentence for it is the one
worth keeping: **a fallback in a comparison is a place where two different things
print the same.** `??`, `||`, a default parameter, a catch-all `_ =>` arm --
each is a join, and a join is where a distinction goes to die. Here the join was
in the *object model* rather than in a probe: prototype lookup is a fallback, and
it made a prototype accessor and an own property print the same.

Defined on the instance as well now, from the constructor. Node's `Stats`
constructor assigns fourteen own fields, so this is the same work in the same
place rather than an extra pass. `Object.keys` matches node's names **and their
order**; `JSON.stringify` round-trips.

## Accessors, and the setter that is deliberately absent

Accessors rather than data properties, because the value lives in this heap and
the JavaScript object only points at it. A data property would be a snapshot
taken at construction that stops tracking whatever a method does to the object it
came from.

The cost is named rather than papered over: there are **no setters**.
`stats.size = 1` is a no-op here and throws in strict mode under node. A setter
is the inbound direction, which for a reference field has no representation at
all -- and publishing setters for the scalar fields and not the reference ones
would make one class writable in some fields and silently not in others, which is
a worse failure than uniformly read-only.

## Two link failures on the way, both about declaring rather than defining

The addon carried `typedef struct NtsObj_Reading NtsObj_Reading;` and no body.
The methods linked because they pass the pointer through without reading it; the
getters dereference it, so they did not. The class emitter wrote that typedef
itself, which is exactly why the gap survived: the name existed everywhere it
was looked for.

Emitting the body then broke `fs` in a second way -- nineteen `unknown type
name 'NtsObj_Blob5395'` -- because a class's fields point at *other* classes'
structs. A pointer field needs the name to exist and never the layout, so the
closure is one step of typedefs and does not recurse.

Both are the same lesson in two sizes. **A forward declaration is enough for
every use that does not read the thing, which is most uses, right up until one
does.**

## Statics are a second wall and are not this one

`class-statics-do-not-cross` still reproduces, and the Node lane was right to
file it separately rather than widening the first fixture.

A static method is `Holder.make` in the HIR -- a dot, not a `#` -- so the class
loop never sees it, and that half is a loop. The half that is not: `Holder.make`
returns a `Holder`, and **a class instance has no outward crossing at all**.
`Buffer.from`, `Buffer.alloc`, `Buffer.concat` and `Buffer.isBuffer` are the same
shape, and `Buffer.from` is the name in 19 of buffer's 54 files that pass
interpreted and fail compiled.

So statics need the addon to hand back a JavaScript wrapper around an instance
the compiled program already allocated, which `napi_define_class` gives no direct
way to do. That is a design step, and saying so is more useful than a partial
implementation that publishes the methods whose signatures happen to avoid it.
