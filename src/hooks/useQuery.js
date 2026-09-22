import { useCallback, useEffect, useRef, useState } from 'react'

// Minimal async-data hook. `fn` returns a promise; re-runs when any dep changes
// or when refetch() is called.
export function useQuery(fn, deps = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fnRef.current()
      setData(result)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => { run() }, [run])

  return { data, error, loading, refetch: run, setData }
}

export function useAsyncAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // `error` state already drives every page's <ErrorBanner>, so callers don't
  // need to catch a rethrow themselves — and almost none of them do, which
  // used to mean every failed action was ALSO an unhandled promise rejection
  // (most call sites are bare `async function` handlers wired straight to
  // onClick/onChange, with no outer try/catch of their own). Pass
  // { rethrow: true } only when the caller genuinely needs to react to the
  // failure itself (e.g. DocumentBuilderPage/AuditWorkspacePage's generate
  // functions, which clean up an orphaned row on failure).
  const runAction = useCallback(async (fn, { rethrow = false } = {}) => {
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      setError(e)
      if (rethrow) throw e
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, error, runAction, setError }
}
