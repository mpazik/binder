import {
  BiProcessor,
  Consumer,
  Processor,
  Provider,
  OnCloseRegister,
  Merge,
} from "./types";
import { equal } from "./utils/equal";

export const map = <T, S>(transform: (v: T) => S): Processor<T, S> => (
  push
) => (v: T) => push(transform(v));

export const filter = <T>(predicate: (v: T) => boolean): Processor<T, T> => (
  push
) => (v: T) => {
  if (predicate(v)) push(v);
};

export const flatten = <T>(array: T[]): Processor<T, T> => (push) => (v: T) =>
  array.forEach(push);

export const reducer = <S, C>(
  initState: S,
  reduce: (state: S, change: C) => S
): Processor<C, S> => (push) => {
  let state: S = initState;
  return (change) => {
    const newState = reduce(state, change);
    state = newState;
    push(newState);
  };
};

export const match = <T, S>(map: Map<T, S>): Processor<T, S> => (push) => (
  v: T
) => {
  const newV = map.get(v);
  if (newV) push(newV!);
};

export const fork = <T>(...consumers: Consumer<T>[]): Consumer<T> => (data) => {
  consumers.forEach((push) => push(data));
};

export const multiProvider = <T>(provider: Provider<T>): Provider<T> => {
  const consumers: Consumer<T>[] = [];

  return (consumer) => {
    consumers.push(consumer);
    if (consumers.length === 1) {
      provider((data) => {
        consumers.forEach((push) => push(data));
      });
    }
  };
};

export const forkMapJoin = <T, S>(
  map1: (v: T) => Partial<S>,
  map2: (v: T) => Partial<S>
): Processor<T, S> =>
  map<T, S>((v) => Object.assign({}, map1(v), map2(v)) as S);

export const join = <T>(
  providerA: Provider<T>,
  providerB: Provider<T>
): Provider<T> => (push: Consumer<T>) => {
  providerA(push);
  providerB(push);
};

export const withInitValue = <T>(
  provider: Provider<T>,
  init: T
): Provider<T> => (push: Consumer<T>) => {
  push(init);
  provider(push);
};

export const split = <T>(
  predicate: (v: T) => boolean,
  push1: Consumer<T>,
  push2: Consumer<T>
): Consumer<T> => (data) => {
  predicate(data) ? push1(data) : push2(data);
};

export const merge = <T, S, W>(
  combine: (stateA: T, stateB: S) => W,
  initA?: T,
  initB?: S
): Merge<T, S, W> => (push) => {
  let stateA: T | undefined = initA;
  let stateB: S | undefined = initB;
  const tryPush = () =>
    stateA && stateB ? push(combine(stateA, stateB)) : undefined;
  tryPush();
  return [
    (newStateA) => {
      stateA = newStateA;
      tryPush();
    },
    (newStateB) => {
      stateB = newStateB;
      tryPush();
    },
  ];
};

export const objectMerge = <T, S>(initA?: T, initB?: S): Merge<T, S, T & S> =>
  merge((stateA, stateB) => Object.assign({}, stateA, stateB), initA, initB);

export function combineLatest<T1, T2>(
  init1: T1,
  init2: T2
): Processor<T1 | T2, T1 & T2>;

export function combineLatest<T1, T2, T3>(
  init1: T1,
  init2: T2,
  init3: T3
): Processor<T1 | T2 | T3, T1 & T2 & T3>;

export function combineLatest(
  ...init: Record<string, unknown>[]
): Processor<any, any> {
  return reducer(Object.assign({}, ...init), (state, change) =>
    Object.assign(state, change)
  );
}

export const filterType = <T, S extends T>(
  predicate: (v: T) => v is S
): Processor<T, S> => (push) => (v: T) => {
  if (predicate(v)) push(v);
};

export const filterNonNull = <T>(): Processor<T | undefined | null, T> => (
  push
) => (v: T | undefined | null) => {
  if (v) push(v);
};

export const mapTo = <T>(value: T): Processor<any, T> => (push) => (v: T) =>
  push(value);

export const biMap = <T1, T2, S1, S2>(
  transform1: (v: T1) => S1,
  transform2: (v: T2) => S2
): BiProcessor<T1, T2, S1, S2> => ([push1, push2]) => [
  (val: T1) => {
    push1(transform1(val));
  },
  (val: T2) => {
    push2(transform2(val));
  },
];

export const wrapMerge = <K1 extends keyof any, K2 extends keyof any>(
  key1: K1,
  key2: K2
) => <T1, T2>(initA?: T1, initB?: T2) => (
  push: Consumer<{ [A in K1]: T1 } & { [B in K2]: T2 }>
) =>
  biMap(
    wrap(key1)<T1>(),
    wrap(key2)<T2>()
  )(
    objectMerge<{ [A in K1]: T1 }, { [B in K2]: T2 }>(
      initA !== undefined ? wrap(key1)<T1>()(initA) : undefined,
      initB !== undefined ? wrap(key2)<T2>()(initB) : undefined
    )(push)
  );

export const kicker = <T>(value: T): Provider<T> => (push) => push(value);

export const pipe = <T, S, U>(map1: (v: T) => S, map2: (v: S) => U) => (
  v: T
): U => map2(map1(v));

export const wrap = <K extends keyof any>(key: K) => <V>() => (
  value: V
): { [A in K]: V } => {
  const o = {} as { [A in K]: V };
  o[key] = value;
  return o;
};

export const log = <T>(name: string, push: Consumer<T>): Consumer<T> => (
  value
) => {
  console.log(name, value);
  push(value);
};

export const onAnimationFrame = <T>(
  onClose: OnCloseRegister,
  push: Consumer<T>
): Consumer<T> => {
  let lastValue: T | null = null;
  let frameRequest: null | ReturnType<typeof window.requestAnimationFrame>;

  const scheduleRender = () => {
    if (frameRequest) return;
    frameRequest = window.requestAnimationFrame(() => {
      push(lastValue!);
      frameRequest = null;
    });
  };

  onClose(() => {
    if (frameRequest == null) return;
    window.cancelAnimationFrame(frameRequest);
  });

  return (value) => {
    lastValue = value;
    scheduleRender();
  };
};

export const passOnlyChanged = <T>(push: Consumer<T>): Consumer<T> => {
  let lastValue: T;
  return (value) => {
    if (equal(value, lastValue)) return;
    lastValue = value;
    push(value);
  };
};