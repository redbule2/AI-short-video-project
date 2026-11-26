// 壳子自己的（不是照搬的）：「我的团队」的接口——成员、部门、谁在哪个部门。
// 后台在 new-video8-8 的 CollaborationTeamController（2026-11-26 加的）；团队由后台按登录的人认，这里不传团队。
import { http } from "@/utils/http";
import { unwrap, type ApiResponse } from "./reply";

export type TeamRole = "owner" | "sub";
export type TeamMemberStatus = "active" | "disabled";

export interface TeamDepartment {
  id: string;
  name: string;
  /** 上级部门；null 是顶层 */
  parentId: string | null;
  sort: number;
}

export interface TeamMember {
  username: string;
  displayName: string;
  role: TeamRole;
  /** 停用的人只有负责人看得到 */
  status: TeamMemberStatus;
  /** 所在部门；null 是还没分部门 */
  departmentId: string | null;
  title: string;
}

export interface TeamOverview {
  ownerUsername: string;
  teamName: string;
  currentUsername: string;
  /** 能不能调整组织架构：只有团队负责人能 */
  canManage: boolean;
  departments: TeamDepartment[];
  members: TeamMember[];
}

export interface SaveTeamDepartment {
  name: string;
  parentId: string | null;
}

export interface SaveTeamMemberPlacement {
  departmentId: string | null;
  title: string;
}

const TEAM = "/api/collaboration/team";

export async function getTeamOverview() {
  const response = await http.request<ApiResponse<TeamOverview>>("get", TEAM);
  return unwrap(response);
}

export async function createTeamDepartment(data: SaveTeamDepartment) {
  const response = await http.request<ApiResponse<TeamDepartment>>(
    "post",
    `${TEAM}/departments`,
    { data }
  );
  return unwrap(response);
}

export async function updateTeamDepartment(
  departmentId: string,
  data: SaveTeamDepartment
) {
  const response = await http.request<ApiResponse<TeamDepartment>>(
    "put",
    `${TEAM}/departments/${encodeURIComponent(departmentId)}`,
    { data }
  );
  return unwrap(response);
}

export async function deleteTeamDepartment(departmentId: string) {
  const response = await http.request<ApiResponse<boolean>>(
    "delete",
    `${TEAM}/departments/${encodeURIComponent(departmentId)}`
  );
  return unwrap(response);
}

export async function saveTeamMemberPlacement(
  username: string,
  data: SaveTeamMemberPlacement
) {
  const response = await http.request<ApiResponse<TeamMember>>(
    "put",
    `${TEAM}/members/${encodeURIComponent(username)}/placement`,
    { data }
  );
  return unwrap(response);
}
