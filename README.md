# mihomo-proxy

## 项目简介

mihomo-proxy 是一个用于 mihomo（Clash Meta）的配置增强脚本，用于自动优化代理规则、节点分组以及网络参数，提高稳定性与可用性。

主要用于校园网、多节点机场订阅以及复杂网络环境下的分流优化。

---

## 功能特性

### 1. 节点自动分组

- 自动按地区分类（HK / TW / SG / JP / KR / US / AS）
- 自动识别未分类节点（Other）
- 支持 AI 专用分组（非 HK 优先）

---

### 2. 策略组生成

自动生成以下策略组：

- main
- All
- ai / All-ai
- tg / tg fallback
- 各地区 URL-Test 组
- GLOBAL 全局入口

---

### 3. DNS 优化

- Fake-IP 模式（黑名单机制）
- system + DoH 混合解析
- 校园网 DNS 兼容优化
- 内网与游戏域名直连优化

---

### 4. 网络增强

- TUN 混合栈模式
- 自动路由与接口检测
- MTU 优化（1280）
- 禁用 ICMP 转发减少异常流量
- Sniffer 优化减少长连接断流

---

### 5. 规则系统

内置 Rule Providers：

- GeoSite / GeoIP（MetaCubeX）
- 广告拦截规则
- 国内直连规则
- AI / 游戏 / 平台规则
- Telegram / GFW 分流规则

---

## 使用方法

### 1. 引入脚本

在 mihomo 配置中加载：

```text id="k6q2xq"
https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/mihomo-proxy.js
```

---

### 2. 生效方式

脚本会在运行时自动：

- 解析原始 proxy
- 重建 proxy-groups
- 注入 rule-providers
- 修改 dns / tun / sniffer 配置

---

## 配置说明

### DNS

- 默认使用 system DNS
- 备用 DoH：

  - dns.alidns.com
  - doh.pub

- fake-ip-range：198.18.0.1/16

---

### TUN

- stack：mixed
- auto-route：true
- strict-route：true
- mtu：1280

---

### Fake-IP 过滤

包含：

- 国内域名直连
- 游戏服务
- LAN / STUN / WebRTC
- Apple / Microsoft / Google CN

---

## 适用场景

- mihomo / Clash Meta 用户
- 校园网环境
- 弱网 / 高丢包网络
- 多地区节点机场订阅
- AI / 游戏 / Telegram 加速分流

---

## 注意事项

- 需要 Clash Meta（mihomo）核心支持
- 建议启用 TUN 模式
- fake-ip 在系统代理模式下可能无效
- 会覆盖 proxy-groups 配置

---

## 项目结构

```text id="0v9c0n"
mihomo-proxy.js
```

---

## 致谢

本项目参考并受以下项目与社区启发：

- Mihomo / Clash Meta 核心项目（[https://github.com/MetaCubeX/mihomo）](https://github.com/MetaCubeX/mihomo）)
- sing-mix 相关规则与分流思路 ([https://github.com/Sakyvo/sing-mix](https://github.com/Sakyvo/sing-mix))
- MetaCubeX GeoSite / GeoIP 规则集（[https://github.com/MetaCubeX/meta-rules-dat）](https://github.com/MetaCubeX/meta-rules-dat）)
- Koolson 图标资源库（[https://github.com/Koolson/Qure）](https://github.com/Koolson/Qure）)
- LinuxDO 社区的经验与最佳实践
