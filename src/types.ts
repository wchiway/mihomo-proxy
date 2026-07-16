/**
 * 类型定义 —— Clash/Mihomo 配置对象刻意保持宽松：
 * boa 运行时传入的是 YAML 转 JSON 的动态对象，过度收窄类型
 * 反而会在字段演进时制造维护负担。
 */

/** Mihomo 配置对象（YAML → JSON） */
export type ClashConfig = Record<string, any>;

/** 订阅中的代理节点 */
export interface Proxy {
  name: string;
  [key: string]: any;
}

/** 策略组 */
export interface ProxyGroup {
  name: string;
  type: string;
  proxies: string[];
  icon?: string;
  [key: string]: any;
}

/** 地区定义 */
export interface Region {
  name: string;
  pattern: string[];
  icon: string;
}

/** 附带编译后正则的地区 */
export interface CompiledRegion extends Region {
  regex: RegExp;
}

/** 分类后的地区节点组 */
export interface RegionGroup {
  name: string;
  icon: string;
  proxies: string[];
}
