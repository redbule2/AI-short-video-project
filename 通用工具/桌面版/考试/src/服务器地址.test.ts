// 壳子自己的（不是照搬的）：服务器地址只问壳子（utils/http 的 serverOrigin）。
// 旧网站页面和服务器同一个地址，照搬来的代码爱拿 location.origin 当服务器；这里页面是本机服务开的，那样写就指到本机流水线去了（2026-11-27 AI 阅卷提示词错过一回）。
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serverOrigin } from "@/utils/http";

const SRC = fileURLToPath(new URL(".", import.meta.url));
/** serverOrigin 自己要拿页面的地址来比，只有它能碰 */
const ALLOWED = [join("utils", "http", "index.ts")];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(ts|vue)$/.test(entry.name) && !entry.name.endsWith(".test.ts")
      ? [file]
      : [];
  });
}

function inDesk(api: unknown) {
  vi.stubGlobal("window", {
    desk: { info: async () => ({ api }) },
    location: { origin: "http://127.0.0.1:8766" }
  });
}

describe("服务器地址", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("用壳子说的服务器，去掉末尾的斜杠", async () => {
    inDesk("http://43.143.83.166/");
    await expect(serverOrigin()).resolves.toBe("http://43.143.83.166");
  });

  it("服务器地址带路径的，路径留着", async () => {
    inDesk("https://v8.example.com:8443/v8/");
    await expect(serverOrigin()).resolves.toBe("https://v8.example.com:8443/v8");
  });

  it("试验时服务器也在本机、换了个端口：照用", async () => {
    inDesk("http://127.0.0.1:18700");
    await expect(serverOrigin()).resolves.toBe("http://127.0.0.1:18700");
  });

  it("壳子说的就是页面自己：不认", async () => {
    inDesk("http://127.0.0.1:8766");
    await expect(serverOrigin()).rejects.toThrow("没问到服务器地址");
  });

  it("页面源码里不拿 location 当服务器地址（只许当 postMessage 的收信地址）", () => {
    const bad = sourceFiles(SRC)
      .filter(file => !ALLOWED.includes(relative(SRC, file)))
      .filter(file => {
        const code = readFileSync(file, "utf8").replace(
          /\.postMessage\([^;]*?location\.origin/g,
          ""
        );
        return /location\.(origin|host)/.test(code);
      })
      .map(file => relative(SRC, file));
    expect(bad, "要写服务器地址，用 utils/http 的 serverOrigin()").toEqual([]);
  });
});
