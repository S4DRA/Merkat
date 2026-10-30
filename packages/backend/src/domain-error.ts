// Next server bundles can each load the same class. The shared service cache may
// therefore throw a domain error from another bundle; constructor identity alone
// is not a reliable HTTP boundary. The non-enumerable brand is process-local.
const brand = Symbol.for("merkat.domain-error");
export function brandDomainError(error: Error, kind: string) {
  Object.defineProperty(error, brand, { value: kind });
}
export function hasDomainError(error: unknown, kind: string): error is Error {
  return error instanceof Error && Reflect.get(error, brand) === kind;
}
