import { describe, expect, it } from "vitest";
import {
  buildRegex,
  lineRank,
  normalizeName,
  parseLineType,
  parseMultiplier,
  sortProxyNames,
  uniq,
} from "../src/utils";

describe("uniq", () => {
  it("去重并剔除 falsy", () => {
    expect(uniq(["a", "b", "a", "", undefined as any, "b"])).toEqual(["a", "b"]);
  });
});

describe("parseMultiplier", () => {
  it.each([
    ["0.2x 香港", 0.2],
    ["日本 1倍", 1],
    ["美国 2X", 2],
    ["新加坡 3×", 3],
    ["无标注节点", 1],
    ["异常 200x", 1], // 超出 (0,100) 范围回退 1
    ["0x 零倍", 1], // 0 不合法
  ])("%s → %d", (name, expected) => {
    expect(parseMultiplier(name)).toBe(expected);
  });
});

describe("normalizeName", () => {
  it("国旗 emoji 转地区 token", () => {
    expect(normalizeName("🇭🇰 节点01")).toContain("HK");
    expect(normalizeName("🇩🇪 法兰克福")).toContain("EU");
    expect(normalizeName("🇻🇳 越南")).toContain("AS");
  });
  it("分隔符统一为空格且大写", () => {
    expect(normalizeName("jp[东京]-01_pro")).toBe("JP 东京 01 PRO");
  });
  it("IEPL 等关键词两侧补空格，避免粘连", () => {
    expect(normalizeName("HKIEPL01")).toContain(" IEPL ");
  });
});

describe("buildRegex 词边界", () => {
  const re = buildRegex(["US", "USA", "美国"]);
  it("US 命中独立 token", () => {
    expect(re.test(normalizeName("US 01"))).toBe(true);
    expect(re.test(normalizeName("🇺🇸 洛杉矶"))).toBe(true);
  });
  it("US 不误伤 PLUS", () => {
    expect(re.test(normalizeName("PLUS 套餐节点"))).toBe(false);
  });
  it("中文关键词直接匹配", () => {
    expect(re.test(normalizeName("美国 高速"))).toBe(true);
  });
});

describe("parseLineType / lineRank", () => {
  it("识别专线与家宽", () => {
    expect(parseLineType("HK IEPL 01")).toBe("IEPL");
    expect(parseLineType("JP 家宽 原生")).toBe("HOME");
    expect(parseLineType("普通节点")).toBe("");
  });
  it("专线 > BGP > 其他", () => {
    expect(lineRank("IEPL")).toBeLessThan(lineRank("BGP"));
    expect(lineRank("BGP")).toBeLessThan(lineRank(""));
    expect(lineRank("GAME")).toBe(2);
  });
});

describe("sortProxyNames", () => {
  it("线路质量 → 倍率升序 → 名称", () => {
    const sorted = sortProxyNames([
      "香港 普通 2x",
      "香港 IEPL 1x",
      "香港 BGP 0.5x",
      "香港 普通 0.2x",
      "香港 IEPL 0.5x",
    ]);
    expect(sorted).toEqual([
      "香港 IEPL 0.5x",
      "香港 IEPL 1x",
      "香港 BGP 0.5x",
      "香港 普通 0.2x",
      "香港 普通 2x",
    ]);
  });
  it("不改变原数组", () => {
    const input = ["b", "a"];
    sortProxyNames(input);
    expect(input).toEqual(["b", "a"]);
  });
});
