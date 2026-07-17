/**
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
*/
var __mihomoSimple = (function(exports) {
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
			payload: ["DOMAIN-SUFFIX,cloudflareinsights.com"]
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
		"DOMAIN-SUFFIX,wegame.com.cn,DIRECT",
		"DOMAIN-KEYWORD,wegame,DIRECT",
		"DOMAIN-SUFFIX,igame.qq.com,DIRECT",
		"DOMAIN-SUFFIX,tgp.qq.com,DIRECT",
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
			"+.qq.com",
			"+.tencent.com",
			"+.qcloud.com",
			"+.wegame.com.cn",
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
			ipv6: false,
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
				"+.qq.com": DNS_SERVERS.CN_DOH,
				"+.tencent.com": DNS_SERVERS.CN_DOH,
				"+.qcloud.com": DNS_SERVERS.CN_DOH,
				"+.wegame.com.cn": DNS_SERVERS.CN_DOH,
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
			"strict-route": false,
			"endpoint-independent-nat": true,
			"dns-hijack": ["any:53", "tcp://any:53"],
			mtu: 1500,
			"disable-icmp-forwarding": true
		};
	};
	//#endregion
	//#region src/simple-main.ts
	/** 三个策略组的名称（规则出口统一引用这里，避免魔法字符串） */
	var GROUPS = {
		ALL: "全部",
		AI: "AI",
		ADBLOCK: "广告拦截"
	};
	/** 香港节点识别（AI 组需剔除，OpenAI/Claude 等常封锁 HK 出口） */
	var HK_FILTER = /香港|HK|HKG|HONGKONG|HONG KONG|🇭🇰/i;
	var STATIC_RULES = buildStaticRules({
		adblock: GROUPS.ADBLOCK,
		ai: GROUPS.AI,
		google: GROUPS.ALL,
		youtube: GROUPS.ALL,
		telegram: GROUPS.ALL,
		steam: GROUPS.ALL,
		apple: GROUPS.ALL,
		microsoft: GROUPS.ALL,
		proxy: GROUPS.ALL
	});
	/**
	* 从订阅节点得到两个节点池：
	*   allNames —— 全部可用节点（剔除自定义过滤与信息类节点）
	*   aiNames  —— AI 纯净池（在 allNames 基础上剔除香港；全被剔则回退 allNames）
	*/
	var buildProxyPools = (proxies = []) => {
		const allNames = sortProxyNames(uniq(proxies.filter((p) => p && p.name && !CUSTOM_FILTER.test(p.name) && !SETTINGS.INFO_FILTER.test(p.name)).map((p) => p.name)));
		const nonHk = allNames.filter((n) => !HK_FILTER.test(n));
		return {
			allNames,
			aiNames: nonHk.length ? nonHk : allNames
		};
	};
	var buildSimpleProxyGroups = ({ allNames, aiNames }) => {
		const icon = (f) => SETTINGS.ICON_BASE + f;
		const groups = [];
		if (allNames.length) {
			groups.push({
				name: "自动测速",
				type: "url-test",
				proxies: allNames,
				icon: icon("Auto.png"),
				...SETTINGS.URL_TEST_EXTRA
			});
			groups.push({
				name: GROUPS.ALL,
				type: "select",
				proxies: ["自动测速", ...allNames],
				icon: icon("Global.png")
			});
		} else groups.push({
			name: GROUPS.ALL,
			type: "select",
			proxies: ["DIRECT"],
			icon: icon("Global.png")
		});
		if (aiNames.length) {
			groups.push({
				name: "AI 自动测速",
				type: "url-test",
				proxies: aiNames,
				icon: icon("ChatGPT.png"),
				...SETTINGS.URL_TEST_EXTRA
			});
			groups.push({
				name: GROUPS.AI,
				type: "select",
				proxies: ["AI 自动测速", ...aiNames],
				icon: icon("ChatGPT.png")
			});
		} else groups.push({
			name: GROUPS.AI,
			type: "select",
			proxies: [GROUPS.ALL],
			icon: icon("ChatGPT.png")
		});
		groups.push({
			name: GROUPS.ADBLOCK,
			type: "select",
			proxies: [
				"REJECT",
				"DIRECT",
				GROUPS.ALL
			],
			icon: icon("AdBlack.png")
		});
		return groups;
	};
	function simpleMain(config) {
		config = config && typeof config === "object" ? config : {};
		const originalProxies = Array.isArray(config.proxies) ? config.proxies : [];
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
		makeProxyNamesUnique(originalProxies);
		config["proxy-groups"] = buildSimpleProxyGroups(buildProxyPools(originalProxies));
		if (originalProxies.length) config.proxies = originalProxies;
		applyRuntime(config);
		applySniffer(config);
		applyTun(config);
		applyDns(config);
		return config;
	}
	//#endregion
	exports.main = simpleMain;
	return exports;
})({});
// Sparkle / Clash Verge Rev (boa_engine) 入口桥接：脚本被求值后直接调用顶层 main
function main(config, profileName) {
	return __mihomoSimple.main(config, profileName);
}
