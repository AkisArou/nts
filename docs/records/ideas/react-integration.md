My question:
/btw just as a sidebar question! If you are aware, we "rebuilt" react in typescript in our repo. it builds in native code with our compiler. This work super nice for android ios windows
macos gtk. But, could we do something smarter for chromium? I mean, ofcourse we could run it as native code like macos for example, but I am talking about some greater chromium
integration, something like as if react was builtin to chromium. I was thinking this, because we compile and control chromium as a target "platform".

Response:
Yes, and controlling Chromium gives us options no other platform does. I'd separate what's worth doing from what only sounds integrated. This comes from what I know of the lane, not new measurements; I haven't looked at the React lane's code from here.

**Baseline: React as just another host.** A react-dom-style host config over the generated DOM bindings, like the host configs on the other platforms. That's already close to "built in": our DOM calls inside one entry cost about what Blink's own C++ does (0.9 to 1.0× in loops, about half of V8's time). So "make the calls cheaper" has little left to give. The wins have to come from structure.

**Integrations worth exploring, roughly by expected payoff:**

1. **The commit phase as one native batch.** React's commit is a list of mutations. Instead of one call per mutation, it could write them into a compact buffer that the adapter applies in a tight C++ loop inside one entry. That removes per-call overhead (each entry is about 15 to 20 ns) and keeps every mutation inside Blink's own batched invalidation.
2. **The scheduler mapped onto Blink's scheduler.** Normally React fakes scheduling with MessageChannel and setTimeout. Natively it can post straight to Blink's task queues with real priorities: input, frame-aligned and idle work, and yield decisions from Blink's own state. Native timers, frames and idle tasks are already there.
3. **Compiler-driven templates.** The React Compiler, which the React lane already has in Rust, knows which parts of a component never change. Those can become pre-built templates that are cloned, which our rows work showed is very fast, instead of being built node by node.
4. **Events through Blink's dispatch.** React's synthetic events re-walk the tree for delegation. Natively, React's propagation could follow the event path Blink has already computed, with listeners as native closures as now.
5. **Rendering off the main thread.** This one is unique to native compilation. React's render phase is pure computation, so it could run in a separate program environment on a worker thread, with only the commit applied on the main thread, which the DOM requires. Page-script React can't do this because of its single JS realm. It's the most ambitious item: it needs thread-safe hand-off of the render result, and it depends on how the runtime's environments work across threads.

**What I'd avoid:**

- **Bypassing the DOM.** Rendering straight to layout objects would lose CSS, accessibility, DevTools and every web API built on the DOM, for a speedup that measurements would have to justify.
- **Patching Blink.** We can, since we compile Chromium, but the lane has deliberately stayed patch-free: an unmodified source tree plus a derived embedder. That keeps Chromium upgrades cheap. Only cross that line for a measured, large win.

**How I'd start:** get the plain host config running on the generated bindings, as a TodoMVC/rows-style React app. Measure it against React running as page script in V8. Then let the profile decide which of items 1 to 5 pays first. My guess is the commit batch and Blink's scheduler, but that's to be measured, not assumed. It also pairs naturally with the lib.dom work: React's DOM layer is ordinary DOM TypeScript, so once delegation lands, much of it could compile as written.

If you want this pursued, it's worth raising in the main conversation, since it touches both this lane and the React lane.

---

It of course should be investigated deeper.
Also investigate something similar for other platforms too!!!
