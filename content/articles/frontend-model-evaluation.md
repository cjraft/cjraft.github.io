---
title: "前端模型能力评估方案：8维度20题专项测试"
date: 2026-04-25
draft: true
tags:
  - "前端开发"
  - "模型评估"
  - "AI编程"
showToc: true
TocOpen: true
description:
  专门针对前端开发领域设计的模型能力评估方案，覆盖 HTML/CSS/JS 基础、框架使用、视觉还原、性能优化、
  可访问性、调试修复与架构设计 8 个维度，每题附带评分标准与复现方式。
lastmod: "2026-04-25"
---

> 本文是《模型快速评估方案》的前端专项篇，聚焦 Web 开发场景，题目设计兼顾「代码正确性」与「工程实践感」。

---

## 维度 1：HTML/CSS 基础与布局（静态还原能力）

### 题 1.1：Flexbox 居中陷阱

```
请用 Flexbox 实现以下效果：一个 300×300px 的容器内，一个 100×100px 的子元素水平垂直居中。
要求：
1. 子元素在容器缩小到 200×200px 时仍保持居中且不被裁切
2. 不能使用 margin: auto
3. 给出完整的 HTML + CSS（含 box-sizing 设置）
```

**评分**：
- 5 分：正确使用 `display: flex; justify-content: center; align-items: center; min-height: 100vh` 或等价方案，且考虑溢出保护
- 3 分：居中正确但未处理缩小场景
- 0 分：使用 margin: auto 或定位错误

---

### 题 1.2：Grid 复杂布局

```
用 CSS Grid 实现一个「圣杯布局」（Holy Grail Layout）：
- 顶部 Header（高度固定 60px）
- 底部 Footer（高度固定 40px）
- 中间三栏：左侧 Sidebar（200px 宽）、中间 Main（自适应）、右侧 Aside（150px 宽）
- 要求：中间栏在内容不足时也能撑满剩余高度（即 Footer 始终在底部）
- 兼容移动端：屏幕 < 768px 时，三栏垂直堆叠，顺序为 Main → Sidebar → Aside
```

**评分**：
- 5 分：Grid 实现正确，`grid-template-areas` 或 `grid-template-columns` 用法规范，响应式断点正确
- 3 分：布局大体正确但 Footer 不会贴底或移动端顺序错误
- 0 分：使用浮动/定位实现，或未处理响应式

---

### 题 1.3：CSS 层级与 Specificity

```
以下代码中，最终 p 元素的颜色是什么？请逐步解释计算过程：

<style>
#app .text { color: blue; }
.container p.text { color: red; }
[data-theme="dark"] p { color: white; }
p { color: black; }
</style>

<div id="app" data-theme="dark">
  <div class="container">
    <p class="text">Hello</p>
  </div>
</div>
```

**评分**：
- 5 分：正确指出红色（`.container p.text`  specificity 0,2,1 = 21，高于 `#app .text` 的 1,1,0 = 110？——等等，这里故意设陷阱，让模型细算）
  实际：#app .text = 1,1,0 = 110；.container p.text = 0,2,1 = 21 → **蓝色**。能指出这点的得满分。
- 3 分：说红色（被 specificity 计算误导）但能展示计算过程
- 0 分：瞎猜或完全错误

> 这道题的价值在于：测试模型是否「背诵规则」还是「真懂 specificity 计算」。

---

## 维度 2：JavaScript 核心与异步（语言深度）

### 题 2.1：Event Loop 输出预测

```
请按执行顺序写出以下代码的输出：

console.log('1');
setTimeout(() => console.log('2'), 0);
Promise.resolve().then(() => console.log('3'));
console.log('4');
new Promise(resolve => {
  console.log('5');
  resolve();
}).then(() => console.log('6'));
setTimeout(() => console.log('7'), 0);
```

**评分**：
- 5 分：1, 4, 5, 3, 6, 2, 7（完全正确）
- 3 分：顺序大体对但微任务/宏任务边界模糊
- 0 分：完全错误

---

### 题 2.2：闭包陷阱修复

```
以下代码意图创建 3 个按钮，点击分别弹出 0、1、2。但实际都弹出 3。请修复：

for (var i = 0; i < 3; i++) {
  const btn = document.createElement('button');
  btn.textContent = `Button ${i}`;
  btn.onclick = () => alert(i);
  document.body.appendChild(btn);
}
```

**评分**：
- 5 分：给出至少 2 种正确修复方案（如改用 let、IIFE、data-attribute 等），并解释 var 作用域问题
- 3 分：修复正确但只有一种方案
- 0 分：修复后仍有问题

---

### 题 2.3：Promise 并发控制

```
实现一个函数 parallelLimit(tasks, limit)，其中：
- tasks 是一个返回 Promise 的函数数组
- limit 是最大并发数
- 要求：同时运行的任务不超过 limit，全部完成后返回结果数组（保持顺序）

例如：
const tasks = [1,2,3,4,5].map(n => () => fetch(`/api/item/${n}`));
parallelLimit(tasks, 2).then(results => console.log(results));
```

**评分**：
- 5 分：正确实现，使用队列或计数器控制并发，保持输出顺序
- 3 分：并发控制正确但顺序未保持（或反之）
- 0 分：用 Promise.all 一次性并发（无视 limit）或未处理异步

---

## 维度 3：框架与组件设计（React/Vue/Angular）

### 题 3.1：React 性能优化

```
以下组件存在性能问题，请指出并优化：

function ProductList({ products, onAddToCart }) {
  const [filter, setFilter] = useState('');
  
  const filtered = products.filter(p => 
    p.name.toLowerCase().includes(filter.toLowerCase())
  );
  
  return (
    <div>
      <input value={filter} onChange={e => setFilter(e.target.value)} />
      {filtered.map(p => (
        <ProductCard product={p} onAdd={onAddToCart} />
      ))}
    </div>
  );
}
```

**评分**：
- 5 分：指出 3 个以上问题（filter 每次渲染重计算、ProductCard 无 key、onAddToCart 引用可能变化导致子组件重渲染、未 useMemo/useCallback），并给出优化后代码
- 3 分：指出 1-2 个问题
- 0 分：未发现问题

---

### 题 3.2：自定义 Hook 设计

```
设计一个 useLocalStorage hook，要求：
1. 与 useState 类似的 API：const [value, setValue] = useLocalStorage('key', 'default')
2. 多个 Tab 之间同步更新（监听 storage 事件）
3. 首次渲染时从 localStorage 读取，避免 hydration mismatch（SSR 安全）
4. 处理 JSON 序列化/反序列化，且能处理存储满异常
```

**评分**：
- 5 分：全部满足，代码健壮，考虑边界情况
- 3 分：满足 2-3 个要求
- 0 分：有明显 bug 或 API 设计错误

---

### 题 3.3：状态管理架构

```
一个电商应用有以下状态：
- 用户购物车（跨页面共享）
- 商品列表筛选条件（页面级别）
- 表单草稿（组件级别，关闭页面丢失也可接受）
- 用户登录态（全局，持久化）

请为 React 项目设计状态管理方案，说明每个状态用什么方式管理（useState/useContext/Zustand/Redux/URL 参数等）及理由。
```

**评分**：
- 5 分：方案合理，理由充分，能区分「服务器状态」与「客户端状态」
- 3 分：方案可行但理由单薄
- 0 分：全部塞到 Redux 或全部用 useState

---

## 维度 4：视觉还原与交互（设计稿 → 代码）

### 题 4.1：纯 CSS 实现加载动画

```
用纯 CSS 实现以下加载动画：
- 三个圆点水平排列
- 依次上下弹跳（不同步，有先后）
- 颜色分别为 #ff6b6b、#4ecdc4、#45b7d1
- 动画循环，总时长 1.4s
- 要求：无 JavaScript，兼容最新 2 个 Chrome 版本即可
```

**评分**：
- 5 分：正确实现，使用 @keyframes + animation-delay，代码简洁
- 3 分：动画实现但圆点同步或未使用 delay
- 0 分：使用 JS 控制或完全错误

---

### 题 4.2：文字描述转 UI

```
请根据以下文字描述写出 HTML + CSS，尽量还原视觉效果：

「一个卡片组件：
- 宽度 320px，圆角 12px，白色背景，阴影轻微
- 顶部是一张 16:9 的封面图
- 下方是标题（18px 粗体，#1a1a1a，单行截断）
- 标题下方是描述（14px，#666，最多 2 行，超出省略）
- 底部是作者区：左侧 32px 圆形头像，右侧是作者名（14px 粗体）和日期（12px，#999）
- 整体 hover 时轻微上浮（translateY -4px），阴影加深，过渡 0.3s ease」
```

**评分**：
- 5 分：结构与样式完整，截断处理正确（`-webkit-line-clamp` 或等价方案），hover 过渡平滑
- 3 分：大体正确但省略号或 hover 效果缺失
- 0 分：明显偏离描述

---

### 题 4.3：响应式图片处理

```
实现一个图片画廊：
- 桌面端：3 列网格，图片等高（aspect-ratio 3:2），gap 16px
- 平板端（< 1024px）：2 列
- 移动端（< 640px）：1 列
- 图片使用懒加载，且提供 srcset 适配 DPR 1x/2x/3x
- 图片加载前显示骨架屏（灰色占位，渐变动效）
```

**评分**：
- 5 分：全部满足，使用 `loading="lazy"` + `srcset`，骨架屏用 CSS 渐变动画
- 3 分：响应式正确但懒加载或 srcset 缺失
- 0 分：固定列数或未处理加载态

---

## 维度 5：性能优化（工程化意识）

### 题 5.1：Core Web Vitals 诊断

```
一个 React 单页应用，Lighthouse 报告如下问题：
- LCP 4.2s（目标 < 2.5s）
- CLS 0.25（目标 < 0.1）
- TBT 350ms（目标 < 200ms）

请列出至少 5 条具体优化建议，并说明每条预期解决哪个指标。
```

**评分**：
- 5 分：5 条建议均具体可操作（如「将首屏图片转为 WebP + preload」、「为图片预留尺寸避免布局偏移」等），且正确关联指标
- 3 分：建议笼统（如「优化代码」）或指标关联错误
- 0 分：建议无效

---

### 题 5.2： Bundle 优化

```
一个 Next.js 项目，分析发现 lodash 占包体积 70KB+，但实际只用到了 _.debounce 和 _.throttle。
请给出 3 种不同的优化方案，说明各自的优缺点。
```

**评分**：
- 5 分：给出 3 种有效方案（如 lodash-es + tree shaking、按需引入 lodash/debounce、改用 lodash-es 或自己实现），优缺点分析到位
- 3 分：2 种方案
- 0 分：未理解 tree shaking 或 babel-plugin-lodash 用法错误

---

## 维度 6：可访问性（a11y）

### 题 6.1：键盘导航修复

```
以下是一个自定义下拉菜单，存在严重的可访问性问题。请指出所有问题并修复：

<div class="dropdown">
  <div class="trigger" onclick="toggle()">Options ▼</div>
  <ul class="menu" style="display: none;">
    <li onclick="select(1)">Item 1</li>
    <li onclick="select(2)">Item 2</li>
    <li onclick="select(3)">Item 3</li>
  </ul>
</div>
```

**评分**：
- 5 分：指出全部问题（无 role/aria 属性、无法键盘操作、无焦点管理、点击外部不关闭、无 ESC 关闭），并给出符合 ARIA 规范的修复代码
- 3 分：指出部分问题
- 0 分：未考虑可访问性

---

### 题 6.2：语义化 HTML

```
将以下「 div  soup」改写为语义化 HTML5，说明每个改动的理由：

<div class="header">
  <div class="logo">Site</div>
  <div class="nav">
    <div class="item"><a href="/">Home</a></div>
    <div class="item"><a href="/about">About</a></div>
  </div>
</div>
<div class="main">
  <div class="article">
    <div class="title">Post Title</div>
    <div class="content">...</div>
  </div>
  <div class="sidebar">...</div>
</div>
<div class="footer">...</div>
```

**评分**：
- 5 分：正确使用 header、nav、ul/li、main、article、h1/h2、aside、footer，且解释理由（SEO、屏幕阅读器、大纲算法）
- 3 分：使用语义标签但遗漏关键部分（如 nav 内未用 ul）
- 0 分：未改动或改动错误

---

## 维度 7：调试与 Bug 修复（实战能力）

### 题 7.1：React 渲染异常

```
用户反馈：点击按钮后页面闪了一下，数据没有更新。
以下是简化后的代码，请找出原因：

function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  
  useEffect(() => {
    fetchUser(userId).then(data => {
      setUser(data);
      document.title = user.name;  // 问题行
    });
  }, [userId]);
  
  if (!user) return <div>Loading...</div>;
  return <div>{user.name}</div>;
}
```

**评分**：
- 5 分：指出闭包陷阱（useEffect 中的 user 是旧值），给出 2 种修复（用 data.name 或添加 user 依赖但处理竞态）
- 3 分：指出问题但修复方案有副作用
- 0 分：未发现问题

---

### 题 7.2：样式泄漏

```
一个微前端项目，子应用 A 的全局样式污染了子应用 B：

/* 子应用 A */
button { background: red; border: none; }

/* 子应用 B 期望默认 button 样式 */

请给出 3 种隔离方案，说明适用场景。
```

**评分**：
- 5 分：给出 3 种有效方案（CSS Modules、Shadow DOM、BEM + 命名空间、Scoped CSS 等），场景分析到位
- 3 分：2 种方案
- 0 分：说「不要用全局样式」这种空话

---

### 题 7.3：内存泄漏

```
以下代码在单页应用中导致内存泄漏，请指出原因并修复：

useEffect(() => {
  const handler = () => console.log('resize');
  window.addEventListener('resize', handler);
  // 缺少 cleanup
}, []);
```

额外追问：如果是 `setInterval` 而非事件监听，泄漏模式有什么不同？

**评分**：
- 5 分：正确指出 cleanup 缺失，给出修复代码，并解释 setInterval 泄漏更隐蔽（回调持续执行 vs 事件监听只是引用不释放）
- 3 分：指出 cleanup 但追问回答不完整
- 0 分：未发现问题

---

## 维度 8：架构与工程化（系统设计）

### 题 8.1：组件库设计

```
设计一个 Button 组件，要求：
1. 支持变体：primary、secondary、ghost、danger
2. 支持尺寸：sm、md、lg
3. 支持状态：loading（带 spinner）、disabled
4. 支持作为链接（<a>）或按钮（<button>）渲染（polymorphic）
5. 使用 TypeScript，类型安全
6. 样式方案任选（CSS Modules / Styled-components / Tailwind），说明理由
```

**评分**：
- 5 分：API 设计优雅，类型完整，loading 状态处理正确（防止重复提交），polymorphic 实现安全
- 3 分：功能满足但类型或边界处理粗糙
- 0 分：明显设计缺陷

---

### 题 8.2：微前端通信

```
一个电商后台采用微前端架构（qiankun），包含：
- 基座应用（负责登录、导航）
- 商品子应用
- 订单子应用

需求：商品子应用点击「查看订单」时，需要跳转到订单子应用并携带商品 ID 过滤条件。

请设计通信方案，说明：
1. 路由跳转方式
2. 跨应用状态共享
3. 如何避免硬编码依赖
```

**评分**：
- 5 分：方案合理（如通过基座应用路由下发、自定义事件 + 约定协议、URL 参数传递过滤条件），解耦清晰
- 3 分：方案可行但耦合较重（如直接操作 window.location）
- 0 分：未理解微前端隔离机制

---

### 题 8.3：错误边界与降级

```
设计一个 React 应用的全局错误处理策略，要求：
1. UI 渲染错误（React Error Boundary）捕获并显示降级 UI
2. 异步错误（API 失败）统一处理，区分「可恢复」与「不可恢复」
3. 全局未捕获错误（window.onerror）上报监控
4. 开发环境显示详细错误堆栈，生产环境显示友好提示
```

**评分**：
- 5 分：分层处理（Error Boundary + 异步中间件 + 全局监听），降级策略清晰，环境区分正确
- 3 分：覆盖部分场景
- 0 分：混淆错误类型或处理方案明显遗漏

---

## 评分汇总表

| 维度 | 题目数 | 满分 | 权重 | 核心考察点 |
|------|--------|------|------|------------|
| HTML/CSS 基础 | 3 | 15 | 1.0 | 布局能力、 specificity 理解 |
| JS 核心与异步 | 3 | 15 | 1.2 | Event Loop、闭包、并发控制 |
| 框架与组件 | 3 | 15 | 1.2 | React 优化、Hook 设计、状态管理 |
| 视觉还原 | 3 | 15 | 1.0 | CSS 动画、设计稿还原、响应式 |
| 性能优化 | 2 | 10 | 1.0 | 工程化意识、指标理解 |
| 可访问性 | 2 | 10 | 0.8 | ARIA、语义化、键盘导航 |
| 调试修复 | 3 | 15 | 1.2 | Bug 定位、内存泄漏、样式隔离 |
| 架构设计 | 3 | 15 | 1.0 | 组件设计、微前端、错误处理 |

**总分 = Σ(维度得分 × 权重)**

---

## 复现规范

1. **温度 0**，关闭 Top-p 随机性
2. **单次生成**，不给予二次机会（模拟真实使用）
3. **记录完整输出**，包括代码和解释部分
4. **人工评审代码**，模型无法自评代码是否可运行
5. **横向对比时**，同一道题对比不同模型的「第一反应」差异最大

---

## 快速版本（10 分钟跑完）

如果时间有限，优先做这 5 道题：

| 优先级 | 题目 | 理由 |
|--------|------|------|
| P0 | 2.1 Event Loop | 区分「背过答案」vs「真懂机制」 |
| P0 | 3.1 React 性能优化 | 考察工程经验深度 |
| P0 | 4.2 文字描述转 UI | 测试「设计意图理解」能力 |
| P1 | 7.1 React 渲染异常 | 实战调试能力 |
| P1 | 8.1 组件库设计 | API 设计品味与类型安全 |

---

> 需要我把这套题整理成一个可直接粘贴到 ChatGPT/Claude 的 JSON 或 Markdown 格式吗？
