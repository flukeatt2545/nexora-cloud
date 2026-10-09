"use client";

import ErrorScreen from "./components/errors/ErrorScreen";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen status={500} reset={reset} />;
}
