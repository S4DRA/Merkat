"use client";
import { useState, useRef, type FormEvent } from "react";
import type { GroupDetail, GroupMemberView } from "@merkat/contracts";
import { Button } from "../ui/primitives";
import { SocialDialog, ReportDialog } from "../privacy-controls";
import { directRequest, directError } from "../../lib/direct-client";
export function GroupSettings({
  group,
  userId,
  close,
  updated,
  left,
}: {
  group: GroupDetail;
  userId: string;
  close: () => void;
  updated: (g: GroupDetail) => void;
  left: () => void;
}) {
  const [name, setName] = useState(group.name),
    [description, setDescription] = useState(group.description),
    [username, setUsername] = useState(""),
    [channelName, setChannelName] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState<{
      action: "REMOVE" | "TRANSFER" | "LEAVE" | "DELETE";
      id?: string;
      label: string;
    } | null>(null),
    [report, setReport] = useState(false);
  const manager = group.role !== "MEMBER";
  const channelClientId = useRef("");
  async function createChannel(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    channelClientId.current ||= crypto.randomUUID();
    try {
      const g = await directRequest<GroupDetail>("groups/channel/create", {
        groupId: group.id,
        name: channelName,
        clientId: channelClientId.current,
      });
      updated(g);
      setChannelName("");
      channelClientId.current = "";
    } catch (e) {
      setError(directError(e));
    } finally {
      setPending(false);
    }
  }
  async function perform(endpoint: string, input: unknown, detail = true) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const g = await directRequest<GroupDetail>(endpoint, input);
      if (detail) updated(g);
      else
        updated(
          await directRequest<GroupDetail>("groups/detail", {
            groupId: group.id,
          }),
        );
      setConfirm(null);
    } catch (e) {
      setError(directError(e));
    } finally {
      setPending(false);
    }
  }
  async function invite(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await directRequest("groups/invite", { groupId: group.id, username });
      setUsername("");
      updated(
        await directRequest<GroupDetail>("groups/detail", {
          groupId: group.id,
        }),
      );
    } catch (e) {
      setError(directError(e));
    } finally {
      setPending(false);
    }
  }
  async function leave() {
    setPending(true);
    setError("");
    try {
      await directRequest("groups/leave", { groupId: group.id });
      left();
    } catch (e) {
      setError(directError(e));
      setPending(false);
    }
  }
  function roleActions(m: GroupMemberView) {
    if (
      !manager ||
      m.id === userId ||
      m.role === "OWNER" ||
      (group.role === "ADMIN" && m.role !== "MEMBER")
    )
      return null;
    return (
      <div className="social-member-actions">
        {group.role === "OWNER" && (
          <>
            <Button
              disabled={pending}
              onClick={() =>
                void perform("groups/member", {
                  groupId: group.id,
                  userId: m.id,
                  action: m.role === "ADMIN" ? "MEMBER" : "ADMIN",
                })
              }
            >
              {m.role === "ADMIN" ? "Make member" : "Make admin"}
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                setConfirm({
                  action: "TRANSFER",
                  id: m.id,
                  label: `Transfer ownership to ${m.displayName ?? m.username}?`,
                })
              }
            >
              Make owner
            </Button>
          </>
        )}
        <Button
          disabled={pending}
          onClick={() =>
            setConfirm({
              action: "REMOVE",
              id: m.id,
              label: `Remove ${m.displayName ?? m.username}?`,
            })
          }
        >
          Remove
        </Button>
      </div>
    );
  }
  if (report)
    return (
      <ReportDialog
        target={{ kind: "GROUP", id: group.id }}
        close={() => setReport(false)}
      />
    );
  return (
    <SocialDialog title="Group settings" close={close} sheet>
      <div className="social-form">
        {manager ? (
          <form
            className="social-form"
            onSubmit={(e) => {
              e.preventDefault();
              void perform("groups/edit", {
                groupId: group.id,
                name,
                description,
              });
            }}
          >
            <label>
              Group name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                disabled={pending}
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                disabled={pending}
              />
            </label>
            <Button type="submit" loading={pending}>
              Save group
            </Button>
          </form>
        ) : (
          <p>{group.description || group.name}</p>
        )}
        <h3>Members · {group.memberCount}</h3>
        {group.members.map((m) => (
          <div key={m.id} className="social-member">
            <div className="social-member-row">
              <strong>{m.displayName ?? m.username}</strong>
              <span>{m.role.toLowerCase()}</span>
            </div>
            <p>@{m.username}</p>
            {roleActions(m)}
          </div>
        ))}
        {manager && (
          <>
            <form className="social-form" onSubmit={(e) => void invite(e)}>
              <label>
                Invite by username
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={30}
                  required
                  autoCapitalize="none"
                  autoComplete="off"
                  disabled={pending}
                />
              </label>
              <Button type="submit" loading={pending}>
                Invite member
              </Button>
            </form>
            {group.invitations.map((i) => (
              <div key={i.id} className="social-member-row">
                <span>Pending · @{i.person.username}</span>
                <Button
                  disabled={pending}
                  onClick={() =>
                    void perform(
                      "groups/invitation",
                      { id: i.id, action: "REVOKE" },
                      false,
                    )
                  }
                >
                  Revoke
                </Button>
              </div>
            ))}
            <h3>Channels</h3>
            <form
              className="social-form"
              onSubmit={(e) => void createChannel(e)}
            >
              <label>
                New channel
                <input
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  maxLength={60}
                  required
                  disabled={pending}
                />
              </label>
              <Button type="submit" loading={pending}>
                Create channel
              </Button>
            </form>
            {group.channels.map((c) => (
              <ChannelSetting
                key={c.id}
                name={c.name}
                disabled={pending}
                rename={(name) =>
                  void perform("groups/channel/edit", {
                    groupId: group.id,
                    channelId: c.id,
                    action: "RENAME",
                    name,
                  })
                }
                remove={
                  c.isDefault
                    ? undefined
                    : () =>
                        setConfirm({
                          action: "DELETE",
                          id: c.id,
                          label: `Delete #${c.name}? Its messages will no longer be accessible.`,
                        })
                }
              />
            ))}
          </>
        )}
        <Button onClick={() => setReport(true)} disabled={pending}>
          Report group
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            setConfirm({
              action: "LEAVE",
              label:
                group.memberCount === 1
                  ? "Leave and close this group?"
                  : "Leave this group? Owners must transfer ownership first.",
            })
          }
        >
          Leave group
        </Button>
        {confirm && (
          <div
            className="social-confirm"
            role="group"
            aria-label="Confirm group action"
          >
            <p>{confirm.label}</p>
            <Button
              loading={pending}
              onClick={() => {
                if (confirm.action === "LEAVE") void leave();
                else if (confirm.action === "DELETE")
                  void perform("groups/channel/edit", {
                    groupId: group.id,
                    channelId: confirm.id,
                    action: "DELETE",
                  });
                else
                  void perform("groups/member", {
                    groupId: group.id,
                    userId: confirm.id,
                    action: confirm.action,
                  });
              }}
            >
              Confirm
            </Button>
            <Button disabled={pending} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </SocialDialog>
  );
}
function ChannelSetting({
  name,
  disabled,
  rename,
  remove,
}: {
  name: string;
  disabled: boolean;
  rename: (name: string) => void;
  remove: (() => void) | undefined;
}) {
  const [draft, setDraft] = useState(name);
  return (
    <form
      className="social-channel-setting"
      onSubmit={(e) => {
        e.preventDefault();
        rename(draft);
      }}
    >
      <label>
        Rename {name}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={60}
          required
          disabled={disabled}
        />
      </label>
      <div>
        <Button type="submit" disabled={disabled}>
          Rename
        </Button>
        {remove && (
          <Button disabled={disabled} onClick={remove}>
            Delete channel
          </Button>
        )}
      </div>
    </form>
  );
}
