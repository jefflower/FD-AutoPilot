import { useState, useEffect } from 'react';

/**
 * 监听 CSS media query 变化
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);

    // 初始同步
    setMatches(mql.matches);

    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/**
 * 检测是否为移动端（< 768px）
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)');
}
