import { reduce } from "./connections";
import { Callback } from "./connections";

export type NamedAction<N, T = void> = T extends void
  ? [name: N]
  : [name: N, data: T];
type SomeAction = NamedAction<string, unknown> | NamedAction<string>;

export type NamedState<N, T = void> = T extends void
  ? [name: N]
  : [name: N, data: T];
type SomeState = NamedState<string, unknown> | NamedState<string>;

type StateByName<S extends SomeState, N extends S[0]> = S extends NamedState<
  N,
  unknown
>
  ? S
  : never;

type ActionByName<A extends SomeAction, N extends A[0]> = A extends NamedAction<
  N,
  unknown
>
  ? A
  : never;

type StatesHandler<S extends SomeState> = {
  [SK in S[0]]?: (state: StateByName<S, SK>[1]) => void;
};

export const newStateHandler = <S extends SomeState>(
  handlers: StatesHandler<S>
) => ([key, data]: S): void => handlers[key as S[0]]?.(data);

export const handleState = <S extends SomeState>(
  [key, data]: S,
  handlers: StatesHandler<S>
): void => handlers[key as S[0]]?.(data);

export const newStateMapper = <S extends SomeState, T>(
  mappers: {
    [SK in S[0]]: (state: StateByName<S, SK>[1]) => T;
  }
) => ([key, data]: S): T => mappers[key as S[0]](data);

export const newStateOptionalMapper = <S extends SomeState, T>(
  mappers: {
    [SK in S[0]]?: (state: StateByName<S, SK>[1]) => T;
  }
) => ([key, data]: S): T | undefined => mappers[key as S[0]]?.(data);

export const mapState = <S extends SomeState, T>(
  [key, data]: S,
  mappers: {
    [SK in S[0]]: (state: StateByName<S, SK>[1]) => T;
  }
): T => mappers[key as S[0]](data);

type Behaviours<S extends SomeState, A extends SomeAction> = {
  [SK in S[0]]: {
    [AK in A[0]]?: (
      action: ActionByName<A, AK>[1],
      state: StateByName<S, SK>[1]
    ) => S;
  };
};
type DefaultHandlers<S extends SomeState, A extends SomeAction> = {
  [AK in A[0]]?: (action: ActionByName<A, AK>[1]) => S;
};

const newStateMachineHandler = <S extends SomeState, A extends SomeAction>(
  behaviours: Behaviours<S, A>,
  defaults?: DefaultHandlers<S, A>
) => (state: S, action: A): S => {
  const behaviour = behaviours[state[0] as S[0]];
  const handler = behaviour[action[0] as A[0]];
  if (handler)
    return handler(
      action[1] as ActionByName<A, A[0]>[1],
      state[1] as StateByName<S, S[0]>[1]
    );

  if (defaults) {
    const defaultHandler = defaults[action[0] as A[0]];
    if (defaultHandler) {
      return defaultHandler(action[1] as ActionByName<A, A[0]>[1]);
    }
  }

  throw new Error(
    `Synchronizer in sate '${state[0]}' do not expected command '${action[0]}'`
  );
};

export const newStateMachine = <S extends SomeState, A extends SomeAction>(
  initState: S,
  behaviours: Behaviours<S, A>,
  callback: Callback<S>,
  defaults?: DefaultHandlers<S, A>
): Callback<A> =>
  reduce(initState, newStateMachineHandler(behaviours, defaults), callback);

export const filterState = <S extends SomeState, K extends S[0]>(
  stateName: K,
  callback: Callback<StateByName<S, K>[1]>
): Callback<S> => (state: S) => {
  if (state[0] === stateName) {
    callback(state[1]);
  }
};
