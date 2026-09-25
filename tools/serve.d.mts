/**
 * What `serve.mjs` hands back, for the gates written in TypeScript.
 *
 * `stop`, not `close`. Two measurement scripts at tick 166 called
 * `server.close?.()`, which is undefined, so the optional call swallowed it and
 * both left a `vite preview` running and hung at exit waiting for their own
 * child. A declaration is cheaper than finding that twice.
 */
export declare function serve(options?: { timeoutMs?: number }): Promise<{
  url: string
  port: number
  stop: () => void
}>

export declare function useShared(url: string): Promise<{
  url: string
  port: string
  stop: () => void
}>
