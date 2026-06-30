/**
 * The mihomo-proxy project - Ultimate Stable Edition (GeoSite + Campus DNS)
 * The project is based on sing-mix, and has been optimized for stability and performance.
 * 核心优化：TUN 防卡 / FCM 防断流 / 校园网 DNS 兜底 / 原生 Geo 稳定分流
 * 提醒使用系统代理 fake-ip 不会生效，建议使用 tun 模式
 * 仓库地址：https://github.com/wchiway/mihomo-proxy
 * 脚本链接：https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/mihomo-proxy.js
 * mihomo 客户端推荐：https://github.com/xishang0128/sparkle
 */

// ====================
// 0. 特殊处理
// ====================
const BYPASS_DOMAINS = ["example.com", "example.org"];
const FORCE_PROXY_DOMAINS = ["test.com", "test.org"];
const CUSTOM_FILTER = /示例占位符1|示例占位符2|示例占位符3/i;

// ====================
// 1. 常量配置
// ====================
const SETTINGS = {
  ICON_BASE:
    "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/",
  RULE_PROVIDER_URL_BASE:
    "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo",
  REGION_ORDER: ["HK", "TW", "SG", "JP", "KR", "AS", "US"],

  URL_TEST_EXTRA: {
    hidden: true,
    url: "https://www.g.cn/generate_204",
    interval: 900,
    tolerance: 100,
    lazy: true,
    timeout: 1000,
    "max-failed-times": 1,
  },
  FALLBACK_TEST_EXTRA: {
    url: "https://www.g.cn/generate_204",
    interval: 900,
    lazy: true,
    timeout: 1000,
    "max-failed-times": 1,
  },
  INFO_FILTER:
    /tg|telegram|倒卖|到期|电报|订阅|发布|防止|返利|购买|官方|官网|工单|过期|规则|建议|客服|联系|流量|剩余|失联|网址|邮箱|续费|邀请|重置|梯子|群/i,
};

// ====================
// 2. 基础工具
// ====================
const uniq = (arr = []) => [...new Set(arr.filter(Boolean))];
const escapeRegex = (s = "") =>
  String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeName = (name = "") =>
  String(name)
    .replace(/(IEPL|IPLC|BGP|RELAY|PRO|V\d+)/gi, " $1 ")
    .replace(/[【】\[\]（）()|_\-.,/:~]/g, " ")
    .replace(/🇭🇰/g, " HK ")
    .replace(/🇹🇼/g, " TW ")
    .replace(/🇸🇬/g, " SG ")
    .replace(/🇯🇵/g, " JP ")
    .replace(/🇰🇷/g, " KR ")
    .replace(/🇻🇳|🇹🇭|🇲🇾|🇮🇩|🇵🇭/g, " AS ")
    .replace(/🇺🇸/g, " US ")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

const buildRegex = (arr = []) =>
  new RegExp(
    arr
      .map((raw) => {
        const token = String(raw).trim().toUpperCase();
        const escaped = escapeRegex(token);
        return /^[A-Z]{2,3}$/.test(token)
          ? `(?:^|[^A-Z])${escaped}(?:[^A-Z]|$)`
          : escaped;
      })
      .join("|"),
    "i",
  );

const buildRegions = () =>
  [
    {
      name: "HK",
      pattern: ["香港", "HK", "HKG", "HONGKONG", "HONG KONG"],
      icon: "Hong_Kong.png",
    },
    {
      name: "TW",
      pattern: ["台湾", "台北", "新北", "TW", "TWN", "TAIWAN", "TAIPEI"],
      icon: "Taiwan.png",
    },
    {
      name: "SG",
      pattern: ["新加坡", "狮城", "SG", "SGP", "SINGAPORE"],
      icon: "Singapore.png",
    },
    {
      name: "JP",
      pattern: ["日本", "东京", "大阪", "JP", "JPN", "JAPAN", "TOKYO", "OSAKA"],
      icon: "Japan.png",
    },
    {
      name: "KR",
      pattern: ["韩国", "首尔", "KR", "KOR", "KOREA", "SEOUL"],
      icon: "Korea.png",
    },
    {
      name: "AS",
      pattern: [
        "越南",
        "泰国",
        "马来西亚",
        "印尼",
        "菲律宾",
        "VN",
        "TH",
        "MY",
        "ID",
        "PH",
        "VIETNAM",
        "THAILAND",
        "MALAYSIA",
        "INDONESIA",
        "PHILIPPINES",
        "MANILA",
      ],
      icon: "Asia_Map.png",
    },
    {
      name: "US",
      pattern: [
        "美国",
        "纽约",
        "旧金山",
        "洛杉矶",
        "西雅图",
        "芝加哥",
        "US",
        "USA",
        "NEWYORK",
        "NEW YORK",
        "SANFRANCISCO",
        "SAN FRANCISCO",
        "LOSANGELES",
        "LOS ANGELES",
        "SEATTLE",
        "CHICAGO",
      ],
      icon: "United_States.png",
    },
  ].map((r) => ({ ...r, regex: buildRegex(r.pattern) }));

const REGIONS = buildRegions();

const mergeRules = (baseRules = [], extraRules = []) => {
  const extra = Array.isArray(extraRules) ? extraRules.filter(Boolean) : [];
  if (!extra.length) return baseRules.slice();
  const matchIndex = baseRules.findIndex(
    (rule) => String(rule).trim().toUpperCase() === "MATCH,main",
  );
  if (matchIndex === -1) return uniq([...baseRules, ...extra]);
  return uniq([
    ...baseRules.slice(0, matchIndex),
    ...extra,
    ...baseRules.slice(matchIndex),
  ]);
};

const pickDirectRules = (rules = []) =>
  rules.filter((rule) => {
    const r = String(rule || "").trim();
    if (!r || r.startsWith("#")) return false;
    return /,DIRECT(?:,|$)/i.test(r);
  });

// ====================
// 3. 规则集与固定规则 (使用官方 GeoSite/GeoIP)
// ====================
const RULE_PROVIDERS_DOMAINS = [
  "category-ads-all",
  "private",
  "google-cn",
  "synology",
  "microsoft@cn",
  "category-game-platforms-download@cn",
  "category-ai-!cn",
  "telegram",
  "gfw",
  "cn",
  "googlefcm",
  "epicgames",
  "nvidia@cn",
  "cloudflare@cn",
  "steam@cn",
  "category-ntp",
  "connectivity-check",
  "apple",
  "spotify",
  "microsoft",
];

const RULE_PROVIDERS_IPS = ["private", "cn"];

const buildRuleProviders = () => {
  const providers = {};
  RULE_PROVIDERS_DOMAINS.forEach((name) => {
    providers[name] = {
      type: "http",
      behavior: "domain",
      format: "mrs",
      path: `./rules/${name}.mrs`,
      url: `${SETTINGS.RULE_PROVIDER_URL_BASE}/geosite/${name}.mrs`,
      interval: 86400,
    };
  });
  RULE_PROVIDERS_IPS.forEach((name) => {
    providers[`${name}-ip`] = {
      type: "http",
      behavior: "ipcidr",
      format: "mrs",
      path: `./rules/${name}-ip.mrs`,
      url: `${SETTINGS.RULE_PROVIDER_URL_BASE}/geoip/${name}.mrs`,
      interval: 86400,
    };
  });
  providers.cloudflare = {
    type: "inline",
    behavior: "classical",
    payload: [
      "DOMAIN,challenges.cloudflare.com",
      "DOMAIN-SUFFIX,cloudflarechallenge.com",
    ],
  };
  return providers;
};

const STATIC_RULES = [
  "RULE-SET,category-ads-all,REJECT",
  ...uniq(BYPASS_DOMAINS).map((d) => `DOMAIN-SUFFIX,${d},DIRECT`),
  ...uniq(FORCE_PROXY_DOMAINS).map((d) => `DOMAIN,${d},main`),
  "RULE-SET,cloudflare,DIRECT",
  "RULE-SET,private,DIRECT",
  "RULE-SET,private-ip,DIRECT,no-resolve",
  "RULE-SET,googlefcm,DIRECT",
  "RULE-SET,google-cn,DIRECT",
  "RULE-SET,synology,DIRECT",
  "DOMAIN-SUFFIX,sharepoint.com,DIRECT",
  "RULE-SET,microsoft@cn,DIRECT",
  "RULE-SET,category-game-platforms-download@cn,DIRECT",
  "RULE-SET,category-ai-!cn,ai",
  "RULE-SET,telegram,tg",
  "RULE-SET,gfw,main",
  "RULE-SET,cn,DIRECT",
  "RULE-SET,cn-ip,DIRECT,no-resolve",
  "MATCH,main",
];

// ====================
// 4. 节点处理
// ====================
const ensureConfigObject = (input) =>
  input && typeof input === "object" ? input : {};
const getOriginalProxies = (input) =>
  Array.isArray(input.proxies) ? input.proxies : [];

const makeProxyNamesUnique = (proxies = []) => {
  const used = new Set();
  const nextIdx = new Map();
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

const filterCustomProxies = (proxies = [], customFilter) =>
  proxies.filter(
    (proxy) => proxy && proxy.name && !customFilter.test(proxy.name),
  );

const splitInfoAndNormalProxies = (proxies = [], infoFilter) =>
  proxies.reduce(
    (acc, proxy) => {
      if (!proxy || !proxy.name) return acc;
      (infoFilter.test(proxy.name) ? acc.infoProxies : acc.normalProxies).push(
        proxy,
      );
      return acc;
    },
    { infoProxies: [], normalProxies: [] },
  );

const classifyProxiesByRegion = (normalProxies = [], regions = []) => {
  const regionGroupsData = regions.map((r) => ({
    name: r.name,
    icon: r.icon,
    proxies: [],
  }));
  const regionGroupMap = new Map(regionGroupsData.map((r) => [r.name, r]));
  const regionSeen = new Map(regionGroupsData.map((r) => [r.name, new Set()]));
  const otherProxyNames = [];
  const otherSeen = new Set();

  normalProxies.forEach((proxy) => {
    const proxyName = proxy.name;
    const normName = normalizeName(proxyName);
    const matchedRegion = regions.find((r) => r.regex.test(normName));
    if (matchedRegion) {
      const group = regionGroupMap.get(matchedRegion.name);
      const seen = regionSeen.get(matchedRegion.name);
      if (group && seen && !seen.has(proxyName)) {
        group.proxies.push(proxyName);
        seen.add(proxyName);
      }
    } else if (!otherSeen.has(proxyName)) {
      otherProxyNames.push(proxyName);
      otherSeen.add(proxyName);
    }
  });

  const activeRegions = regionGroupsData
    .map((r) => ({ ...r, proxies: uniq(r.proxies) }))
    .filter((r) => r.proxies.length > 0);
  return {
    activeRegions,
    activeRegionNameSet: new Set(activeRegions.map((r) => r.name)),
    activeRegionMap: new Map(activeRegions.map((r) => [r.name, r])),
    otherProxyNames: uniq(otherProxyNames),
  };
};

const buildAllAiProxyList = (
  activeRegions = [],
  otherProxyNames = [],
  allNames = [],
) => {
  const nonHk = uniq([
    ...activeRegions.filter((r) => r.name !== "HK").flatMap((r) => r.proxies),
    ...otherProxyNames,
  ]);
  return nonHk.length ? nonHk : allNames;
};

// ====================
// 5. 策略组
// ====================
const buildProxyGroups = ({
  allNames,
  allAiNames,
  activeRegionMap,
  activeRegionNameSet,
  otherProxyNames,
  infoNames,
}) => {
  const groups = [];
  const add = (name, type, proxies, icon = "Available.png", extra = {}) => {
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

  const regionEntries = SETTINGS.REGION_ORDER.filter((rName) =>
    activeRegionNameSet.has(rName),
  );

  if (allNames.length) {
    const mainEntries = ["All", ...regionEntries];
    if (otherProxyNames.length) mainEntries.push("Other");
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

  if (allAiNames.length) {
    const aiRegionEntries = SETTINGS.REGION_ORDER.filter(
      (rName) => rName !== "HK" && activeRegionNameSet.has(rName),
    );
    const aiEntries = ["All-ai", ...aiRegionEntries];
    if (otherProxyNames.length) aiEntries.push("Other");
    add("ai", "select", aiEntries, "ChatGPT.png");
    add(
      "URL Test - All-ai",
      "url-test",
      allAiNames,
      "ChatGPT.png",
      SETTINGS.URL_TEST_EXTRA,
    );
    add(
      "All-ai",
      "select",
      ["URL Test - All-ai", ...allAiNames],
      "ChatGPT.png",
    );
  }

  if (allNames.length) {
    const hasSG = activeRegionNameSet.has("SG");
    add(
      "tg - Fallback",
      "fallback",
      hasSG ? ["SG", "main"] : ["main"],
      "Telegram.png",
      SETTINGS.FALLBACK_TEST_EXTRA,
    );
    add(
      "tg",
      "select",
      ["tg - Fallback", ...(hasSG ? ["SG"] : []), "main"],
      "Telegram.png",
    );
  }

  SETTINGS.REGION_ORDER.forEach((rName) => {
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

  if (otherProxyNames.length) {
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

  add(
    "GLOBAL",
    "select",
    [
      ...(allNames.length ? ["main", "All"] : []),
      ...(allAiNames.length ? ["ai", "All-ai"] : []),
      ...(allNames.length ? ["tg"] : []),
      ...regionEntries,
      ...(otherProxyNames.length ? ["Other"] : []),
      ...(infoNames.length ? ["info"] : []),
    ],
    "Global.png",
  );

  return groups;
};

// ====================
// 6. 网络配置模块 (含深度底层优化)
// ====================
const applySniffer = (cfg) => {
  cfg.sniffer = {
    ...(cfg.sniffer || {}),
    enable: true,
    "force-dns-mapping": true,
    "parse-pure-ip": true,
    "override-destination": false, // 【防断流核心】关闭强制覆盖，保护 FCM 等长连接
    sniff: {
      HTTP: { ports: [80, "8080-8880"], "override-destination": false },
      TLS: { ports: [443, 8443] },
      QUIC: { ports: [443, 8443] },
    },
  };
};

const applyTun = (cfg) => {
  cfg.tun = {
    ...(cfg.tun || {}),
    enable: true,
    stack: "mixed",
    "auto-route": true,
    "auto-detect-interface": true,
    "strict-route": true,
    "dns-hijack": ["any:53", "tcp://any:53"],
    mtu: 1280, // 【防卡顿核心】降低 MTU 适应严苛网络环境
    "disable-icmp-forwarding": true, // 【防风暴核心】禁止 ICMP 转发，防止占用率飙升
  };
};

const applyRuntime = (cfg) => {
  cfg.mode = "rule";
  cfg["log-level"] = "warning";
  cfg.profile = {
    ...(cfg.profile || {}),
    "store-selected": true,
    "store-fake-ip": false,
  };
};

const applyDns = (cfg) => {
  const dns = cfg.dns || {};
  const fakeIpFilterFromCfg = Array.isArray(dns["fake-ip-filter"])
    ? dns["fake-ip-filter"]
    : [];

  // 恢复为 Geo 规则集的直通名单
  const directRuleSets = [
    "rule-set:cn",
    "rule-set:google-cn",
    "rule-set:synology",
    "rule-set:googlefcm",
    "rule-set:epicgames",
    "rule-set:nvidia@cn",
    "rule-set:microsoft@cn",
    "rule-set:cloudflare@cn",
    "rule-set:steam@cn",
    "rule-set:category-game-platforms-download@cn",
    "rule-set:category-ntp",
    "rule-set:connectivity-check",
    "rule-set:apple",
    "rule-set:spotify",
    "rule-set:microsoft",
  ];

  // 保留主机游戏与局域网穿透
  const gameAndLanFilter = [
    "+.stun.*.*",
    "+.stun.*.*.*",
    "+.stun.*.*.*.*",
    "+.stun.*.*.*.*.*",
    "*.n.n.srv.nintendo.net",
    "+.stun.playstation.net",
    "xbox.*.*.microsoft.com",
    "*.*.xboxlive.com",
    "+.msftncsi.com",
    "+.msftconnecttest.com",
    "+.teracloud.jp",
    "+.lan",
    "localhost.ptlogin2.qq.com",
    "WORKGROUP",
  ];

  // 合并生成完整的 Fake-IP 黑名单
  const fullFakeIpFilter = uniq([
    "+.cn",
    "rule-set:cloudflare",
    "rule-set:private",
    ...directRuleSets,
    ...gameAndLanFilter,
    ...fakeIpFilterFromCfg,
  ]);

  cfg.dns = {
    ...dns,
    enable: true,
    listen: "0.0.0.0:1053",
    ipv6: true,
    "cache-algorithm": "arc",
    "prefer-h3": false,
    "use-hosts": true,
    "use-system-hosts": true,
    "respect-rules": false, // Fake-IP 模式下保持关闭
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "fake-ip-range6": "fc00::/18",
    "fake-ip-filter-mode": "blacklist",
    "fake-ip-filter": fullFakeIpFilter,

    // 【校园网专属优化】首选 system 保证内网畅通，附带纯 IP 公共 DNS 及加密 DoH 防劫持兜底
    "default-nameserver": ["system", "223.5.5.5", "119.29.29.29"],
    nameserver: [
      "system",
      "https://dns.alidns.com/dns-query",
      "https://doh.pub/dns-query",
    ],
    "proxy-server-nameserver": [
      "system",
      "https://dns.alidns.com/dns-query",
      "https://doh.pub/dns-query",
    ],
  };

  // DoH 预解析加速
  cfg.hosts = {
    "dns.alidns.com": ["223.5.5.5", "223.6.6.6"],
    "doh.pub": ["1.12.12.12", "120.53.53.53"],
    "services.googleapis.cn": ["services.googleapis.com"],
    "+.mcdn.bilivideo.com": ["0.0.0.0"],
    "+.mcdn.bilivideo.cn": ["0.0.0.0"],
  };
};

// ====================
// 7. 主流程
// ====================
function main(config) {
  config = ensureConfigObject(config);
  const originalProxies = getOriginalProxies(config);
  const existingRules = Array.isArray(config.rules) ? config.rules : [];

  // 清除老旧数据模式配置
  delete config["geodata-mode"];
  delete config["geo-auto-update"];
  delete config["geo-update-interval"];
  delete config["geox-url"];

  config["rule-providers"] = {
    ...(config["rule-providers"] || {}),
    ...buildRuleProviders(),
  };

  config.rules = mergeRules(STATIC_RULES, pickDirectRules(existingRules));

  if (originalProxies.length) {
    makeProxyNamesUnique(originalProxies);
    const filteredProxies = filterCustomProxies(originalProxies, CUSTOM_FILTER);
    const { infoProxies, normalProxies } = splitInfoAndNormalProxies(
      filteredProxies,
      SETTINGS.INFO_FILTER,
    );

    const baseProxies = normalProxies;
    const allNames = uniq(baseProxies.map((p) => p.name));
    const infoNames = uniq(infoProxies.map((p) => p.name));

    const {
      activeRegions,
      activeRegionNameSet,
      activeRegionMap,
      otherProxyNames,
    } = classifyProxiesByRegion(baseProxies, REGIONS);
    const allAiNames = buildAllAiProxyList(
      activeRegions,
      otherProxyNames,
      allNames,
    );

    config["proxy-groups"] = buildProxyGroups({
      allNames,
      allAiNames,
      activeRegionMap,
      activeRegionNameSet,
      otherProxyNames,
      infoNames,
    });
    config.proxies = originalProxies;
  } else {
    config["proxy-groups"] = buildProxyGroups({
      allNames: [],
      allAiNames: [],
      activeRegionMap: new Map(),
      activeRegionNameSet: new Set(),
      otherProxyNames: [],
      infoNames: [],
    });
  }

  applyRuntime(config);
  applySniffer(config);
  applyTun(config);
  applyDns(config);

  return config;
}
