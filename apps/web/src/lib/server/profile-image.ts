import sharp from "sharp";
import { AVATAR_MAX_BYTES } from "@merkat/contracts";

/** Decode actual PNG/JPEG pixels, bound decompression, remove metadata and normalize. */
export async function normalizeAvatar(bytes: Uint8Array, mime: string) {
  if (!bytes.length || bytes.length > AVATAR_MAX_BYTES)
    throw new Error("INVALID_AVATAR");
  const png = Buffer.from(bytes.subarray(0, 8)).equals(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!((png && mime === "image/png") || (jpeg && mime === "image/jpeg")))
    throw new Error("INVALID_AVATAR");
  const image = sharp(bytes, {
    limitInputPixels: 20_000_000,
    failOn: "error",
    animated: false,
  });
  const metadata = await image.metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > 8192 ||
    metadata.height > 8192 ||
    (metadata.pages ?? 1) > 1
  )
    throw new Error("INVALID_AVATAR");
  return image
    .rotate()
    .resize(512, 512, { fit: "cover" })
    .flatten({ background: "#f6f5f1" })
    .jpeg({ quality: 85 })
    .toBuffer();
}
