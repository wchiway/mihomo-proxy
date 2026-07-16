// ============================================================
// 2. Utils —— 基础工具（含解析结果缓存，减少重复计算）
// ============================================================

/** 数组去重并剔除 falsy */
export const uniq = <T>(arr: T[] = []): T[] => [
  ...new Set(arr.filter(Boolean)),
];

/** 转义正则元字符 */
export const escapeRegex = (s = ""): string =>
  String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 归一化节点名：把国旗 emoji、分隔符统一成带空格的大写 token，
 * 便于后续用词边界正则精确匹配地区/线路。
 */
export const normalizeName = (name = ""): string =>
  String(name)
    .replace(/(IEPL|IPLC|BGP|RELAY|PRO|V\d+)/gi, " $1 ")
    .replace(/[【】\[\]（）()|_\-.,/:~]/g, " ")
    .replace(/🇭🇰/g, " HK ")
    .replace(/🇹🇼/g, " TW ")
    .replace(/🇸🇬/g, " SG ")
    .replace(/🇯🇵/g, " JP ")
    .replace(/🇰🇷/g, " KR ")
    .replace(/🇺🇸/g, " US ")
    .replace(/🇦🇺/g, " AU ")
    .replace(/🇪🇺|🇩🇪|🇫🇷|🇬🇧|🇳🇱|🇷🇺|🇮🇹|🇪🇸|🇸🇪|🇨🇭|🇵🇱|🇫🇮|🇹🇷|🇮🇪|🇦🇹|🇧🇪/g, " EU ")
    .replace(/🇻🇳|🇹🇭|🇲🇾|🇮🇩|🇵🇭|🇮🇳/g, " AS ")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * 由关键词数组构建匹配正则；2~3 位纯字母（如 HK/JP/USA）加词边界，
 * 避免误伤（例如 "US" 命中 "PLUS"）。
 */
export const buildRegex = (arr: string[] = []): RegExp =>
  new RegExp(
    arr
      .map((raw) => {
        const token = String(raw).trim().toUpperCase();
        const escaped = escapeRegex(token);
        return /^[A-Z]{2,3}$/.test(token)
          ? `(?:^|[^A-Z])${escaped}(?:[^A-Z]|$)`
          : escaped;
      })
      .join("|"),
    "i",
  );

// ---- 倍率解析（带缓存） ----
const _mulCache = new Map<string, number>();
/**
 * 从节点名解析计费倍率（如 "0.2x" / "1倍" / "2X"）。
 * 未标注时默认 1。用于策略组内自动排序。
 */
export const parseMultiplier = (name = ""): number => {
  const cached = _mulCache.get(name);
  if (cached !== undefined) return cached;
  let val = 1;
  const m = String(name).match(/(\d+(?:\.\d+)?)\s*(?:x|倍|×|✕)/i);
  if (m) {
    const v = parseFloat(m[1]);
    if (v > 0 && v < 100) val = v;
  }
  _mulCache.set(name, val);
  return val;
};

// ---- 线路类型解析（带缓存） ----
const _lineCache = new Map<string, string>();
const LINE_TAGS: Array<{ tag: string; re: RegExp }> = [
  { tag: "IEPL", re: /IEPL/i },
  { tag: "IPLC", re: /IPLC/i },
  { tag: "BGP", re: /BGP/i },
  { tag: "GAME", re: /GAME|游戏|游戲/i },
  { tag: "HOME", re: /RESIDENT|HOME|住宅|家宽|家寬|原生|NATIVE/i },
];
/** 解析节点线路类型（专线 / 游戏 / 家宽等），无标注返回 ""。 */
export const parseLineType = (name = ""): string => {
  const cached = _lineCache.get(name);
  if (cached !== undefined) return cached;
  let tag = "";
  for (const t of LINE_TAGS) {
    if (t.re.test(name)) {
      tag = t.tag;
      break;
    }
  }
  _lineCache.set(name, tag);
  return tag;
};

/** 线路优先级：专线(IEPL/IPLC) > BGP > 其他，数值越小越靠前。 */
export const lineRank = (tag: string): number =>
  tag === "IEPL" || tag === "IPLC" ? 0 : tag === "BGP" ? 1 : 2;

/**
 * 节点自动排序：先按线路质量，再按倍率升序（省流量优先），最后按名称。
 * 让优质/低倍率线路稳定地出现在 select 组顶部。
 */
export const sortProxyNames = (names: string[] = []): string[] =>
  names.slice().sort((a, b) => {
    const lr = lineRank(parseLineType(a)) - lineRank(parseLineType(b));
    if (lr !== 0) return lr;
    const mr = parseMultiplier(a) - parseMultiplier(b);
    if (mr !== 0) return mr;
    return a.localeCompare(b);
  });
