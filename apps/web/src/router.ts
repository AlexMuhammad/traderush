import { useEffect, useState } from 'react';

/** A path router in fifteen lines. Duel links are real paths (§5.3), so no hash routing. */
export function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState({}, '', to);
    setPath(to);
  };
  return [path, navigate];
}
