import { useEffect, useState } from 'react';

/**
 * Accessibility (issue #63): subscribe to the user's `prefers-reduced-motion`
 * setting. The global CSS rule in index.css already neutralises keyframe and
 * transition animation, but the simulation loops are driven by
 * requestAnimationFrame in JS — CSS cannot stop those. Components use this
 * hook to swap streaming playback for instant final-state updates, so
 * motion-sensitive users get the same numbers with none of the motion.
 */
export default function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
