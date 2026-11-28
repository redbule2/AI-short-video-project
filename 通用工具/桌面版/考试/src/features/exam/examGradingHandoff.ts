import { createExamGradingGrant } from "@/api/exam";
import { serverOrigin } from "@/utils/http";

const activePreparations = new Map<
  string,
  Promise<{ prompt: string; expiresAt: string }>
>();

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, "");
}

/**
 * 生成只允许处理一份答卷的外部 AI 阅卷提示词。
 * 其中的临时授权码只能调用两个专用端点，10 分钟后由服务端强制失效。
 */
export function buildExamGradingPrompt(
  sheetId: string,
  baseUrl: string,
  grantCode: string,
  expiresAt: string
) {
  const normalizedSheetId = sheetId.trim();
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);
  const detailUrl = `${normalizedBaseUrl}/api/exam/grading/grant/sheets/${encodeURIComponent(normalizedSheetId)}`;
  const submitUrl = `${normalizedBaseUrl}/api/exam/grading/grant/submit`;

  return `你是 NEW VIDEO8 考试阅卷 AI。请只通过 HTTP API 对下面这份唯一答卷评分；不要控制浏览器，也不要根据试卷标题、考生姓名或交卷时间猜测目标。

Base URL: ${normalizedBaseUrl}
目标 sheetId: ${normalizedSheetId}

本次单答卷临时授权：
X-Exam-Grading-Grant: ${grantCode}
过期时间: ${expiresAt}

授权边界：
- 该临时授权只允许调用下方两个阅卷专用接口，且只绑定 sheetId=${normalizedSheetId}。
- 每次请求都必须携带上面的 X-Exam-Grading-Grant 请求头；不得把授权码改用于站点其他接口。
- 若接口提示授权无效、过期或答卷不匹配，立即停止并让用户在 NEW VIDEO8 中重新点击“生成并复制授权提示词”；不要索取账号、密码或其他凭证。

执行步骤：
1. GET ${detailUrl}
   请求头：X-Exam-Grading-Grant: ${grantCode}
2. 检查统一响应的 success === true，且 data.sheetId 必须严格等于“${normalizedSheetId}”；不相等立即停止，禁止写回。
3. 只挑选 data.items 中 gradedBy === null、earnedScore === null、studentAnswer 非空，且 type 属于 fillBlank / essay / practical 的待判题。single / multiple / judge 是系统客观题，禁止改分。
4. 逐题依据 stem、stemImages、correctAnswer、analysis、score、studentAnswer 评分。实操题图片 URL 若为相对路径，前面拼接 Base URL 后读取。每题给整数分，范围 0 到该题 score，并写一条面向考生、说明得失分依据的简洁 comment。
5. 仅当存在待判题时，POST ${submitUrl}
   请求头：
   X-Exam-Grading-Grant: ${grantCode}
   Content-Type: application/json
   请求体：
{
  "sheetId": "${normalizedSheetId}",
  "items": [
    {
      "questionId": "<必须原样使用该答卷返回的 questionId>",
      "score": "<整数>",
      "comment": "<评分依据>"
    }
  ]
}
6. 检查写回响应 success === true，报告 data.status、data.totalScore、data.remainingCount。若仍有待判题，继续只处理同一 sheetId；若没有待判题，停止并说明该答卷无需评分或已完成评分。

严格限制：
- 只处理 sheetId=${normalizedSheetId}，不得处理任何其他答卷。
- 不得编造或替换 sheetId、questionId，不得修改客观题，不得在无法精确匹配时写回。`;
}

/**
 * 消费者:ExamGradingHandoff 显式点击。
 * 页面进入=0 请求；每次点击=1 POST；同一答卷的重叠点击合并为 1 个在途请求。
 * 提示词里的服务器地址只问壳子（serverOrigin），不收调用方传的：页面自己的地址是本机服务，写进去 AI 就找错门。
 * 地址问不到就停在这里，不签发授权。
 */
export function prepareExamGradingPrompt(sheetId: string) {
  const normalizedSheetId = sheetId.trim();
  const inFlight = activePreparations.get(normalizedSheetId);
  if (inFlight) return inFlight;

  const preparation = (async () => {
    const baseUrl = await serverOrigin();
    const grant = await createExamGradingGrant(normalizedSheetId);
    if (grant.sheetId !== normalizedSheetId) {
      throw new Error("临时授权返回的答卷 ID 不匹配，已停止复制。");
    }
    if (!grant.grantCode?.trim()) {
      throw new Error("临时授权生成失败，请重试。");
    }

    return {
      prompt: buildExamGradingPrompt(
        normalizedSheetId,
        baseUrl,
        grant.grantCode,
        grant.expiresAt
      ),
      expiresAt: grant.expiresAt
    };
  })().finally(() => {
    activePreparations.delete(normalizedSheetId);
  });

  activePreparations.set(normalizedSheetId, preparation);
  return preparation;
}
