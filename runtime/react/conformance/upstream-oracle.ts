import {
  Component,
  Suspense,
  __COMPILER_RUNTIME,
  createContext,
  createElement,
  createRef,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useState,
} from '../generated/client-mutation-production-linked/packages/react/index.ts';
import {
  createContainer,
  flushPassiveEffects,
  flushSyncFromReconciler,
  updateContainerSync,
} from '../generated/client-mutation-production-linked/packages/react-reconciler/src/ReactFiberReconciler.ts';
import {getRecordingHost} from '../host-test/ReactFiberConfigMutationOracle.ts';
import type {HostNode} from '../host-test/recording-host.ts';
import {Counter as CompiledCounter} from '../generated/compiler-output/Counter.checked.tsx';

interface Tree {
  kind: string;
  type: string;
  props: string[];
  text: string;
  hidden: boolean;
  children: Tree[];
}

interface RootHandle {
  container: HostNode;
  root: ReturnType<typeof createContainer>;
  errors: string[];
}

interface Scenario {
  name: string;
  tree: Tree;
  operations: string[];
  observations: string[];
}

const host = getRecordingHost();
host.reset();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeRoot(): RootHandle {
  const errors: string[] = [];
  const capture = (error: unknown): void => {
    errors.push(errorText(error));
  };
  const container = host.createContainer();
  const root = createContainer(
    container,
    1,
    null,
    false,
    null,
    '',
    capture,
    capture,
    capture,
    () => {},
    null,
  );
  return {container, root, errors};
}

function render(handle: RootHandle, element: unknown): void {
  flushSyncFromReconciler(() => {
    updateContainerSync(element, handle.root);
  });
  while (flushPassiveEffects()) {}
  if (handle.errors.length > 0) {
    throw new Error(`React captured errors: ${handle.errors.join('; ')}`);
  }
}

function tree(node: HostNode): Tree {
  return {
    kind: node.kind,
    type: node.type,
    props: node.props.map(prop => `${prop.name}=${String(prop.value)}`),
    text: node.text,
    hidden: node.hidden,
    children: node.children.map(tree),
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function operationsFrom(start: number): string[] {
  return host.mutations.slice(start).map(mutation => mutation.operation);
}

function runFunctionMount(): Scenario {
  const handle = makeRoot();
  const start = host.mutations.length;
  function Greeting(props: {label: string}) {
    return createElement('label', {label: props.label}, `Hello ${props.label}`);
  }
  render(handle, createElement(Greeting, {label: 'NTS'}));
  const mounted = tree(handle.container);
  assert(mounted.children[0]?.props[0] === 'label=NTS', 'function props were lost');
  assert(mounted.children[0]?.children[0]?.text === 'Hello NTS', 'text mount failed');
  render(handle, null);
  assert(handle.container.children.length === 0, 'function tree did not unmount');
  return {
    name: 'function-mount-unmount',
    tree: mounted,
    operations: operationsFrom(start),
    observations: ['function rendered', 'text mounted', 'root unmounted'],
  };
}

function runKeyedReconciliation(): Scenario {
  const handle = makeRoot();
  function Rows(props: {ids: readonly string[]}) {
    return createElement(
      'list',
      null,
      ...props.ids.map(id => createElement('row', {id, key: id})),
    );
  }
  render(handle, createElement(Rows, {ids: ['a', 'b', 'c']}));
  const start = host.mutations.length;
  render(handle, createElement(Rows, {ids: ['c', 'a', 'd']}));
  const updated = tree(handle.container);
  const rows = updated.children[0]?.children.map(child => child.props[0]);
  assert(rows?.join(',') === 'id=c,id=a,id=d', 'keyed order is incorrect');
  const operations = operationsFrom(start);
  assert(operations.includes('remove'), 'keyed deletion was not recorded');
  assert(
    operations.includes('insert') || operations.includes('append'),
    'keyed insertion was not recorded',
  );
  render(handle, null);
  return {
    name: 'keyed-reconciliation',
    tree: updated,
    operations,
    observations: ['reused c and a', 'deleted b', 'inserted d'],
  };
}

const ValueContext = createContext('default');
let setHookState: ((value: number) => void) | null = null;
let dispatchHookState: ((delta: number) => void) | null = null;

function HookLeaf() {
  const context = useContext(ValueContext);
  const [state, setState] = useState(1);
  const [reduced, dispatch] = useReducer(
    (value: number, delta: number) => value + delta,
    10,
  );
  setHookState = setState;
  dispatchHookState = dispatch;
  return createElement('output', {value: `${context}:${state}:${reduced}`});
}

function runHooksAndContext(): Scenario {
  const handle = makeRoot();
  const start = host.mutations.length;
  render(
    handle,
    createElement(ValueContext, {value: 'first'}, createElement(HookLeaf, null)),
  );
  assert(setHookState !== null && dispatchHookState !== null, 'hook dispatchers missing');
  flushSyncFromReconciler(() => {
    setHookState?.(4);
    dispatchHookState?.(7);
  });
  while (flushPassiveEffects()) {}
  render(
    handle,
    createElement(ValueContext, {value: 'second'}, createElement(HookLeaf, null)),
  );
  const updated = tree(handle.container);
  assert(
    updated.children[0]?.props[0] === 'value=second:4:17',
    'state, reducer or context update failed',
  );
  render(handle, null);
  return {
    name: 'hooks-state-reducer-context',
    tree: updated,
    operations: operationsFrom(start),
    observations: ['state=4', 'reducer=17', 'context=second'],
  };
}

function runEffectsAndHostRef(): Scenario {
  const handle = makeRoot();
  const effects: string[] = [];
  const ref = createRef();
  function Effects(props: {step: number}) {
    useLayoutEffect(() => {
      effects.push(`layout:${props.step}`);
      return () => effects.push(`layout-clean:${props.step}`);
    }, [props.step]);
    useEffect(() => {
      effects.push(`passive:${props.step}`);
      return () => effects.push(`passive-clean:${props.step}`);
    }, [props.step]);
    return createElement('leaf', {ref, value: props.step});
  }
  const start = host.mutations.length;
  render(handle, createElement(Effects, {step: 1}));
  assert(ref.current !== null, 'host ref was not attached');
  render(handle, createElement(Effects, {step: 2}));
  const updated = tree(handle.container);
  render(handle, null);
  assert(ref.current === null, 'host ref was not detached');
  const expected = [
    'layout:1',
    'passive:1',
    'layout-clean:1',
    'layout:2',
    'passive-clean:1',
    'passive:2',
    'layout-clean:2',
    'passive-clean:2',
  ];
  assert(effects.join('|') === expected.join('|'), 'effect ordering or cleanup changed');
  return {
    name: 'effects-cleanup-host-ref',
    tree: updated,
    operations: operationsFrom(start),
    observations: effects,
  };
}

function runClassComponent(): Scenario {
  const handle = makeRoot();
  const lifecycle: string[] = [];
  class ClassLeaf extends Component {
    state = {value: 1};

    componentDidMount(): void {
      lifecycle.push('mount');
    }

    componentDidUpdate(): void {
      lifecycle.push('update');
    }

    componentWillUnmount(): void {
      lifecycle.push('unmount');
    }

    render() {
      return createElement('class-leaf', {value: this.state.value});
    }
  }
  const ref = createRef();
  const start = host.mutations.length;
  render(handle, createElement(ClassLeaf, {ref}));
  assert(ref.current !== null, 'class ref was not attached');
  flushSyncFromReconciler(() => {
    ref.current.setState({value: 5});
  });
  while (flushPassiveEffects()) {}
  const updated = tree(handle.container);
  assert(updated.children[0]?.props[0] === 'value=5', 'class setState failed');
  render(handle, null);
  assert(ref.current === null, 'class ref was not detached');
  assert(lifecycle.join('|') === 'mount|update|unmount', 'class lifecycle changed');
  return {
    name: 'class-state-lifecycle-ref',
    tree: updated,
    operations: operationsFrom(start),
    observations: lifecycle,
  };
}

function runSuspenseFallback(): Scenario {
  const handle = makeRoot();
  const pending = new Promise<void>(() => {});
  function Suspend(): never {
    throw pending;
  }
  const start = host.mutations.length;
  render(
    handle,
    createElement(
      Suspense,
      {fallback: createElement('fallback', {label: 'waiting'})},
      createElement(Suspend, null),
    ),
  );
  const fallback = tree(handle.container);
  assert(fallback.children[0]?.type === 'fallback', 'Suspense fallback did not mount');
  render(handle, null);
  return {
    name: 'suspense-fallback',
    tree: fallback,
    operations: operationsFrom(start),
    observations: ['pending thenable selected fallback'],
  };
}

let setCacheTick: ((value: number) => void) | null = null;

function runCompilerCacheOwnership(): Scenario {
  const handle = makeRoot();
  const identities: object[] = [];
  let computations = 0;
  function Cached(props: {value: number}) {
    const cache = __COMPILER_RUNTIME.c(2);
    const [tick, setTick] = useState(0);
    setCacheTick = setTick;
    let computed;
    if (cache[0] !== props.value) {
      computations++;
      computed = {value: props.value * 2};
      cache[0] = props.value;
      cache[1] = computed;
    } else {
      computed = cache[1];
    }
    identities.push(computed);
    return createElement('cache-output', {value: `${computed.value}:${tick}`});
  }
  const start = host.mutations.length;
  render(handle, createElement(Cached, {value: 3}));
  const first = identities[identities.length - 1];
  assert(setCacheTick !== null, 'cache scenario state dispatcher missing');
  flushSyncFromReconciler(() => setCacheTick?.(1));
  while (flushPassiveEffects()) {}
  const second = identities[identities.length - 1];
  assert(first === second && computations === 1, 'memo cache missed on unrelated update');
  render(handle, createElement(Cached, {value: 4}));
  const third = identities[identities.length - 1];
  assert(second !== third && computations === 2, 'memo cache did not invalidate');
  const updated = tree(handle.container);
  assert(updated.children[0]?.props[0] === 'value=8:1', 'memo cache output is wrong');
  render(handle, null);
  return {
    name: 'compiler-cache-ownership',
    tree: updated,
    operations: operationsFrom(start),
    observations: [
      'same cache object across committed update',
      'unrelated state update hit cache',
      'prop change invalidated cache',
      `computations=${computations}`,
    ],
  };
}

function runCompiledComponent(): Scenario {
  const handle = makeRoot();
  const start = host.mutations.length;
  render(handle, createElement(CompiledCounter, {count: 2, label: 'compiled'}));
  render(handle, createElement(CompiledCounter, {count: 2, label: 'compiled'}));
  render(handle, createElement(CompiledCounter, {count: 3, label: 'compiled'}));
  const updated = tree(handle.container);
  assert(
    updated.children[0]?.children.map(child => child.text).join('') === 'compiled:6',
    'React Compiler output produced the wrong tree',
  );
  render(handle, null);
  return {
    name: 'react-compiler-output',
    tree: updated,
    operations: operationsFrom(start),
    observations: [
      'typed recovered _c(6) output executed',
      'same props hit compiler cache',
      'changed prop invalidated compiler cache',
    ],
  };
}

const scenarios = [
  runFunctionMount(),
  runKeyedReconciliation(),
  runHooksAndContext(),
  runEffectsAndHostRef(),
  runClassComponent(),
  runSuspenseFallback(),
  runCompilerCacheOwnership(),
  runCompiledComponent(),
];

console.log(JSON.stringify({scenarios}));
