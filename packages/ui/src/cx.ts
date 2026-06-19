// Minimal classNames joiner — keeps components dependency-free.
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
