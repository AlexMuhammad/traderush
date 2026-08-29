/**
 * A promise that gives up.
 *
 * The indexer client has no timeout of its own: a call that never answers leaves
 * a screen on its loading lamps forever, which reads as a broken app and is
 * indistinguishable from a slow one. A stated failure is worth more than an
 * honest wait nobody can interpret.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} did not answer in ${Math.round(ms / 1000)}s`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e as Error); },
    );
  });
}
