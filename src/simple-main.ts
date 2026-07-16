import { CUSTOM_FILTER } from "./user-config";
import { SETTINGS } from "./settings";
import { sortProxyNames, uniq } from "./utils";
import { buildRuleProviders } from "./rule-providers";
import {
  buildStaticRules,
  mergeRules,
  pickDirectRules,
  type RuleTargets,
} from "./rules";
import { makeProxyNamesUnique } from "./proxies";
import { applyDns } from "./dns";
import { applyRuntime, applySniffer, applyTun } from "./runtime";
import type { ClashConfig, Proxy, ProxyGroup } from "./types";

// ============================================================
// simple-mihomo —— 极简业务分流版
// ------------------------------------------------------------
// mihomo-proxy 的极简姊妹版：保留全部业务分流与 DNS/TUN 优化
// （规则骨架、规则集、DNS、Runtime 与完整版共享同一份源码模块），
// 但策略组只有三个，节点不做地区分组，简洁好理解：
//
//   全部     —— 所有节点（内置自动测速，默认自动选优）
//   AI       —— 可访问 AI 服务的纯净节点（自动剔除香港，OpenAI 等封锁 HK 出口）
//   广告拦截 —— REJECT（默认拦截）/ DIRECT / 全部 三选一
// ============================================================

/** 三个策略组的名称（规则出口统一引用这里，避免魔法字符串） */
const GROUPS = {
  ALL: "全部",
  AI: "AI",
  ADBLOCK: "广告拦截",
};

/** 香港节点识别（AI 组需剔除，OpenAI/Claude 等常封锁 HK 出口） */
const HK_FILTER = /香港|HK|HKG|HONGKONG|HONG KONG|🇭🇰/i;

/** 极简版分流出口：广告独立成组可切换，其余全部收敛到「全部/AI」 */
const SIMPLE_RULE_TARGETS: RuleTargets = {
  adblock: GROUPS.ADBLOCK,
  ai: GROUPS.AI,
  google: GROUPS.ALL,
  youtube: GROUPS.ALL,
  telegram: GROUPS.ALL,
  steam: GROUPS.ALL,
  apple: GROUPS.ALL,
  microsoft: GROUPS.ALL,
  proxy: GROUPS.ALL,
};

const STATIC_RULES = buildStaticRules(SIMPLE_RULE_TARGETS);

// ============================================================
// Proxies —— 节点处理（去重 → 过滤 → 分池）
// ============================================================

/**
 * 从订阅节点得到两个节点池：
 *   allNames —— 全部可用节点（剔除自定义过滤与信息类节点）
 *   aiNames  —— AI 纯净池（在 allNames 基础上剔除香港；全被剔则回退 allNames）
 */
const buildProxyPools = (
  proxies: Proxy[] = [],
): { allNames: string[]; aiNames: string[] } => {
  const usable = proxies.filter(
    (p) =>
      p &&
      p.name &&
      !CUSTOM_FILTER.test(p.name) &&
      !SETTINGS.INFO_FILTER.test(p.name),
  );
  const allNames = sortProxyNames(uniq(usable.map((p) => p.name)));
  const nonHk = allNames.filter((n) => !HK_FILTER.test(n));
  return { allNames, aiNames: nonHk.length ? nonHk : allNames };
};

// ============================================================
// ProxyGroups —— 仅三个策略组：全部 / AI / 广告拦截
// ============================================================

const buildSimpleProxyGroups = ({
  allNames,
  aiNames,
}: {
  allNames: string[];
  aiNames: string[];
}): ProxyGroup[] => {
  const icon = (f: string) => SETTINGS.ICON_BASE + f;
  const groups: ProxyGroup[] = [];

  // 全部：自动测速打头（默认选它即自动选优），后跟所有节点可手动切换。
  // 无节点时回退 DIRECT，保证规则引用的组始终存在（配置不报错）。
  if (allNames.length) {
    groups.push({
      name: "自动测速",
      type: "url-test",
      proxies: allNames,
      icon: icon("Auto.png"),
      ...SETTINGS.URL_TEST_EXTRA,
    });
    groups.push({
      name: GROUPS.ALL,
      type: "select",
      proxies: ["自动测速", ...allNames],
      icon: icon("Global.png"),
    });
  } else {
    groups.push({
      name: GROUPS.ALL,
      type: "select",
      proxies: ["DIRECT"],
      icon: icon("Global.png"),
    });
  }

  // AI：纯净节点池（已剔除香港），同样自动测速打头
  if (aiNames.length) {
    groups.push({
      name: "AI 自动测速",
      type: "url-test",
      proxies: aiNames,
      icon: icon("ChatGPT.png"),
      ...SETTINGS.URL_TEST_EXTRA,
    });
    groups.push({
      name: GROUPS.AI,
      type: "select",
      proxies: ["AI 自动测速", ...aiNames],
      icon: icon("ChatGPT.png"),
    });
  } else {
    groups.push({
      name: GROUPS.AI,
      type: "select",
      proxies: [GROUPS.ALL],
      icon: icon("ChatGPT.png"),
    });
  }

  // 广告拦截：默认 REJECT；误杀时可切 DIRECT（直连放行）或 全部（代理放行）
  groups.push({
    name: GROUPS.ADBLOCK,
    type: "select",
    proxies: ["REJECT", "DIRECT", GROUPS.ALL],
    icon: icon("AdBlack.png"),
  });

  return groups;
};

// ============================================================
// Main
// ============================================================

export function simpleMain(config: ClashConfig): ClashConfig {
  config = config && typeof config === "object" ? config : {};
  const originalProxies: Proxy[] = Array.isArray(config.proxies)
    ? config.proxies
    : [];
  const existingRules: string[] = Array.isArray(config.rules)
    ? config.rules
    : [];

  // 清理旧版 geodata 字段（统一走 rule-providers）
  delete config["geodata-mode"];
  delete config["geo-auto-update"];
  delete config["geo-update-interval"];
  delete config["geox-url"];

  config["rule-providers"] = {
    ...(config["rule-providers"] || {}),
    ...buildRuleProviders(),
  };
  config.rules = mergeRules(STATIC_RULES, pickDirectRules(existingRules));

  makeProxyNamesUnique(originalProxies);
  config["proxy-groups"] = buildSimpleProxyGroups(
    buildProxyPools(originalProxies),
  );
  if (originalProxies.length) config.proxies = originalProxies;

  applyRuntime(config);
  applySniffer(config);
  applyTun(config);
  applyDns(config);

  return config;
}
