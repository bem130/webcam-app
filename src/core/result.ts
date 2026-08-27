export type Option<T> = Readonly<{ tag: "some"; value: T }> | Readonly<{ tag: "none" }>;

export type Result<T, E> = Readonly<{ tag: "ok"; value: T }> | Readonly<{ tag: "err"; error: E }>;

export const none: Option<never> = { tag: "none" };
export const some = <T>(value: T): Option<T> => ({ tag: "some", value });
export const ok = <T>(value: T): Result<T, never> => ({ tag: "ok", value });
export const err = <E>(error: E): Result<never, E> => ({ tag: "err", error });

export function assertNever(value: never): never {
  throw new Error(`Unexpected domain value: ${String(value)}`);
}
