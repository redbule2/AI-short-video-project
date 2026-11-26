// 壳子自己的（不是照搬的）：旧项目用 axios 直接连服务器、自己带凭证；这里经桌面软件（window.desk.api）去问，凭证不进页面。
// 对外的样子照旧：http.request(方法, 地址, { params, data })，回的是服务器给的那一整份；连不上、状态码不对就抛错。
type Options = {
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: unknown;
  /** 要的是一张图（聊天里的图片）：回的是 { type, bytes }，不是服务器的那一整份 */
  binary?: boolean;
};

type DeskReply = { ok: boolean; status: number; data: unknown };

/** 抛出去的错长得像 axios 的：页面照 error.response.data.message 取话。 */
export function toHttpError(reply: DeskReply) {
  if (reply.status === 0) {
    return new Error("连不上服务器，看看网络");
  }
  return Object.assign(
    new Error(`Request failed with status code ${reply.status}`),
    { response: { status: reply.status, data: reply.data } }
  );
}

/** 要带的内容：一张图（FormData 里的 file）单独带；别的转成纯数据（响应式对象过不了桥）。 */
export async function toDeskOptions(options: Options = {}) {
  const send: Record<string, unknown> = {};
  if (options.params) {
    send.query = JSON.parse(JSON.stringify(options.params));
  }
  if (typeof FormData !== "undefined" && options.data instanceof FormData) {
    const file = options.data.get("file");
    if (file instanceof File) {
      send.file = {
        name: file.name,
        type: file.type,
        bytes: await file.arrayBuffer()
      };
    }
  } else if (options.data !== undefined) {
    send.body = JSON.parse(JSON.stringify(options.data));
  }
  if (options.binary) {
    send.binary = true;
  }
  return send;
}

async function request<T>(
  method: string,
  url: string,
  options?: Options
): Promise<T> {
  const desk = (window as unknown as { desk?: { api?: Function } }).desk;
  if (!desk?.api) {
    throw new Error("这一页要在桌面软件里打开");
  }
  const reply = (await desk.api(
    method,
    url,
    await toDeskOptions(options)
  )) as DeskReply;
  if (!reply.ok) {
    throw toHttpError(reply);
  }
  return reply.data as T;
}

export const http = {
  request,
  get: <T>(url: string, options?: Options) => request<T>("get", url, options),
  post: <T>(url: string, options?: Options) => request<T>("post", url, options)
};
