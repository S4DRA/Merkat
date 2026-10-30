// Real product components with explicit fixture data, solely for component/browser QA.
import { createRoot } from "react-dom/client";
import { AppShell } from "../../apps/web/src/components/app-shell";
import { AppearanceProvider } from "../../apps/web/src/components/appearance";
import { InstallAppProvider } from "../../apps/web/src/components/install-app";
import { ProfileWorkspace } from "../../apps/web/src/components/account/profile-workspace";
import { SettingsWorkspace } from "../../apps/web/src/components/account/settings-workspace";
import { ProfileForm } from "../../apps/web/src/components/account/profile-form";
import { AccountFrame } from "../../apps/web/src/components/account/account-frame";
import { AuthenticationForm } from "../../apps/web/src/components/account/authentication-form";
import { CalendarWorkspace } from "../../apps/web/src/components/plans/calendar-workspace";
import { ChatsWorkspace } from "../../apps/web/src/components/chats/chats-workspace";
import { TabDetail } from "../../apps/web/src/components/plans/tab-workspace";
import { SearchWorkspace } from "../../apps/web/src/components/friends/search-workspace";
import { findDestination } from "../../apps/web/src/lib/navigation";
const userId = "00000000-0000-4000-8000-000000000001";
const account = {
  id: userId,
  onboardingComplete: true,
  profile: {
    displayName: "QA Alice",
    username: "qa_alice",
    bio: "A test profile for conversations, shared plans and a little good company.",
    avatarRef: null,
  },
};
const path = location.pathname;
const destination =
  findDestination(path === "/tabs-preview" ? "chats" : path.slice(1)) ??
  findDestination("profile")!;
const content =
  path === "/profile" ? (
    <ProfileWorkspace account={account} />
  ) : path === "/settings" ? (
    <SettingsWorkspace account={account} />
  ) : path === "/plans" ? (
    <CalendarWorkspace userId={userId} />
  ) : path === "/chats" ? (
    <ChatsWorkspace userId={userId} />
  ) : path === "/search" ? (
    <SearchWorkspace />
  ) : path === "/tabs-preview" ? (
    <div className="fixture-tab">
      <TabDetail tabId="30000000-0000-4000-8000-000000000001" userId={userId} />
    </div>
  ) : null;
createRoot(document.getElementById("root")!).render(
  <AppearanceProvider>
    <InstallAppProvider>
      {path === "/profile/edit" ? (
        <AccountFrame title="Edit profile">
          <ProfileForm account={account} />
        </AccountFrame>
      ) : path === "/login" || path === "/register" ? (
        <AccountFrame title={path === "/login" ? "Sign in" : "Create account"}>
          <AuthenticationForm register={path === "/register"} available />
        </AccountFrame>
      ) : (
        <AppShell destination={destination}>{content}</AppShell>
      )}
    </InstallAppProvider>
  </AppearanceProvider>,
);
