"use client";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { RealtimeCapability, RealtimeConnection } from "@merkat/contracts";
import { directRequest, DirectRequestError } from "../../lib/direct-client";

export function useDirectRealtime(
  onChange: () => void,
  onUnauthorized: (error: unknown) => void,
  attempt: number,
) {
  const [state, setState] = useState<
    "connecting" | "live" | "reconnecting" | "unavailable"
  >("connecting");
  useEffect(() => {
    let disposed = false;
    let capability: RealtimeCapability | undefined;
    let client: ReturnType<typeof createClient> | undefined;
    let refreshing: Promise<RealtimeCapability> | undefined;
    async function load() {
      if (capability && capability.expiresAt * 1000 > Date.now() + 30000)
        return capability;
      refreshing ??= directRequest<RealtimeConnection>("direct/realtime", {})
        .then((result) => {
          if ("available" in result)
            throw new DirectRequestError("REALTIME_UNAVAILABLE");
          return result;
        })
        .finally(() => {
          refreshing = undefined;
        });
      capability = await refreshing;
      return capability;
    }
    function failed(error: unknown) {
      if (disposed) return;
      client?.realtime.disconnect();
      setState("unavailable");
      onUnauthorized(error);
    }
    async function connect() {
      try {
        const initial = await load();
        if (disposed) return;
        client = createClient(initial.url, initial.publishableKey, {
          accessToken: async () => {
            try {
              return (await load()).token;
            } catch (error) {
              failed(error);
              throw new Error("Realtime authorization unavailable");
            }
          },
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });
        await client.realtime.setAuth(initial.token);
        if (disposed) {
          client.realtime.disconnect();
          return;
        }
        client
          .channel(initial.topic, {
            config: { private: true, broadcast: { self: false } },
          })
          .on("broadcast", { event: "changed" }, () => {
            if (!disposed) {
              onChange();
              window.dispatchEvent(new Event("merkat:reconcile"));
            }
          })
          .subscribe((status) => {
            if (disposed) return;
            if (status === "SUBSCRIBED") {
              setState("live");
              onChange();
              window.dispatchEvent(new Event("merkat:reconcile"));
            } else if (
              status === "CHANNEL_ERROR" ||
              status === "TIMED_OUT" ||
              status === "CLOSED"
            )
              setState("reconnecting");
          });
      } catch (error) {
        failed(error);
      }
    }
    async function wake() {
      if (document.visibilityState !== "visible" || disposed) return;
      try {
        const fresh = await load();
        if (!disposed && client) await client.realtime.setAuth(fresh.token);
      } catch (error) {
        failed(error);
      }
    }
    void connect();
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      disposed = true;
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      client?.realtime.disconnect();
    };
  }, [onChange, onUnauthorized, attempt]);
  return state;
}
