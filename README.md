# 激光逻辑门运算

在网格上放置光学元件，激光沿网格传播并与元件发生作用，由此完成逻辑运算。

## 本地运行

直接双击 `index.html` 即可，不需要安装任何环境，也不需要本地服务器。

## 玩法

- 从屏幕上方的面板选择元件，在网格上左键放置
- 中键拖动视野，滚轮缩放
- WASD 旋转当前元件，右键删除
- 数字键或反引号键切换选中的元件
- 光源需要点击才能开启或关闭
- Command 加 Z 撤销，Command 加 Shift 加 Z 重做
- P 键开关注能读数面板：帧率、帧间隔、每帧脚本耗时、元件总数、在屏元件数、被剔除数、当前缩放
  （外接键盘也可以用 F2；Mac 笔记本上功能键默认被系统占用，需按住 Fn 才发得出来，所以主键定为 P）

读数面板里那两行的分工：帧间隔是浏览器实际给到的帧间隔，脚本是每帧 JavaScript 自己占用的时间。
两者一起看才能判断帧率是被脚本拖住，还是本来就到了浏览器的上限。

元件的阻挡规则、激光的传播与结算时序写在 [基本逻辑.md](基本逻辑.md) 里。

## 目录结构

```
index.html          入口页面
css/style.css       样式表
js/util.js          缓动曲线、数值钳制、坐标互转、颜色换算（必须最先加载）
js/config.js        所有可调参数的集中登记处
js/element-types.js 元件类型表与形状几何
js/state.js         全部状态变量的集中声明处
js/render-scene.js  视口、网格、激光、面板框、底栏的绘制
js/render-panel.js  选项槽、图标、元件槽、简介浮层的绘制
js/scene.js         电路与视野的序列化、反序列化
js/ui.js            弹出面板的 DOM 初始化
js/sidebar.js       左侧竖栏里的存档列表：读磁盘上所选文件夹的条目铺成树；换文件夹前先问一句要不要丢弃未保存的改动
js/files.js         文件读写与剪贴板
js/settings.js      运行速度滑块与两个开关
js/slots.js         选项槽的命中判定与动画
js/elements.js      网格上元件的增删、放置、渲染
js/history.js       撤销与重做
js/circuit.js       阻挡图、微帧推进、发射与接收
js/selection.js     选中、框选、拖动、整批旋转
js/ghost.js         虚影跟随与各类动画
js/debug.js         调试面板与调色沙盒
js/camera.js        相机更新与渲染入口
js/input.js         指针、滚轮、键盘输入
js/main.js          主循环与初始化入口
worker.js           部署时先于静态资源执行，拦掉直接输入 js、css 网址的访问
wrangler.jsonc      线上部署的配置：项目名、入口脚本，以及要上传的目录
dist/               发布成品目录，部署时上传的就是它，里面只放页面、样式与脚本
旧大文件版本.html   最早的单文件版本，样式与脚本全部内联，已停止维护，仅作留存
```

根目录有两个可以直接双击打开的入口，别搞混。

`index.html` 是当前维护的多文件版本，开发都改它和 `css/`、`js/` 下的文件。

`旧大文件版本.html` 是最早的单文件版本，样式与脚本全部内联在这一个文件里，功能停在拆分之前，不再更新。留在这里只为对照早期实现，不要在上面改代码，改了也不会反映到多文件版本里。

脚本之间靠全局作用域共享变量，因此 `index.html` 里的加载顺序不能随意调整。

`util.js` 必须排在第一位，有两处硬依赖：`config.js` 在文件顶层就要调用 `hslToRgb` 把常态色、亮起色、选中色预先算成 RGB 端点；`state.js` 在文件顶层就要调用 `newEased` 建立几组缓动标量。这两处都在脚本刚加载时立即执行，工具函数一旦排在后面，整个页面会在加载阶段就中断，报的却是别的文件的行号。

同理，任何在文件顶层就被调用的函数，都必须来自比它更早加载的文件；只在函数体里调用的则不受这个限制。

## 技术栈

原生 HTML、CSS、JavaScript，无框架、无构建工具、无外部依赖。

## 发布

线上地址是 https://laser.shayuyue.com ，站点跑在 Cloudflare 上，纯静态，没有构建步骤。

部署用 Cloudflare 官方的 wrangler 命令行工具完成，本机已装 Node。以下命令都在项目根目录下执行。

第一次部署前先登录一次：

```sh
cd "/Users/shayuyue/Desktop/Projects/激光逻辑门运算"
npx wrangler login
```

这条命令会打开浏览器，跳到 Cloudflare 的授权页，登录账号后点一下 Allow 即可，终端随即打印登录成功，然后才轮得到部署。

浏览器没有自动弹出来的话，把终端里那条 `https://dash.cloudflare.com/oauth2/auth?...` 整条复制到地址栏打开，效果一样。

如果终端打印 `Timed out waiting for authorization code`，说明这次授权没有在时限内完成，那条链接已经失效，重跑一次 `npx wrangler login` 换条新的即可。反复超时通常是三个原因：链接没打开、浏览器里没有登录 Cloudflare 账号、或者 `dash.cloudflare.com` 在当前网络下打不开。

登录凭证会过期，过期之后部署不会成功。终端会报 `Not logged in`，并说明 token 已过期、自动刷新也没有成功。这时重新跑一次上面那条 `npx wrangler login` 就行，不需要改任何配置，也不需要重新绑定域名。

判断依据看报错里的那句话即可：说的是凭证过期，就是重新登录的事；如果报的是别的原因（网络不通、项目名对不上），那才是另外的问题。

### 授权页打不开时

如果本机浏览器根本打不开 `dash.cloudflare.com`，整个 OAuth 流程都走不通，可以改用 API Token 绕开浏览器授权：

```sh
cd "/Users/shayuyue/Desktop/Projects/激光逻辑门运算"
export CLOUDFLARE_API_TOKEN="你的token"
npx wrangler deploy
```

Token 在 Cloudflare 控制台的 API 令牌页面创建，模板选 `Edit Cloudflare Workers`，建好后复制出来。控制台打不开的话，在别的能上网的设备上创建也一样，Token 只是一串字符，拿到本机用即可，不需要浏览器回调。带上这个环境变量跑部署，wrangler 就不再走登录流程。

Token 是敏感凭证，只留在自己的终端里，不要写进仓库或文档。

之后每次更新固定三步：改源码、把源码同步进 `dist`、执行部署。

```sh
cd "/Users/shayuyue/Desktop/Projects/激光逻辑门运算"
rm -rf dist && mkdir dist && cp -R index.html css js dist/
find dist -name '.DS_Store' -delete
npx wrangler deploy
```

第一条命令把运行所需的三个东西铺进 `dist`：入口页面、样式表、脚本。README、LICENSE、基本逻辑.md 是给人看的文档，页面运行时不读它们，留在根目录即可，不必上线。

这里先删掉整个 `dist` 再复制，而不是直接往里面覆盖：覆盖是增量的，源码里已经删除的文件会继续留在 `dist` 里，跟着一起传上线。`dist` 不是自动同步的，跳过这一步就会把旧内容传上去。

第三条命令清掉 macOS 在目录里自动生成的 `.DS_Store`。`cp -R` 会把它一并复制进 `dist`，不清掉就会连目录清单一起传上线。

最后一条命令把 `dist` 上传，并立即把线上切到新版本。

部署成功后，终端会打印上传的文件数量、新的版本号，以及一个 `workers.dev` 地址。那个 `workers.dev` 地址在国内打不开，属于域名层面的阻断，和部署成没成功无关，成功与否看文件数量和版本号即可；对外一律用上面那个自定义域名。

`wrangler.jsonc` 登记着三件事：

- `name` 决定更新哪个项目。写错或改动它，会变成新建一个项目，原有项目上绑好的域名不会跟过去。
- `main` 指向 `worker.js`，也就是先于静态资源执行的那段拦截脚本。它在根目录，不在 `dist` 里，所以不需要同步进发布目录。
- `assets.directory` 指向 `dist`，所以只有 `dist` 里的内容会被上传，源码、文档、旧版本文件都不会出现在线上。

线上对 `js/` 与 `css/` 的直接访问会被拦掉并返回 404，这是 `worker.js` 做的：它看浏览器自动附带的 `Sec-Fetch-Dest` 请求头，在地址栏直接回车时该值是 `document`，一律拒绝；页面内正常加载脚本和样式时分别是 `script` 和 `style`，照常放行。这只挡住闲逛式访问，项目本身是开源的，开发者工具里依然看得到脚本内容，命令行工具也不会带这个请求头。

部署完成后，顺手到项目页的「域名和路由」确认自定义域名还在；万一掉了，在那里重新添加一次即可。

## 许可证

MIT，详见 [LICENSE](LICENSE)。