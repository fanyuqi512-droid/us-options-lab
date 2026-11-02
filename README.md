# 美股期权实验室 · US Options Lab

静态单页应用：查询美股期权链，用 Black–Scholes–Merton 计算公允价、隐含波动率（IV）、Greeks，并展示 IV Smile 与偏贵/偏便宜偏离（教育用途）。

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

直接打开 `index.html`，或：

```bash
cd /workspace/us-options-lab
python3 -m http.server 8765
```

## 发布（Surge）

```bash
npx surge@latest /workspace/us-options-lab us-options-lab.surge.sh
```

## 免责声明

仅供学习，不构成投资建议。
