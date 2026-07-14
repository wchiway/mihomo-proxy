/**
 * mihomo-proxy — Ultimate Stable Edition v2.2
 * ------------------------------------------------------------------
 * 面向 Clash Verge Rev / 最新 Mihomo(Clash.Meta) 内核的配置增强脚本。
 *
 * 相较于 v1 的核心升级（详见各模块注释）：
 *   1. DNS 架构重设计：Smart 分流 + nameserver-policy + respect-rules=true
 *      默认上游为国际 DoH 且经代理出站（防 DNS 泄露），国内域名白名单
 *      走国内 DoH，节点域名解析用国内加密 DoH 保证直连可达且防污染。
 *   2. Fake-IP 黑名单精简：仅保留 private/cn/lan/stun/ntp/connectivity-check。
 *   3. Rule Providers 全面改用最新 MetaCubeX .mrs，逻辑 key 与远端文件名解耦。
 *   4. Google / AI / Apple / Microsoft / Steam 均拥有独立分流策略与策略组。
 *   5. 节点分类算法升级：识别地区(含 EU/AU) + 倍率 + 专线线路，并自动排序。
 *   6. TUN/Sniffer/Runtime 采用最新选项优化，兼顾稳定与吞吐。
 *
 * 提醒：使用系统代理时 fake-ip 不会生效，建议使用 TUN 模式。
 * 仓库地址：https://github.com/wchiway/mihomo-proxy
 * 脚本链接：https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/mihomo-proxy.js
 * 客户端推荐：https://github.com/xishang0128/sparkle
 */

// ============================================================
// 0. 用户自定义区（按需修改，留空即不生效）
// ============================================================
/** 强制直连的域名（后缀匹配） */
const BYPASS_DOMAINS = ["example.com", "example.org"];
/** 强制走代理(main)的域名（精确匹配） */
const FORCE_PROXY_DOMAINS = ["test.com", "test.org"];
/** 需要从订阅中剔除的节点名过滤器（正则） */
const CUSTOM_FILTER = /示例占位符1|示例占位符2|示例占位符3/i;

// ============================================================
// 1. Config —— 常量配置（集中管理，避免魔法值）
// ============================================================
const SETTINGS = {
  /** Koolson/Qure 彩色图标库 */
  ICON_BASE:
    "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/",
  /** MetaCubeX meta-rules-dat 规则集根地址 */
  RULE_PROVIDER_URL_BASE:
    "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo",
  /** 规则集本地缓存目录 */
  RULE_PROVIDER_PATH: "./rules",
  /** 规则集更新间隔（秒），24 小时 */
  PROVIDER_INTERVAL: 86400,

  /** 策略组中地区的展示顺序（同时决定生成顺序） */
  REGION_ORDER: ["HK", "TW", "JP", "SG", "KR", "US", "EU", "AU", "AS"],

  /** url-test 自动测速组的通用参数 */
  URL_TEST_EXTRA: {
    hidden: true,
    url: "https://www.gstatic.com/generate_204", // 反映真实翻墙质量
    interval: 300,
    tolerance: 50,
    lazy: true,
    timeout: 5000, // v1 的 1000ms 过短易误判，放宽到 5s
    "max-failed-times": 3,
  },
  /** fallback 组的通用参数 */
  FALLBACK_TEST_EXTRA: {
    url: "https://www.gstatic.com/generate_204",
    interval: 300,
    lazy: true,
    timeout: 5000,
    "max-failed-times": 3,
  },

  /** 机场信息类节点（到期/官网/流量等）识别过滤器 */
  INFO_FILTER:
    /tg|telegram|倒卖|到期|电报|订阅|发布|防止|返利|购买|官方|官网|工单|过期|规则|建议|客服|联系|流量|剩余|失联|网址|邮箱|续费|邀请|重置|梯子|群/i,
};

/** DNS 服务器常量（集中定义，便于统一维护） */
const DNS_SERVERS = {
  /** bootstrap（纯 IP，用于解析 DoH 域名本身） */
  BOOTSTRAP: ["223.5.5.5", "119.29.29.29", "1.1.1.1", "8.8.8.8"],
  /** 国内加密 DoH（AliDNS + DNSPod） */
  CN_DOH: ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],
  /** 国际加密 DoH（Cloudflare + Google，IP 形式免 bootstrap） */
  GLOBAL_DOH: ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"],
};

/** Fake-IP 地址池 */
const FAKE_IP_RANGE = "198.18.0.1/16";
const FAKE_IP_RANGE6 = "fc00::/18";

// ============================================================
// 2. Utils —— 基础工具（含解析结果缓存，减少重复计算）
// ============================================================
/** 数组去重并剔除 falsy */
const uniq = (arr = []) => [...new Set(arr.filter(Boolean))];

/** 转义正则元字符 */
const escapeRegex = (s = "") =>
  String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 归一化节点名：把国旗 emoji、分隔符统一成带空格的大写 token，
 * 便于后续用词边界正则精确匹配地区/线路。
 */
const normalizeName = (name = "") =>
  String(name)
    .replace(/(IEPL|IPLC|BGP|RELAY|PRO|V\d+)/gi, " $1 ")
    .replace(/[【】\[\]（）()|_\-.,/:~]/g, " ")
    .replace(/🇭🇰/g, " HK ")
    .replace(/🇹🇼/g, " TW ")
    .replace(/🇸🇬/g, " SG ")
    .replace(/🇯🇵/g, " JP ")
    .replace(/🇰🇷/g, " KR ")
    .replace(/🇺🇸/g, " US ")
    .replace(/🇦🇺/g, " AU ")
    .replace(/🇪🇺|🇩🇪|🇫🇷|🇬🇧|🇳🇱|🇷🇺|🇮🇹|🇪🇸|🇸🇪|🇨🇭|🇵🇱|🇫🇮|🇹🇷|🇮🇪|🇦🇹|🇧🇪/g, " EU ")
    .replace(/🇻🇳|🇹🇭|🇲🇾|🇮🇩|🇵🇭|🇮🇳/g, " AS ")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * 由关键词数组构建匹配正则；2~3 位纯字母（如 HK/JP/USA）加词边界，
 * 避免误伤（例如 "US" 命中 "PLUS"）。
 */
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

// ---- 倍率解析（带缓存） ----
const _mulCache = new Map();
/**
 * 从节点名解析计费倍率（如 "0.2x" / "1倍" / "2X"）。
 * 未标注时默认 1。用于策略组内自动排序。
 */
const parseMultiplier = (name = "") => {
  if (_mulCache.has(name)) return _mulCache.get(name);
  let val = 1;
  const m = String(name).match(/(\d+(?:\.\d+)?)\s*(?:x|倍|×|✕)/i);
  if (m) {
    const v = parseFloat(m[1]);
    if (v > 0 && v < 100) val = v;
  }
  _mulCache.set(name, val);
  return val;
};

// ---- 线路类型解析（带缓存） ----
const _lineCache = new Map();
const LINE_TAGS = [
  { tag: "IEPL", re: /IEPL/i },
  { tag: "IPLC", re: /IPLC/i },
  { tag: "BGP", re: /BGP/i },
  { tag: "GAME", re: /GAME|游戏|游戲/i },
  { tag: "HOME", re: /RESIDENT|HOME|住宅|家宽|家寬|原生|NATIVE/i },
];
/** 解析节点线路类型（专线 / 游戏 / 家宽等），无标注返回 ""。 */
const parseLineType = (name = "") => {
  if (_lineCache.has(name)) return _lineCache.get(name);
  let tag = "";
  for (const t of LINE_TAGS) {
    if (t.re.test(name)) {
      tag = t.tag;
      break;
    }
  }
  _lineCache.set(name, tag);
  return tag;
};

/** 线路优先级：专线(IEPL/IPLC) > BGP > 其他，数值越小越靠前。 */
const lineRank = (tag) =>
  tag === "IEPL" || tag === "IPLC" ? 0 : tag === "BGP" ? 1 : 2;

/**
 * 节点自动排序：先按线路质量，再按倍率升序（省流量优先），最后按名称。
 * 让优质/低倍率线路稳定地出现在 select 组顶部。
 */
const sortProxyNames = (names = []) =>
  names.slice().sort((a, b) => {
    const lr = lineRank(parseLineType(a)) - lineRank(parseLineType(b));
    if (lr !== 0) return lr;
    const mr = parseMultiplier(a) - parseMultiplier(b);
    if (mr !== 0) return mr;
    return a.localeCompare(b);
  });

// ============================================================
// 3. Regions —— 地区定义（新增 EU / AU，保留 AS）
// ============================================================
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
      name: "JP",
      pattern: ["日本", "东京", "大阪", "JP", "JPN", "JAPAN", "TOKYO", "OSAKA"],
      icon: "Japan.png",
    },
    {
      name: "SG",
      pattern: ["新加坡", "狮城", "SG", "SGP", "SINGAPORE"],
      icon: "Singapore.png",
    },
    {
      name: "KR",
      pattern: ["韩国", "首尔", "KR", "KOR", "KOREA", "SEOUL"],
      icon: "Korea.png",
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
    {
      name: "EU",
      pattern: [
        "欧洲",
        "德国",
        "法国",
        "英国",
        "荷兰",
        "俄罗斯",
        "意大利",
        "西班牙",
        "瑞典",
        "瑞士",
        "波兰",
        "芬兰",
        "土耳其",
        "爱尔兰",
        "奥地利",
        "法兰克福",
        "伦敦",
        "EU",
        "DE",
        "FR",
        "UK",
        "GB",
        "NL",
        "RU",
        "IT",
        "ES",
        "SE",
        "CH",
        "PL",
        "FI",
        "TR",
        "IE",
        "AT",
        "GERMANY",
        "FRANCE",
        "LONDON",
        "FRANKFURT",
      ],
      icon: "European_Union.png",
    },
    {
      name: "AU",
      pattern: [
        "澳大利亚",
        "澳洲",
        "悉尼",
        "墨尔本",
        "AU",
        "AUS",
        "AUSTRALIA",
        "SYDNEY",
        "MELBOURNE",
      ],
      icon: "Australia.png",
    },
    {
      name: "AS",
      pattern: [
        "越南",
        "泰国",
        "马来西亚",
        "印尼",
        "菲律宾",
        "印度",
        "VN",
        "TH",
        "MY",
        "ID",
        "PH",
        "IN",
        "VIETNAM",
        "THAILAND",
        "MALAYSIA",
        "INDONESIA",
        "PHILIPPINES",
        "MANILA",
      ],
      icon: "Asia_Map.png",
    },
  ].map((r) => ({ ...r, regex: buildRegex(r.pattern) }));

const REGIONS = buildRegions();

// ============================================================
// 4. RuleProviders —— 规则集（逻辑 key ↔ 远端文件名解耦）
// ------------------------------------------------------------
// 关键设计：MetaCubeX 仓库中不存在 microsoft-cn / steam-cn，
// 真实文件为 microsoft@cn / steam@cn。这里 key 用文件系统/引用友好的
// 安全名（供 rule-providers 键、rules 引用、nameserver-policy 使用），
// file 用远端真实文件名（供拼 URL）。既满足 Plan 命名，又保证不 404。
// ============================================================
/** GeoSite 域名类规则集：{ key: 内部逻辑名, file: 远端文件名 } */
const GEOSITE_PROVIDERS = [
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
const GEOIP_PROVIDERS = [
  { key: "private-ip", file: "private" },
  { key: "cn-ip", file: "cn" },
  { key: "google-ip", file: "google" }, // 支撑 Google 独立策略的 IP 兜底
  { key: "telegram-ip", file: "telegram" }, // Telegram 强依赖 IP 段
];

/** 构建 rule-providers 配置对象 */
const buildRuleProviders = () => {
  const providers = {};
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

  // Cloudflare 验证页（人机验证）直连，避免被代理影响
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

// ============================================================
// 5. RuleBuilder —— 分流规则（顺序敏感：越具体越靠前）
// ============================================================
/**
 * 静态规则集。分流目标对应 §7 生成的策略组名。
 * 设计要点：
 *  - Google FCM 走代理(Google 组)，不再 DIRECT（Plan 4）。
 *  - Google / YouTube / AI / Telegram / Steam / Apple / Microsoft 各自独立分流。
 *  - 国区子集(*-cn)直连，全球集走对应代理组。
 */
const STATIC_RULES = [
  // 广告拦截
  "RULE-SET,category-ads-all,REJECT",

  // 用户自定义
  ...uniq(BYPASS_DOMAINS).map((d) => `DOMAIN-SUFFIX,${d},DIRECT`),
  ...uniq(FORCE_PROXY_DOMAINS).map((d) => `DOMAIN,${d},main`),

  // 基础设施：Cloudflare 验证页 / 内网 直连
  "RULE-SET,cloudflare,DIRECT",
  "RULE-SET,private,DIRECT",
  "RULE-SET,private-ip,DIRECT,no-resolve",

  // AI（独立于 gfw，优先匹配以免被 google/gfw 抢占）
  "RULE-SET,openai,AI",
  "RULE-SET,anthropic,AI",
  "RULE-SET,perplexity,AI",
  "RULE-SET,cursor,AI",
  "RULE-SET,notion,AI",
  "RULE-SET,category-ai,AI",

  // Google 生态（顺序关键！rules 是有序数组，先匹配先停止）
  // google-cn 列表中混有 connectivitycheck.gstatic.com / fonts.googleapis.com /
  // fonts.gstatic.com / dl.google.com 等全球关键域名（历史上有国内 CDN，现已不可达）。
  // 若 google-cn,DIRECT 放在 google 之前，会把上述域名强制直连 → YouTube 报
  // "未联网"、Chrome 商店卡死、NotebookLM 白屏。
  // 实际效果：google 先匹配并消耗了所有全球域名，google-cn 仅能命中
  // 不在 google 集合中的纯国区域名（google.cn / 265.com / pki.goog 等）。
  "RULE-SET,googlefcm,Google", // FCM 走代理（关键修正）
  "RULE-SET,youtube,YouTube",
  "RULE-SET,google,Google",
  "RULE-SET,google-ip,Google,no-resolve",
  "RULE-SET,google-cn,DIRECT",

  // Telegram
  "RULE-SET,telegram,Telegram",
  "RULE-SET,telegram-ip,Telegram,no-resolve",

  // Steam（国区/下载 CDN 直连，商店/社区/登录走代理组）
  "RULE-SET,steam-cn,DIRECT",
  "RULE-SET,steam,Steam",

  // Apple（国区 CDN 直连，iCloud/App Store 全球等走代理组）
  "RULE-SET,apple-cn,DIRECT",
  "RULE-SET,apple,Apple",

  // Microsoft（国区/Windows Update 直连，Copilot 等全球走代理组）
  "RULE-SET,microsoft-cn,DIRECT",
  "RULE-SET,microsoft,Microsoft",

  // Spotify 走代理
  "RULE-SET,spotify,main",

  // 连通性检测 / NTP 直连（快速返回，避免走代理增加延迟）
  "RULE-SET,connectivity-check,DIRECT",
  "RULE-SET,category-ntp,DIRECT",

  // GFW 兜底走代理
  "RULE-SET,gfw,main",

  // 国内直连
  "RULE-SET,cn,DIRECT",
  "RULE-SET,cn-ip,DIRECT,no-resolve",

  // 漏网之鱼走主代理
  "MATCH,main",
];

/**
 * 合并用户既有规则中的 DIRECT 规则到 MATCH 之前，保持向后兼容。
 */
const mergeRules = (baseRules = [], extraRules = []) => {
  const extra = Array.isArray(extraRules) ? extraRules.filter(Boolean) : [];
  if (!extra.length) return baseRules.slice();
  const matchIndex = baseRules.findIndex((rule) =>
    String(rule).trim().toUpperCase().startsWith("MATCH,"),
  );
  if (matchIndex === -1) return uniq([...baseRules, ...extra]);
  return uniq([
    ...baseRules.slice(0, matchIndex),
    ...extra,
    ...baseRules.slice(matchIndex),
  ]);
};

/** 从用户既有规则中挑出 DIRECT 规则（供合并保留自定义直连） */
const pickDirectRules = (rules = []) =>
  rules.filter((rule) => {
    const r = String(rule || "").trim();
    if (!r || r.startsWith("#")) return false;
    return /,DIRECT(?:,|$)/i.test(r);
  });

// ============================================================
// 6. Classifier —— 节点处理与分类
// ============================================================
const ensureConfigObject = (input) =>
  input && typeof input === "object" ? input : {};
const getOriginalProxies = (input) =>
  Array.isArray(input.proxies) ? input.proxies : [];

/** 节点重名去冲突：追加 _1/_2… 后缀 */
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

/** 剔除自定义过滤器命中的节点 */
const filterCustomProxies = (proxies = [], customFilter) =>
  proxies.filter(
    (proxy) => proxy && proxy.name && !customFilter.test(proxy.name),
  );

/** 分离「信息类节点」与「正常节点」 */
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

/**
 * 按地区分类，并对每个地区/Other 组内节点自动排序。
 * 单次遍历完成匹配（Plan 16：避免重复遍历）。
 */
const classifyProxiesByRegion = (normalProxies = [], regions = []) => {
  const regionData = regions.map((r) => ({
    name: r.name,
    icon: r.icon,
    proxies: [],
  }));
  const regionMap = new Map(regionData.map((r) => [r.name, r]));
  const regionSeen = new Map(regionData.map((r) => [r.name, new Set()]));
  const otherProxyNames = [];
  const otherSeen = new Set();

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

// ============================================================
// 7. ProxyBuilder —— 策略组生成
// ============================================================
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

// ============================================================
// 8. DNSBuilder —— DNS 架构（Smart 分流 + respect-rules）
// ============================================================
const applyDns = (cfg) => {
  const dns = cfg.dns || {};
  const userFakeIpFilter = Array.isArray(dns["fake-ip-filter"])
    ? dns["fake-ip-filter"]
    : [];

  // Fake-IP 黑名单：仅保留 private/cn/lan/stun/ntp/connectivity-check（Plan 2）
  const fakeIpFilter = uniq([
    // private
    "rule-set:private",
    // cn
    "rule-set:cn",
    "+.cn",
    // lan
    "+.lan",
    "+.local",
    "localhost",
    "*.localhost",
    // stun（WebRTC / 主机游戏 NAT 穿透）
    "+.stun.*.*",
    "+.stun.*.*.*",
    "+.stun.*.*.*.*",
    // ntp
    "rule-set:category-ntp",
    // connectivity-check：不能整组引用！该规则集包含 www.gstatic.com /
    // connectivitycheck.gstatic.com（Google 全系联网探测与静态资源域名），
    // 整组豁免 fake-ip 会使其经真实 IP 解析，在国内拿到污染 IP 后即使
    // 规则命中代理也会拨向坏 IP。此处仅豁免非 Google 的系统探测域名。
    "+.msftconnecttest.com",
    "+.msftncsi.com",
    "+.captive.apple.com",
    // 保留用户既有条目
    ...userFakeIpFilter,
  ]);

  cfg.dns = {
    ...dns,
    enable: true,
    listen: "0.0.0.0:1053",
    ipv6: true,
    "cache-algorithm": "arc",
    "prefer-h3": false, // 官方明确：respect-rules 与 prefer-h3 不建议同开
    "use-hosts": true,
    "use-system-hosts": true,

    // respect-rules=true：DNS 解析遵循分流规则，配合 policy 做 Smart 分流（Plan 1）
    "respect-rules": true,

    "enhanced-mode": "fake-ip",
    "fake-ip-range": FAKE_IP_RANGE,
    "fake-ip-range6": FAKE_IP_RANGE6,
    "fake-ip-filter-mode": "blacklist",
    "fake-ip-filter": fakeIpFilter,

    // bootstrap：解析下方 DoH 域名本身。首位 system 兼容校园网未认证
    // 阶段（此时公共 DNS 未必可达），其后为纯 IP 公共 DNS 兜底。
    "default-nameserver": ["system", ...DNS_SERVERS.BOOTSTRAP],

    // 默认解析：国际 DoH（防 DNS 泄露核心！）。
    // fake-ip 模式下 A/AAAA 由本地 fake-ip 应答，但浏览器普遍会发
    // HTTPS(TYPE65) 等非 A/AAAA 查询，加上其他需真实解析的场景，
    // 都会打到这里的默认上游——若默认是国内 DoH，境外域名的查询将由
    // 国内解析商发出（泄露测试直接显示中国 DNS）。respect-rules=true
    // 使国际 DoH 连接经代理出站，既不泄露、结果也纯净；国内域名族由
    // 下方 policy 白名单接管，不受影响（参见 MetaCubeX/mihomo
    // Discussion#1786 的社区共识方案）。
    nameserver: DNS_SERVERS.GLOBAL_DOH,

    // 解析代理节点服务器域名：必须在【直连】状态即可达。
    // 国内网络直连访问 1.1.1.1 / 8.8.8.8 的 DoH(443) 常被阻断，会导致
    // 节点域名解析失败、所有节点测速超时。改用国内加密 DoH：既国内可达，
    // 又因 DoH 加密不受 GFW 污染（alidns/doh.pub 不会篡改机场自有域名）。
    "proxy-server-nameserver": DNS_SERVERS.CN_DOH,

    // Smart 分流核心：按规则集精确指派上游 DNS
    // 语法注意：多规则集合并到一个 key 时，`rule-set:` 前缀只写一次，
    // 后接逗号分隔的名称（mihomo config.go parseNameServerPolicy 按
    // 首个冒号切分前缀，再按逗号切分名称；重复前缀会被解析成
    // 名为 "rule-set" 的规则集导致 "not found rule-set" 启动错误）。
    // 注：nameserver-policy 是 YAML Map（字典），key 顺序在规范层面
    // 无保证。此处各 key 引用的 rule-set 域名集合**互不重叠**，因此
    // 不存在顺序依赖——任一域名只会命中唯一的 key。真正依赖顺序的
    // 是 rules 数组（见上方 google vs google-cn 的注释）。
    "nameserver-policy": {
      // 内网/私有域名 → 系统 DNS 优先（校园网内网仅系统 DNS 可解析）
      "rule-set:private": ["system", ...DNS_SERVERS.CN_DOH],
      // 需翻墙域名族（Google/YouTube/AI/GFW/Telegram/Spotify）→ 国际 DoH
      "rule-set:google,googlefcm,youtube,gfw,telegram,spotify,category-ai,openai,anthropic,perplexity,cursor,notion":
        DNS_SERVERS.GLOBAL_DOH,
      // 国内域名族 → 国内 DoH（白名单式：仅明确国内的才走国内解析）
      "rule-set:cn,apple-cn,google-cn,microsoft-cn,steam-cn":
        DNS_SERVERS.CN_DOH,
    },
  };

  // DoH 域名预解析加速 + 特殊映射
  cfg.hosts = {
    ...(cfg.hosts || {}),
    "dns.alidns.com": ["223.5.5.5", "223.6.6.6"],
    "doh.pub": ["1.12.12.12", "120.53.53.53"],
    "services.googleapis.cn": "services.googleapis.com",
    "+.mcdn.bilivideo.com": ["0.0.0.0"], // 屏蔽 B 站 P2P CDN 回源
    "+.mcdn.bilivideo.cn": ["0.0.0.0"],
  };
};

// ============================================================
// 9. RuntimeBuilder —— 运行时 / Sniffer / TUN
// ============================================================
const applyRuntime = (cfg) => {
  cfg.mode = "rule";
  cfg["log-level"] = "warning"; // 降低日志开销
  cfg["tcp-concurrent"] = true; // 多 IP 并发握手，降低连接延迟
  cfg["unified-delay"] = true; // 统一延迟统计口径，测速更准
  cfg["find-process-mode"] = "off"; // 无进程规则，关闭以提升性能
  // 注：global-client-fingerprint 已从新版内核移除，如需 TLS 指纹请在
  // 节点级设置 client-fingerprint，此处不再全局注入。
  cfg["keep-alive-interval"] = 30; // 长连接保活，缓解 FCM 等断流
  cfg["keep-alive-idle"] = 600;
  cfg.profile = {
    ...(cfg.profile || {}),
    "store-selected": true, // 记住手动选择的节点
    "store-fake-ip": false, // 规则更新后避免 fake-ip 缓存错乱
  };
};

const applySniffer = (cfg) => {
  cfg.sniffer = {
    ...(cfg.sniffer || {}),
    enable: true,
    "force-dns-mapping": true,
    "parse-pure-ip": true,
    // 全局关闭强制覆盖：保护 FCM 等长连接，且避免影响 YouTube QUIC（Plan 9）
    "override-destination": false,
    sniff: {
      HTTP: { ports: [80, "8080-8880"], "override-destination": false },
      TLS: { ports: [443, 8443], "override-destination": true },
      QUIC: { ports: [443, 8443], "override-destination": true },
    },
    // 跳过常见无需嗅探的 CDN/内网域名
    "skip-domain": ["Mijia Cloud", "+.push.apple.com", "+.oray.com"],
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
    "endpoint-independent-nat": true, // 改善 P2P / 游戏 NAT（Plan 10）
    "dns-hijack": ["any:53", "tcp://any:53"],
    mtu: 1500, // 通用最优 MTU；弱网可下调至 1280
    "disable-icmp-forwarding": true, // 防 ICMP 转发风暴导致占用飙升
  };
};

// ============================================================
// 10. Main —— 主流程
// ============================================================
function main(config) {
  config = ensureConfigObject(config);
  const originalProxies = getOriginalProxies(config);
  const existingRules = Array.isArray(config.rules) ? config.rules : [];

  // 清理旧版 geodata 相关字段（改用 rule-providers）
  delete config["geodata-mode"];
  delete config["geo-auto-update"];
  delete config["geo-update-interval"];
  delete config["geox-url"];

  // 规则集与规则
  config["rule-providers"] = {
    ...(config["rule-providers"] || {}),
    ...buildRuleProviders(),
  };
  config.rules = mergeRules(STATIC_RULES, pickDirectRules(existingRules));

  // 节点分类与策略组
  if (originalProxies.length) {
    makeProxyNamesUnique(originalProxies);
    const filtered = filterCustomProxies(originalProxies, CUSTOM_FILTER);
    const { infoProxies, normalProxies } = splitInfoAndNormalProxies(
      filtered,
      SETTINGS.INFO_FILTER,
    );

    const allNames = uniq(normalProxies.map((p) => p.name));
    const infoNames = uniq(infoProxies.map((p) => p.name));

    const {
      activeRegions,
      activeRegionNameSet,
      activeRegionMap,
      otherProxyNames,
    } = classifyProxiesByRegion(normalProxies, REGIONS);
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
    // 无节点时仍产出基础结构（含 GLOBAL）
    config["proxy-groups"] = buildProxyGroups({
      allNames: [],
      allAiNames: [],
      activeRegionMap: new Map(),
      activeRegionNameSet: new Set(),
      otherProxyNames: [],
      infoNames: [],
    });
  }

  // 网络与运行时
  applyRuntime(config);
  applySniffer(config);
  applyTun(config);
  applyDns(config);

  return config;
}
