/**
 * 打包入口：仅导出 main。
 * Vite 以 IIFE 格式产出 `var __mihomoProxy = (...)();`，
 * 再由 vite.config.ts 的 footer 注入顶层 `function main(...)`
 * 桥接，满足 Sparkle / Clash Verge Rev (boa_engine) 对脚本
 * `{script}; main(config, profileName)` 的调用约定。
 */
export { main } from "./main";
