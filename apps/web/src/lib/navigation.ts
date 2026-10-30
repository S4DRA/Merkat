export const destinations = [
  {
    id: "chats",
    label: "Chats",
    description: "A little hello goes a long way.",
    title: "Good conversations start here.",
  },
  {
    id: "calls",
    label: "Calls",
    description: "Closer, wherever you are.",
    title: "Make time for a familiar voice.",
  },
  {
    id: "plans",
    label: "Plans",
    description: "From someday to see you there.",
    title: "Good company. Better plans.",
  },
  {
    id: "groups",
    label: "Groups",
    description: "Your people, in one place.",
    title: "Find your kind of together.",
  },
  {
    id: "profile",
    label: "Profile",
    description: "A space that feels like you.",
    title: "Bring a little of yourself.",
  },
] as const;
export const secondaryDestinations = [
  {
    id: "friends",
    label: "Friends",
    description: "Your people, a little closer.",
    title: "Good company starts here.",
  },
  {
    id: "search",
    label: "Search",
    description: "Find your way back to what matters.",
    title: "People, conversations and plans.",
  },
  {
    id: "settings",
    label: "Settings",
    description: "Make Merkat feel like home.",
    title: "Your space. Your preferences.",
  },
] as const;
export type NavigationMode = "classic" | "central";
export type Destination =
  (typeof destinations)[number] | (typeof secondaryDestinations)[number];
export type DestinationId = Destination["id"];
// October 17 user-approved order. Existing Calls/Groups URLs remain available.
export function navigationDestinations(mode: NavigationMode) {
  switch (mode) {
    case "classic":
    case "central":
      return [
        { id: "plans", label: "Calendar", href: "/plans" },
        { id: "friends", label: "Friends", href: "/friends" },
        { id: "new-chat", label: "New chat", href: "/chats?new=1" },
        { id: "chats", label: "Chats", href: "/chats" },
        { id: "profile", label: "Profile", href: "/profile" },
      ] as const;
  }
}
export function findDestination(id: string) {
  return [...destinations, ...secondaryDestinations].find(
    (item) => item.id === id,
  );
}
