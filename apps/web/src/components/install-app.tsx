"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Download, X } from "lucide-react";
import Image from "next/image";
import { Button, IconButton } from "./ui/primitives";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
const InstallContext = createContext<{
  installed: boolean;
  open: () => void;
} | null>(null);
export function InstallAppProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [installable, setInstallable] = useState(false);
  const event = useRef<InstallEvent | null>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const [apple, setApple] = useState(false);
  useEffect(() => {
    const media = matchMedia("(display-mode: standalone)");
    const update = () =>
      setInstalled(
        media.matches ||
          !!(navigator as Navigator & { standalone?: boolean }).standalone,
      );
    const capture = (e: Event) => {
      e.preventDefault();
      event.current = e as InstallEvent;
      setInstallable(true);
    };
    const complete = () => {
      setInstalled(true);
      event.current = null;
      setInstallable(false);
      dialog.current?.close();
    };
    queueMicrotask(() => {
      update();
      setApple(
        /iPhone|iPad|iPod/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
      );
    });
    media.addEventListener("change", update);
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", complete);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", complete);
    };
  }, []);
  async function install() {
    const deferred = event.current;
    if (!deferred) return;
    setPending(true);
    setError("");
    try {
      await deferred.prompt();
      await deferred.userChoice;
      event.current = null;
      setInstallable(false);
      dialog.current?.close();
    } catch {
      setError("Open your browser menu to install Merkat.");
    } finally {
      setPending(false);
    }
  }
  return (
    <InstallContext
      value={{ installed, open: () => dialog.current?.showModal() }}
    >
      {children}
      <dialog
        ref={dialog}
        className="direct-new-chat install-dialog"
        aria-labelledby="install-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <div className="direct-dialog-heading">
          <h2 id="install-title">Install Merkat</h2>
          <IconButton
            label="Close install"
            icon={X}
            onClick={() => dialog.current?.close()}
          />
        </div>
        <Image
          src="/icons/merkat-192.png"
          width={72}
          height={72}
          alt="Merkat app icon"
        />
        <p>
          {apple
            ? "Tap Share, then Add to Home Screen."
            : "Open your browser menu and choose Install app or Add to Home screen."}
        </p>
        <p className="install-note">
          An internet connection is needed for conversations.
        </p>
        {installable && (
          <Button
            variant="primary"
            onClick={() => void install()}
            loading={pending}
          >
            Install app
          </Button>
        )}
        {error && <p role="alert">{error}</p>}
      </dialog>
    </InstallContext>
  );
}
export function InstallAppButton() {
  const install = useContext(InstallContext);
  if (!install || install.installed) return null;
  return (
    <Button onClick={install.open}>
      <Download size={18} aria-hidden="true" />
      Install Merkat
    </Button>
  );
}
