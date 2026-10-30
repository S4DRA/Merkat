import Link from "next/link";
import Image from "next/image";
import {
  CalendarDays,
  MessageCircle,
  Phone,
  Search,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { navigationDestinations, type DestinationId } from "../lib/navigation";
import { Badge } from "./ui/primitives";
export const destinationIcons: Record<DestinationId, LucideIcon> = {
  chats: MessageCircle,
  calls: Phone,
  plans: CalendarDays,
  groups: Users,
  profile: UserRound,
  search: Search,
  settings: Settings,
  friends: Users,
};
export function ShellNavigation({
  selected,
  unread = {},
}: {
  selected: DestinationId;
  unread?: Partial<Record<DestinationId, number>>;
}) {
  return (
    <nav className="primary-navigation" aria-label="Main navigation">
      {navigationDestinations("classic").map((item) => {
        if (item.id === "new-chat")
          return (
            <Link
              key={item.id}
              className="destination destination--create"
              href={item.href}
              aria-label="New chat"
              scroll={false}
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
            </Link>
          );
        const Icon = destinationIcons[item.id];
        return (
          <Link
            key={item.id}
            className="destination"
            href={item.href}
            aria-current={
              selected === item.id ||
              (item.id === "profile" && selected === "settings")
                ? "page"
                : undefined
            }
          >
            <span className="nav-icon">
              <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
              <Badge count={unread[item.id] ?? 0} />
            </span>
            <span className="destination-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
