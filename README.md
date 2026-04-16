# Markdown Reader

一个 Chrome 插件，将本地 `.md` 文件和 Git 平台的 Markdown 渲染提升到 GitHub 级别。

## 功能

- **本地文件阅读** — 浏览器直接打开 `.md` 文件，自动渲染为 GitHub 风格
- **Git 平台增强** — 支持 GitLab、Gitea 等自建平台的 Markdown 渲染替换
- **代码高亮** — 192 种语言语法高亮（highlight.js）
- **数学公式** — KaTeX 支持，懒加载（仅在检测到公式时加载）
- **目录导航** — 左侧 TOC 侧边栏，可收起/展开，滚动高亮
- **表格增强** — 列宽可拖拽调整，横向滚动
- **代码复制** — 代码块一键复制按钮
- **错误降级** — 渲染失败时保留原始内容，toast 提示

## 安装

### 从源码构建

```bash
# 安装依赖
npm install

# 构建
npm run build
```

### 加载到 Chrome

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `dist/` 目录
4. **重要：** 点击插件「详情」，开启「允许访问文件网址」

## 使用

- 本地 `.md` 文件：浏览器直接打开，自动渲染
- Git 平台：访问 GitLab 等平台的 `.md` 文件页面，自动增强

## 架构

```
src/
├── adapters/          # 平台适配器（Adapter 模式）
│   ├── base.js        # 适配器基类
│   ├── gitlab.js      # GitLab 适配器
│   ├── local-file.js  # 本地文件适配器
│   └── index.js       # 适配器注册表
├── core/
│   ├── renderer.js    # 渲染引擎（marked + highlight.js + KaTeX）
│   ├── toc.js         # 目录生成 + 侧边栏
│   └── table.js       # 表格增强（列拖拽）
├── popup/             # 插件弹窗
├── themes/            # 主题样式
├── background.js      # Service Worker
└── content.js         # Content Script 入口
```

### 添加新平台

继承 `BaseAdapter`，实现三个方法：

```javascript
class MyAdapter extends BaseAdapter {
  matchUrl(url) { /* 是否匹配当前 URL */ }
  async getRawMarkdown(doc) { /* 获取 Markdown 原文 */ }
  async getContainer(doc) { /* 获取渲染目标容器 */ }
}
```

在 `adapters/index.js` 中注册即可。

## 技术栈

| 依赖 | 用途 |
|------|------|
| marked | Markdown 解析 |
| highlight.js | 代码语法高亮 |
| KaTeX | 数学公式（懒加载） |
| webpack | 构建打包 |

## 开发

```bash
# 开发模式（watch）
npm run dev

# 构建生产版本
npm run build

# 运行测试
npm test
```

## License

MIT
