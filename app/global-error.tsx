"use client";

import ErrorScreen from "./components/errors/ErrorScreen";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="th"><head><meta name="viewport" content="width=device-width, initial-scale=1" /><title>ระบบมีปัญหา | NEXORA</title></head><body style={{ margin: 0 }}><ErrorScreen status={500} reset={reset} /></body></html>;
}
