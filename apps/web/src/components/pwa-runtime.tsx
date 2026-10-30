"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/primitives";

export function PwaRuntime() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [error, setError] = useState("");
  const requested = useRef(false);
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    )
      return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const installed = () => {
      if (
        !disposed &&
        registration?.waiting &&
        navigator.serviceWorker.controller
      )
        setWaiting(registration.waiting);
    };
    const found = () => {
      installing = registration?.installing ?? null;
      installing?.addEventListener("statechange", installed);
    };
    const changed = () => {
      setWaiting(null);
      if (requested.current) window.location.reload();
    };
    const online = () => {
      void registration?.update().catch(() => {});
    };
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((value) => {
        if (disposed) return;
        registration = value;
        installed();
        registration.addEventListener("updatefound", found);
        found();
      })
      .catch(() => {
        if (!disposed)
          setError("Offline support is unavailable. You can continue online.");
      });
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    window.addEventListener("online", online);
    return () => {
      disposed = true;
      registration?.removeEventListener("updatefound", found);
      installing?.removeEventListener("statechange", installed);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      window.removeEventListener("online", online);
    };
  }, []);
  if (!waiting && !error) return null;
  return (
    <div className="pwa-update" role="status">
      <span>{error || "A Merkat update is ready."}</span>
      {waiting && (
        <Button
          onClick={() => {
            const hasDraft =
              !!document.querySelector(
                'dialog[open] form, [data-dirty="true"], [aria-busy="true"]',
              ) ||
              [
                ...document.querySelectorAll<HTMLTextAreaElement>(
                  ".direct-composer textarea",
                ),
              ].some((input) => input.value.trim());
            if (hasDraft) {
              setError("Finish or save your draft before updating.");
              return;
            }
            setError("");
            requested.current = true;
            waiting.postMessage({ type: "MERKAT_ACTIVATE_UPDATE" });
          }}
        >
          Update
        </Button>
      )}
      {error && <Button onClick={() => setError("")}>Dismiss</Button>}
    </div>
  );
}
