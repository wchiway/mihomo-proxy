import { DNS_SERVERS, FAKE_IP_RANGE, FAKE_IP_RANGE6 } from "./settings";
import { uniq } from "./utils";
import type { ClashConfig } from "./types";

// ============================================================
// 8. DNSBuilder —— DNS 架构（Smart 分流 + respect-rules）
// ============================================================

export const applyDns = (cfg: ClashConfig): void => {
  const dns = cfg.dns || {};
  const userFakeIpFilter: string[] = Array.isArray(dns["fake-ip-filter"])
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
    // 注：nameserver-policy 按书写顺序自上而下匹配（内核以有序 Map
    // 读取）。多数 key 引用的 rule-set 域名集合互不重叠，唯一的刻意
    // 顺序依赖：category-ntp 含 time.google.com，与 google 族重叠，
    // 必须放在 google 族之后，使 time.google.com 保持国际 DoH（其
    // 连接被 google 规则送代理，需要纯净解析）。真正依赖顺序的还有
    // rules 数组（见 rules.ts 中 google vs google-cn 的注释）。
    "nameserver-policy": {
      // 内网/私有域名 → 系统 DNS 优先（校园网内网仅系统 DNS 可解析）
      "rule-set:private": ["system", ...DNS_SERVERS.CN_DOH],
      // 需翻墙域名族（Google/YouTube/AI/GFW/Telegram/Spotify）→ 国际 DoH
      "rule-set:google,googlefcm,youtube,gfw,telegram,spotify,category-ai,openai,anthropic,perplexity,cursor,notion":
        DNS_SERVERS.GLOBAL_DOH,
      // 豁免 fake-ip 的 NTP/联网探测域名需要真实解析，必须显式指到
      // 直连可达的上游：若落到默认 nameserver（国际 DoH，respect-rules
      // 下经代理出站），开机代理未就绪时 NTP 域名解析失败 → 系统时间
      // 偏差 → TLS 握手全挂 → 代理更连不上（鸡生蛋死锁）；NCSI 探测
      // 同理会误报"无 Internet"。system 置首兼容校园网未认证阶段。
      "rule-set:category-ntp": ["system", ...DNS_SERVERS.CN_DOH],
      "+.msftconnecttest.com": ["system", ...DNS_SERVERS.CN_DOH],
      "+.msftncsi.com": ["system", ...DNS_SERVERS.CN_DOH],
      "+.captive.apple.com": ["system", ...DNS_SERVERS.CN_DOH],
      // Steam 下载 CDN 直连（见 rules.ts）：DNS 也走国内 DoH，
      // 解析到国内/就近 CDN 边缘节点，直连才能跑满带宽；若落到默认
      // 国际 DoH（经代理出站），会拿到境外边缘节点，直连反而绕远。
      "+.steamcontent.com": DNS_SERVERS.CN_DOH,
      "+.steamserver.net": DNS_SERVERS.CN_DOH,
      "+.steampipe.akamaized.net": DNS_SERVERS.CN_DOH,
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
