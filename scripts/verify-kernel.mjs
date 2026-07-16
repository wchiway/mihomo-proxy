/**
 * 双级校验的第 2 级：用真实 mihomo 内核对 verify.mjs 导出的 YAML
 * 跑 `-t` 配置测试，抓 V8 断言层抓不到的内核 schema 错误
 * （字段拼写、类型不符、nameserver-policy 语法、rule-set 引用等）。
 *
 * 内核定位顺序：
 *   1. 环境变量 MIHOMO_BIN
 *   2. PATH 中的 mihomo / mihomo.exe
 *   3. 常见客户端安装路径（Sparkle / Clash Verge Rev）
 * 找不到则跳过并以退出码 0 结束（CI 中由 workflow 显式下载内核）。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));

const findKernel = () => {
  if (process.env.MIHOMO_BIN && existsSync(process.env.MIHOMO_BIN)) {
    return process.env.MIHOMO_BIN;
  }
  const candidates = [
    "mihomo",
    "mihomo.exe",
    "D:\\Sparkle\\resources\\sidecar\\mihomo.exe",
    "D:\\Clash Verge\\verge-mihomo.exe",
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ["-v"], { stdio: "pipe" });
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
};

const kernel = findKernel();
if (!kernel) {
  console.log("⊘ 未找到 mihomo 内核，跳过第 2 级校验（可设置 MIHOMO_BIN 指定路径）");
  process.exit(0);
}

const version = execFileSync(kernel, ["-v"], { encoding: "utf8" }).split("\n")[0];
console.log(`内核：${version}`);

let failed = false;
for (const file of ["test-full.yaml", "test-simple.yaml"]) {
  const cfg = path.join(distDir, file);
  if (!existsSync(cfg)) {
    console.error(`✗ ${file} 不存在，请先运行 pnpm build`);
    failed = true;
    continue;
  }
  try {
    // -d 指向 dist：规则集缓存路径 ./rules 落在 dist 下，不污染仓库
    const out = execFileSync(kernel, ["-t", "-d", distDir, "-f", cfg], {
      encoding: "utf8",
    });
    const line = out.trim().split("\n").pop();
    console.log(`✓ ${file} 内核 -t 通过：${line}`);
  } catch (e) {
    console.error(`✗ ${file} 内核 -t 失败：\n${e.stdout || ""}${e.stderr || e.message}`);
    failed = true;
  }
}

process.exitCode = failed ? 1 : 0;
