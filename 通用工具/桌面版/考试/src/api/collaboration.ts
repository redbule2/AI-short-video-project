import { http } from "@/utils/http";

export type AccountRole = "owner" | "sub";
export type AccountStatus = "active" | "disabled";

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T | null;
}

export interface TeamAccount {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  status: AccountStatus;
  lastActive: string;
  permissionNote: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface CollaborationWorkspace {
  accounts: TeamAccount[];
  stats: {
    total: number;
    subTotal: number;
    disabledTotal: number;
  };
  currentUsername: string;
  ownerUsername: string;
  accountType: AccountRole;
  canManageAccounts: boolean;
}

export interface CreateSubAccountRequest {
  displayName: string;
  username: string;
  password: string;
}

export interface ResetSubAccountPasswordResult {
  username: string;
  password: string;
}

function unwrap<T>(response: ApiResponse<T>) {
  if (!response.success) {
    throw new Error(response.message || "请求失败");
  }

  return response.data as T;
}

export function getCollaborationErrorMessage(error: unknown) {
  const responseData = (
    error as {
      response?: {
        data?: {
          message?: string;
        };
      };
    }
  )?.response?.data;

  if (responseData?.message) {
    return responseData.message;
  }

  return error instanceof Error ? error.message : "请求失败";
}

export async function getCollaborationWorkspace() {
  const response = await http.request<ApiResponse<CollaborationWorkspace>>(
    "get",
    "/api/collaboration/accounts"
  );
  return unwrap(response);
}

export async function createSubAccount(data: CreateSubAccountRequest) {
  const response = await http.request<ApiResponse<TeamAccount>>(
    "post",
    "/api/collaboration/accounts",
    { data }
  );
  return unwrap(response);
}

export async function updateSubAccountStatus(
  username: string,
  status: AccountStatus
) {
  const response = await http.request<ApiResponse<TeamAccount>>(
    "patch",
    `/api/collaboration/accounts/${encodeURIComponent(username)}/status`,
    { data: { status } }
  );
  return unwrap(response);
}

export async function resetSubAccountPassword(username: string) {
  const response = await http.request<ApiResponse<ResetSubAccountPasswordResult>>(
    "post",
    `/api/collaboration/accounts/${encodeURIComponent(username)}/reset-password`,
    { data: {} }
  );
  return unwrap(response);
}

export async function removeSubAccount(username: string) {
  const response = await http.request<ApiResponse<boolean>>(
    "delete",
    `/api/collaboration/accounts/${encodeURIComponent(username)}`
  );
  return unwrap(response);
}
