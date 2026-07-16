// ============================================================
// 0. 用户自定义区（按需修改，留空即不生效）
// ============================================================

/** 强制直连的域名（后缀匹配） */
export const BYPASS_DOMAINS: string[] = ["example.com", "example.org"];

/** 强制走代理的域名（精确匹配；完整版出口为 main 组，极简版为「全部」组） */
export const FORCE_PROXY_DOMAINS: string[] = ["test.com", "test.org"];

/** 需要从订阅中剔除的节点名过滤器（正则） */
export const CUSTOM_FILTER = /示例占位符1|示例占位符2|示例占位符3/i;
