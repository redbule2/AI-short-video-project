// 壳子自己的（不是照搬的）：后台回的都是 { success, message, data }；没成就把后台的话抛出去。「我的团队」「消息」两份接口共用。
export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T | null;
}

export function unwrap<T>(response: ApiResponse<T>) {
  if (!response.success) {
    throw new Error(response.message || "请求失败");
  }

  return response.data as T;
}
