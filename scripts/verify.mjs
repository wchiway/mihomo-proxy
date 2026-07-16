/**
 * 产物冒烟验证（双级校验的第 1 级）：
 * 用 node:vm 模拟 boa_engine 的调用方式 —— `{script}; main(config, name)`，
 * 在无 module/require 的裸沙箱中执行 dist 产物并断言关键结构。
 * 通过后：
 *   1. 导出 dist/test-full.yaml / dist/test-simple.yaml 供第 2 级
 *      真实内核校验（scripts/verify-kernel.mjs 或 CI）
 *   2. 将产物同步到仓库根目录（发布位置）
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import vm from "node:vm";
import yaml from "js-yaml";

let failed = false;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ${msg}`);
    failed = true;
  } else {
    console.log(`✓ ${msg}`);
  }
};

const CN_DOH = ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"];
const GLOBAL_DOH = ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"];

/** 内核合法的样例节点（-t 校验要求 ss 节点字段完整） */
const sampleProxy = (name) => ({
  name,
  type: "ss",
  server: "203.0.113.1",
  port: 443,
  cipher: "aes-128-gcm",
  password: "verify-only",
  udp: true,
});

const sampleConfig = () => ({
  "mixed-port": 7890,
  proxies: [
    sampleProxy("🇭🇰 香港 IEPL 01"),
    sampleProxy("🇯🇵 日本 02 0.5x"),
    sampleProxy("🇺🇸 美国 GAME"),
    sampleProxy("🇸🇬 新加坡 BGP"),
    sampleProxy("剩余流量：100GB"),
    sampleProxy("🇭🇰 香港 IEPL 01"), // 故意重名
  ],
  rules: ["DOMAIN-SUFFIX,mycompany.com,DIRECT", "MATCH,Proxy"],
});

/** 在裸沙箱中按 boa 的调用约定执行产物 */
const runScript = (file, cfg) => {
  const script = readFileSync(new URL(`../dist/${file}`, import.meta.url), "utf8");
  const sandbox = vm.createContext({ console });
  return new vm.Script(
    `${script};\nJSON.parse(JSON.stringify(main(${JSON.stringify(cfg)}, "verify")))`,
  ).runInContext(sandbox);
};

/** 两个版本共同的断言（DNS 防泄露铁律 / 规则一致性 / 节点处理） */
const assertCommon = (tag, result) => {
  assert(typeof result === "object" && !!result, `[${tag}] main 返回对象`);
  assert(result.dns?.["respect-rules"] === true, `[${tag}] DNS respect-rules=true`);
  assert(
    JSON.stringify(result.dns?.nameserver) === JSON.stringify(GLOBAL_DOH),
    `[${tag}] 默认 nameserver 为国际 DoH（防 DNS 泄露铁律）`,
  );
  assert(
    JSON.stringify(result.dns?.["proxy-server-nameserver"]) === JSON.stringify(CN_DOH),
    `[${tag}] proxy-server-nameserver 为国内 DoH`,
  );
  assert(
    result.dns?.["nameserver-policy"]?.["rule-set:cn,apple-cn,google-cn,microsoft-cn,steam-cn"] !== undefined,
    `[${tag}] nameserver-policy 国内白名单存在`,
  );
  assert(
    JSON.stringify(result.dns?.["nameserver-policy"]?.["+.steamcontent.com"]) === JSON.stringify(CN_DOH),
    `[${tag}] Steam 下载 CDN 的 DNS 指向国内 DoH`,
  );

  const rules = result.rules ?? [];
  const steamDirectIdx = rules.indexOf("DOMAIN-SUFFIX,steamcontent.com,DIRECT");
  const steamRuleIdx = rules.findIndex((r) => /^RULE-SET,steam,/.test(r));
  assert(
    steamDirectIdx > -1 && steamRuleIdx > -1 && steamDirectIdx < steamRuleIdx,
    `[${tag}] Steam 下载 CDN 直连且位于 steam 规则集之前`,
  );
  assert(rules.includes("DOMAIN-SUFFIX,mycompany.com,DIRECT"), `[${tag}] 用户 DIRECT 规则被保留合并`);
  assert(/^MATCH,/.test(rules[rules.length - 1] ?? ""), `[${tag}] MATCH 兜底在末位`);

  // 每条 RULE-SET 引用的规则集都必须已定义
  const providerKeys = Object.keys(result["rule-providers"] ?? {});
  const missing = rules
    .map((r) => String(r).match(/^RULE-SET,([^,]+),/)?.[1])
    .filter((k) => k && !providerKeys.includes(k));
  assert(missing.length === 0, `[${tag}] 规则集引用一致（缺失：${missing.join(",") || "无"}）`);

  // 重名节点去冲突
  const names = (result.proxies ?? []).map((p) => p.name);
  assert(new Set(names).size === names.length, `[${tag}] 节点重名已去冲突`);

  // 每条规则的出口必须是存在的策略组 / DIRECT / REJECT / 节点名
  const groupNames = new Set((result["proxy-groups"] ?? []).map((g) => g.name));
  const validTargets = new Set([...groupNames, ...names, "DIRECT", "REJECT", "REJECT-DROP", "PASS"]);
  const badTargets = rules
    .map((r) => {
      const parts = String(r).split(",");
      return parts[0] === "MATCH" ? parts[1] : parts[2];
    })
    .filter((t) => t && !validTargets.has(t));
  assert(badTargets.length === 0, `[${tag}] 规则出口均有对应策略组（异常：${badTargets.join(",") || "无"}）`);
};

// ============ 完整版 ============
const full = runScript("mihomo-proxy.js", sampleConfig());
assertCommon("full", full);
{
  const groups = full["proxy-groups"] ?? [];
  const names = groups.map((g) => g.name);
  for (const g of ["main", "All", "AI", "Google", "YouTube", "Telegram", "Steam", "Apple", "Microsoft", "GLOBAL", "HK", "JP", "US", "SG", "info"]) {
    assert(names.includes(g), `[full] 策略组存在：${g}`);
  }
  assert(full.rules[0] === "RULE-SET,category-ads-all,REJECT", "[full] 广告规则出口为 REJECT");
  const aiGroup = groups.find((g) => g.name === "AI");
  assert(aiGroup && !aiGroup.proxies.includes("HK"), "[full] AI 组排除 HK");
  const emptyFull = runScript("mihomo-proxy.js", {});
  assert((emptyFull["proxy-groups"] ?? []).some((g) => g.name === "GLOBAL"), "[full] 无节点时仍产出 GLOBAL");
}

// ============ 极简版 ============
const simple = runScript("simple-mihomo.js", sampleConfig());
assertCommon("simple", simple);
{
  const groups = simple["proxy-groups"] ?? [];
  const names = groups.map((g) => g.name);
  assert(
    JSON.stringify(names) === JSON.stringify(["自动测速", "全部", "AI 自动测速", "AI", "广告拦截"]),
    `[simple] 策略组恰为五个（含两个隐藏测速组）：${names.join(" / ")}`,
  );
  assert(simple.rules[0] === "RULE-SET,category-ads-all,广告拦截", "[simple] 广告规则出口为「广告拦截」组");
  assert(simple.rules.includes("RULE-SET,google,全部"), "[simple] google 出口收敛到「全部」");
  assert(simple.rules[simple.rules.length - 1] === "MATCH,全部", "[simple] MATCH 出口为「全部」");
  const aiGroup = groups.find((g) => g.name === "AI");
  assert(aiGroup && !aiGroup.proxies.some((n) => /香港|🇭🇰/.test(n)), "[simple] AI 组剔除香港节点");
  const adblock = groups.find((g) => g.name === "广告拦截");
  assert(
    adblock && JSON.stringify(adblock.proxies) === JSON.stringify(["REJECT", "DIRECT", "全部"]),
    "[simple] 广告拦截组选项为 REJECT/DIRECT/全部",
  );
  // 双版本规则骨架一致性：剥离出口后应完全相同
  const skeleton = (rules) =>
    rules.map((r) => {
      const parts = String(r).split(",");
      if (parts[0] === "MATCH") return "MATCH";
      return `${parts[0]},${parts[1]}`;
    });
  assert(
    JSON.stringify(skeleton(full.rules)) === JSON.stringify(skeleton(simple.rules)),
    "[两版一致] 规则骨架（类型+匹配对象序列）完全相同",
  );
  const emptySimple = runScript("simple-mihomo.js", {});
  const emptyAll = (emptySimple["proxy-groups"] ?? []).find((g) => g.name === "全部");
  assert(
    emptyAll && JSON.stringify(emptyAll.proxies) === JSON.stringify(["DIRECT"]),
    "[simple] 无节点时「全部」回退 DIRECT",
  );
}

// ============ 导出内核校验用 YAML + 同步产物 ============
if (failed) {
  console.error("\n验证失败，产物未复制到仓库根目录。");
  process.exitCode = 1;
} else {
  writeFileSync(new URL("../dist/test-full.yaml", import.meta.url), yaml.dump(full, { lineWidth: -1 }));
  writeFileSync(new URL("../dist/test-simple.yaml", import.meta.url), yaml.dump(simple, { lineWidth: -1 }));
  copyFileSync(new URL("../dist/mihomo-proxy.js", import.meta.url), new URL("../mihomo-proxy.js", import.meta.url));
  copyFileSync(new URL("../dist/simple-mihomo.js", import.meta.url), new URL("../simple-mihomo.js", import.meta.url));
  console.log("\n全部通过：产物已同步到仓库根目录，内核校验 YAML 已导出到 dist/。");
  console.log("第 2 级校验：pnpm verify:kernel（需本地 mihomo 内核或设置 MIHOMO_BIN）");
}
