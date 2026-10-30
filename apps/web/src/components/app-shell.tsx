"use client";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Info, Search, Settings, X } from "lucide-react";
import type { Destination } from "../lib/navigation";
import { ShellNavigation, destinationIcons } from "./shell-navigation";
import { Avatar, Badge, Button, IconButton, Skeleton } from "./ui/primitives";
import { NotificationCenter } from "./plans/notification-center";

export function AppShell({
  destination,
  accountControls,
  children,
}: {
  destination: Destination;
  accountControls?: ReactNode;
  children?: ReactNode;
}) {
  const [mobileContent, setMobileContent] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const Icon = destinationIcons[destination.id];
  function openContent() {
    setMobileContent(true);
    requestAnimationFrame(() => content.current?.focus());
  }
  function closeContent() {
    setMobileContent(false);
    requestAnimationFrame(() => openButton.current?.focus());
  }
  return (
    <div className="app-shell" data-mobile-content={mobileContent}>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="brand-header">
        <span className="brand-link">
          <span>
            {destination.id === "plans" ? "Calendar" : destination.label}
          </span>
        </span>
        <span className="brand-motto">TALK. PLAN. MEET.</span>
        <NotificationCenter />
        <Link
          className="icon-link global-search"
          href="/search"
          aria-label="Global search"
        >
          <Search size={20} aria-hidden="true" />
        </Link>
      </header>
      <ShellNavigation selected={destination.id} />
      <main
        id="content"
        className={
          children ? "shell-workspace chats-workspace" : "shell-workspace"
        }
        tabIndex={-1}
      >
        {children ?? (
          <>
            <section
              className="context-panel"
              aria-label={`${destination.label} context`}
            >
              <div className="context-heading">
                <div>
                  <p className="eyebrow">YOUR EVERYDAY, TOGETHER</p>
                  <h1>{destination.label}</h1>
                </div>
                <Link
                  className="icon-link"
                  href={
                    destination.id === "profile" ||
                    destination.id === "settings"
                      ? "/settings"
                      : "/search"
                  }
                  aria-label={
                    destination.id === "profile" ||
                    destination.id === "settings"
                      ? "Settings"
                      : `Search ${destination.label.toLowerCase()}`
                  }
                >
                  {destination.id === "profile" ||
                  destination.id === "settings" ? (
                    <Settings size={20} aria-hidden="true" />
                  ) : (
                    <Search size={20} aria-hidden="true" />
                  )}
                </Link>
              </div>
              <p className="context-intro">{destination.description}</p>
              {accountControls ? (
                <div className="context-body">{accountControls}</div>
              ) : (
                <div className="context-body">
                  <div className="outline-symbol">
                    <Icon size={28} strokeWidth={1.5} aria-hidden="true" />
                  </div>
                  <h2>A space taking shape.</h2>
                  <p>Feature implementation begins in a later phase.</p>
                  <button
                    ref={openButton}
                    className="space-link"
                    type="button"
                    onClick={openContent}
                  >
                    Explore this space
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
              )}
              {destination.id === "profile" && (
                <Link className="settings-row" href="/settings">
                  <Settings size={20} aria-hidden="true" />
                  Settings
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              )}
              {destination.id === "settings" && (
                <Link className="settings-row" href="/profile">
                  <ArrowLeft size={18} aria-hidden="true" />
                  Back to Profile
                </Link>
              )}
              <div className="context-footer">
                <span className="phase-label">SHELL PREVIEW</span>
                <span>Made for real life.</span>
              </div>
            </section>
            <section
              ref={content}
              className="active-panel"
              aria-label={`${destination.label} overview`}
              tabIndex={-1}
            >
              <header className="content-toolbar">
                <div className="toolbar-title">
                  <span className="mobile-back">
                    <IconButton
                      label={`Back to ${destination.label}`}
                      icon={ArrowLeft}
                      onClick={closeContent}
                    />
                  </span>
                  <Icon size={18} aria-hidden="true" />
                  <span>{destination.label}</span>
                </div>
                <IconButton
                  label="About this space"
                  icon={Info}
                  onClick={() => dialog.current?.showModal()}
                />
              </header>
              <div className="active-body">
                <div className="welcome-mark">
                  <Image
                    src="/brand/merkat-orange-on-white.png"
                    alt="Official Merkat symbol"
                    width={1536}
                    height={1024}
                    sizes="180px"
                  />
                </div>
                <p className="eyebrow">MORE MOMENTS TOGETHER</p>
                <h2>{destination.title}</h2>
                <p className="active-description">{destination.description}</p>
                <div className="development-state">
                  <span className="state-line" />
                  <p>
                    <strong>{destination.label} — structural shell</strong>
                    <br />
                    Feature implementation begins in a later phase.
                  </p>
                </div>
                <Button onClick={() => dialog.current?.showModal()}>
                  About this space
                  <ArrowRight size={16} aria-hidden="true" />
                </Button>
              </div>
              <footer className="content-footer">
                <span>
                  PEOPLE <span aria-hidden="true">↗</span> CONVERSATION{" "}
                  <span aria-hidden="true">↗</span> PLANS
                </span>
                <span>See you there.</span>
              </footer>
            </section>
          </>
        )}
      </main>
      <dialog
        ref={dialog}
        className="info-panel"
        aria-labelledby="info-title"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]',
            ),
          );
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">MERKAT / FOUNDATION</p>
            <h2 id="info-title">Room to grow.</h2>
          </div>
          <IconButton
            label="Close information"
            icon={X}
            onClick={() => dialog.current?.close()}
          />
        </div>
        <p>
          This is the {destination.label.toLowerCase()} shell. Conversations and
          activity arrive in a later phase.
        </p>
        <div className="dialog-section">
          <h3>One familiar way around.</h3>
          <p>
            Chats, Calls, Plans, Groups and Profile share the same navigation.
            Central Nav will offer another way to reach them later.
          </p>
        </div>
        <div className="dialog-section">
          <h3>Interface states</h3>
          <p className="sample-note">
            Design examples only — not live activity.
          </p>
          <div className="state-samples">
            <div>
              <Avatar name="Avatar example" online />
              <span>Avatar · online</span>
            </div>
            <div>
              <Badge count={3} />
              <span>Unread example</span>
            </div>
            <div>
              <Button disabled>Unavailable</Button>
            </div>
            <div>
              <Button loading>Loading</Button>
            </div>
            <div className="loading-sample">
              <Skeleton />
              <span>Loading placeholder</span>
            </div>
          </div>
        </div>
        <p className="dialog-footnote">
          Your conversations will stay connected to the plans you make.
        </p>
      </dialog>
    </div>
  );
}
