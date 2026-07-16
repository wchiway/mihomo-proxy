import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * 打包目标：Clash Verge Rev / Sparkle 的 boa_engine 运行时。
 * 约束：
 *  - 产物必须是单文件普通脚本（非 ESM，boa 以 `{script}; main(config, name)` 求值）
 *  - 顶层作用域必须存在可调用的 `main` → 用 IIFE + footer 桥接
 *  - boa 支持 90%+ 最新 ES 规范，target es2020 安全
 *
 * 双产物：默认 mode 构建完整版，`vite build --mode simple` 构建极简版。
 * （Vite 库模式的 IIFE 不支持多 entry，故用 mode 区分、两次构建。）
 */

const FULL = {
  entry: "src/index.ts",
  name: "__mihomoProxy",
  fileName: "mihomo-proxy.js",
  banner: `/**
 * mihomo-proxy — Ultimate Stable Edition v2.3
 * ------------------------------------------------------------------
 * 面向 Clash Verge Rev / 最新 Mihomo(Clash.Meta) 内核的配置增强脚本。
 * 本文件由 vite build 自动生成，请勿手改；源码见 src/ 目录。
 *
 * 仓库地址：https://github.com/wchiway/mihomo-proxy
 * 脚本链接：https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/mihomo-proxy.js
 * 客户端推荐：https://github.com/xishang0128/sparkle
 * 提醒：使用系统代理时 fake-ip 不会生效，建议使用 TUN 模式。
 */`,
};

const SIMPLE = {
  entry: "src/simple.ts",
  name: "__mihomoSimple",
  fileName: "simple-mihomo.js",
  banner: `/**
 * simple-mihomo — 极简业务分流版 v1.2
 * ------------------------------------------------------------------
 * mihomo-proxy.js 的极简姊妹版：保留全部业务分流与 DNS/TUN 优化，
 * 但策略组只有三个，节点不做地区分组，简洁好理解：
 *
 *   全部     —— 所有节点（内置自动测速，默认自动选优）
 *   AI       —— 可访问 AI 服务的纯净节点（自动剔除香港）
 *   广告拦截 —— REJECT（默认拦截）/ DIRECT / 全部 三选一
 *
 * 业务分流规则与 mihomo-proxy.js 共享同一份源码模块（src/），
 * 构建期即保证两版规则/DNS 架构一致，不再手工同步。
 * 本文件由 vite build 自动生成，请勿手改；源码见 src/ 目录。
 *
 * 仓库地址：https://github.com/wchiway/mihomo-proxy
 * 脚本链接：https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/simple-mihomo.js
 * 提醒：使用系统代理时 fake-ip 不会生效，建议使用 TUN 模式。
 */`,
};

export default defineConfig(({ mode }) => {
  const variant = mode === "simple" ? SIMPLE : FULL;
  return {
    build: {
      lib: {
        entry: resolve(__dirname, variant.entry),
        name: variant.name,
        formats: ["iife"],
        fileName: () => variant.fileName,
      },
      target: "es2020",
      minify: false, // 保持产物可读、便于用户审计
      outDir: "dist",
      // 完整版先构建并清空 dist，极简版随后追加
      emptyOutDir: mode !== "simple",
      rolldownOptions: {
        output: {
          banner: variant.banner,
          footer: `
// Clash Verge Rev (boa_engine) 入口桥接：脚本被求值后直接调用顶层 main
function main(config, profileName) {
  return ${variant.name}.main(config, profileName);
}`,
        },
      },
    },
  };
});
