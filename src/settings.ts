// ============================================================
// 1. Config —— 常量配置（集中管理，避免魔法值）
// ============================================================

export const SETTINGS = {
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
export const DNS_SERVERS = {
  /** bootstrap（纯 IP，用于解析 DoH 域名本身） */
  BOOTSTRAP: ["223.5.5.5", "119.29.29.29", "1.1.1.1", "8.8.8.8"],
  /** 国内加密 DoH（AliDNS + DNSPod） */
  CN_DOH: ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],
  /** 国际加密 DoH（Cloudflare + Google，IP 形式免 bootstrap） */
  GLOBAL_DOH: ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"],
};

/** Fake-IP 地址池 */
export const FAKE_IP_RANGE = "198.18.0.1/16";
export const FAKE_IP_RANGE6 = "fc00::/18";
