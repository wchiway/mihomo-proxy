/**
 * 极简版打包入口：仅导出 main。
 * 与完整版共享 settings / utils / rule-providers / rules / dns / runtime
 * 模块，差异只在策略组结构（见 simple-main.ts）。
 */
export { simpleMain as main } from "./simple-main";
