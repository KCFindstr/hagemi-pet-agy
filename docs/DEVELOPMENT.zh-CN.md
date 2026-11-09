# 哈基米的工作原理

写给想修改她的人。她会做什么、怎么安装，请看 [README](../README.zh-CN.md)。

## 工作原理

```
Antigravity
├── 语言服务器 ──┐  会话列表、额度、模型列表、一句话补全
├── brain/*/transcript.jsonl ──┤  工具活动（从旁读取）
│                ▼
│        sidecars/pet/main.mjs   monitor → director → brain
│                │
│                ▼  Chrome DevTools 协议，隔离环境
└── 应用窗口 ── 封闭的 Shadow DOM ── WebGL 网格绑定 + Canvas 粒子 + 气泡
```

- **渲染：** 每个姿势是网格上的一张贴图。根据每张图的关键点生成柔性权重，让头发、耳朵、头和腿发生形变，再加上弹簧跟随和转头视差。尾巴沿着线稿切成独立图层，摆动时不会带着旁边的头发一起变形，被尾巴挡住的部分先用 [LaMa](https://huggingface.co/Carve/LaMa-ONNX) 补画，大多数姿势再用 [Animagine XL 4.0](https://huggingface.co/cagliostrolab/animagine-xl-4.0) 细化，尾巴摆动时宝石也会保留自己的描边。眨眼是手绘风格的贴片，通过同一张网格变形。姿势之间用短暂的交叉淡入切换。
- **行为：** 代理运行时每 2 秒轮询一次，否则每 4 秒一次，并且只读取活跃对话日志的新增内容。窗口隐藏时暂停渲染。
- **隔离：** 桌宠运行在隔离环境和封闭的 Shadow Root 里，碰不到应用的 JavaScript 和样式，Sidecar 停止时也会干净地移除。

### 为什么不用插件 Hook 或侧边面板？

Antigravity 文档提供了 Hook 和 Sidecar，但没有让插件在应用上层绘制的方式，而 Hook 会在代理循环里为每次工具调用启动一个进程。所以这个插件：

- 从旁读取活动，绝不会拖慢你的代理；
- 通过应用自己开启的 DevTools 端口进入窗口，不修改任何应用文件；
- 使用了未公开的本地接口：`GetAllCascadeTrajectories`、`RetrieveUserQuotaSummary`、`GetModelResponse` 等。

**Antigravity 更新可能让这些失效。** 应用本身不依赖它们，所以最坏的情况是她不再出现或不再有反应。已在 Windows 上的 Antigravity 2.28.2 测试。macOS 和 Linux 的路径已实现，但还没在真机上试过。

### 远程控制

她只住在桌面应用里，不会出现在远程控制的网页端。网页端运行在你另一个浏览器里，DevTools 端口够不到，而且 Antigravity 在那里关闭了插件面板。Sidecar 会继续在主机上运行，所以回到桌面窗口时她的状态是最新的。

## 开发

需要 Node 22 或更高版本。没有运行时依赖，也不需要构建。

把当前代码（包括你的改动）装进应用，以及再卸载掉：

```bash
npm run install:local
```

```bash
npm run uninstall:local
```

```bash
npm test
```

```bash
npm run preview
```

`preview` 会在 http://127.0.0.1:7891 打开排练舞台，每个状态、动作和台词都有按钮，不需要 Antigravity。`npm run dev` 会让 Sidecar 连接正在运行的应用，不安装任何东西，并输出详细日志。

README 里的动图和截图都是在排练舞台上录制的，不会录到真实应用，画面里只有虚构数据。修改美术或台词后可以重新录制。需要 Edge 或 Chrome，以及带 Pillow 的 Python：

```bash
npm run media
npm run media -- --lang zhs
npm run media -- --lang zhs touch stills
```

英文版输出到 `docs/media/`，中文版输出到 `docs/media/zhs/`。写上场景名就只重录这些：hello、reactions、work、subagents、quota、touch、drag、dock、language 和 stills。

修改姿势或关键点（`tools/landmarks.json`）后需要重新生成绑定数据。需要带 Pillow 和 numpy 的 Python：

```bash
npm run build:rig
```

这一步会重置尾巴下方的图层，所以之后要重新补画。补画还需要 `opencv-python-headless`、`onnxruntime` 和模型文件（不在本仓库中）：

```bash
npm run build:under -- --model path/to/lama_fp32.onnx
```

它最后会验证：尾巴静止时，所有图层合成后与原图完全一致。单独运行验证用 `npm run build:under -- --check`。

如果想用更大的模型重画这些图层，可以用 `tools/colab_inpaint.ipynb` 在 Colab GPU 上运行 [Animagine XL 4.0](https://huggingface.co/cagliostrolab/animagine-xl-4.0)，以 LaMa 的结果为起点。这一步是可选的。发布的图层中有 37 个姿势用到了它：

```bash
npm run build:under -- --export crops.zip
```

把 `crops.zip` 上传到 notebook，再把它下载的结果 zip 拿回来。`--import` 只改写尾巴下方的图层，并重复同样的验证：

```bash
npm run build:under -- --import results.zip --variant s050_a
```

## AI 吐槽的限制

调用模型要通过下面每一项检查。小事依然用写好的台词，不花钱。

| 限制 | 默认值 | 可设置 |
| --- | --- | --- |
| 模型 | `Gemini 3.8 Flash (Low)`，最省的版本 | 你列表里的任何模型 |
| 哪些时刻 | 一轮完成、出错、子代理、额度变化、深夜等，随话量调整 | 话量 |
| 两次调用的最短间隔 | 2 分钟 | 是 |
| 每小时 / 每天次数 | 30 / 300 | 是 |
| 每天估算 Token，包含提示词和回复 | 200,000 | 是 |
| 评论模型额度低时暂停 | 低于 10% | 是 |
| 每次调用附带的摘录 | 用户约 200 字以内，代理约 1000 字以内，先清理敏感内容 | 上下文范围 |
| 只在你看着时 | 窗口聚焦且可见 | 是 |
| 同样的情况重复调用 | 6 小时内不会 | |
| 失败之后 | 退避 2 到 60 分钟，期间改用台词 | |

调用走 Antigravity 自己的本地语言服务器，使用你已登录的账号，所以不需要 API Key，也会计入你的正常额度。Token 数是估算值，因为接口不返回用量。AI 生成的吐槽会带 ✦ 标记，当天用量可以在设置面板里看到。

设置保存在 `~/.gemini/antigravity/sidecar_data/hagemi-pet-agy/pet/data/settings.json`。
