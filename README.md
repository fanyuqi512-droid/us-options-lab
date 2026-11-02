# 美股期权实验室 · US Options Lab

静态单页应用：查询美股期权链，用 Black–Scholes–Merton 计算公允价、隐含波动率（IV）、Greeks，并展示 IV Smile 与偏贵/偏便宜偏离（**教育用途，非投资建议**）。

## 在线地址

- **主站 GitHub Pages**: https://fanyuqi512-droid.github.io/us-options-lab/
- 备用 Flypod（约 14 天）: https://ca542aefb6074898.flypod.page
- 备用 ShipStatic（约 3 天）: https://pure-synth-xz7g5k6.shipstatic.com

> Surge (`us-options-lab.surge.sh`) 因账号为一次性邮箱被拒绝发布；已改用 GitHub Pages。

仓库：https://github.com/fanyuqi512-droid/us-options-lab

## 功能

- 标的代码查询与现价
- 到期日选择与 Call/Put 期权链
- BS 公允价 vs 市场 Mid，偏离% 高亮
- 由 Mid 反推 IV（Newton + 二分），IV Smile 图
- Delta / Gamma / Theta / Vega / Rho
- ATM ±1σ 预期波动
- 手动 BS 计算器（无行情时可用）
- Yahoo 失败时自动演示数据 + localStorage 缓存

## 本地打开

```bash
cd /workspace/us-options-lab
python3 -m http.server 8765
```

或直接打开 `index.html`。

## 数据说明

优先请求 Yahoo Finance 公开 `v7/finance/options`；浏览器 CORS 失败时依次尝试公共代理，再回退本地缓存与内置 Demo 链。

## 免责声明

仅供学习，不构成投资建议。期权交易有亏损全部本金的风险。
