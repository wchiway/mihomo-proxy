/**
 * simple-mihomo — 极简业务分流版 v1.1
 * ------------------------------------------------------------------
 * mihomo-proxy.js 的极简姊妹版：保留全部业务分流与 DNS/TUN 优化，
 * 但策略组只有三个，节点不做地区分组，简洁好理解：
 *
 *   全部     —— 所有节点（内置自动测速，默认自动选优）
 *   AI       —— 可访问 AI 服务的纯净节点（自动剔除香港，OpenAI 等封锁 HK 出口）
 *   广告拦截 —— REJECT（默认拦截）/ DIRECT / 全部 三选一
 *
 * 业务分流规则与 mihomo-proxy.js 保持一致（Google/YouTube/Telegram/
 * Steam/Apple/Microsoft/AI/国内直连），仅将出口收敛到上述三组。
 * 继承的关键修正（勿改动顺序/写法，注释注明原因）：
 *   1. google(代理) 必须先于 google-cn(直连) —— google-cn 列表混有
 *      connectivitycheck.gstatic.com / fonts.googleapis.com 等全球域名。
 *   2. nameserver-policy 多规则集 key 只写一次 rule-set: 前缀，
 *      且国际 DoH 族先于国内族匹配。
 *   3. proxy-server-nameserver 用国内加密 DoH（直连可达 + 防污染）。
 *   4. fake-ip 黑名单不整组引用 connectivity-check（内含 gstatic）。
 *
 * 提醒：使用系统代理时 fake-ip 不会生效，建议使用 TUN 模式。
 * 仓库地址：https://github.com/wchiway/mihomo-proxy
 */

// ============================================================
// 0. 用户自定义区（按需修改，留空即不生效）
// ============================================================
/** 强制直连的域名（后缀匹配） */
const BYPASS_DOMAINS = ["example.com", "example.org"];
/** 强制走代理(全部)的域名（精确匹配） */
const FORCE_PROXY_DOMAINS = ["test.com", "test.org"];
/** 需要从订阅中剔除的节点名过滤器（正则） */
const CUSTOM_FILTER = /示例占位符1|示例占位符2|示例占位符3/i;

// ============================================================
// 1. Config —— 常量配置
// ============================================================
/** 三个策略组的名称（规则出口统一引用这里，避免魔法字符串） */
const GROUPS = {
  ALL: "全部",
  AI: "AI",
  ADBLOCK: "广告拦截",
};

const SETTINGS = {
  ICON_BASE:
    "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/",
  RULE_PROVIDER_URL_BASE:
    "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo",
  RULE_PROVIDER_PATH: "./rules",
  PROVIDER_INTERVAL: 86400,

  /** url-test 自动测速参数 */
  URL_TEST_EXTRA: {
    hidden: true,
    url: "https://www.gstatic.com/generate_204",
    interval: 300,
    tolerance: 50,
    lazy: true,
    timeout: 5000,
    "max-failed-times": 3,
  },

  /** 机场信息类节点（到期/官网/流量等）识别过滤器，命中则不进入策略组 */
  INFO_FILTER:
    /tg|telegram|倒卖|到期|电报|订阅|发布|防止|返利|购买|官方|官网|工单|过期|规则|建议|客服|联系|流量|剩余|失联|网址|邮箱|续费|邀请|重置|梯子|群/i,

  /** 香港节点识别（AI 组需剔除，OpenAI/Claude 等常封锁 HK 出口） */
  HK_FILTER: /香港|HK|HKG|HONGKONG|HONG KONG|🇭🇰/i,
};

/** DNS 服务器常量 */
const DNS_SERVERS = {
  /** bootstrap（纯 IP，用于解析 DoH 域名本身） */
  BOOTSTRAP: ["223.5.5.5", "119.29.29.29", "1.1.1.1", "8.8.8.8"],
  /** 国内加密 DoH（AliDNS + DNSPod） */
  CN_DOH: ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],
  /** 国际加密 DoH（Cloudflare + Google，IP 形式免 bootstrap） */
  GLOBAL_DOH: ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"],
};

const FAKE_IP_RANGE = "198.18.0.1/16";
const FAKE_IP_RANGE6 = "fc00::/18";

// ============================================================
// 2. Utils —— 基础工具
// ============================================================
const uniq = (arr = []) => [...new Set(arr.filter(Boolean))];

/**
 * 从节点名解析计费倍率（如 "0.2x" / "1倍" / "2X"），未标注默认 1。
 * 用于「全部/AI」组内排序：低倍率省流量，排前面。
 */
const parseMultiplier = (name = "") => {
  const m = String(name).match(/(\d+(?:\.\d+)?)\s*(?:x|倍|×|✕)/i);
  if (!m) return 1;
  const v = parseFloat(m[1]);
  return v > 0 && v < 100 ? v : 1;
};

/** 专线(IEPL/IPLC) > BGP > 普通线路 的排序权重 */
const lineRank = (name = "") =>
  /IEPL|IPLC/i.test(name) ? 0 : /BGP/i.test(name) ? 1 : 2;

/** 节点排序：线路质量 → 倍率升序 → 名称 */
const sortProxyNames = (names = []) =>
  names.slice().sort((a, b) => {
    const lr = lineRank(a) - lineRank(b);
    if (lr !== 0) return lr;
    const mr = parseMultiplier(a) - parseMultiplier(b);
    if (mr !== 0) return mr;
    return a.localeCompare(b);
  });

// ============================================================
// 3. RuleProviders —— 规则集（逻辑 key ↔ 远端文件名解耦）
// ------------------------------------------------------------
// MetaCubeX 仓库不存在 microsoft-cn / steam-cn，真实文件为
// microsoft@cn / steam@cn；key 用安全名，file 用远端真实名。
// ============================================================
const GEOSITE_PROVIDERS = [
  { key: "category-ads-all", file: "category-ads-all" },
  { key: "private", file: "private" },
  { key: "cn", file: "cn" },
  { key: "google", file: "google" },
  { key: "google-cn", file: "google-cn" },
  { key: "googlefcm", file: "googlefcm" },
  { key: "youtube", file: "youtube" },
  { key: "apple", file: "apple" },
  { key: "apple-cn", file: "apple-cn" },
  { key: "microsoft", file: "microsoft" },
  { key: "microsoft-cn", file: "microsoft@cn" },
  { key: "telegram", file: "telegram" },
  { key: "spotify", file: "spotify" },
  { key: "steam", file: "steam" },
  { key: "steam-cn", file: "steam@cn" },
  // AI 独立域名（不依赖 gfw）
  { key: "category-ai", file: "category-ai-!cn" },
  { key: "openai", file: "openai" },
  { key: "anthropic", file: "anthropic" },
  { key: "perplexity", file: "perplexity" },
  { key: "cursor", file: "cursor" },
  { key: "notion", file: "notion" },
  // 兜底与基础设施
  { key: "gfw", file: "gfw" },
  { key: "connectivity-check", file: "connectivity-check" },
  { key: "category-ntp", file: "category-ntp" },
];

const GEOIP_PROVIDERS = [
  { key: "private-ip", file: "private" },
  { key: "cn-ip", file: "cn" },
  { key: "google-ip", file: "google" },
  { key: "telegram-ip", file: "telegram" },
];

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

  // Cloudflare 人机验证页直连
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
// 4. Rules —— 业务分流规则（与 mihomo-proxy.js 同构，出口收敛为三组）
// ============================================================
const STATIC_RULES = [
  // 广告拦截（可在「广告拦截」组切 REJECT/DIRECT/全部）
  `RULE-SET,category-ads-all,${GROUPS.ADBLOCK}`,

  // 用户自定义
  ...uniq(BYPASS_DOMAINS).map((d) => `DOMAIN-SUFFIX,${d},DIRECT`),
  ...uniq(FORCE_PROXY_DOMAINS).map((d) => `DOMAIN,${d},${GROUPS.ALL}`),

  // 基础设施：Cloudflare 验证页 / 内网 直连
  "RULE-SET,cloudflare,DIRECT",
  "RULE-SET,private,DIRECT",
  "RULE-SET,private-ip,DIRECT,no-resolve",

  // AI（独立于 gfw，优先匹配以免被 google 抢占）
  `RULE-SET,openai,${GROUPS.AI}`,
  `RULE-SET,anthropic,${GROUPS.AI}`,
  `RULE-SET,perplexity,${GROUPS.AI}`,
  `RULE-SET,cursor,${GROUPS.AI}`,
  `RULE-SET,notion,${GROUPS.AI}`,
  `RULE-SET,category-ai,${GROUPS.AI}`,

  // Google 生态（顺序关键！rules 是有序数组，先匹配先停止）
  // google-cn 列表混有 gstatic.com / googleapis.com 等全球域名，
  // 若 google-cn,DIRECT 放在 google 之前会强制直连 → YouTube 报未联网。
  // 实际效果：google 先消耗所有全球域名，google-cn 仅命中
  // 不在 google 集合中的纯国区域名（google.cn / 265.com 等）。
  `RULE-SET,googlefcm,${GROUPS.ALL}`, // FCM 走代理防推送断流
  `RULE-SET,youtube,${GROUPS.ALL}`,
  `RULE-SET,google,${GROUPS.ALL}`,
  `RULE-SET,google-ip,${GROUPS.ALL},no-resolve`,
  "RULE-SET,google-cn,DIRECT",

  // Telegram（强依赖 IP 段）
  `RULE-SET,telegram,${GROUPS.ALL}`,
  `RULE-SET,telegram-ip,${GROUPS.ALL},no-resolve`,

  // Steam / Apple / Microsoft：国区直连，全球走代理
  "RULE-SET,steam-cn,DIRECT",
  `RULE-SET,steam,${GROUPS.ALL}`,
  "RULE-SET,apple-cn,DIRECT",
  `RULE-SET,apple,${GROUPS.ALL}`,
  "RULE-SET,microsoft-cn,DIRECT",
  `RULE-SET,microsoft,${GROUPS.ALL}`,

  // Spotify
  `RULE-SET,spotify,${GROUPS.ALL}`,

  // 连通性检测 / NTP 直连
  "RULE-SET,connectivity-check,DIRECT",
  "RULE-SET,category-ntp,DIRECT",

  // GFW 兜底走代理
  `RULE-SET,gfw,${GROUPS.ALL}`,

  // 国内直连
  "RULE-SET,cn,DIRECT",
  "RULE-SET,cn-ip,DIRECT,no-resolve",

  // 漏网之鱼走代理
  `MATCH,${GROUPS.ALL}`,
];

/** 保留用户既有 DIRECT 规则（合并到 MATCH 之前） */
const pickDirectRules = (rules = []) =>
  rules.filter((rule) => {
    const r = String(rule || "").trim();
    if (!r || r.startsWith("#")) return false;
    return /,DIRECT(?:,|$)/i.test(r);
  });

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

// ============================================================
// 5. Proxies —— 节点处理（去重 → 过滤 → 分池）
// ============================================================
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

/**
 * 从订阅节点得到两个节点池：
 *   allNames —— 全部可用节点（剔除自定义过滤与信息类节点）
 *   aiNames  —— AI 纯净池（在 allNames 基础上剔除香港；全被剔则回退 allNames）
 */
const buildProxyPools = (proxies = []) => {
  const usable = proxies.filter(
    (p) =>
      p &&
      p.name &&
      !CUSTOM_FILTER.test(p.name) &&
      !SETTINGS.INFO_FILTER.test(p.name),
  );
  const allNames = sortProxyNames(uniq(usable.map((p) => p.name)));
  const nonHk = allNames.filter((n) => !SETTINGS.HK_FILTER.test(n));
  return { allNames, aiNames: nonHk.length ? nonHk : allNames };
};

// ============================================================
// 6. ProxyGroups —— 仅三个策略组：全部 / AI / 广告拦截
// ============================================================
const buildProxyGroups = ({ allNames, aiNames }) => {
  const icon = (f) => SETTINGS.ICON_BASE + f;
  const groups = [];

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
// 7. DNS —— 与 mihomo-proxy.js 相同的 Smart 分流架构
// ============================================================
const applyDns = (cfg) => {
  const dns = cfg.dns || {};
  const userFakeIpFilter = Array.isArray(dns["fake-ip-filter"])
    ? dns["fake-ip-filter"]
    : [];

  // Fake-IP 黑名单：仅 private/cn/lan/stun/ntp/非 Google 系统探测域。
  // 不整组引用 connectivity-check —— 其内含 www.gstatic.com，整组豁免
  // 会让 gstatic 走真实 IP + 国内 DNS 解析，拿到污染 IP 后连代理也救不回。
  const fakeIpFilter = uniq([
    "rule-set:private",
    "rule-set:cn",
    "+.cn",
    "+.lan",
    "+.local",
    "localhost",
    "*.localhost",
    "+.stun.*.*",
    "+.stun.*.*.*",
    "+.stun.*.*.*.*",
    "rule-set:category-ntp",
    "+.msftconnecttest.com",
    "+.msftncsi.com",
    "+.captive.apple.com",
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
    "respect-rules": true, // DNS 出口遵循分流规则

    "enhanced-mode": "fake-ip",
    "fake-ip-range": FAKE_IP_RANGE,
    "fake-ip-range6": FAKE_IP_RANGE6,
    "fake-ip-filter-mode": "blacklist",
    "fake-ip-filter": fakeIpFilter,

    // bootstrap：首位 system 兼容校园网未认证阶段
    "default-nameserver": ["system", ...DNS_SERVERS.BOOTSTRAP],

    // 默认解析：国际 DoH（防 DNS 泄露：境外域名的 TYPE65 等真实查询
    // 不得落到国内解析商；respect-rules 使其经代理出站）
    nameserver: DNS_SERVERS.GLOBAL_DOH,

    // 节点服务器域名解析：必须直连可达 → 国内加密 DoH（DoH 防污染）
    "proxy-server-nameserver": DNS_SERVERS.CN_DOH,

    // Smart 分流：多规则集 key 的 rule-set: 前缀只写一次（内核按首个
    // 冒号切前缀再按逗号切名称）。
    // 注：nameserver-policy 是 YAML Map，key 顺序无规范保证。此处
    // 各 key 引用的 rule-set 域名集合互不重叠，不存在顺序依赖。
    "nameserver-policy": {
      "rule-set:private": ["system", ...DNS_SERVERS.CN_DOH],
      "rule-set:google,googlefcm,youtube,gfw,telegram,spotify,category-ai,openai,anthropic,perplexity,cursor,notion":
        DNS_SERVERS.GLOBAL_DOH,
      "rule-set:cn,apple-cn,google-cn,microsoft-cn,steam-cn":
        DNS_SERVERS.CN_DOH,
    },
  };

  cfg.hosts = {
    ...(cfg.hosts || {}),
    "dns.alidns.com": ["223.5.5.5", "223.6.6.6"],
    "doh.pub": ["1.12.12.12", "120.53.53.53"],
    "services.googleapis.cn": "services.googleapis.com",
    "+.mcdn.bilivideo.com": ["0.0.0.0"],
    "+.mcdn.bilivideo.cn": ["0.0.0.0"],
  };
};

// ============================================================
// 8. Runtime / Sniffer / TUN
// ============================================================
const applyRuntime = (cfg) => {
  cfg.mode = "rule";
  cfg["log-level"] = "warning";
  cfg["tcp-concurrent"] = true;
  cfg["unified-delay"] = true;
  cfg["find-process-mode"] = "off";
  cfg["keep-alive-interval"] = 30;
  cfg["keep-alive-idle"] = 600;
  cfg.profile = {
    ...(cfg.profile || {}),
    "store-selected": true,
    "store-fake-ip": false,
  };
};

const applySniffer = (cfg) => {
  cfg.sniffer = {
    ...(cfg.sniffer || {}),
    enable: true,
    "force-dns-mapping": true,
    "parse-pure-ip": true,
    "override-destination": false, // 保护 FCM 等长连接
    sniff: {
      HTTP: { ports: [80, "8080-8880"], "override-destination": false },
      TLS: { ports: [443, 8443], "override-destination": true },
      QUIC: { ports: [443, 8443], "override-destination": true },
    },
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
    "endpoint-independent-nat": true,
    "dns-hijack": ["any:53", "tcp://any:53"],
    mtu: 1500, // 弱网可下调至 1280
    "disable-icmp-forwarding": true,
  };
};

// ============================================================
// 9. Main
// ============================================================
function main(config) {
  config = config && typeof config === "object" ? config : {};
  const originalProxies = Array.isArray(config.proxies) ? config.proxies : [];
  const existingRules = Array.isArray(config.rules) ? config.rules : [];

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
  config["proxy-groups"] = buildProxyGroups(buildProxyPools(originalProxies));
  if (originalProxies.length) config.proxies = originalProxies;

  applyRuntime(config);
  applySniffer(config);
  applyTun(config);
  applyDns(config);

  return config;
}
