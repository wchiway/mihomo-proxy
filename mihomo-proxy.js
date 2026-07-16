/**
* mihomo-proxy — Ultimate Stable Edition v2.3
* ------------------------------------------------------------------
* 面向 Clash Verge Rev / 最新 Mihomo(Clash.Meta) 内核的配置增强脚本。
* 本文件由 vite build 自动生成，请勿手改；源码见 src/ 目录。
*
* 仓库地址：https://github.com/wchiway/mihomo-proxy
* 脚本链接：https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/mihomo-proxy.js
* 客户端推荐：https://github.com/xishang0128/sparkle
* 提醒：使用系统代理时 fake-ip 不会生效，建议使用 TUN 模式。
*/
var __mihomoProxy = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region src/user-config.ts
	/** 强制直连的域名（后缀匹配） */
	var BYPASS_DOMAINS = ["example.com", "example.org"];
	/** 强制走代理的域名（精确匹配；完整版出口为 main 组，极简版为「全部」组） */
	var FORCE_PROXY_DOMAINS = ["test.com", "test.org"];
	/** 需要从订阅中剔除的节点名过滤器（正则） */
	var CUSTOM_FILTER = /示例占位符1|示例占位符2|示例占位符3/i;
	//#endregion
	//#region src/settings.ts
	var SETTINGS = {
		/** Koolson/Qure 彩色图标库 */
		ICON_BASE: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/",
		/** MetaCubeX meta-rules-dat 规则集根地址 */
		RULE_PROVIDER_URL_BASE: "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo",
		/** 规则集本地缓存目录 */
		RULE_PROVIDER_PATH: "./rules",
		/** 规则集更新间隔（秒），24 小时 */
		PROVIDER_INTERVAL: 86400,
		/** 策略组中地区的展示顺序（同时决定生成顺序） */
		REGION_ORDER: [
			"HK",
			"TW",
			"JP",
			"SG",
			"KR",
			"US",
			"EU",
			"AU",
			"AS"
		],
		/** url-test 自动测速组的通用参数 */
		URL_TEST_EXTRA: {
			hidden: true,
			url: "https://www.gstatic.com/generate_204",
			interval: 300,
			tolerance: 50,
			lazy: true,
			timeout: 5e3,
			"max-failed-times": 3
		},
		/** fallback 组的通用参数 */
		FALLBACK_TEST_EXTRA: {
			url: "https://www.gstatic.com/generate_204",
			interval: 300,
			lazy: true,
			timeout: 5e3,
			"max-failed-times": 3
		},
		/** 机场信息类节点（到期/官网/流量等）识别过滤器 */
		INFO_FILTER: /tg|telegram|倒卖|到期|电报|订阅|发布|防止|返利|购买|官方|官网|工单|过期|规则|建议|客服|联系|流量|剩余|失联|网址|邮箱|续费|邀请|重置|梯子|群/i
	};
	/** DNS 服务器常量（集中定义，便于统一维护） */
	var DNS_SERVERS = {
		/** bootstrap（纯 IP，用于解析 DoH 域名本身） */
		BOOTSTRAP: [
			"223.5.5.5",
			"119.29.29.29",
			"1.1.1.1",
			"8.8.8.8"
		],
		/** 国内加密 DoH（AliDNS + DNSPod） */
		CN_DOH: ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],
		/** 国际加密 DoH（Cloudflare + Google，IP 形式免 bootstrap） */
		GLOBAL_DOH: ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"]
	};
	/** Fake-IP 地址池 */
	var FAKE_IP_RANGE = "198.18.0.1/16";
	var FAKE_IP_RANGE6 = "fc00::/18";
	//#endregion
	//#region src/utils.ts
	/** 数组去重并剔除 falsy */
	var uniq = (arr = []) => [...new Set(arr.filter(Boolean))];
	/** 转义正则元字符 */
	var escapeRegex = (s = "") => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	/**
	* 归一化节点名：把国旗 emoji、分隔符统一成带空格的大写 token，
	* 便于后续用词边界正则精确匹配地区/线路。
	*/
	var normalizeName = (name = "") => String(name).replace(/(IEPL|IPLC|BGP|RELAY|PRO|V\d+)/gi, " $1 ").replace(/[【】\[\]（）()|_\-.,/:~]/g, " ").replace(/🇭🇰/g, " HK ").replace(/🇹🇼/g, " TW ").replace(/🇸🇬/g, " SG ").replace(/🇯🇵/g, " JP ").replace(/🇰🇷/g, " KR ").replace(/🇺🇸/g, " US ").replace(/🇦🇺/g, " AU ").replace(/🇪🇺|🇩🇪|🇫🇷|🇬🇧|🇳🇱|🇷🇺|🇮🇹|🇪🇸|🇸🇪|🇨🇭|🇵🇱|🇫🇮|🇹🇷|🇮🇪|🇦🇹|🇧🇪/g, " EU ").replace(/🇻🇳|🇹🇭|🇲🇾|🇮🇩|🇵🇭|🇮🇳/g, " AS ").toUpperCase().replace(/\s+/g, " ").trim();
	/**
	* 由关键词数组构建匹配正则；2~3 位纯字母（如 HK/JP/USA）加词边界，
	* 避免误伤（例如 "US" 命中 "PLUS"）。
	*/
	var buildRegex = (arr = []) => new RegExp(arr.map((raw) => {
		const token = String(raw).trim().toUpperCase();
		const escaped = escapeRegex(token);
		return /^[A-Z]{2,3}$/.test(token) ? `(?:^|[^A-Z])${escaped}(?:[^A-Z]|$)` : escaped;
	}).join("|"), "i");
	var _mulCache = /* @__PURE__ */ new Map();
	/**
	* 从节点名解析计费倍率（如 "0.2x" / "1倍" / "2X"）。
	* 未标注时默认 1。用于策略组内自动排序。
	*/
	var parseMultiplier = (name = "") => {
		const cached = _mulCache.get(name);
		if (cached !== void 0) return cached;
		let val = 1;
		const m = String(name).match(/(\d+(?:\.\d+)?)\s*(?:x|倍|×|✕)/i);
		if (m) {
			const v = parseFloat(m[1]);
			if (v > 0 && v < 100) val = v;
		}
		_mulCache.set(name, val);
		return val;
	};
	var _lineCache = /* @__PURE__ */ new Map();
	var LINE_TAGS = [
		{
			tag: "IEPL",
			re: /IEPL/i
		},
		{
			tag: "IPLC",
			re: /IPLC/i
		},
		{
			tag: "BGP",
			re: /BGP/i
		},
		{
			tag: "GAME",
			re: /GAME|游戏|游戲/i
		},
		{
			tag: "HOME",
			re: /RESIDENT|HOME|住宅|家宽|家寬|原生|NATIVE/i
		}
	];
	/** 解析节点线路类型（专线 / 游戏 / 家宽等），无标注返回 ""。 */
	var parseLineType = (name = "") => {
		const cached = _lineCache.get(name);
		if (cached !== void 0) return cached;
		let tag = "";
		for (const t of LINE_TAGS) if (t.re.test(name)) {
			tag = t.tag;
			break;
		}
		_lineCache.set(name, tag);
		return tag;
	};
	/** 线路优先级：专线(IEPL/IPLC) > BGP > 其他，数值越小越靠前。 */
	var lineRank = (tag) => tag === "IEPL" || tag === "IPLC" ? 0 : tag === "BGP" ? 1 : 2;
	/**
	* 节点自动排序：先按线路质量，再按倍率升序（省流量优先），最后按名称。
	* 让优质/低倍率线路稳定地出现在 select 组顶部。
	*/
	var sortProxyNames = (names = []) => names.slice().sort((a, b) => {
		const lr = lineRank(parseLineType(a)) - lineRank(parseLineType(b));
		if (lr !== 0) return lr;
		const mr = parseMultiplier(a) - parseMultiplier(b);
		if (mr !== 0) return mr;
		return a.localeCompare(b);
	});
	//#endregion
	//#region src/regions.ts
	var REGION_DEFS = [
		{
			name: "HK",
			pattern: [
				"香港",
				"HK",
				"HKG",
				"HONGKONG",
				"HONG KONG"
			],
			icon: "Hong_Kong.png"
		},
		{
			name: "TW",
			pattern: [
				"台湾",
				"台北",
				"新北",
				"TW",
				"TWN",
				"TAIWAN",
				"TAIPEI"
			],
			icon: "Taiwan.png"
		},
		{
			name: "JP",
			pattern: [
				"日本",
				"东京",
				"大阪",
				"JP",
				"JPN",
				"JAPAN",
				"TOKYO",
				"OSAKA"
			],
			icon: "Japan.png"
		},
		{
			name: "SG",
			pattern: [
				"新加坡",
				"狮城",
				"SG",
				"SGP",
				"SINGAPORE"
			],
			icon: "Singapore.png"
		},
		{
			name: "KR",
			pattern: [
				"韩国",
				"首尔",
				"KR",
				"KOR",
				"KOREA",
				"SEOUL"
			],
			icon: "Korea.png"
		},
		{
			name: "US",
			pattern: [
				"美国",
				"纽约",
				"旧金山",
				"洛杉矶",
				"西雅图",
				"芝加哥",
				"US",
				"USA",
				"NEWYORK",
				"NEW YORK",
				"SANFRANCISCO",
				"SAN FRANCISCO",
				"LOSANGELES",
				"LOS ANGELES",
				"SEATTLE",
				"CHICAGO"
			],
			icon: "United_States.png"
		},
		{
			name: "EU",
			pattern: [
				"欧洲",
				"德国",
				"法国",
				"英国",
				"荷兰",
				"俄罗斯",
				"意大利",
				"西班牙",
				"瑞典",
				"瑞士",
				"波兰",
				"芬兰",
				"土耳其",
				"爱尔兰",
				"奥地利",
				"法兰克福",
				"伦敦",
				"EU",
				"DE",
				"FR",
				"UK",
				"GB",
				"NL",
				"RU",
				"IT",
				"ES",
				"SE",
				"CH",
				"PL",
				"FI",
				"TR",
				"IE",
				"AT",
				"GERMANY",
				"FRANCE",
				"LONDON",
				"FRANKFURT"
			],
			icon: "European_Union.png"
		},
		{
			name: "AU",
			pattern: [
				"澳大利亚",
				"澳洲",
				"悉尼",
				"墨尔本",
				"AU",
				"AUS",
				"AUSTRALIA",
				"SYDNEY",
				"MELBOURNE"
			],
			icon: "Australia.png"
		},
		{
			name: "AS",
			pattern: [
				"越南",
				"泰国",
				"马来西亚",
				"印尼",
				"菲律宾",
				"印度",
				"VN",
				"TH",
				"MY",
				"ID",
				"PH",
				"IN",
				"VIETNAM",
				"THAILAND",
				"MALAYSIA",
				"INDONESIA",
				"PHILIPPINES",
				"MANILA"
			],
			icon: "Asia_Map.png"
		}
	];
	var buildRegions = () => REGION_DEFS.map((r) => ({
		...r,
		regex: buildRegex(r.pattern)
	}));
	var REGIONS = buildRegions();
	//#endregion
	//#region src/rule-providers.ts
	/** GeoSite 域名类规则集：{ key: 内部逻辑名, file: 远端文件名 } */
	var GEOSITE_PROVIDERS = [
		{
			key: "category-ads-all",
			file: "category-ads-all"
		},
		{
			key: "private",
			file: "private"
		},
		{
			key: "cn",
			file: "cn"
		},
		{
			key: "google",
			file: "google"
		},
		{
			key: "google-cn",
			file: "google-cn"
		},
		{
			key: "googlefcm",
			file: "googlefcm"
		},
		{
			key: "youtube",
			file: "youtube"
		},
		{
			key: "apple",
			file: "apple"
		},
		{
			key: "apple-cn",
			file: "apple-cn"
		},
		{
			key: "microsoft",
			file: "microsoft"
		},
		{
			key: "microsoft-cn",
			file: "microsoft@cn"
		},
		{
			key: "telegram",
			file: "telegram"
		},
		{
			key: "spotify",
			file: "spotify"
		},
		{
			key: "steam",
			file: "steam"
		},
		{
			key: "steam-cn",
			file: "steam@cn"
		},
		{
			key: "category-ai",
			file: "category-ai-!cn"
		},
		{
			key: "openai",
			file: "openai"
		},
		{
			key: "anthropic",
			file: "anthropic"
		},
		{
			key: "perplexity",
			file: "perplexity"
		},
		{
			key: "cursor",
			file: "cursor"
		},
		{
			key: "notion",
			file: "notion"
		},
		{
			key: "gfw",
			file: "gfw"
		},
		{
			key: "connectivity-check",
			file: "connectivity-check"
		},
		{
			key: "category-ntp",
			file: "category-ntp"
		}
	];
	/** GeoIP 网段类规则集：{ key, file } */
	var GEOIP_PROVIDERS = [
		{
			key: "private-ip",
			file: "private"
		},
		{
			key: "cn-ip",
			file: "cn"
		},
		{
			key: "google-ip",
			file: "google"
		},
		{
			key: "telegram-ip",
			file: "telegram"
		}
	];
	/** 构建 rule-providers 配置对象 */
	var buildRuleProviders = () => {
		const providers = {};
		const base = SETTINGS.RULE_PROVIDER_URL_BASE;
		const common = {
			type: "http",
			format: "mrs",
			interval: SETTINGS.PROVIDER_INTERVAL
		};
		GEOSITE_PROVIDERS.forEach(({ key, file }) => {
			providers[key] = {
				...common,
				behavior: "domain",
				path: `${SETTINGS.RULE_PROVIDER_PATH}/${key}.mrs`,
				url: `${base}/geosite/${file}.mrs`
			};
		});
		GEOIP_PROVIDERS.forEach(({ key, file }) => {
			providers[key] = {
				...common,
				behavior: "ipcidr",
				path: `${SETTINGS.RULE_PROVIDER_PATH}/${key}.mrs`,
				url: `${base}/geoip/${file}.mrs`
			};
		});
		providers.cloudflare = {
			type: "inline",
			behavior: "classical",
			payload: ["DOMAIN,challenges.cloudflare.com", "DOMAIN-SUFFIX,cloudflarechallenge.com"]
		};
		return providers;
	};
	//#endregion
	//#region src/rules.ts
	/**
	* 构建静态规则。分流目标由 targets 注入。
	* 设计要点：
	*  - Google FCM 走代理，不再 DIRECT（Plan 4）。
	*  - Google / YouTube / AI / Telegram / Steam / Apple / Microsoft 各自独立分流。
	*  - 国区子集(*-cn)直连，全球集走对应代理组。
	*/
	var buildStaticRules = (t) => [
		`RULE-SET,category-ads-all,${t.adblock}`,
		...uniq(BYPASS_DOMAINS).map((d) => `DOMAIN-SUFFIX,${d},DIRECT`),
		...uniq(FORCE_PROXY_DOMAINS).map((d) => `DOMAIN,${d},${t.proxy}`),
		"RULE-SET,cloudflare,DIRECT",
		"RULE-SET,private,DIRECT",
		"RULE-SET,private-ip,DIRECT,no-resolve",
		`RULE-SET,openai,${t.ai}`,
		`RULE-SET,anthropic,${t.ai}`,
		`RULE-SET,perplexity,${t.ai}`,
		`RULE-SET,cursor,${t.ai}`,
		`RULE-SET,notion,${t.ai}`,
		`RULE-SET,category-ai,${t.ai}`,
		`RULE-SET,googlefcm,${t.google}`,
		`RULE-SET,youtube,${t.youtube}`,
		`RULE-SET,google,${t.google}`,
		`RULE-SET,google-ip,${t.google},no-resolve`,
		"RULE-SET,google-cn,DIRECT",
		`RULE-SET,telegram,${t.telegram}`,
		`RULE-SET,telegram-ip,${t.telegram},no-resolve`,
		"DOMAIN-SUFFIX,steamcontent.com,DIRECT",
		"DOMAIN-SUFFIX,steamserver.net,DIRECT",
		"DOMAIN-SUFFIX,steampipe.akamaized.net,DIRECT",
		"RULE-SET,steam-cn,DIRECT",
		`RULE-SET,steam,${t.steam}`,
		"RULE-SET,apple-cn,DIRECT",
		`RULE-SET,apple,${t.apple}`,
		"RULE-SET,microsoft-cn,DIRECT",
		`RULE-SET,microsoft,${t.microsoft}`,
		`RULE-SET,spotify,${t.proxy}`,
		"RULE-SET,connectivity-check,DIRECT",
		"RULE-SET,category-ntp,DIRECT",
		`RULE-SET,gfw,${t.proxy}`,
		"RULE-SET,cn,DIRECT",
		"RULE-SET,cn-ip,DIRECT,no-resolve",
		`MATCH,${t.proxy}`
	];
	/**
	* 合并用户既有规则中的 DIRECT 规则到 MATCH 之前，保持向后兼容。
	*/
	var mergeRules = (baseRules = [], extraRules = []) => {
		const extra = Array.isArray(extraRules) ? extraRules.filter(Boolean) : [];
		if (!extra.length) return baseRules.slice();
		const matchIndex = baseRules.findIndex((rule) => String(rule).trim().toUpperCase().startsWith("MATCH,"));
		if (matchIndex === -1) return uniq([...baseRules, ...extra]);
		return uniq([
			...baseRules.slice(0, matchIndex),
			...extra,
			...baseRules.slice(matchIndex)
		]);
	};
	/** 从用户既有规则中挑出 DIRECT 规则（供合并保留自定义直连） */
	var pickDirectRules = (rules = []) => rules.filter((rule) => {
		const r = String(rule || "").trim();
		if (!r || r.startsWith("#")) return false;
		return /,DIRECT(?:,|$)/i.test(r);
	});
	//#endregion
	//#region src/proxies.ts
	var ensureConfigObject = (input) => input && typeof input === "object" ? input : {};
	var getOriginalProxies = (input) => Array.isArray(input.proxies) ? input.proxies : [];
	/** 节点重名去冲突：追加 _1/_2… 后缀 */
	var makeProxyNamesUnique = (proxies = []) => {
		const used = /* @__PURE__ */ new Set();
		const nextIdx = /* @__PURE__ */ new Map();
		proxies.forEach((p) => {
			if (!p || !p.name) return;
			const base = String(p.name);
			if (!used.has(base)) {
				used.add(base);
				nextIdx.set(base, 1);
				return;
			}
			let idx = nextIdx.get(base) ?? 1;
			let candidate = `${base}_${idx}`;
			while (used.has(candidate)) candidate = `${base}_${++idx}`;
			p.name = candidate;
			used.add(candidate);
			nextIdx.set(base, idx + 1);
		});
	};
	/** 剔除自定义过滤器命中的节点 */
	var filterCustomProxies = (proxies = [], customFilter) => proxies.filter((proxy) => proxy && proxy.name && !customFilter.test(proxy.name));
	/** 分离「信息类节点」与「正常节点」 */
	var splitInfoAndNormalProxies = (proxies = [], infoFilter) => proxies.reduce((acc, proxy) => {
		if (!proxy || !proxy.name) return acc;
		(infoFilter.test(proxy.name) ? acc.infoProxies : acc.normalProxies).push(proxy);
		return acc;
	}, {
		infoProxies: [],
		normalProxies: []
	});
	/**
	* 按地区分类，并对每个地区/Other 组内节点自动排序。
	* 单次遍历完成匹配（Plan 16：避免重复遍历）。
	*/
	var classifyProxiesByRegion = (normalProxies = [], regions = []) => {
		const regionData = regions.map((r) => ({
			name: r.name,
			icon: r.icon,
			proxies: []
		}));
		const regionMap = new Map(regionData.map((r) => [r.name, r]));
		const regionSeen = new Map(regionData.map((r) => [r.name, /* @__PURE__ */ new Set()]));
		const otherProxyNames = [];
		const otherSeen = /* @__PURE__ */ new Set();
		normalProxies.forEach((proxy) => {
			const proxyName = proxy.name;
			const normName = normalizeName(proxyName);
			const matched = regions.find((r) => r.regex.test(normName));
			if (matched) {
				const group = regionMap.get(matched.name);
				const seen = regionSeen.get(matched.name);
				if (group && seen && !seen.has(proxyName)) {
					group.proxies.push(proxyName);
					seen.add(proxyName);
				}
			} else if (!otherSeen.has(proxyName)) {
				otherProxyNames.push(proxyName);
				otherSeen.add(proxyName);
			}
		});
		const activeRegions = regionData.map((r) => ({
			...r,
			proxies: sortProxyNames(uniq(r.proxies))
		})).filter((r) => r.proxies.length > 0);
		return {
			activeRegions,
			activeRegionNameSet: new Set(activeRegions.map((r) => r.name)),
			activeRegionMap: new Map(activeRegions.map((r) => [r.name, r])),
			otherProxyNames: sortProxyNames(uniq(otherProxyNames))
		};
	};
	/**
	* AI 专用节点池：优先排除香港（OpenAI 常封锁 HK 出口）。
	* 若排除后为空则回退全部节点。
	*/
	var buildAllAiProxyList = (activeRegions = [], otherProxyNames = [], allNames = []) => {
		const nonHk = uniq([...activeRegions.filter((r) => r.name !== "HK").flatMap((r) => r.proxies), ...otherProxyNames]);
		return nonHk.length ? nonHk : allNames;
	};
	//#endregion
	//#region src/proxy-groups.ts
	var buildProxyGroups = ({ allNames, allAiNames, activeRegionMap, activeRegionNameSet, otherProxyNames, infoNames }) => {
		const groups = [];
		const add = (name, type, proxies, icon = "Available.png", extra = {}) => {
			proxies = uniq(proxies);
			if (name && proxies.length) groups.push({
				name,
				type,
				proxies,
				icon: SETTINGS.ICON_BASE + icon,
				...extra
			});
		};
		const regionEntries = SETTINGS.REGION_ORDER.filter((r) => activeRegionNameSet.has(r));
		const hasOther = otherProxyNames.length > 0;
		const hasNodes = allNames.length > 0;
		if (hasNodes) {
			add("main", "select", [
				"All",
				...regionEntries,
				...hasOther ? ["Other"] : []
			], "Available.png");
			add("URL Test - All", "url-test", allNames, "Auto.png", SETTINGS.URL_TEST_EXTRA);
			add("All", "select", ["URL Test - All", ...allNames], "Auto.png");
		}
		regionEntries.forEach((rName) => {
			const region = activeRegionMap.get(rName);
			if (!region) return;
			add(`URL Test - ${region.name}`, "url-test", region.proxies, region.icon, SETTINGS.URL_TEST_EXTRA);
			add(region.name, "select", [`URL Test - ${region.name}`, ...region.proxies], region.icon);
		});
		if (hasOther) {
			add("URL Test - Other", "url-test", otherProxyNames, "Available.png", SETTINGS.URL_TEST_EXTRA);
			add("Other", "select", ["URL Test - Other", ...otherProxyNames], "Available.png");
		}
		if (infoNames.length) add("info", "select", infoNames, "Available.png");
		if (hasNodes) {
			const proxyFirst = [
				"main",
				"All",
				...regionEntries,
				...hasOther ? ["Other"] : []
			];
			const withDirect = [...proxyFirst, "DIRECT"];
			const aiRegions = regionEntries.filter((r) => r !== "HK");
			add("URL Test - AI", "url-test", allAiNames, "ChatGPT.png", SETTINGS.URL_TEST_EXTRA);
			add("AI", "select", [
				"URL Test - AI",
				...aiRegions,
				"main",
				...hasOther ? ["Other"] : []
			], "ChatGPT.png");
			add("Google", "select", proxyFirst, "Google_Search.png");
			add("YouTube", "select", ["Google", ...proxyFirst], "YouTube.png");
			const hasSG = activeRegionNameSet.has("SG");
			add("Telegram - Fallback", "fallback", hasSG ? ["SG", "main"] : ["main"], "Telegram.png", SETTINGS.FALLBACK_TEST_EXTRA);
			add("Telegram", "select", [
				"Telegram - Fallback",
				...hasSG ? ["SG"] : [],
				...proxyFirst
			], "Telegram.png");
			add("Steam", "select", withDirect, "Steam.png");
			add("Apple", "select", withDirect, "Apple.png");
			add("Microsoft", "select", withDirect, "Microsoft.png");
		}
		add("GLOBAL", "select", [
			...hasNodes ? [
				"main",
				"All",
				"AI",
				"Google",
				"YouTube",
				"Telegram",
				"Steam",
				"Apple",
				"Microsoft"
			] : [],
			...regionEntries,
			...hasOther ? ["Other"] : [],
			...infoNames.length ? ["info"] : [],
			"DIRECT"
		], "Global.png");
		return groups;
	};
	//#endregion
	//#region src/dns.ts
	var applyDns = (cfg) => {
		const dns = cfg.dns || {};
		const fakeIpFilter = uniq([
			"rule-set:private",
			"rule-set:cn",
			"+.cn",
			"+.lan",
			"+.local",
			"localhost",
			"*.localhost",
			"+.stun.*.*",
			"+.stun.*.*.*",
			"+.stun.*.*.*.*",
			"rule-set:category-ntp",
			"+.msftconnecttest.com",
			"+.msftncsi.com",
			"+.captive.apple.com",
			...Array.isArray(dns["fake-ip-filter"]) ? dns["fake-ip-filter"] : []
		]);
		cfg.dns = {
			...dns,
			enable: true,
			listen: "0.0.0.0:1053",
			ipv6: true,
			"cache-algorithm": "arc",
			"prefer-h3": false,
			"use-hosts": true,
			"use-system-hosts": true,
			"respect-rules": true,
			"enhanced-mode": "fake-ip",
			"fake-ip-range": FAKE_IP_RANGE,
			"fake-ip-range6": FAKE_IP_RANGE6,
			"fake-ip-filter-mode": "blacklist",
			"fake-ip-filter": fakeIpFilter,
			"default-nameserver": ["system", ...DNS_SERVERS.BOOTSTRAP],
			nameserver: DNS_SERVERS.GLOBAL_DOH,
			"proxy-server-nameserver": DNS_SERVERS.CN_DOH,
			"nameserver-policy": {
				"rule-set:private": ["system", ...DNS_SERVERS.CN_DOH],
				"rule-set:google,googlefcm,youtube,gfw,telegram,spotify,category-ai,openai,anthropic,perplexity,cursor,notion": DNS_SERVERS.GLOBAL_DOH,
				"rule-set:category-ntp": ["system", ...DNS_SERVERS.CN_DOH],
				"+.msftconnecttest.com": ["system", ...DNS_SERVERS.CN_DOH],
				"+.msftncsi.com": ["system", ...DNS_SERVERS.CN_DOH],
				"+.captive.apple.com": ["system", ...DNS_SERVERS.CN_DOH],
				"+.steamcontent.com": DNS_SERVERS.CN_DOH,
				"+.steamserver.net": DNS_SERVERS.CN_DOH,
				"+.steampipe.akamaized.net": DNS_SERVERS.CN_DOH,
				"rule-set:cn,apple-cn,google-cn,microsoft-cn,steam-cn": DNS_SERVERS.CN_DOH
			}
		};
		cfg.hosts = {
			...cfg.hosts || {},
			"dns.alidns.com": ["223.5.5.5", "223.6.6.6"],
			"doh.pub": ["1.12.12.12", "120.53.53.53"],
			"services.googleapis.cn": "services.googleapis.com",
			"+.mcdn.bilivideo.com": ["0.0.0.0"],
			"+.mcdn.bilivideo.cn": ["0.0.0.0"]
		};
	};
	//#endregion
	//#region src/runtime.ts
	var applyRuntime = (cfg) => {
		cfg.mode = "rule";
		cfg["log-level"] = "warning";
		cfg["tcp-concurrent"] = true;
		cfg["unified-delay"] = true;
		cfg["find-process-mode"] = "off";
		cfg["keep-alive-interval"] = 30;
		cfg["keep-alive-idle"] = 600;
		cfg.profile = {
			...cfg.profile || {},
			"store-selected": true,
			"store-fake-ip": true
		};
	};
	var applySniffer = (cfg) => {
		cfg.sniffer = {
			...cfg.sniffer || {},
			enable: true,
			"force-dns-mapping": true,
			"parse-pure-ip": true,
			"override-destination": false,
			sniff: {
				HTTP: {
					ports: [80, "8080-8880"],
					"override-destination": false
				},
				TLS: {
					ports: [443, 8443],
					"override-destination": true
				},
				QUIC: {
					ports: [443, 8443],
					"override-destination": true
				}
			},
			"skip-domain": [
				"Mijia Cloud",
				"+.push.apple.com",
				"+.oray.com"
			]
		};
	};
	var applyTun = (cfg) => {
		cfg.tun = {
			...cfg.tun || {},
			enable: true,
			stack: "mixed",
			"auto-route": true,
			"auto-detect-interface": true,
			"strict-route": true,
			"endpoint-independent-nat": true,
			"dns-hijack": ["any:53", "tcp://any:53"],
			mtu: 1500,
			"disable-icmp-forwarding": true
		};
	};
	//#endregion
	//#region src/main.ts
	var STATIC_RULES = buildStaticRules({
		adblock: "REJECT",
		ai: "AI",
		google: "Google",
		youtube: "YouTube",
		telegram: "Telegram",
		steam: "Steam",
		apple: "Apple",
		microsoft: "Microsoft",
		proxy: "main"
	});
	function main(config) {
		config = ensureConfigObject(config);
		const originalProxies = getOriginalProxies(config);
		const existingRules = Array.isArray(config.rules) ? config.rules : [];
		delete config["geodata-mode"];
		delete config["geo-auto-update"];
		delete config["geo-update-interval"];
		delete config["geox-url"];
		config["rule-providers"] = {
			...config["rule-providers"] || {},
			...buildRuleProviders()
		};
		config.rules = mergeRules(STATIC_RULES, pickDirectRules(existingRules));
		if (originalProxies.length) {
			makeProxyNamesUnique(originalProxies);
			const { infoProxies, normalProxies } = splitInfoAndNormalProxies(filterCustomProxies(originalProxies, CUSTOM_FILTER), SETTINGS.INFO_FILTER);
			const allNames = uniq(normalProxies.map((p) => p.name));
			const infoNames = uniq(infoProxies.map((p) => p.name));
			const { activeRegions, activeRegionNameSet, activeRegionMap, otherProxyNames } = classifyProxiesByRegion(normalProxies, REGIONS);
			const allAiNames = buildAllAiProxyList(activeRegions, otherProxyNames, allNames);
			config["proxy-groups"] = buildProxyGroups({
				allNames,
				allAiNames,
				activeRegionMap,
				activeRegionNameSet,
				otherProxyNames,
				infoNames
			});
			config.proxies = originalProxies;
		} else config["proxy-groups"] = buildProxyGroups({
			allNames: [],
			allAiNames: [],
			activeRegionMap: /* @__PURE__ */ new Map(),
			activeRegionNameSet: /* @__PURE__ */ new Set(),
			otherProxyNames: [],
			infoNames: []
		});
		applyRuntime(config);
		applySniffer(config);
		applyTun(config);
		applyDns(config);
		return config;
	}
	//#endregion
	exports.main = main;
	return exports;
})({});
// Clash Verge Rev (boa_engine) 入口桥接：脚本被求值后直接调用顶层 main
function main(config, profileName) {
	return __mihomoProxy.main(config, profileName);
}
