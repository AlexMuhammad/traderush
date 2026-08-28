import { useEffect, useState } from 'react';

/** A path router in thirty lines. Duel links are real paths (§5.3), so no hash
 *  routing — the hash is free to mean what it means everywhere else, an anchor
 *  within the page. */
export function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (to: string) => {
    const [target = '/', anchor] = to.split('#');
    const samePath = target === window.location.pathname;
    if (!samePath || anchor) window.history.pushState({}, '', to);
    if (!samePath) setPath(target);
    // Wait a frame so the destination screen has mounted before we look for it.
    if (anchor) {
      requestAnimationFrame(() => {
        document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  return [path, navigate];
}
