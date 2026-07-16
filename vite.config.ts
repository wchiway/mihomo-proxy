import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * 打包目标：Clash Verge Rev 的 boa_engine 运行时。
 * 约束：
 *  - 产物必须是单文件普通脚本（非 ESM，boa 以 `{script}; main(config, name)` 求值）
 *  - 顶层作用域必须存在可调用的 `main` → 用 IIFE + footer 桥接
 *  - boa 支持 90%+ 最新 ES 规范，target es2020 安全
 */
const BANNER = `/**
 * mihomo-proxy — Ultimate Stable Edition v2.2
 * ------------------------------------------------------------------
 * 面向 Clash Verge Rev / 最新 Mihomo(Clash.Meta) 内核的配置增强脚本。
 * 本文件由 vite build 自动生成，请勿手改；源码见 src/ 目录。
 *
 * 仓库地址：https://github.com/wchiway/mihomo-proxy
 * 脚本链接：https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/mihomo-proxy.js
 * 客户端推荐：https://github.com/xishang0128/sparkle
 * 提醒：使用系统代理时 fake-ip 不会生效，建议使用 TUN 模式。
 */`;

const FOOTER = `
// Clash Verge Rev (boa_engine) 入口桥接：脚本被求值后直接调用顶层 main
function main(config, profileName) {
  return __mihomoProxy.main(config, profileName);
}`;

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "__mihomoProxy",
      formats: ["iife"],
      fileName: () => "mihomo-proxy.js",
    },
    target: "es2020",
    minify: false, // 保持产物可读、便于用户审计
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        banner: BANNER,
        footer: FOOTER,
      },
    },
  },
});
