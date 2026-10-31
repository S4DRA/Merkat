"use client";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MessageCirclePlus, Users } from "lucide-react";

const actions = [
  { label: "New Chat", href: "/chats?new=1", icon: MessageCirclePlus },
  { label: "New Group", href: "/groups?new=1", icon: Users },
] as const;

export function QuickCreate() {
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const focusMenu = useRef(false);
  const [open, setOpen] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const reset = useCallback((focus = false) => {
    clearTimeout(timer.current);
    if (gesture.current) suppressClick.current = true;
    gesture.current = null;
    focusMenu.current = false;
    setOpen(false);
    setPressed(false);
    setTarget(null);
    if (focus) button.current?.focus();
  }, []);
  const show = useCallback((focus: boolean) => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const half = Math.min(146, (width - 24) / 2);
    setAnchor({
      x: Math.max(
        left + half + 12,
        Math.min(rect.left + rect.width / 2, left + width - half - 12),
      ),
      y: Math.max(top + 12, Math.min(rect.top - 96, top + height - 96)),
    });
    focusMenu.current = focus;
    setOpen(true);
  }, []);
  useLayoutEffect(() => {
    if (open && focusMenu.current) {
      focusMenu.current = false;
      items.current[0]?.focus();
    }
  }, [open]);
  function hit(x: number, y: number) {
    const index = items.current.findIndex((item) => {
      const r = item?.getBoundingClientRect();
      return r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    return index < 0 ? null : index;
  }
  function choose(index: number) {
    const action = actions[index];
    reset();
    if (action) router.push(action.href, { scroll: false });
  }
  useEffect(() => {
    const interrupt = () => reset();
    const visibility = () => {
      if (document.hidden) reset();
    };
    const outside = (event: PointerEvent) => {
      if (gesture.current && gesture.current.id !== event.pointerId) reset();
      else if (
        !button.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node) &&
        !gesture.current
      )
        reset();
    };
    window.addEventListener("blur", interrupt);
    window.addEventListener("resize", interrupt);
    window.visualViewport?.addEventListener("resize", interrupt);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("blur", interrupt);
      window.removeEventListener("resize", interrupt);
      window.visualViewport?.removeEventListener("resize", interrupt);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [reset]);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="destination destination--create"
        aria-label="Create a chat or group"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "quick-create-menu" : undefined}
        data-pressed={pressed}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) {
            reset();
            return;
          }
          suppressClick.current = false;
          setPressed(true);
          gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            active: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          timer.current = setTimeout(() => {
            if (!gesture.current) return;
            gesture.current.active = true;
            suppressClick.current = true;
            show(false);
          }, 400);
        }}
        onPointerMove={(event) => {
          const current = gesture.current;
          if (!current || current.id !== event.pointerId) return;
          if (
            !current.active &&
            Math.hypot(event.clientX - current.x, event.clientY - current.y) >
              12
          ) {
            suppressClick.current = true;
            reset();
          } else if (current.active)
            setTarget(hit(event.clientX, event.clientY));
        }}
        onPointerUp={(event) => {
          const current = gesture.current;
          clearTimeout(timer.current);
          setPressed(false);
          if (!current || current.id !== event.pointerId) return;
          gesture.current = null;
          if (current.active) {
            suppressClick.current = true;
            const index = hit(event.clientX, event.clientY);
            if (index === null) reset();
            else choose(index);
          }
        }}
        onPointerCancel={() => {
          suppressClick.current = true;
          reset();
        }}
        onLostPointerCapture={() => {
          if (gesture.current?.active) reset();
        }}
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => {
          if (suppressClick.current && event.detail !== 0) {
            suppressClick.current = false;
            return;
          }
          suppressClick.current = false;
          if (open) reset(true);
          else show(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            show(true);
          }
          if (event.key === "Escape") reset(true);
        }}
      >
        <Image
          className="nav-logo"
          src="/brand/merkat-white-transparent.png"
          alt=""
          aria-hidden="true"
          width={54}
          height={36}
          unoptimized
        />
      </button>
      {open &&
        createPortal(
          <div
            id="quick-create-menu"
            ref={menu}
            role="menu"
            aria-label="Create"
            className="quick-create-menu"
            style={{ left: anchor.x, top: anchor.y }}
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Tab") {
                event.preventDefault();
                reset(true);
                return;
              }
              if (
                [
                  "ArrowLeft",
                  "ArrowRight",
                  "ArrowUp",
                  "ArrowDown",
                  "Home",
                  "End",
                ].includes(event.key)
              ) {
                event.preventDefault();
                const current = items.current.findIndex(
                  (item) => item === document.activeElement,
                );
                const index =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 1
                      : (current + 1) % 2;
                items.current[index]?.focus();
              }
            }}
          >
            {actions.map((action, index) => (
              <button
                key={action.href}
                ref={(element) => {
                  items.current[index] = element;
                }}
                type="button"
                role="menuitem"
                className="quick-create-action"
                data-targeted={target === index}
                onClick={() => choose(index)}
              >
                <action.icon size={24} aria-hidden="true" />
                <span>{action.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
