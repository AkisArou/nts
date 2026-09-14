// The library's public interface, and the thing the binding in
// `types/library.d.ts` claims to describe.
//
// Written for the witness. While this library declared its functions only in
// `library.c`, the generated witness re-declared them beside no other
// declaration and agreed with itself -- a check whose answer could not depend
// on whether the binding was right. With a header the two declarations meet in
// one translation unit, and a callback whose C signature the binding gets
// wrong is a compile error instead of a call through a mismatched ABI.
//
// Real C libraries ship one of these, so this is what the example should have
// looked like from the start.
#ifndef NTS_EXAMPLE_LIBRARY_H
#define NTS_EXAMPLE_LIBRARY_H

// Opaque to this library, which only ever hands it back. The program declares
// the same tag with a field, and the witness checks that layout.
struct counter { int total; };

// A registration table: the shape of `struct sigaction`, of every `_ops`
// struct in the kernel headers, and of most C libraries that take more than
// one callback. The caller fills the members in and hands the struct over.
struct handlers {
  int (*on_value)(int);
  int fallback;
};

// Calls `h->on_value(n)` if it is set, and returns `h->fallback` if it is not.
int dispatch(const struct handlers *h, int n);

int apply_twice(int (*f)(int), int x);
int apply_never(int (*f)(int), int x);
void each_upto(void (*f)(struct counter *, int), struct counter *ctx, int upto);
int subscribe(void (*f)(struct counter *, int), struct counter *ctx);
void unsubscribe(int handle);
void deliver(int n);

#endif
