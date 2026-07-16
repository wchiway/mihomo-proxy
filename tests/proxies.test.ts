import { describe, expect, it } from "vitest";
import {
  buildAllAiProxyList,
  classifyProxiesByRegion,
  makeProxyNamesUnique,
  splitInfoAndNormalProxies,
} from "../src/proxies";
import { REGIONS } from "../src/regions";
import { SETTINGS } from "../src/settings";
import type { Proxy } from "../src/types";

const p = (name: string): Proxy => ({ name });

describe("makeProxyNamesUnique", () => {
  it("重名追加 _1/_2 后缀", () => {
    const proxies = [p("节点"), p("节点"), p("节点")];
    makeProxyNamesUnique(proxies);
    expect(proxies.map((x) => x.name)).toEqual(["节点", "节点_1", "节点_2"]);
  });
  it("后缀与既有名冲突时继续递增", () => {
    const proxies = [p("A"), p("A_1"), p("A")];
    makeProxyNamesUnique(proxies);
    expect(new Set(proxies.map((x) => x.name)).size).toBe(3);
  });
});

describe("splitInfoAndNormalProxies", () => {
  it("信息类节点按 INFO_FILTER 分离", () => {
    const { infoProxies, normalProxies } = splitInfoAndNormalProxies(
      [p("剩余流量：10G"), p("官网 example.com"), p("🇭🇰 香港 01")],
      SETTINGS.INFO_FILTER,
    );
    expect(infoProxies.map((x) => x.name)).toEqual([
      "剩余流量：10G",
      "官网 example.com",
    ]);
    expect(normalProxies.map((x) => x.name)).toEqual(["🇭🇰 香港 01"]);
  });
});

describe("classifyProxiesByRegion", () => {
  const proxies = [
    p("🇭🇰 香港 IEPL"),
    p("JP 东京 01"),
    p("Frankfurt 德国"),
    p("神秘节点 X"),
    p("🇭🇰 香港 IEPL"), // 重复名（上游已去重场景外的防御）
  ];
  const result = classifyProxiesByRegion(proxies, REGIONS);

  it("按地区归组", () => {
    expect(result.activeRegionNameSet.has("HK")).toBe(true);
    expect(result.activeRegionNameSet.has("JP")).toBe(true);
    expect(result.activeRegionNameSet.has("EU")).toBe(true);
    expect(result.activeRegionMap.get("HK")!.proxies).toEqual(["🇭🇰 香港 IEPL"]);
  });
  it("未匹配节点进 Other", () => {
    expect(result.otherProxyNames).toEqual(["神秘节点 X"]);
  });
  it("无节点地区不出现", () => {
    expect(result.activeRegionNameSet.has("US")).toBe(false);
  });
});

describe("buildAllAiProxyList", () => {
  const regions = [
    { name: "HK", icon: "", proxies: ["hk1", "hk2"] },
    { name: "JP", icon: "", proxies: ["jp1"] },
  ];
  it("排除 HK 地区节点", () => {
    expect(buildAllAiProxyList(regions, ["other1"], ["hk1", "hk2", "jp1", "other1"])).toEqual([
      "jp1",
      "other1",
    ]);
  });
  it("仅有 HK 时回退全部节点", () => {
    expect(buildAllAiProxyList([regions[0]], [], ["hk1", "hk2"])).toEqual([
      "hk1",
      "hk2",
    ]);
  });
});
