"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { GroupList } from "@merkat/contracts";
import { Users, Plus } from "lucide-react";
import { Avatar, Badge, Button } from "../ui/primitives";
import { directRequest, directError } from "../../lib/direct-client";
export function GroupRows({
  list,
  base = "/groups",
}: {
  list: GroupList;
  base?: string;
}) {
  return (
    <>
      {list.groups.map((g) => (
        <Link
          key={g.id}
          href={`${base}?group=${g.id}&channel=${g.defaultChannelId}`}
          scroll={false}
          className="direct-list-item group-list-item"
        >
          {g.avatarRef ? (
            <Avatar name={g.name} src={g.avatarRef} />
          ) : (
            <span className="group-avatar">
              <Users size={22} aria-hidden="true" />
            </span>
          )}
          <span className="direct-list-copy">
            <span className="direct-list-line">
              <strong>{g.name}</strong>
              <time dateTime={g.activityAt}>
                {new Date(g.activityAt).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })}
              </time>
            </span>
            <span className="direct-list-line">
              <span>
                {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
              </span>
              <Badge count={g.unreadCount} />
            </span>
          </span>
        </Link>
      ))}
    </>
  );
}
export function GroupInboxEntries({ revision }: { revision: number }) {
  const [list, setList] = useState<GroupList | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    directRequest<GroupList>("groups/list", {}, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setList(value);
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(directError(e));
      });
    return () => controller.abort();
  }, [revision, attempt]);
  return (
    <section aria-label="Groups in Chats">
      <div className="group-inbox-heading">
        <Link href="/groups">
          Groups
          {list && list.invitations.length > 0 && (
            <Badge count={list.invitations.length} />
          )}
        </Link>
        <Link
          href="/groups?new=1"
          className="icon-link"
          aria-label="Create group"
        >
          <Plus size={20} />
        </Link>
      </div>
      {list && <GroupRows list={list} base="/chats" />}
      {list?.nextCursor && (
        <Link href="/groups" className="group-see-all">
          All groups
        </Link>
      )}
      {error && (
        <div className="direct-feedback" role="alert">
          {error}
          <Button
            onClick={() => {
              setError("");
              setAttempt((v) => v + 1);
            }}
          >
            Retry groups
          </Button>
        </div>
      )}
    </section>
  );
}
