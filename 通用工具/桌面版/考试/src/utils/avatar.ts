// 壳子自己的（不是照搬的）：圆头像上写的字，「我的团队」和「消息」共用（2026-11-26）。
// 中文名取最后两个字（小王→小王，张三丰→三丰：一队人里姓重的多，名好认）；别的取头一个字母，大写；空的写「?」。
const HAN = /\p{Script=Han}/u;

export function avatarText(name: string | null | undefined) {
  const chars = [...String(name ?? "").trim()];
  if (chars.length === 0) return "?";
  const han = chars.filter(char => HAN.test(char));
  return han.length ? han.slice(-2).join("") : chars[0].toUpperCase();
}
