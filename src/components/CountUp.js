import React, { useEffect, useState } from "react";
export default function CountUp({ value, duration = 700, suffix = "" }) {
  const target = Number(value) || 0;
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(target); return; }
    let raf, start;
    const tick = (t) => {
      if (!start) start = t;
      const p = Math.min((t - start) / duration, 1);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return <>{n}{suffix}</>;
}
