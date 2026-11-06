/**
 * near-api-js calls RPCs with no time limit, so a connection that drops mid-request waits forever and
 * the failover never moves on. Both the server and the web app wrap `fetch` with this.
 */

/** A fetch that gives up after `ms` unless the caller set its own limit; with `only`, just for those addresses. */
export function timedFetch(inner: typeof fetch, ms: number, only?: (url: string) => boolean): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (init?.signal || (only && !only(url))) return inner(input, init);
    return inner(input, { ...init, signal: AbortSignal.timeout(ms) });
  }) as typeof fetch;
}
