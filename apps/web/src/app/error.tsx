"use client";
import { Button } from "../components/ui/primitives";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="account-page">
      <section className="account-card">
        <h1>Couldn’t connect.</h1>
        <Button onClick={reset}>Try again</Button>
      </section>
    </main>
  );
}
