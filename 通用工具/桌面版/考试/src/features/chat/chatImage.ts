// 壳子自己的（不是照搬的）：「消息」里的图片（2026-11-26）。
// 发之前：认类型、量大小，大的缩到长边 1600 存成 webp（动图原样发）；
// 看的时候：经壳子拿回图本身，做成本页的地址记下，同一张不拿第二回（最多记 300 张，最久没看的先丢）。
import { getChatImage, type ChatImageData } from "@/api/chat";
import {
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  fitSide,
  needsShrink
} from "./chatModel";

export interface PreparedImage {
  file: File;
  width: number;
  height: number;
  /** 发出去之前、发出去以后，本页先用这一份摆出来 */
  url: string;
}

export const TYPE_MESSAGE = "只能发 png、jpg、webp、gif 图片。";
export const SIZE_MESSAGE = "图片要在 10MB 以内。";

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error(TYPE_MESSAGE);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("这张图打不开，换一张试试。");
  });
  try {
    const { width, height } = bitmap;
    if (!needsShrink(file.type, file.size, width, height)) {
      if (file.size > IMAGE_MAX_BYTES) throw new Error(SIZE_MESSAGE);
      return { file, width, height, url: URL.createObjectURL(file) };
    }
    const size = fitSide(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>(done => canvas.toBlob(done, "image/webp", 0.86));
    if (!blob) throw new Error("这张图转不过来，换一张试试。");
    if (blob.size > IMAGE_MAX_BYTES) throw new Error(SIZE_MESSAGE);
    const name = `${(file.name || "图片").replace(/\.[^.]*$/, "")}.webp`;
    const out = new File([blob], name, { type: "image/webp" });
    return { file: out, width: size.width, height: size.height, url: URL.createObjectURL(out) };
  } finally {
    bitmap.close();
  }
}

const MAX_KEPT = 300;
const kept = new Map<string, Promise<string>>();

/** 一张图在本页的地址：拿过的直接给；没拿过的经壳子拿一回 */
export function imageUrl(
  messageId: string,
  fetch: (id: string) => Promise<ChatImageData> = getChatImage
) {
  const old = kept.get(messageId);
  if (old) {
    kept.delete(messageId); // 挪到最后：最近看过
    kept.set(messageId, old);
    return old;
  }
  const url = fetch(messageId).then(data =>
    URL.createObjectURL(new Blob([data.bytes], { type: data.type || "image/png" }))
  );
  url.catch(() => kept.delete(messageId)); // 没拿到：下回再拿
  kept.set(messageId, url);
  while (kept.size > MAX_KEPT) {
    const [first, drop] = kept.entries().next().value!;
    kept.delete(first);
    drop.then(URL.revokeObjectURL, () => {});
  }
  return url;
}

/** 自己刚发的图：服务器回了编号，本机那一份接着用，不用再拿 */
export function keepImage(messageId: string, url: string) {
  kept.set(messageId, Promise.resolve(url));
}
