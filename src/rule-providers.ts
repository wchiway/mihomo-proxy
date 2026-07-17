import { SETTINGS } from "./settings";

// ============================================================
// 4. RuleProviders —— 规则集（逻辑 key ↔ 远端文件名解耦）
// ------------------------------------------------------------
// 关键设计：MetaCubeX 仓库中不存在 microsoft-cn / steam-cn，
// 真实文件为 microsoft@cn / steam@cn。这里 key 用文件系统/引用友好的
// 安全名（供 rule-providers 键、rules 引用、nameserver-policy 使用），
// file 用远端真实文件名（供拼 URL）。既满足 Plan 命名，又保证不 404。
// ============================================================

interface ProviderEntry {
  key: string;
  file: string;
}

/** GeoSite 域名类规则集：{ key: 内部逻辑名, file: 远端文件名 } */
const GEOSITE_PROVIDERS: ProviderEntry[] = [
  { key: "category-ads-all", file: "category-ads-all" }, // 广告拦截
  { key: "private", file: "private" },
  { key: "cn", file: "cn" },
  { key: "google", file: "google" },
  { key: "google-cn", file: "google-cn" },
  { key: "googlefcm", file: "googlefcm" },
  { key: "youtube", file: "youtube" },
  { key: "apple", file: "apple" },
  { key: "apple-cn", file: "apple-cn" },
  { key: "microsoft", file: "microsoft" },
  { key: "microsoft-cn", file: "microsoft@cn" }, // 真实文件为 microsoft@cn
  { key: "telegram", file: "telegram" },
  { key: "spotify", file: "spotify" },
  { key: "steam", file: "steam" },
  { key: "steam-cn", file: "steam@cn" }, // 真实文件为 steam@cn
  // ---- AI 独立域名（不依赖 gfw） ----
  { key: "category-ai", file: "category-ai-!cn" },
  { key: "openai", file: "openai" }, // 含 ChatGPT
  { key: "anthropic", file: "anthropic" }, // 含 Claude
  { key: "perplexity", file: "perplexity" },
  { key: "cursor", file: "cursor" },
  { key: "notion", file: "notion" },
  // ---- 兜底与基础设施 ----
  { key: "gfw", file: "gfw" },
  { key: "connectivity-check", file: "connectivity-check" },
  { key: "category-ntp", file: "category-ntp" },
];

/** GeoIP 网段类规则集：{ key, file } */
const GEOIP_PROVIDERS: ProviderEntry[] = [
  { key: "private-ip", file: "private" },
  { key: "cn-ip", file: "cn" },
  { key: "google-ip", file: "google" }, // 支撑 Google 独立策略的 IP 兜底
  { key: "telegram-ip", file: "telegram" }, // Telegram 强依赖 IP 段
];

/** 构建 rule-providers 配置对象 */
export const buildRuleProviders = (): Record<string, any> => {
  const providers: Record<string, any> = {};
  const base = SETTINGS.RULE_PROVIDER_URL_BASE;
  const common = {
    type: "http",
    format: "mrs",
    interval: SETTINGS.PROVIDER_INTERVAL,
  };

  GEOSITE_PROVIDERS.forEach(({ key, file }) => {
    providers[key] = {
      ...common,
      behavior: "domain",
      path: `${SETTINGS.RULE_PROVIDER_PATH}/${key}.mrs`,
      url: `${base}/geosite/${file}.mrs`,
    };
  });
  GEOIP_PROVIDERS.forEach(({ key, file }) => {
    providers[key] = {
      ...common,
      behavior: "ipcidr",
      path: `${SETTINGS.RULE_PROVIDER_PATH}/${key}.mrs`,
      url: `${base}/geoip/${file}.mrs`,
    };
  });

  // Cloudflare 基础设施直连：
  // - cloudflareinsights.com：Web Analytics 分析脚本，前置直连防 category-ads-all 误杀
  // - challenges.cloudflare.com 不在此列，让其跟随主站路由以保持 IP 一致，
  //   避免 Turnstile 验证时代理 IP 与直连 IP 不一致触发风控
  providers.cloudflare = {
    type: "inline",
    behavior: "classical",
    payload: [
      "DOMAIN-SUFFIX,cloudflareinsights.com",
    ],
  };
  return providers;
};
