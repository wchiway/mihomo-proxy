import { normalizeName, sortProxyNames, uniq } from "./utils";
import type {
  ClashConfig,
  CompiledRegion,
  Proxy,
  RegionGroup,
} from "./types";

// ============================================================
// 6. Classifier —— 节点处理与分类
// ============================================================

export const ensureConfigObject = (input: unknown): ClashConfig =>
  input && typeof input === "object" ? (input as ClashConfig) : {};

export const getOriginalProxies = (input: ClashConfig): Proxy[] =>
  Array.isArray(input.proxies) ? input.proxies : [];

/** 节点重名去冲突：追加 _1/_2… 后缀 */
export const makeProxyNamesUnique = (proxies: Proxy[] = []): void => {
  const used = new Set<string>();
  const nextIdx = new Map<string, number>();
  proxies.forEach((p) => {
    if (!p || !p.name) return;
    const base = String(p.name);
    if (!used.has(base)) {
      used.add(base);
      nextIdx.set(base, 1);
      return;
    }
    let idx = nextIdx.get(base) ?? 1;
    let candidate = `${base}_${idx}`;
    while (used.has(candidate)) candidate = `${base}_${++idx}`;
    p.name = candidate;
    used.add(candidate);
    nextIdx.set(base, idx + 1);
  });
};

/** 剔除自定义过滤器命中的节点 */
export const filterCustomProxies = (
  proxies: Proxy[] = [],
  customFilter: RegExp,
): Proxy[] =>
  proxies.filter(
    (proxy) => proxy && proxy.name && !customFilter.test(proxy.name),
  );

/** 分离「信息类节点」与「正常节点」 */
export const splitInfoAndNormalProxies = (
  proxies: Proxy[] = [],
  infoFilter: RegExp,
): { infoProxies: Proxy[]; normalProxies: Proxy[] } =>
  proxies.reduce(
    (acc, proxy) => {
      if (!proxy || !proxy.name) return acc;
      (infoFilter.test(proxy.name) ? acc.infoProxies : acc.normalProxies).push(
        proxy,
      );
      return acc;
    },
    { infoProxies: [] as Proxy[], normalProxies: [] as Proxy[] },
  );

export interface RegionClassification {
  activeRegions: RegionGroup[];
  activeRegionNameSet: Set<string>;
  activeRegionMap: Map<string, RegionGroup>;
  otherProxyNames: string[];
}

/**
 * 按地区分类，并对每个地区/Other 组内节点自动排序。
 * 单次遍历完成匹配（Plan 16：避免重复遍历）。
 */
export const classifyProxiesByRegion = (
  normalProxies: Proxy[] = [],
  regions: CompiledRegion[] = [],
): RegionClassification => {
  const regionData: RegionGroup[] = regions.map((r) => ({
    name: r.name,
    icon: r.icon,
    proxies: [],
  }));
  const regionMap = new Map(regionData.map((r) => [r.name, r]));
  const regionSeen = new Map(regionData.map((r) => [r.name, new Set<string>()]));
  const otherProxyNames: string[] = [];
  const otherSeen = new Set<string>();

  normalProxies.forEach((proxy) => {
    const proxyName = proxy.name;
    const normName = normalizeName(proxyName);
    const matched = regions.find((r) => r.regex.test(normName));
    if (matched) {
      const group = regionMap.get(matched.name);
      const seen = regionSeen.get(matched.name);
      if (group && seen && !seen.has(proxyName)) {
        group.proxies.push(proxyName);
        seen.add(proxyName);
      }
    } else if (!otherSeen.has(proxyName)) {
      otherProxyNames.push(proxyName);
      otherSeen.add(proxyName);
    }
  });

  const activeRegions = regionData
    .map((r) => ({ ...r, proxies: sortProxyNames(uniq(r.proxies)) }))
    .filter((r) => r.proxies.length > 0);

  return {
    activeRegions,
    activeRegionNameSet: new Set(activeRegions.map((r) => r.name)),
    activeRegionMap: new Map(activeRegions.map((r) => [r.name, r])),
    otherProxyNames: sortProxyNames(uniq(otherProxyNames)),
  };
};

/**
 * AI 专用节点池：优先排除香港（OpenAI 常封锁 HK 出口）。
 * 若排除后为空则回退全部节点。
 */
export const buildAllAiProxyList = (
  activeRegions: RegionGroup[] = [],
  otherProxyNames: string[] = [],
  allNames: string[] = [],
): string[] => {
  const nonHk = uniq([
    ...activeRegions.filter((r) => r.name !== "HK").flatMap((r) => r.proxies),
    ...otherProxyNames,
  ]);
  return nonHk.length ? nonHk : allNames;
};
