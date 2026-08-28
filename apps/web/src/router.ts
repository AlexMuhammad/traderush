import { useEffect, useState } from 'react';

/** A path router in thirty lines. Duel links are real paths (§5.3), so no hash
 *  routing — the hash is free to mean what it means everywhere else, an anchor
 *  within the page.
 *
 *  `usePath` is called from more than one place (the shell, and the routes it
 *  renders), so navigation must reach every instance. pushState deliberately
 *  does NOT fire popstate, so `navigate` dispatches one itself and every hook
 *  updates from the same listener. Without that, a link in one subtree moves
 *  the URL while another subtree keeps rendering the old path.
 */
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
    if (!samePath) window.dispatchEvent(new PopStateEvent('popstate'));
    // Wait a frame so the destination screen has mounted before we look for it.
    if (anchor) {
      requestAnimationFrame(() => {
        document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  return [path, navigate];
}
