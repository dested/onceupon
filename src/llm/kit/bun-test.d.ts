/**
 * The slice of `bun:test` the kit's tests use. The root tsconfig carries no Bun types (and adding
 * the package is out of scope), so this one typed boundary stands in for them.
 */
declare module 'bun:test' {
  interface Matchers {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
  }
  export function describe(name: string, fn: () => void): void
  export function test(name: string, fn: () => void | Promise<void>): void
  export function expect(actual: unknown): Matchers & { not: Matchers }
}
