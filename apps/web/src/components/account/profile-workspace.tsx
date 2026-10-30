import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  LockKeyhole,
  Palette,
  Pencil,
  UserRound,
} from "lucide-react";
import type { Account } from "@merkat/contracts";
import { Avatar } from "../ui/primitives";
import { AccountControls } from "./account-controls";
export function ProfileWorkspace({ account }: { account: Account }) {
  return (
    <div className="profile-workspace">
      <section className="profile-main">
        <p className="eyebrow">YOUR SPACE, YOUR PEOPLE</p>
        <div className="profile-hero">
          <Avatar
            name={account.profile.displayName ?? "You"}
            src={account.profile.avatarRef ?? undefined}
          />
          <div>
            <h1>{account.profile.displayName}</h1>
            <p className="supporting-copy">@{account.profile.username}</p>
          </div>
          <Link href="/profile/edit" className="button">
            <Pencil size={16} aria-hidden="true" />
            Edit profile
          </Link>
        </div>
        {account.profile.bio ? (
          <p className="profile-bio">{account.profile.bio}</p>
        ) : (
          <p className="supporting-copy">
            A few words can start a conversation. Add a bio to introduce
            yourself.
          </p>
        )}
        <div className="profile-links">
          <Link href="/profile/edit">
            <UserRound size={20} />
            <span>
              <strong>Your identity</strong>
              <small>Photo, name, username and bio</small>
            </span>
            <ArrowRight size={18} />
          </Link>
          <Link href="/settings#appearance-title">
            <Palette size={20} />
            <span>
              <strong>Appearance & comfort</strong>
              <small>Light, dark and a little more you</small>
            </span>
            <ArrowRight size={18} />
          </Link>
          <Link href="/settings#privacy">
            <LockKeyhole size={20} />
            <span>
              <strong>Privacy & safety</strong>
              <small>Decide who can reach you</small>
            </span>
            <ArrowRight size={18} />
          </Link>
          <Link href="/plans">
            <CalendarDays size={20} />
            <span>
              <strong>Your calendar</strong>
              <small>Make room for good company</small>
            </span>
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>
      <aside className="profile-side">
        <h2>Account</h2>
        <AccountControls account={account} compact />
      </aside>
    </div>
  );
}
