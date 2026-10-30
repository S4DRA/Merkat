"use client";
import { useEffect, useState } from "react";
import type { ChatScope, GroupList } from "@merkat/contracts";
import { Button } from "../ui/primitives";
import { directRequest, directError } from "../../lib/direct-client";
export function GroupDestinationPicker({
  onChange,
}: {
  onChange: (scope: ChatScope | undefined) => void;
}) {
  const [groups, setGroups] = useState<GroupList["groups"]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const all: GroupList["groups"] = [];
      let before: GroupList["nextCursor"] = null;
      try {
        do {
          const page: GroupList = await directRequest<GroupList>(
            "groups/list",
            before ? { before } : {},
            controller.signal,
          );
          all.push(...page.groups);
          before = page.nextCursor;
        } while (before);
        if (!controller.signal.aborted) {
          setGroups(all);
          setError("");
          setLoading(false);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(directError(error));
          setLoading(false);
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);
  return (
    <>
      <label>
        Share with group
        <select
          required
          defaultValue=""
          disabled={loading}
          onChange={(event) => {
            const group = groups.find((g) => g.id === event.target.value);
            onChange(
              group
                ? {
                    kind: "GROUP",
                    id: group.id,
                    channelId: group.defaultChannelId,
                  }
                : undefined,
            );
          }}
        >
          <option value="">
            {loading ? "Loading your groups…" : "Choose a group"}
          </option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
      <small>
        The invitation will be shared in the selected group’s default channel.
        Members choose whether to join.
      </small>
      {!loading && !error && groups.length === 0 && (
        <p>No groups yet. You can still create a personal activity.</p>
      )}
      {error && (
        <p role="alert">
          {error}
          <Button type="button" onClick={() => setAttempt((v) => v + 1)}>
            Retry groups
          </Button>
        </p>
      )}
    </>
  );
}
