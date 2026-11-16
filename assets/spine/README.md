# Spine 素材目录约定

本地骨骼资源放在本目录，按宠物 `id` 分子目录，不随 npm 包分发。

```
assets/spine/<pet-id>/
  skeleton.json   # 或 .skel
  skeleton.atlas
  skeleton.png    # atlas 引用的图集
  meta.json       # 可选：clips / defaultSkin / walkSpeedPx
```

## 配置

- `pets[].presentation`：`video`（缺省）或 `spine`
- `pets[].spine.root`：相对本目录或条目素材根的子路径（例如宠物 id，或 `heroes/cat`）
- `pets[].spine.meta`：槽位名 → clip 名、默认皮肤、步行像素速度

设置页只露出「表现：视频 / 骨骼」。骨骼工程、运行时与图集请放到上述路径，由播放端解析。

## 分发边界

`package.json` 的 `files` **不**包含 `assets/spine`：

- 未授权的 Spine 运行时、编辑器工程与示例资源不得打进发布包
- 自有导出放在本目录即可，开发时从工作副本加载
- 若日后提供可分发的 stub / meta（无第三方二进制），再把安全文件加入 `files`

视频序列仍在 `assets/webm/`。
