"use client";
import { useEffect, useState } from "react";
import type { Appearance } from "@merkat/contracts";
import { Bell } from "lucide-react";
import { Button } from "../ui/primitives";
import { directRequest } from "../../lib/direct-client";
export function NotificationPreferences({
  settings,
  saving,
  update,
}: {
  settings: Appearance;
  saving: boolean;
  update: (patch: Partial<Appearance>) => Promise<void>;
}) {
  const [registered, setRegistered] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .getRegistration()
      .then(async (reg) => {
        const subscription = await reg?.pushManager.getSubscription();
        if (subscription) {
          const r = await directRequest<{ registered: boolean }>(
            "push/status",
            { endpoint: subscription.endpoint },
          );
          setRegistered(r.registered);
        }
      })
      .catch(() => {});
  }, []);
  async function enable() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      )
        throw new Error(
          "This browser doesn't support device notifications. Your in-app reminders are still available.",
        );
      const config = await directRequest<{
        available: boolean;
        publicKey: string | null;
      }>("push/config", {});
      if (!config.available || !config.publicKey)
        throw new Error(
          "Device notifications are unavailable right now. In-app reminders are still available.",
        );
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error(
          "Permission wasn't granted. Your reminders will remain in Notifications.",
        );
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;
      const binary = atob(
          config.publicKey.replace(/-/g, "+").replace(/_/g, "/"),
        ),
        key = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        }));
      const json = subscription.toJSON();
      await directRequest("push/subscribe", {
        endpoint: json.endpoint,
        keys: json.keys,
      });
      await update({ pushEnabled: true });
      setRegistered(true);
      setMessage(
        "This device is subscribed. Reminders are also saved in Notifications.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Couldn't enable notifications.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration(),
        subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await directRequest("push/remove", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setRegistered(false);
      setMessage(
        "Notifications turned off on this device. In-app reminders remain available.",
      );
    } catch {
      setMessage("Couldn't turn off device notifications. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section">
      <div>
        <p className="eyebrow">DON’T MISS THE GOOD STUFF</p>
        <h2>Reminders & notifications</h2>
      </div>
      <label className="preference-row">
        <span>
          <strong>Plan reminders</strong>
          <small>24 hours and 5 hours before plans on your calendar.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.remindersEnabled}
          disabled={saving || busy}
          onChange={(e) => void update({ remindersEnabled: e.target.checked })}
        />
      </label>
      <Button
        disabled={busy || saving}
        onClick={() => void (registered ? disable() : enable())}
      >
        <Bell size={16} />
        {busy
          ? "Updating…"
          : registered
            ? "Disable on this device"
            : "Enable on this device"}
      </Button>
      <p className="supporting-copy">
        A browser permission prompt appears only when you choose to enable
        device notifications.
      </p>
      <p role="status" className="settings-feedback">
        {message}
      </p>
    </section>
  );
}
