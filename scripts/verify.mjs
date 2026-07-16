/**
 * 产物冒烟验证（对齐仓库既有验证流程第 1 级）：
 * 用 node:vm 模拟 boa_engine 的调用方式 —— `{script}; main(config, name)`，
 * 在无 module/require 的裸沙箱中执行 dist 产物并断言关键结构。
 */
import { readFileSync, copyFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync(new URL("../dist/mihomo-proxy.js", import.meta.url), "utf8");

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${msg}`);
  }
};

// 裸沙箱：不注入 require/module/process，贴近 boa 环境
const sandbox = vm.createContext({ console });
const sampleConfig = {
  proxies: [
    { name: "🇭🇰 香港 IEPL 01", type: "ss" },
    { name: "🇯🇵 日本 02 0.5x", type: "ss" },
    { name: "🇺🇸 美国 GAME", type: "ss" },
    { name: "剩余流量：100GB", type: "ss" },
    { name: "🇭🇰 香港 IEPL 01", type: "ss" }, // 故意重名
  ],
  rules: ["DOMAIN-SUFFIX,mycompany.com,DIRECT", "MATCH,Proxy"],
};

const result = new vm.Script(
  `${script};\nJSON.parse(JSON.stringify(main(${JSON.stringify(sampleConfig)}, "test-profile")))`,
).runInContext(sandbox);

// —— 结构断言 ——
assert(typeof result === "object" && result, "main 返回对象");
assert(result.dns?.["respect-rules"] === true, "DNS respect-rules=true（防泄露架构）");
assert(
  JSON.stringify(result.dns?.nameserver) === JSON.stringify(["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"]),
  "默认 nameserver 为国际 DoH（防 DNS 泄露铁律）",
);
assert(
  result.dns?.["nameserver-policy"]?.["rule-set:cn,apple-cn,google-cn,microsoft-cn,steam-cn"] !== undefined,
  "nameserver-policy 国内白名单存在",
);
assert(Array.isArray(result.rules) && result.rules[0] === "RULE-SET,category-ads-all,REJECT", "规则首条为广告拦截");
assert(result.rules.includes("DOMAIN-SUFFIX,mycompany.com,DIRECT"), "用户 DIRECT 规则被保留合并");
assert(result.rules[result.rules.length - 1] === "MATCH,main", "MATCH,main 兜底在末位");
assert(
  result.rules.indexOf("DOMAIN-SUFFIX,steamcontent.com,DIRECT") > -1 &&
    result.rules.indexOf("DOMAIN-SUFFIX,steamcontent.com,DIRECT") < result.rules.indexOf("RULE-SET,steam,Steam"),
  "Steam 下载 CDN 直连且位于 steam 规则集之前",
);
assert(
  JSON.stringify(result.dns?.["nameserver-policy"]?.["+.steamcontent.com"]) ===
    JSON.stringify(["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"]),
  "Steam 下载 CDN 的 DNS 指向国内 DoH",
);

const groups = result["proxy-groups"] ?? [];
const groupNames = groups.map((g) => g.name);
for (const g of ["main", "All", "AI", "Google", "YouTube", "Telegram", "Steam", "Apple", "Microsoft", "GLOBAL", "HK", "JP", "US", "info"]) {
  assert(groupNames.includes(g), `策略组存在：${g}`);
}
const providerKeys = Object.keys(result["rule-providers"] ?? {});
for (const rule of result.rules) {
  const m = String(rule).match(/^RULE-SET,([^,]+),/);
  if (m) assert(providerKeys.includes(m[1]), `规则集引用一致：${m[1]}`);
}
// AI 组不含 HK 直选项（URL Test - AI 之后的地区项）
const aiGroup = groups.find((g) => g.name === "AI");
assert(aiGroup && !aiGroup.proxies.includes("HK"), "AI 组排除 HK");
// 重名节点被改名
const names = result.proxies.map((p) => p.name);
assert(new Set(names).size === names.length, "节点重名已去冲突");

// 无节点配置也能产出
const emptyResult = new vm.Script(`JSON.parse(JSON.stringify(main({}, "empty")))`).runInContext(sandbox);
assert((emptyResult["proxy-groups"] ?? []).some((g) => g.name === "GLOBAL"), "无节点时仍产出 GLOBAL");

if (process.exitCode) {
  console.error("\n验证失败，产物未复制到仓库根目录。");
} else {
  copyFileSync(new URL("../dist/mihomo-proxy.js", import.meta.url), new URL("../mihomo-proxy.js", import.meta.url));
  console.log("\n全部通过，已将 dist/mihomo-proxy.js 同步到仓库根目录 mihomo-proxy.js");
}
