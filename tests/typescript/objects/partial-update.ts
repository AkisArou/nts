/*---
description: An update typed Partial<T> carries only the properties it sets, and merging it changes only those.
features: [ts-objects, ts-utility-types, ts-spread]
---*/
type Task = { title: string; done: boolean; priority: number };
function update(task: Task, changes: Partial<Task>): Task {
  return { ...task, ...changes };
}
const task: Task = { title: "write", done: false, priority: 2 };
const finished = update(task, { done: true });
assert.sameValue(finished.done, true);
assert.sameValue(finished.title, "write");
assert.sameValue(task.done, false);
assert.sameValue(Object.keys({ done: true } satisfies Partial<Task>).length, 1);
