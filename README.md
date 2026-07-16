# mihomo-proxy

mihomo（Clash Meta）配置增强脚本 · Ultimate Stable Edition v2.3

在 Clash Verge Rev / Sparkle 等客户端中作为**覆写脚本**加载，自动完成节点分组、服务级分流、DNS 防泄露分流与 TUN/Sniffer 网络优化。主要面向国内复杂网络（含校园网）与多地区机场订阅，目标是 Google 全家桶 / AI / 流媒体的高稳定性与零 DNS 泄露。

---

## 两个版本，按需选择

|                      | mihomo-proxy.js（完整版）                                    | simple-mihomo.js（极简版）         |
| -------------------- | ------------------------------------------------------------ | ---------------------------------- |
| 策略组数量           | 20+（地区组 + 服务组）                                       | 3 个                               |
| 地区分组             | HK / TW / JP / SG / KR / US / EU / AU / AS + Other           | 无                                 |
| 服务组               | Google / YouTube / AI / Telegram / Steam / Apple / Microsoft | 统一收敛到「全部」                 |
| AI 纯净池            | ✅ 剔除香港                                                  | ✅ 剔除香港                        |
| 广告拦截             | 固定 REJECT                                                  | 「广告拦截」组可切 REJECT / DIRECT |
| 分流规则 / DNS / TUN | 同一套                                                       | 同一套                             |
| 适合人群             | 想精细控制每类服务出口                                       | 只想选个节点就用                   |

```text
# 完整版
https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/mihomo-proxy.js

# 极简版
https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/simple-mihomo.js
```

---

## 功能特性

### 1. 节点自动分类与排序

- 地区识别：中英文名 / 缩写 / 国旗 emoji 均可识别，含 EU（欧洲）与 AU（澳洲）
- 线路识别：IEPL / IPLC / BGP / 游戏 / 家宽（住宅）
- 倍率识别：`0.2x`、`1倍`、`2X` 等计费倍率
- 组内自动排序：专线优先 → 低倍率优先 → 名称序
- 信息类节点（到期 / 官网 / 剩余流量）自动分离，不混入代理组
- 重名节点自动加 `_1 / _2` 后缀去冲突

### 2. 策略组

完整版自动生成：

- `main`（主入口）/ `All`（全量 + 自动测速）/ `GLOBAL`（总览）
- `AI`：非香港纯净池（OpenAI / Claude / Gemini / Perplexity / Cursor / Notion / Copilot）
- `Google` / `YouTube`：独立分流，不依赖 GFW 列表
- `Telegram`：SG 优先 + fallback 自愈
- `Steam` / `Apple` / `Microsoft`：国区直连 + 全球走代理，可一键切 DIRECT
- 各地区 URL-Test 自动测速组（隐藏，供地区组引用）

极简版仅三组：

- `全部`：所有节点 + 内置「自动测速」（默认自动选优）
- `AI`：剔除香港的纯净节点池 + 独立自动测速
- `广告拦截`：REJECT（默认）/ DIRECT / 全部

### 3. DNS 架构（防泄露 Smart 分流）

- Fake-IP 黑名单模式，黑名单仅保留：private / cn / lan / stun / ntp / 非 Google 系统联网探测
- `respect-rules: true`：DNS 出口遵循分流规则
- 防泄露三级白名单（`nameserver-policy` 按序匹配）：
  1. 内网/私有域名 → 系统 DNS 优先（兼容校园网内网）
  2. 需翻墙域名族（Google / YouTube / AI / GFW / Telegram / Spotify）→ 国际 DoH
  3. 国内域名族（cn / apple-cn / google-cn / microsoft-cn / steam-cn）→ 国内 DoH（AliDNS / DNSPod）
- **默认上游 = 国际 DoH（1.1.1.1 / 8.8.8.8，IP 直连形式）且经代理出站**——
  境外域名（含浏览器 TYPE65 查询）绝不落到国内解析商，这是防泄露核心
- `proxy-server-nameserver` = 国内加密 DoH：直连状态必然可达且防污染，节点域名始终可解析
- 无 `fallback` 机制（fallback 请求不走代理，本身就是泄露源）

### 4. 分流规则要点

- Google FCM 走代理（防推送断流）
- **全球 `google` 优先于 `google-cn` 匹配**：google-cn 列表混有
  connectivitycheck.gstatic.com / fonts.googleapis.com 等全球关键域名（其国内 CDN 已失效），
  先代理后直连可避免 YouTube「未联网」、Chrome 商店卡死、页面白屏
- AI 域名独立分流（openai / anthropic / perplexity / cursor / notion / category-ai），不依赖 GFW 列表
- steam-cn / apple-cn / microsoft-cn 直连（`-cn` 为脚本内部逻辑名，实际映射远端 `@cn` 文件）
- 广告拦截（category-ads-all）、Cloudflare 人机验证页直连
- 保留用户配置中已有的自定义 DIRECT 规则（合并到 MATCH 之前）

### 5. 网络增强

- TUN：mixed 栈 / strict-route / endpoint-independent-nat / dns-hijack / MTU 1500
- Runtime：tcp-concurrent / unified-delay / store-selected / log-level warning
- Sniffer：HTTP + TLS + QUIC(HTTP/3)，全局关闭 override-destination 保护 FCM 长连接

---

## 使用方法

1. 打开 mihomo 客户端（Clash Verge Rev / Sparkle）的「覆写 / 扩展脚本」设置
2. 添加上方任一脚本链接（或下载后本地引用）
3. 应用到订阅配置，重启内核（建议 TUN 模式）

脚本会在订阅加载时自动：解析节点 → 重建 proxy-groups → 注入 rule-providers → 重写 dns / tun / sniffer / runtime。

### 自定义

自定义常量位于 `src/user-config.ts`（两版共享）：

```ts
/** 强制直连的域名（后缀匹配） */
export const BYPASS_DOMAINS = ["example.com", "example.org"];
/** 强制走代理的域名（精确匹配；完整版走 main 组，极简版走「全部」组） */
export const FORCE_PROXY_DOMAINS = ["test.com", "test.org"];
/** 需要从订阅中剔除的节点名过滤器（正则） */
export const CUSTOM_FILTER = /示例占位符1|示例占位符2|示例占位符3/i;
```

两种修改方式：

1. **推荐**：改 `src/user-config.ts` 后 `pnpm build` 重新生成（改动进入两份产物且不会丢失）
2. **临时**：直接编辑产物 JS 顶部的同名常量（在 IIFE 内第一段）——注意
   下次 `pnpm build` 会覆盖手改内容

---

## 常见问题

**Q：如何确认没有 DNS 泄露？**
用 [browserleaks.com/dns](https://browserleaks.com/dns) 或 [ipleak.net](https://ipleak.net) 复测，应只显示代理出口侧解析商（Cloudflare / Google 等），不出现国内运营商或阿里/腾讯 DNS。若个别浏览器仍泄露，检查浏览器自身的「安全 DNS」设置（Chrome：设置 → 隐私 → 使用安全 DNS）——该路径在浏览器内部加密直发，代理内核无法接管，关闭即可。

**Q：导入后所有节点超时？**
通常是节点服务器域名解析失败。本脚本已将 `proxy-server-nameserver` 固定为国内加密 DoH（直连可达）；若机场域名被特殊污染，可在脚本 `DNS_SERVERS.CN_DOH` 中更换上游。

**Q：YouTube 提示「未联网」/ Google 页面白屏？**
本脚本已通过规则顺序修复（google 先于 google-cn）。若仍出现，清一次浏览器 DNS 缓存（`chrome://net-internals/#dns`）并重启 TUN。

**Q：校园网 / 弱网卡顿？**
将脚本中 TUN 的 `mtu: 1500` 下调为 `1280`。

**Q：想改地区顺序 / 测速参数？**
完整版调整 `SETTINGS.REGION_ORDER` 与 `URL_TEST_EXTRA`；极简版调整 `SETTINGS.URL_TEST_EXTRA`。

---

## 注意事项

- 需要 mihomo（Clash Meta）内核；系统代理模式下 fake-ip 不生效，建议 TUN 模式
- 会覆盖订阅中的 proxy-groups / rules / dns / tun / sniffer 配置
- 规则集使用 MetaCubeX meta-rules-dat 的 `.mrs` 格式，首次加载需联网下载
- 脚本内多处注释标注了「顺序关键 / 语法注意」的段落（google-cn 顺序、
  nameserver-policy 单前缀写法等），修改前请先阅读注释，均为实测踩坑结论

---

## 项目结构

```text
mihomo-proxy.js    # 完整版（构建产物，请勿手改）
simple-mihomo.js   # 极简版（构建产物，请勿手改）
src/               # 两版共享的 TypeScript 源码
├── index.ts       #   完整版打包入口
├── simple.ts      #   极简版打包入口
├── main.ts        #   完整版主流程（服务级独立策略组）
├── simple-main.ts #   极简版主流程（全部 / AI / 广告拦截 三组）
├── user-config.ts #   用户自定义区（两版共享）
├── settings.ts    #   常量配置（SETTINGS / DNS_SERVERS / Fake-IP）
├── utils.ts       #   工具函数（倍率/线路解析缓存等）
├── regions.ts     #   地区定义（完整版用）
├── rule-providers.ts # 规则集（key ↔ 远端文件名解耦）
├── rules.ts       #   分流规则骨架（出口目标参数化，两版注入各自策略组名）
├── proxies.ts     #   节点分类
├── proxy-groups.ts#   完整版策略组生成
├── dns.ts         #   DNS 防泄露架构
├── runtime.ts     #   Runtime / Sniffer / TUN
└── types.ts       #   类型定义
tests/             # vitest 单元测试（工具函数 / 规则 / 节点分类）
scripts/verify.mjs        # 第 1 级校验：node:vm 冒烟断言 + YAML 导出
scripts/verify-kernel.mjs # 第 2 级校验：真实 mihomo 内核 -t
vite.config.ts     # Vite 8 库模式双产物构建配置
.github/workflows/ci.yml  # CI：类型检查 → 单测 → 构建 → 产物一致性 → 内核校验
```

---

## 构建与开发（Vite 8 全 Rust 工具链）

两份产物均由 **Vite 8 + TypeScript** 从同一份 `src/` 构建生成——规则骨架、
规则集、DNS、TUN 在源码层共享，**构建期即保证两版一致，不再手工同步**。
Vite 8 已用 Rolldown（打包）+ Oxc（转换/压缩）的全 Rust 工具链取代
esbuild + Rollup,本项目直接使用其原生配置（`rolldownOptions`）。

```bash
pnpm install        # 安装依赖（Node 20+ / pnpm 11+，lock 文件已入库）
pnpm typecheck      # tsc 类型检查
pnpm test           # vitest 单元测试
pnpm build          # 双产物构建 → node:vm 冒烟断言 → 同步到仓库根目录
pnpm verify:kernel  # 真实内核 -t 校验（需本地 mihomo 或设 MIHOMO_BIN）
```

构建约束（面向 Clash Verge Rev / Sparkle 的 boa_engine 运行时）：

- 产物为**单文件普通脚本**（非 ESM），以 IIFE 打包并由 footer 注入顶层
  `main(config, profileName)`，满足 `{script}; main(config, name)` 调用约定
- target ES2020（boa 支持 90%+ 最新 ES 规范），`minify: false` 保留全部
  中文注释，产物可读可审计
- 双级校验后才同步产物：第 1 级 `node:vm` 裸沙箱断言（DNS 防泄露铁律、
  规则集引用一致性、双版规则骨架一致、策略组完整性等），第 2 级真实
  mihomo 内核 `-t` 配置测试；CI 对每次 push 全量执行并校验产物与源码一致

---

## 更新日志

### v2.3（2026-07）

- 工程化：拆分为 `src/` TypeScript 模块，Vite 8（Rolldown + Oxc
  全 Rust 工具链，不再使用 esbuild/Rollup）库模式打包回单文件
- **双版本统一构建**：极简版（v1.2）与完整版共享同一份规则骨架 /
  规则集 / DNS / TUN 源码，出口目标参数化注入，构建期保证两版一致
  （彻底解决历史上两文件手工同步导致的漂移）
- 新增 Steam 游戏下载 CDN 直连（steamcontent.com / steamserver.net /
  steampipe.akamaized.net，前置于 steam 规则集），DNS 同步指向国内 DoH
  以解析就近 CDN 节点；极简版同步获得该修正
- 双级校验：`node:vm` 冒烟断言（含双版规则骨架一致性）+ 真实内核
  `mihomo -t`（已过 v1.19.25）；vitest 单元测试 36 项
- CI：类型检查 → 单测 → 构建 → 产物与源码一致性 → 内核校验；
  pnpm-lock.yaml 入库保证可复现构建

### v2.2（2026-07）

- 修复 hosts 中 `services.googleapis.cn` CNAME 映射使用数组语法（域名别名不支持数组，可能被内核忽略）
- 修复 Sniffer TLS/QUIC 的 `override-destination` 未显式启用，导致纯 IP 连接场景域名分流规则失效
- 修正 `nameserver-policy` 注释中关于 key 顺序的错误描述（YAML Map 无序，实际依靠 rule-set 互斥而非顺序）
- 修正 `google-cn` 规则注释，明确其仅覆盖不在 google 集合中的纯国区域名
- 统一两个脚本的 `mergeRules` 行为（完整版改用 `startsWith("MATCH,")` 匹配，与极简版一致）

### v2.1（2026-07）

- DNS 全面重设计：respect-rules + 三级白名单 policy + 默认国际 DoH 经代理出站（修复 DNS 泄露）
- 修复 google-cn 规则顺序导致的 YouTube「未联网」、Chrome 商店卡死、页面白屏
- 修复 nameserver-policy 多规则集 key 写法导致的内核启动失败（`not found rule-set`）
- 修复 proxy-server-nameserver 不可达导致的全节点超时
- Fake-IP 黑名单精简至最小集，Rule Providers 全量迁移到 .mrs 并与远端文件名解耦
- 新增 EU / AU 地区、倍率与专线识别、节点自动排序
- 新增 Google / YouTube / AI / Steam / Apple / Microsoft 独立服务组；FCM 改走代理
- 新增极简版 simple-mihomo.js（全部 / AI / 广告拦截 三组）
- TUN / Sniffer / Runtime 更新至最新内核选项；所有配置经 mihomo v1.19.28 真实内核 `-t` 校验

---

## 致谢

本项目参考并受以下项目与社区启发：

- Mihomo / Clash Meta 核心项目（<https://github.com/MetaCubeX/mihomo>）
- sing-mix 相关规则与分流思路（<https://github.com/Sakyvo/sing-mix>）
- MetaCubeX GeoSite / GeoIP 规则集（<https://github.com/MetaCubeX/meta-rules-dat>）
- Koolson 图标资源库（<https://github.com/Koolson/Qure>）
- LinuxDO 社区的经验与最佳实践
