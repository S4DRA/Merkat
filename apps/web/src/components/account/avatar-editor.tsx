"use client";
import Image from "next/image";
import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Camera, UserRound } from "lucide-react";
import { AVATAR_MAX_BYTES } from "@merkat/contracts";
import { Button } from "../ui/primitives";

export function AvatarEditor({
  avatarRef,
  name,
}: {
  avatarRef: string | null;
  name: string;
}) {
  const [src, setSrc] = useState(avatarRef),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null),
    busy = useRef(false);
  const router = useRouter();
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy.current) return;
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      !/\.(png|jpe?g)$/i.test(file.name)
    ) {
      setMessage("Choose a PNG or JPG photo.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setMessage("Choose a photo of 2 MB or less.");
      return;
    }
    busy.current = true;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok)
        throw new Error(
          response.status === 413
            ? "Choose a photo of 2 MB or less."
            : response.status === 400
              ? "That photo couldn't be read. Try another PNG or JPG."
              : "Couldn't update your photo. Try again.",
        );
      const result = await response.json();
      setSrc(result.avatarRef);
      setMessage("Profile photo updated.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Couldn't update your photo.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function remove() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      if (!response.ok) throw new Error();
      setSrc(null);
      setMessage("Profile photo removed.");
      router.refresh();
    } catch {
      setMessage("Couldn't remove your photo. Try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section className="avatar-editor" aria-label="Profile photo">
      <span className="profile-photo">
        {src ? (
          <Image
            src={src}
            alt={`${name}'s profile photo`}
            width={112}
            height={112}
            unoptimized
          />
        ) : (
          <UserRound size={42} aria-hidden="true" />
        )}
      </span>
      <div>
        <input
          ref={input}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          aria-label="Choose profile photo"
          onChange={(e) => void upload(e)}
          disabled={pending}
        />
        <Button onClick={() => input.current?.click()} loading={pending}>
          <Camera size={16} aria-hidden="true" />
          {src ? "Change photo" : "Add a photo"}
        </Button>
        {src && (
          <Button
            variant="quiet"
            onClick={() => void remove()}
            disabled={pending}
          >
            Remove
          </Button>
        )}
        <p className="supporting-copy">
          PNG or JPG · up to 2 MB
          <br />
          Your photo is cropped to a square.
        </p>
      </div>
      <p role="status" className="avatar-feedback">
        {message}
      </p>
    </section>
  );
}
