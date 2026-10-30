"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  appearanceSchema,
  defaultAppearance,
  type Appearance,
} from "@merkat/contracts";
import { directRequest } from "../lib/direct-client";
import { NotificationPreferences } from "./account/notification-preferences";

const storageKey = "merkat.appearance.v1";
const AppearanceContext = createContext<{
  settings: Appearance;
  saving: boolean;
  message: string;
  update: (patch: Partial<Appearance>) => Promise<void>;
} | null>(null);
function apply(settings: Appearance) {
  const dark =
    settings.theme === "DARK" ||
    (settings.theme === "SYSTEM" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.reduceMotion = String(settings.reduceMotion);
  document.documentElement.dataset.largeText = String(settings.largeText);
  try {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch {
    /* Storage is optional. */
  }
}
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Appearance>(defaultAppearance);
  const [saving, setSaving] = useState(false),
    [message, setMessage] = useState("");
  const pathname = usePathname();
  const loaded = useRef(false),
    current = useRef(settings),
    busy = useRef(false);
  useEffect(() => {
    let value = defaultAppearance;
    try {
      const result = appearanceSchema.safeParse(
        JSON.parse(localStorage.getItem(storageKey) || "null"),
      );
      if (result.success) value = result.data;
    } catch {
      /* Keep defaults. */
    }
    current.current = value;
    apply(value);
    queueMicrotask(() => setSettings(value));
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => apply(current.current);
    media.addEventListener("change", changed);
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      try {
        const result = appearanceSchema.safeParse(JSON.parse(event.newValue));
        if (result.success) {
          current.current = result.data;
          setSettings(result.data);
          apply(result.data);
        }
      } catch {
        /* Ignore invalid stored values. */
      }
    };
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", changed);
      window.removeEventListener("storage", sync);
    };
  }, []);
  useEffect(() => {
    if (["/login", "/register"].includes(pathname)) {
      loaded.current = false;
      return;
    }
    if (loaded.current) return;
    const controller = new AbortController();
    void directRequest<{ settings: Appearance }>(
      "preferences/get",
      {},
      controller.signal,
    )
      .then((result) => {
        const parsed = appearanceSchema.safeParse(result.settings);
        if (!parsed.success) return;
        loaded.current = true;
        current.current = parsed.data;
        setSettings(parsed.data);
        apply(parsed.data);
      })
      .catch(() => {
        /* Cached appearance works when offline or signed out. */
      });
    return () => controller.abort();
  }, [pathname]);
  const update = useCallback(async (patch: Partial<Appearance>) => {
    if (busy.current) return;
    const previous = current.current,
      next = { ...previous, ...patch };
    busy.current = true;
    setSaving(true);
    setMessage("");
    current.current = next;
    setSettings(next);
    apply(next);
    try {
      await directRequest("preferences/update", next);
      setMessage("Preferences saved.");
    } catch {
      current.current = previous;
      setSettings(previous);
      apply(previous);
      setMessage("Couldn't save. Your previous preferences are restored.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, []);
  return (
    <AppearanceContext value={{ settings, saving, message, update }}>
      {children}
    </AppearanceContext>
  );
}
export function AppearanceControls() {
  const context = useContext(AppearanceContext);
  if (!context) return null;
  const { settings, update, saving, message } = context;
  return (
    <>
      <section className="settings-section" aria-labelledby="appearance-title">
        <div>
          <p className="eyebrow">MAKE YOURSELF AT HOME</p>
          <h2 id="appearance-title">Appearance & comfort</h2>
          <p className="supporting-copy">
            A little more you. Across every conversation.
          </p>
        </div>
        <fieldset className="theme-options" disabled={saving}>
          <legend>Colour theme</legend>
          {(
            [
              { value: "LIGHT", label: "Light", icon: Sun },
              { value: "DARK", label: "Dark", icon: Moon },
              { value: "SYSTEM", label: "System", icon: Monitor },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <label
              key={value}
              className="theme-option"
              data-selected={settings.theme === value}
            >
              <input
                type="radio"
                name="theme"
                value={value}
                checked={settings.theme === value}
                onChange={() => void update({ theme: value })}
              />
              <span className="theme-preview" data-preview={value}>
                <span />
                <span />
                <span />
              </span>
              <span>
                <Icon size={16} aria-hidden="true" />
                {label}
                {settings.theme === value && (
                  <Check size={16} aria-hidden="true" />
                )}
              </span>
            </label>
          ))}
        </fieldset>
        <label className="preference-row">
          <span>
            <strong>Reduce motion</strong>
            <small>Keep transitions still and comfortable.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.reduceMotion}
            disabled={saving}
            onChange={(e) => void update({ reduceMotion: e.target.checked })}
          />
        </label>
        <label className="preference-row">
          <span>
            <strong>Larger text</strong>
            <small>Give messages and controls a little more room.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.largeText}
            disabled={saving}
            onChange={(e) => void update({ largeText: e.target.checked })}
          />
        </label>
        <p role="status" className="settings-feedback">
          {saving ? "Saving preferences…" : message}
        </p>
      </section>
      <NotificationPreferences
        settings={settings}
        saving={saving}
        update={update}
      />
    </>
  );
}
