"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Users, Plus, Hash } from "lucide-react";
import type { GroupDetail, GroupList } from "@merkat/contracts";
import { Badge, Button, IconButton } from "../ui/primitives";
import {
  directRequest,
  directError,
  DirectRequestError,
} from "../../lib/direct-client";
import { useDirectRealtime } from "../chats/use-direct-realtime";
import { ChatsWorkspace, type DirectMemory } from "../chats/chats-workspace";
import { SocialDialog } from "../privacy-controls";
import { GroupRows } from "./group-list";
import { GroupSettings } from "./group-settings";
import { PeoplePicker } from "../people-picker";
import { saveGroupAvatar, validateGroupAvatar } from "./group-avatar-editor";
import {
  GroupThread,
  type GroupPosition,
  type GroupThreadData,
} from "./group-thread";

type GroupMemory = {
  threads: Map<string, GroupThreadData>;
  positions: Map<string, GroupPosition>;
};
function useGroupMemory() {
  const [memories, setMemories] = useState(new Map<string, GroupMemory>());
  const save = useCallback(
    (
      groupId: string,
      channelId: string,
      data: GroupThreadData,
      position: GroupPosition,
    ) => {
      setMemories((old) => {
        const prior = old.get(groupId);
        return new Map(old).set(groupId, {
          threads: new Map(prior?.threads).set(channelId, data),
          positions: new Map(prior?.positions).set(channelId, position),
        });
      });
    },
    [],
  );
  return { memories, save };
}

export function ChatsSurface({ userId }: { userId: string }) {
  const params = useSearchParams();
  const group = params.get("group");
  const memory = useGroupMemory();
  const [directMemory, setDirectMemory] = useState<DirectMemory>(() => ({
    threads: new Map(),
    positions: new Map(),
  }));
  const remember = useCallback<
    NonNullable<Parameters<typeof ChatsWorkspace>[0]["remember"]>
  >((id, thread, position) => {
    setDirectMemory((old) => ({
      threads: thread ? new Map(old.threads).set(id, thread) : old.threads,
      positions: new Map(old.positions).set(id, position),
    }));
  }, []);
  return group ? (
    <GroupsWorkspace
      key={group}
      userId={userId}
      inbox
      initialMemory={memory.memories.get(group)}
      saveMemory={memory.save}
    />
  ) : (
    <ChatsWorkspace
      userId={userId}
      initialMemory={directMemory}
      remember={remember}
    />
  );
}
export function GroupsSurface({ userId }: { userId: string }) {
  const params = useSearchParams();
  const groupId = params.get("group") ?? "",
    memory = useGroupMemory();
  return (
    <GroupsWorkspace
      key={groupId}
      userId={userId}
      initialMemory={memory.memories.get(groupId)}
      saveMemory={memory.save}
    />
  );
}
export function GroupsWorkspace({
  userId,
  inbox = false,
  initialMemory,
  saveMemory,
}: {
  userId: string;
  inbox?: boolean;
  initialMemory?: GroupMemory | undefined;
  saveMemory?: (
    groupId: string,
    channelId: string,
    data: GroupThreadData,
    position: GroupPosition,
  ) => void;
}) {
  const params = useSearchParams(),
    router = useRouter();
  const groupId = params.get("group") ?? "",
    base = inbox ? "/chats" : "/groups",
    panel = params.get("panel");
  const [list, setList] = useState<GroupList | null>(null),
    [group, setGroup] = useState<GroupDetail | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [attempt, setAttempt] = useState(0),
    [revision, setRevision] = useState(0);
  const busy = useRef(false),
    queued = useRef(false),
    alive = useRef(true);
  const [caches, setCaches] = useState(
      initialMemory?.threads ?? new Map<string, GroupThreadData>(),
    ),
    [positions, setPositions] = useState(
      initialMemory?.positions ?? new Map<string, GroupPosition>(),
    );
  const unauthorized = useCallback(
    (e: unknown) => {
      if (e instanceof DirectRequestError && e.code === "UNAUTHORIZED") {
        router.replace("/login");
        router.refresh();
      }
    },
    [router],
  );
  const refresh = useCallback(async () => {
    if (busy.current) {
      queued.current = true;
      return;
    }
    busy.current = true;
    try {
      do {
        queued.current = false;
        const [l, g] = await Promise.all([
          directRequest<GroupList>("groups/list", {}),
          groupId
            ? directRequest<GroupDetail>("groups/detail", { groupId })
            : Promise.resolve(null),
        ]);
        if (!alive.current) return;
        setList(l);
        setGroup(g);
        setError("");
        setRevision((v) => v + 1);
      } while (queued.current);
    } catch (e) {
      if (!alive.current) return;
      unauthorized(e);
      if (
        groupId &&
        e instanceof DirectRequestError &&
        e.code === "NOT_FOUND"
      ) {
        setCaches(new Map());
        setGroup(null);
        router.replace(`${base}?notice=unavailable`, { scroll: false });
      } else setError(directError(e));
    } finally {
      busy.current = false;
    }
  }, [groupId, base, router, unauthorized]);
  const changed = useCallback(() => void refresh(), [refresh]);
  const connection = useDirectRealtime(changed, unauthorized, attempt);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => {
      if (alive.current) return refresh();
    });
    const wake = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [refresh]);
  useEffect(() => {
    const viewport = window.visualViewport,
      frame = document.querySelector<HTMLElement>(".app-shell");
    const resize = () => {
      if (viewport)
        frame?.style.setProperty(
          "--chat-viewport-height",
          `${viewport.height}px`,
        );
    };
    resize();
    viewport?.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      frame?.style.removeProperty("--chat-viewport-height");
    };
  }, []);
  const requestedChannel = params.get("channel");
  const channel =
    group?.channels.find((c) => c.id === requestedChannel) ??
    group?.channels.find((c) => c.isDefault);
  useEffect(() => {
    if (
      group &&
      requestedChannel &&
      !group.channels.some((c) => c.id === requestedChannel)
    )
      router.replace(
        `${base}?group=${group.id}&channel=${group.defaultChannelId}${panel === "settings" || panel === "channels" ? `&panel=${panel}` : ""}`,
        { scroll: false },
      );
  }, [group, requestedChannel, router, base, panel]);
  function closePanel() {
    router.back();
  }
  function openPanel(name: string) {
    if (!group || !channel) return;
    router.push(
      `${base}?group=${group.id}&channel=${channel.id}&panel=${name}`,
      { scroll: false },
    );
  }
  async function actInvitation(id: string, action: "ACCEPT" | "DECLINE") {
    setPending(true);
    setError("");
    try {
      await directRequest("groups/invitation", { id, action });
      await refresh();
    } catch (e) {
      setError(directError(e));
      unauthorized(e);
    } finally {
      setPending(false);
    }
  }
  async function more() {
    if (!list?.nextCursor || pending) return;
    setPending(true);
    try {
      const page = await directRequest<GroupList>("groups/list", {
        before: list.nextCursor,
      });
      setList((old) =>
        old
          ? {
              ...page,
              groups: [
                ...old.groups,
                ...page.groups.filter(
                  (g) => !old.groups.some((o) => o.id === g.id),
                ),
              ],
            }
          : page,
      );
    } catch (e) {
      setError(directError(e));
    } finally {
      setPending(false);
    }
  }
  const remember = useCallback(
    (id: string, data: GroupThreadData, position: GroupPosition) => {
      setCaches((old) => new Map(old).set(id, data));
      setPositions((old) => new Map(old).set(id, position));
      saveMemory?.(groupId, id, data, position);
    },
    [groupId, saveMemory],
  );
  return (
    <div
      className="direct-workspace group-workspace"
      data-thread-open={!!groupId}
      data-conversation-open={!!groupId}
    >
      <section className="direct-list" aria-label="Groups context">
        <header className="direct-list-heading">
          <h1>
            Groups
            {list && list.groups.some((g) => g.unreadCount > 0) && (
              <Badge
                count={list.groups.filter((g) => g.unreadCount > 0).length}
              />
            )}
          </h1>
          <IconButton
            label="Create group"
            icon={Plus}
            onClick={() => router.push("/groups?new=1", { scroll: false })}
          />
        </header>
        <div className="direct-connection" role="status">
          <span data-live={connection === "live"} />
          {connection === "live"
            ? "Live"
            : connection === "unavailable"
              ? "Live updates unavailable"
              : "Connecting…"}
          {connection !== "live" && (
            <Button
              onClick={() => {
                setAttempt((a) => a + 1);
                void refresh();
              }}
            >
              Retry
            </Button>
          )}
        </div>
        <div className="direct-list-scroll">
          {params.get("notice") === "unavailable" && (
            <p role="alert" className="direct-feedback">
              Group unavailable.
            </p>
          )}
          {!list && !error && (
            <p role="status" className="direct-feedback">
              Loading groups…
            </p>
          )}
          {error && (
            <div className="direct-feedback" role="alert">
              {error}
              <Button onClick={() => void refresh()}>Retry groups</Button>
            </div>
          )}
          {list?.invitations.map((i) => (
            <div key={i.id} className="group-invitation">
              <strong>{i.groupName}</strong>
              <p>@{i.invitedBy.username} invited you</p>
              <div>
                <Button
                  variant="primary"
                  disabled={pending}
                  onClick={() => void actInvitation(i.id, "ACCEPT")}
                >
                  Join group
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => void actInvitation(i.id, "DECLINE")}
                >
                  Decline
                </Button>
              </div>
            </div>
          ))}
          {list && <GroupRows list={list} base={base} />}
          {list?.groups.length === 0 && (
            <div className="direct-empty">
              <Users size={32} />
              <h2>No groups yet.</h2>
              <Button
                onClick={() => router.push("/groups?new=1")}
                variant="primary"
              >
                Create group
              </Button>
            </div>
          )}
          {list?.nextCursor && (
            <Button
              className="direct-more"
              loading={pending}
              onClick={() => void more()}
            >
              More groups
            </Button>
          )}
        </div>
        <Link className="group-see-all" href="/chats">
          Back to Chats
        </Link>
      </section>
      {group && channel ? (
        <GroupThread
          key={channel.id}
          userId={userId}
          group={group}
          channel={channel}
          base={base}
          connection={connection}
          revision={revision}
          cached={caches.get(channel.id)}
          position={positions.get(channel.id)}
          remember={remember}
          updated={setGroup}
          refresh={changed}
          unavailable={changed}
          openChannels={() => openPanel("channels")}
          openSettings={() => openPanel("settings")}
          unauthorized={unauthorized}
        />
      ) : (
        <section
          className={groupId ? "direct-thread group-loading" : "direct-idle"}
          aria-label="Group conversation"
        >
          <Users size={40} />
          <h2>{groupId ? "Loading group…" : "Your people, in one place."}</h2>
          {error && <p role="alert">{error}</p>}
        </section>
      )}
      {panel === "channels" && group && channel && (
        <SocialDialog title="Channels" close={closePanel} sheet>
          <p className="group-sheet-context">{group.name}</p>
          <nav aria-label="Group channels" className="group-channel-list">
            {group.channels.map((c) => (
              <Link
                key={c.id}
                href={`${base}?group=${group.id}&channel=${c.id}`}
                replace
                scroll={false}
                aria-current={c.id === channel.id ? "page" : undefined}
              >
                <Hash size={18} />
                <span>{c.name}</span>
                <Badge count={c.unreadCount} />
              </Link>
            ))}
          </nav>
        </SocialDialog>
      )}
      {panel === "settings" && group && (
        <GroupSettings
          group={group}
          userId={userId}
          close={closePanel}
          updated={(g) => {
            setGroup(g);
            changed();
          }}
          left={() => router.replace(base, { scroll: false })}
        />
      )}
      {params.get("new") === "1" && (
        <CreateGroup
          close={() => router.replace("/groups", { scroll: false })}
          created={(g) =>
            router.replace(
              `/chats?group=${g.id}&channel=${g.defaultChannelId}`,
              { scroll: false },
            )
          }
        />
      )}
    </div>
  );
}
function CreateGroup({
  close,
  created,
}: {
  close: () => void;
  created: (g: GroupDetail) => void;
}) {
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [createdGroup, setCreatedGroup] = useState<GroupDetail | null>(null);
  const clientId = useRef("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!review) {
      setReview(true);
      return;
    }
    setPending(true);
    setError("");
    clientId.current ||= crypto.randomUUID();
    try {
      const group =
        createdGroup ??
        (await directRequest<GroupDetail>("groups/create", {
          clientId: clientId.current,
          name,
          description,
          usernames: people,
        }));
      setCreatedGroup(group);
      if (avatar) {
        const result = await saveGroupAvatar(group.id, avatar);
        created({ ...group, avatarRef: result.avatarRef });
      } else created(group);
    } catch (e) {
      setError(directError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <SocialDialog title="Create group" close={close}>
      <form className="social-form" onSubmit={(e) => void submit(e)}>
        {!review ? (
          <>
            <label>
              Group name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                autoFocus
                disabled={pending}
              />
            </label>
            <label>
              Description (optional)
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                disabled={pending}
              />
            </label>
            <PeoplePicker
              value={people}
              onChange={setPeople}
              disabled={pending}
              limit={20}
            />
            <label>
              Group avatar (optional)
              <input
                type="file"
                accept="image/png,image/jpeg"
                disabled={pending}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  try {
                    if (file) validateGroupAvatar(file);
                    setAvatar(file);
                    setError("");
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Choose a valid image.",
                    );
                    event.target.value = "";
                  }
                }}
              />
            </label>
            {avatar && <p>{avatar.name}</p>}
          </>
        ) : (
          <section aria-label="Review group">
            <h3>{name}</h3>
            <p>{description}</p>
            <h4>{people.length} invitations</h4>
            {people.map((person) => (
              <p key={person}>@{person}</p>
            ))}
            <p>People are invited and must accept before joining.</p>
            {avatar && <p>Avatar: {avatar.name}</p>}
            <Button
              type="button"
              disabled={pending || !!createdGroup}
              onClick={() => setReview(false)}
            >
              Back to details
            </Button>
          </section>
        )}
        <Button type="submit" variant="primary" loading={pending}>
          {createdGroup
            ? "Retry avatar"
            : review
              ? "Create group"
              : "Review group"}
        </Button>
        {createdGroup && (
          <>
            <p>
              The group has been created. Retry the avatar or continue without
              it.
            </p>
            <Button
              type="button"
              disabled={pending}
              onClick={() => created(createdGroup)}
            >
              Open group without avatar
            </Button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </form>
    </SocialDialog>
  );
}
