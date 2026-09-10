import { useEffect, useState } from 'react';

// Reevaluate elapsed dates while a workstation remains open, without reloading data.
export function useMinuteNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
