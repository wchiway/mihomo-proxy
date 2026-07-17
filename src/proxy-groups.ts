import { SETTINGS } from "./settings";
import { uniq } from "./utils";
import type { ProxyGroup, RegionGroup } from "./types";

// ============================================================
// 7. ProxyBuilder —— 策略组生成
// ============================================================

export interface ProxyGroupsInput {
  allNames: string[];
  allAiNames: string[];
  activeRegionMap: Map<string, RegionGroup>;
  activeRegionNameSet: Set<string>;
  otherProxyNames: string[];
  infoNames: string[];
}

export const buildProxyGroups = ({
  allNames,
  allAiNames,
  activeRegionMap,
  activeRegionNameSet,
  otherProxyNames,
  infoNames,
}: ProxyGroupsInput): ProxyGroup[] => {
  const groups: ProxyGroup[] = [];
  const add = (
    name: string,
    type: string,
    proxies: string[],
    icon = "Available.png",
    extra: Record<string, any> = {},
  ) => {
    proxies = uniq(proxies);
    if (name && proxies.length)
      groups.push({
        name,
        type,
        proxies,
        icon: SETTINGS.ICON_BASE + icon,
        ...extra,
      });
  };

  // 按既定顺序取出「有节点」的地区
  const regionEntries = SETTINGS.REGION_ORDER.filter((r) =>
    activeRegionNameSet.has(r),
  );
  const hasOther = otherProxyNames.length > 0;
  const hasNodes = allNames.length > 0;

  // ---- 主选择组 & 全量组 ----
  if (hasNodes) {
    const mainEntries = [
      "All",
      ...regionEntries,
      ...(hasOther ? ["Other"] : []),
    ];
    add("main", "select", mainEntries, "Available.png");
    add(
      "URL Test - All",
      "url-test",
      allNames,
      "Auto.png",
      SETTINGS.URL_TEST_EXTRA,
    );
    add("All", "select", ["URL Test - All", ...allNames], "Auto.png");
  }

  // ---- 地区组（每地区一个 url-test + 一个 select） ----
  regionEntries.forEach((rName) => {
    const region = activeRegionMap.get(rName);
    if (!region) return;
    add(
      `URL Test - ${region.name}`,
      "url-test",
      region.proxies,
      region.icon,
      SETTINGS.URL_TEST_EXTRA,
    );
    add(
      region.name,
      "select",
      [`URL Test - ${region.name}`, ...region.proxies],
      region.icon,
    );
  });

  // ---- Other / info ----
  if (hasOther) {
    add(
      "URL Test - Other",
      "url-test",
      otherProxyNames,
      "Available.png",
      SETTINGS.URL_TEST_EXTRA,
    );
    add(
      "Other",
      "select",
      ["URL Test - Other", ...otherProxyNames],
      "Available.png",
    );
  }
  if (infoNames.length) add("info", "select", infoNames, "Available.png");

  // ---- 服务策略组（依赖节点存在） ----
  if (hasNodes) {
    // 代理优先型成员：main → All → 各地区 → Other
    const proxyFirst = [
      "main",
      "All",
      ...regionEntries,
      ...(hasOther ? ["Other"] : []),
    ];
    // 需在本地/直连间可切换的服务：附加 DIRECT 选项
    const withDirect = [...proxyFirst, "DIRECT"];

    // AI：非香港优先 + 自动测速子组
    const aiRegions = regionEntries.filter((r) => r !== "HK");
    add(
      "URL Test - AI",
      "url-test",
      allAiNames,
      "ChatGPT.png",
      SETTINGS.URL_TEST_EXTRA,
    );
    add(
      "AI",
      "select",
      ["URL Test - AI", ...aiRegions, "main", ...(hasOther ? ["Other"] : [])],
      "ChatGPT.png",
    );

    // Google / YouTube（YouTube 可复用 Google 出口）
    add("Google", "select", proxyFirst, "Google_Search.png");
    add("YouTube", "select", ["Google", ...proxyFirst], "YouTube.png");

    // Telegram（新加坡优先，附 fallback 自愈）
    const hasSG = activeRegionNameSet.has("SG");
    add(
      "Telegram - Fallback",
      "fallback",
      hasSG ? ["SG", "main"] : ["main"],
      "Telegram.png",
      SETTINGS.FALLBACK_TEST_EXTRA,
    );
    add(
      "Telegram",
      "select",
      ["Telegram - Fallback", ...(hasSG ? ["SG"] : []), ...proxyFirst],
      "Telegram.png",
    );

    // Steam / Apple / Microsoft：默认走代理，可选 DIRECT
    add("Steam", "select", withDirect, "Steam.png");
    add("Apple", "select", withDirect, "Apple.png");
    add("Microsoft", "select", withDirect, "Microsoft.png");
  } else {
    // 零节点回退：规则出口引用的业务组必须始终存在（对齐极简版
    // 「全部」组的处理），否则空订阅/拉取失败时内核 -t 直接报错
    const fallbackGroups: Array<[string, string]> = [
      ["main", "Available.png"],
      ["AI", "ChatGPT.png"],
      ["Google", "Google_Search.png"],
      ["YouTube", "YouTube.png"],
      ["Telegram", "Telegram.png"],
      ["Steam", "Steam.png"],
      ["Apple", "Apple.png"],
      ["Microsoft", "Microsoft.png"],
    ];
    fallbackGroups.forEach(([name, icon]) =>
      add(name, "select", ["DIRECT"], icon),
    );
  }

  // ---- GLOBAL 全局入口（汇总所有组） ----
  add(
    "GLOBAL",
    "select",
    [
      ...(hasNodes
        ? [
            "main",
            "All",
            "AI",
            "Google",
            "YouTube",
            "Telegram",
            "Steam",
            "Apple",
            "Microsoft",
          ]
        : []),
      ...regionEntries,
      ...(hasOther ? ["Other"] : []),
      ...(infoNames.length ? ["info"] : []),
      "DIRECT",
    ],
    "Global.png",
  );

  return groups;
};
