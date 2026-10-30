import Image from "next/image";
import type { ReactNode } from "react";
import { InstallAppButton } from "../install-app";
export function AccountFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="account-page">
      <section className="account-card">
        <div className="brand-link">
          <Image
            src="/brand/merkat-white-on-orange.png"
            alt="Merkat"
            width={1536}
            height={1024}
            priority
          />
          <span>MERKAT</span>
        </div>
        <h1>{title}</h1>
        {children}
        <InstallAppButton />
      </section>
    </main>
  );
}
