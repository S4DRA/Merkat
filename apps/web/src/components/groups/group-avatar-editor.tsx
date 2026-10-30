"use client";
import { useState } from "react";
import { AVATAR_MAX_BYTES, type GroupDetail } from "@merkat/contracts";
import { Avatar, Button } from "../ui/primitives";
import { directRequest } from "../../lib/direct-client";
export function validateGroupAvatar(file: File) {
  if (file.size > AVATAR_MAX_BYTES)
    throw new Error("Choose a PNG or JPG up to 2 MB.");
  if (!["image/png", "image/jpeg"].includes(file.type))
    throw new Error("Choose a PNG or JPG image.");
}
export async function saveGroupAvatar(groupId: string, file: File | null) {
  if (file) validateGroupAvatar(file);
  const response = await fetch(`/api/groups/${groupId}/avatar`, {
    method: file ? "PUT" : "DELETE",
    credentials: "same-origin",
    ...(file ? { headers: { "Content-Type": file.type }, body: file } : {}),
  });
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "Only group owners and admins can change the avatar."
        : response.status === 400 ||
            response.status === 413 ||
            response.status === 415
          ? "Choose a valid PNG or JPG up to 2 MB."
          : "Could not save the group avatar. Try again.",
    );
  return (await response.json()) as { avatarRef: string | null };
}
export function GroupAvatarEditor({
  group,
  updated,
}: {
  group: GroupDetail;
  updated: (group: GroupDetail) => void;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function save(file: File | null) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await saveGroupAvatar(group.id, file);
      updated(
        await directRequest<GroupDetail>("groups/detail", {
          groupId: group.id,
        }),
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save the group avatar.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="group-avatar-editor">
      <h3>Group avatar</h3>
      <Avatar name={group.name} src={group.avatarRef ?? undefined} />
      <label>
        Change group avatar
        <input
          type="file"
          accept="image/png,image/jpeg"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void save(file);
            event.target.value = "";
          }}
        />
      </label>
      {group.avatarRef && (
        <Button disabled={pending} onClick={() => void save(null)}>
          Remove group avatar
        </Button>
      )}
      <small>PNG or JPG, up to 2 MB. Visible to current group members.</small>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
