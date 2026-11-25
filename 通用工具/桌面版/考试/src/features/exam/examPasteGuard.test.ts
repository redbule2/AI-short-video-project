import { describe, expect, it } from "vitest";
import { isPastedInputType, noPasteHintText } from "./pasteGuard";

describe("卷首规则措辞", () => {
  it("只讲本卷真有的题型(填空与简答都在禁止之列)", () => {
    expect(noPasteHintText(["single", "fillBlank"])).toBe(
      "填空不能粘贴,请自己键入。"
    );
    expect(noPasteHintText(["essay", "practical"])).toBe(
      "简答不能粘贴,请自己键入。"
    );
    expect(noPasteHintText(["fillBlank", "judge", "essay"])).toBe(
      "填空与简答都不能粘贴,请自己键入。"
    );
  });

  it("整卷都是客观题时一个字都不说(纯噪音)", () => {
    expect(noPasteHintText(["single", "multiple", "judge", "practical"])).toBe(
      ""
    );
    expect(noPasteHintText([])).toBe("");
  });
});

describe("搬运动作判定", () => {
  it("粘贴/拖入被判定为搬运,拦下", () => {
    expect(isPastedInputType("insertFromPaste")).toBe(true);
    expect(isPastedInputType("insertFromPasteAsQuotation")).toBe(true);
    expect(isPastedInputType("insertFromDrop")).toBe(true);
    expect(isPastedInputType("insertFromYank")).toBe(true);
  });

  it("逐字输入/中文输入法/手机纠错一律放行(拦了就打不出字)", () => {
    expect(isPastedInputType("insertText")).toBe(false);
    expect(isPastedInputType("insertCompositionText")).toBe(false);
    expect(isPastedInputType("insertReplacementText")).toBe(false);
    expect(isPastedInputType("deleteContentBackward")).toBe(false);
    expect(isPastedInputType(undefined)).toBe(false);
  });
});
