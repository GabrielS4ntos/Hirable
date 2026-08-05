import * as React from "react";

type State<T> = { data: T | null; error: string | null; loading: boolean };

/**
 * Fetches once and then re-fetches on an interval, pausing while the tab is
 * hidden so the local agent is not polled needlessly.
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs = 5000, deps: React.DependencyList = []) {
  const [state, setState] = React.useState<State<T>>({ data: null, error: null, loading: true });
  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = React.useCallback(async () => {
    try {
      const data = await fetcherRef.current();
      setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      setState((current) => ({ ...current, error: (error as Error).message, loading: false }));
      return null;
    }
  }, []);

  React.useEffect(() => {
    setState((current) => ({ ...current, loading: true }));
    void refresh();
    if (!intervalMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, refresh, ...deps]);

  return { ...state, refresh, setData: (data: T) => setState({ data, error: null, loading: false }) };
}
