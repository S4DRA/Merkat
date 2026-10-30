import { notFound } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { findDestination } from "../../lib/navigation";
import { requireAccount } from "../../lib/account-server";
import { AccountControls } from "../../components/account/account-controls";
import { Suspense } from "react";
import {
  ChatsSurface,
  GroupsSurface,
} from "../../components/groups/groups-workspace";
import { FriendsWorkspace } from "../../components/friends/friends-workspace";
import { ProfileWorkspace } from "../../components/account/profile-workspace";
import { CalendarWorkspace } from "../../components/plans/calendar-workspace";
import { SettingsWorkspace } from "../../components/account/settings-workspace";
import { SearchWorkspace } from "../../components/friends/search-workspace";
export default async function DestinationPage({
  params,
}: {
  params: Promise<{ destination: string }>;
}) {
  const destination = findDestination((await params).destination);
  if (!destination) notFound();
  const account = await requireAccount();
  return (
    <AppShell
      key={`${destination.id}:${account.id}`}
      destination={destination}
      accountControls={
        destination.id === "profile" || destination.id === "settings" ? (
          <AccountControls
            account={account}
            showPrivacy={destination.id === "settings"}
          />
        ) : undefined
      }
    >
      {destination.id === "settings" ? (
        <SettingsWorkspace account={account} />
      ) : destination.id === "search" ? (
        <SearchWorkspace />
      ) : destination.id === "plans" ? (
        <Suspense fallback={<p role="status">Loading calendar…</p>}>
          <CalendarWorkspace userId={account.id} />
        </Suspense>
      ) : destination.id === "profile" ? (
        <ProfileWorkspace account={account} />
      ) : destination.id === "chats" ? (
        <Suspense fallback={<p role="status">Loading chats…</p>}>
          <ChatsSurface userId={account.id} />
        </Suspense>
      ) : destination.id === "friends" ? (
        <FriendsWorkspace />
      ) : destination.id === "groups" ? (
        <Suspense fallback={<p role="status">Loading groups…</p>}>
          <GroupsSurface userId={account.id} />
        </Suspense>
      ) : undefined}
    </AppShell>
  );
}
