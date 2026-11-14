# plugin-tetris · Halo 俄罗斯方块插件

一个完整可运行的 Halo 2.x 插件，为站点加入俄罗斯方块。**插件面向所有 Halo 站点，不绑定任何具体域名。**

> ## 访问约定（硬性要求）：`https://你的域名/tetris`
>
> 这是**唯一**对外入口。插件启动时会自己创建并发布 slug 为 `tetris` 的 Halo 页面，装好 JAR 后直接打开即可，不需要手动建页面。域名由访客浏览器当前所在的站点决定，插件既不读取、也不需要知道它是什么；同一份 JAR 装到多少站点，就有多少个互相独立、但都遵循 `https://你的域名/tetris` 这一写法的游戏入口。

- **不绑定域名**：入口页面、iframe、静态资源、排行榜 API、主题同步全部使用**同源相对路径**，运行时从不读取 `location.hostname`。个人域名、二级域名、内网 IP + 端口、本地 `localhost:8090` 都适用，无需改代码、无需按域名重新打包。
- **零后台操作**：上传 / 启用 JAR 即自动建页；不注册 Console 侧边栏菜单，不向前台导航自动加菜单项。
- **全站排行榜**：匿名可读可提交，带每 IP 60 秒 10 次限流、昵称/分数校验；非 Halo 部署自动降级为浏览器本地榜。
- **Ethereal 主题适配**：同源读取 `theme` / `hue`，自动跟随明暗与主题色相，无需改主题文件、无需注入脚本。
- **自适应视口**：iframe 高度取父视口剩余空间，嵌入时精简重复页头，10×20 棋盘按可用高度动态缩放，`dvh` 兜底；100% 缩放直接可玩。
- **可独立部署**：`standalone/tetris.html` 是零外部请求单文件版，任意博客、对象存储、`file://` 打开都能玩。

> 与 `plugin-game-2048` 是两个**完全独立**的工程与插件：本工程放在独立目录 / 独立仓库，不改动、不覆盖 2048 插件的任何文件；两者的 `plugin.yaml` name、GVK、API 路径、Scheme 与页面 slug 全都不相同，可以同时安装、互不影响。升级俄罗斯方块不会碰到 2048 的排行榜数据。

---

## 功能

| 项目 | 说明 |
| --- | --- |
| 游戏规则 | 10×20 棋盘、7 种方块、7-bag 随机、旋转 + 踢墙、幽灵落点预览 |
| 操作 | ← → 移动 / WASD、↑ 或 X 顺时针、Q 逆时针、↓ 软降、空格硬降、C 暂存、P 暂停、R 重开 |
| 移动端 | 6 个触屏按钮 + 棋盘滑动（左右移动、上滑/轻点旋转、下滑硬降） |
| 计分 | 消 1/2/3/4 行得 100/300/500/800 × 等级；软降每行 +1、硬降每行 +2；每 10 行升 1 级，重力从 800ms 递减到 80ms |
| 预览 | Next ×3、Hold（每回合限一次）、分数 / 最高分 / 消行 / 等级 / 落块数 |
| 排行榜 | Halo 全站榜或浏览器本地榜；昵称用 `textContent` 渲染，防 XSS |
| 主题 | 经典方块配色保持可读性，外围卡片 / 按钮 / 排行榜跟随 Ethereal 明暗与 `--hue` |

---

## 目录结构

```
plugin-tetris/
├── build.gradle                     # Java 构建；jar 排除 ui/**，不含 Console UI
├── settings.gradle / gradle.properties   # rootProject / version=1.0.0
├── gradlew / gradlew.bat / gradle/  # Gradle 9.4.0 wrapper（华为云镜像 + sha256）
├── src/main/java/run/halo/tetris/
│   ├── TetrisPlugin.java            # 生命周期：注册 TetrisScore Scheme + 触发自动建页
│   ├── TetrisPageInitializer.java   # 幂等创建已发布 /tetris 页面 + Snapshot
│   ├── TetrisScore.java             # 自定义模型（GVK: tetris.halo.run/v1alpha1）
│   ├── ScoreService.java            # 校验、规范化、排行查询与写入
│   ├── ScoreEndpoint.java           # 公开 API + 每 IP 滑动窗口限流
│   ├── ScoreSubmit.java             # 请求 DTO
│   └── ScoreView.java               # 响应投影
├── src/main/resources/
│   ├── plugin.yaml                  # 插件清单（requires >=2.27.0）
│   ├── logo.svg
│   ├── extensions/
│   │   ├── reverse-proxy.yaml       # /tetris/** -> static/tetris
│   │   └── role-template.yaml       # 匿名只读+提交 / 可选管理角色
│   ├── page/tetris.html             # 自动写入页面的正文（同源 iframe）
│   └── static/tetris/               # 前台游戏页（也是 standalone/ 的源文件）
│       ├── index.html / style.css / app.js
│       └── tetris-core.js           # 由 scripts/build-standalone.mjs 生成
├── src/test/java/.../TetrisPageInitializerTest.java   # JUnit 5 + Mockito（5 项）
├── ui/
│   ├── src/core/tetris.js           # 唯一规则源码（零依赖纯函数，ESM）
│   ├── test/tetris.test.mjs         # 规则测试（17 项）
│   └── test/contract.test.mjs       # 域名无关 / 自动建页 / 主题 / 页面冒烟（11 项）
├── scripts/
│   ├── build-standalone.mjs         # ESM -> window.TetrisCore（IIFE）
│   └── build-blog-pack.mjs          # 生成四文件版 + 单文件离线版
├── standalone/                      # 纯前端静态包（可脱离 Halo 部署）
├── deploy/                          # 手动兜底片段（自动建页失败时使用）
└── LICENSE / README.md
```

---

## 下载（推荐）

不想装 JDK / Gradle 时，直接用 GitHub Release 里已构建好的 JAR：

| 版本 | 文件 | 大小 | SHA-256 |
| --- | --- | --- | --- |
| **v1.0.2（最新）** | [plugin-tetris-1.0.2.jar](https://github.com/LinuxOega/plugin-tetris/releases/download/v1.0.2/plugin-tetris-1.0.2.jar) | 41,797 B | `e161abb0b77d6591563b605c2cd9d4ec30769b5d4316b4942fdecacf7c1b4e05` |
| v1.0.1 | [plugin-tetris-1.0.1.jar](https://github.com/LinuxOega/plugin-tetris/releases/download/v1.0.1/plugin-tetris-1.0.1.jar) | 40,826 B | `a564340e64dc0fd00ae868db19f8ebfa71e1c37be0f5b246bae1c1d1381a07cb` |

发布页：[LinuxOega/plugin-tetris Releases](https://github.com/LinuxOega/plugin-tetris/releases)，含各版本更新说明与附件。源码在独立仓库 [LinuxOega/plugin-tetris](https://github.com/LinuxOega/plugin-tetris)，与 2048 插件的仓库互不影响。

> Release 附件实际从 `objects.githubusercontent.com` 下载，部分网络环境下不可达；此时用下面的本地构建，产物与 Release 完全一致。`.gitignore` 有意不把 JAR 放进源码仓库。

## 环境要求与构建

| 依赖 | 版本 |
| --- | --- |
| Halo | **>= 2.27.0**（仅插件模式；纯前端部署不需要 Halo） |
| JDK | 21 |
| Gradle | 9.4.0（wrapper 已内置，也可用系统安装） |
| Node / npm | 22+ / 10+ |

```bash
# 1) 规则源码变更后，重新生成前台页面的核心脚本
node scripts/build-standalone.mjs

# 2) 生成可部署到任意博客的静态包（standalone/）
node scripts/build-blog-pack.mjs

# 3) 一条命令完成：Node 测试 + Java 编译/单测 + JAR 打包
./gradlew build          # Windows: .\gradlew.bat build
# 产物：build/libs/plugin-tetris-1.0.2.jar（同一份 JAR 可用于任意域名）
```

`ui/` 只承担「规则唯一源码 + Node 测试」，`build.gradle` 的 `jar` 显式 `exclude 'ui/**'` 与 `exclude 'ui-plugin.json'`：Halo 靠 `resources/ui/ui-plugin.json` 识别 Console 插件入口，JAR 里没有这个文件就不会注册侧边栏菜单。

> Wrapper 分发源指向华为云镜像（`repo.huaweicloud.com`），带 `distributionSha256Sum` 校验；官方源会重定向到 GitHub，部分网络环境下不可达。

---

## 使用方式

### 1. 唯一入口：`https://你的域名/tetris`

安装：Halo 控制台 → 插件 → 上传插件 → 选择 JAR → 启用。

1.0.0 起，插件启动时会自己把入口建好：**上传 / 启用 JAR 后直接打开 `https://你的域名/tetris`**，不需要手动新建页面。这一步在任何站点上都完全相同、与域名无关。

底层写入两个 Halo 扩展对象（对齐 Halo 2.27 原生发布契约）：

| 对象 | 内容 |
| --- | --- |
| `SinglePage` · `plugin-tetris-page` | 标题「俄罗斯方块」、slug `tetris`、`publish=true`、`visible=PUBLIC`、`published` label、专属 `managed=true` 标记 |
| `Snapshot` · `plugin-tetris-page-content` | `rawType=HTML`、带 `content.halo.run/keep-raw` 的基础快照，正文是 `src/main/resources/page/tetris.html`；页面的 `baseSnapshot` / `headSnapshot` / `releaseSnapshot` 都指向它 |

Halo 把页面正文存在 `Snapshot` 里，只有「已发布 + 公开 + 有 `releaseSnapshot`」三者齐备，主题路由 `/{slug}` 才会被注册，因此两个对象必须一起写、且 Snapshot 先写。

**幂等与安全策略**：已存在且由插件管理的页面只修复发布状态，**不覆盖你改过的标题和内容**；内容快照丢了会补建；若 slug 已被别的页面占用则跳过并写 WARN，不制造冲突；**卸载 / 更新不删除页面**（保护站长编辑）；建页失败会退避重试 3 次，仍失败只记日志，不影响插件和排行榜启动。

> **为什么不是插件直接注册 `/tetris`**：Halo 把插件静态资源前缀固定为 `/plugins/{name}/assets/**`，`CustomEndpoint` 又固定挂在 `/apis/` 下，插件无法占用站点根路径。用自定义页面是官方支持的做法。

### 2. 手动兜底

若自动建页被跳过（例如 slug 已被占用），后台 →「页面」→ 新建 → 别名 / slug 填 `tetris` → 内容区切 **HTML / 源码模式**，整段粘贴 `deploy/ethereal/page.html` → 可见性「公开」→ 点「**发布**」。

片段核心（**同源相对路径 + 零脚本 + 无固定域名**）：

```html
<iframe src="/plugins/plugin-tetris/assets/tetris/index.html"
  title="俄罗斯方块"
  style="display:block;width:100%;height:clamp(240px,calc(100vh - 380px),620px);height:clamp(240px,calc(100dvh - 380px),620px);border:0"></iframe>
```

> **子路径部署**：若 Halo 通过反向代理挂在 `/blog/` 下，把片段里两处 `/plugins/...` 改成 `/blog/plugins/...`。游戏页会自动从自身 URL 推导出 `/blog` 前缀，排行榜 API 随之变成 `/blog/apis/...`；也可显式设置 `{ basePath: '/blog' }`。根路径部署时什么都不用改。

### 自适应视口（无需缩小网页）

**1.0.2 起不用再按 `Ctrl+-` 缩小浏览器。** 旧版 iframe 高度被固定为 720–900px，游戏页内部又是固定 320px 宽（10×20）的棋盘加两栏侧栏，外层主题还有标题与说明，三段高度相加超过一屏，只能靠浏览器缩放才能看全。现在改成三层自适应：

| 层 | 做法 |
| --- | --- |
| 父页面 iframe | 片段高度改为 `clamp(240px, calc(100dvh - 380px), 620px)`（同时保留 `100vh` 兜底），即视口减去站点头部后的剩余空间 |
| 同源 iframe 运行时 | 游戏页通过 `window.frameElement` 直接按父视口剩余高度修正 iframe 高度（240–880px）；窗口缩放、手机旋转、主题头部高度变化都会重算 |
| 游戏页内部 | iframe 内自动启用 `is-embedded` 精简重复的标题 / 说明 / 提示 / 页脚；棋盘按「视口高度 − 页头 − 工具栏 − 触屏按钮」除以 2 动态计算宽度，CSS 另有 `50dvh` 兜底，JS 被禁用也不溢出 |

因此**已装过旧版、页面里仍是 720px 旧 iframe 也无需重建页面**：更新 JAR 后，游戏页会从 iframe 内部按父视口剩余空间直接改写外层高度；若主题头部占用太多、剩余空间不足 420px，页面会自动定位到游戏区，让 iframe 占满整个视口——打开就是 100% 缩放可玩，不用手动下翻，也不用 `Ctrl+-`。同时插件启动时会把**由旧版本插件生成的页面正文**自动升级为新版片段（你自己编辑过的内容不会被覆盖）。若想手动替换，后台编辑该页面，HTML / 源码模式整段粘贴 `deploy/ethereal/page.html` 即可。

直接全屏打开 `/plugins/plugin-tetris/assets/tetris/index.html`，或双击本地 `standalone/tetris.html`，同样自适应；只是没有父页面可调整，走的是 CSS `dvh` 兜底加棋盘动态计算。契约测试 `ui/test/fit-viewport.test.mjs` 锁死了「不得再出现固定 iframe 高度」与无布局环境下的降级行为。

### 3. 部署后核对清单

1. `https://你的域名/tetris` 返回 200 并显示 10×20 棋盘
2. Console 左侧菜单**没有**「俄罗斯方块」页面（「插件」列表里能看到本插件，属正常）
3. 前台导航栏**没有**自动生成的游戏入口
4. 方向键 / WASD 能移动，空格硬降，C 能暂存；提交成绩后刷新排行榜能看到新记录
5. 浏览器 Network 面板里资源与 API 请求均指向**当前站点域名**

### 如果 `https://你的域名/tetris` 返回 404

看响应体即可判断：若返回 `application/problem+json` 且内容是 `No static resource tetris.`，说明请求已到 Halo，只是站点里**没有可公开访问的 `tetris` 页面路由**。按顺序自查：

1. **装的是 1.0.0 且插件已启用吗？** 自动建页只在插件启动时执行；用「更新插件」上传后要等重启完成。
2. **slug 被占用了吗？** 看插件日志里有没有 `Slug /tetris is already used`；有就删掉/重命名那个页面再重启插件。
3. **建的是「页面」吗？** 手动兜底必须建 SinglePage，不是文章，也不是「外观 → 菜单」里的自定义链接。
4. **发布了吗？** 点「发布」而不是「保存草稿」，可见性设为「公开」。

只读自检（域名换成站点实际域名）：

```bash
curl -s "https://你的域名/apis/api.content.halo.run/v1alpha1/singlepages?size=50"
```

应出现 `slug: "tetris"`、`publish: true`、`visible: "PUBLIC"`、`phase: "PUBLISHED"` 且只有一条。同时确认插件本身正常：`/plugins/plugin-tetris/assets/tetris/index.html` 与 `/apis/api.tetris.halo.run/v1alpha1/scores` 都应返回 200。

---

## 排行榜 API

```
GET  /apis/api.tetris.halo.run/v1alpha1/scores?size=10
POST /apis/api.tetris.halo.run/v1alpha1/scores
```

提交体：`{ "player": "昵称", "score": 1234, "lines": 12, "level": 2, "pieces": 45 }`

- 昵称 1–24 个可见字符，过滤控制字符；分数 0–10,000,000；`lines` / `level` / `pieces` 会被夹紧到合法范围。
- 匿名角色只被授予 `get` / `list` / `create`，底层 `TetrisScore` 扩展不对外可写；每 IP 60 秒最多 10 次提交。
- 游戏结束会自动提交一次；也可手动点「提交成绩」。在线提交失败自动降级为本地榜。

### 自定义 API / 强制本地榜

在 `index.html` 脚本前设置 `window.TETRIS_CONFIG`：

```js
window.TETRIS_CONFIG = { apiBase: '/my/scores' };  // 自定义排行榜
window.TETRIS_CONFIG = { mode: 'local' };          // 完全离线，浏览器本地榜
window.TETRIS_CONFIG = { basePath: '/blog' };      // 子路径部署
window.TETRIS_CONFIG = { theme: 'off' };           // 关闭 Ethereal 主题跟随
window.TETRIS_CONFIG = { defaultHue: 250 };        // 默认主题色相
```

---

## Ethereal 主题适配

游戏页通过 ReverseProxy 作为独立文档提供，拿不到父页 CSS 变量，但**与站点同源**，因此直接读同源 `localStorage` 的 `theme` / `__user_chose_theme` / `hue`，监听 `storage` 与 `matchMedia` 变化，设置 `.dark`、`data-color-scheme`、`color-scheme-*`、`--hue`；也接受同源 `postMessage({ type: 'tetris:theme', scheme, hue })`（拒绝跨域消息）。不需要改主题文件、不需要注入脚本。

`deploy/ethereal/` 提供了主题同款卡片容器、可粘贴页面与**可选**桥接脚本 `theme-bridge.js`（仅用于不写 localStorage 的自定义主题）。方块本身保留经典配色，保证明暗主题下的可读性；外围卡片、按钮、输入框与排行榜才跟随主题变量。

---

## 纯前端部署（不需要 Halo）

- `standalone/tetris.html` — 单文件，CSS / JS 全内联，`mode:'local'`，零外部请求，直接上传或双击打开即可。
- `standalone/tetris/` — 四文件版，适合 CSP 禁止 `unsafe-inline` 的站点。
- `deploy/embed-snippet.html` — 最短 iframe 片段，可贴进文章 HTML 块或主题模板。

独立部署版只有浏览器本地排行榜（每位访客各存各的）；要全站榜需自建 API 或使用 Halo 插件模式。

---

## 验证状态

- ✅ `npm test`：**35 项全部通过** — 规则 17（7-bag、旋转踢墙、碰撞、消行计分、等级、Hold、终局、不可变性、RNG 确定性）+ 契约 11（域名无关、多域名多协议请求一致、子路径、自动建页、DTO 字段、单文件离线包、主题同步、页面渲染 + 键盘可玩）+ **自适应视口契约 7**（无固定 iframe 高度、dvh 兜底、运行时测量、静态包同步、jsdom 降级）
- ✅ JUnit 5 + Mockito：`TetrisPageInitializerTest` 5 项通过
- ✅ `./gradlew build`：BUILD SUCCESSFUL（42 秒，9 个任务）
- ✅ JAR 内容核验：`plugin-tetris-1.0.2.jar`（41,797 B / 27 条目，8 个 `.class`）；`plugin.yaml` version 1.0.2 / requires >=2.27.0；4 个组件（`ScoreEndpoint` / `ScoreService` / `TetrisPageInitializer` / `TetrisPlugin`）；含 `page/tetris.html`、`static/tetris/` 4 个文件、2 个 extensions YAML、`META-INF/plugin-components.idx`；**无 `ui/`、无 `ui-plugin.json`、无 `menu-item.yaml`、无任何硬编码域名**

**仍未验证**：本机无 Docker、无本地 Halo 实例，因此「启用插件后自动建页、真实浏览器中 `/tetris` 的路由与视觉表现」需要在目标站点上传 JAR 后确认。构建契约、片段同源性、页面可玩性已由自动化测试覆盖。

---

## 已知限制

- Console 的「插件」列表仍会列出本插件（Halo 机制，无法隐藏），但点进去没有游戏菜单。
- 静态路径 `/plugins/plugin-tetris/assets/tetris/index.html` 仍可直接打开（Halo 机制），只是没有任何菜单或链接指向它；严格只允许 `/tetris` 需在反向代理层拦截。
- 自动建页会往内容库写入 2 个对象，卸载时不自动删除（避免误删编辑）；不需要时到后台「页面」删除标题为「俄罗斯方块」、`tetris.halo.run/managed=true` 的那条。
- 站点启用 HTTPS 就自动是 `https://`，HTTP 环境自动是 `http://`，插件不强制跳转。

MIT License。
