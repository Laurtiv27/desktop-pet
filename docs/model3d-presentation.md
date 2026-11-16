# 3D 骨骼桌宠（model3d）

设计规格见：`docs/model3d-presentation-design.md`。

## 摘要

- **表现**：Three.js + glTF/GLB，固定机位，透明 Electron 窗
- **配置**：`presentation: "model3d"` + `model3d` 资源 / meta
- **行为**：与 video / Spine 同构的 Intent + BehaviorPlanner；位移走现有窗口 bounds
- **分支**：`feat/model3d-presentation`（基于 main，独立于 Spine 分支）
- **首版验收**：演示 GLB 的 `idle` 循环、`walk` + 窗口移动、拖拽；`autoBehavior` 可关

## 非目标（首版）

自由旋转查看、布料/换装、AI 生成 3D、本分支实现 Spine 运行时。

## 素材

首版演示模型是 Khronos glTF Sample Models 的 Fox（glTF-Binary）。

- 文件：`assets/model3d/model3d-demo/Fox.glb`（同目录 `meta.json`：`idle` → `Survey`，`walk` → `Walk`，`autoBehavior: false`）
- 来源：https://github.com/KhronosGroup/glTF-Sample-Models/tree/main/2.0/Fox
- 许可副本：`assets/model3d/model3d-demo/NOTICE.txt`

| 部分       | 作者                                                                        | 许可                                                                                           |
| ---------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 低模网格   | [PixelMannen](https://opengameart.org/content/fox-and-shiba)                | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)                                  |
| 绑定与动画 | [@tomkranis](https://sketchfab.com/models/371dea88d7e04a76af5763f2a36866bc) | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)                                      |
| glTF 转换  | @AsoboStudio、@scurest                                                      | [转换说明](https://github.com/KhronosGroup/glTF-Sample-Models/pull/150#issuecomment-406300118) |

公开展示或再分发动画时，按 CC-BY 4.0 保留 tomkranis 的署名，并保留 PixelMannen 的来源说明。

## 启用演示宠

不要改默认女仆。把下面这只宠物追加进用户层 `main-config.jsonc` 的 `pets` 数组（与女仆并列）。可复制片段：`assets/model3d/model3d-demo/pet-snippet.jsonc`。

用户文件在 `~/.dsh/dsh-pet/main-config.jsonc`（Windows：`%USERPROFILE%\.dsh\dsh-pet\main-config.jsonc`）。文件不存在时，先在设置页点一次「同步」生成带注释的原文，再追加。

```jsonc
{
  "name": "小狐狸",
  "id": "model3d-demo",
  "size": 320,
  "balanceEnabled": false,
  "whisperEnabled": false,
  "workStatusEnabled": false,
  "fixedEnabled": true,
  "display": "desktop",
  "position": { "corner": "bottom-right", "marginX": 24, "marginY": 80 },
  "presentation": "model3d",
  "model3d": {
    "assetId": "model3d-demo",
    "meta": {
      "glb": "Fox.glb",
      "clips": { "idle": "Survey", "walk": "Walk" },
      "walkSpeedPx": 100,
      "scale": 0.02,
      "pivot": { "x": 0, "y": 0, "z": 0 },
      "camera": { "kind": "perspective", "fov": 35, "distance": 5 },
      "facingMode": "mirror",
      "autoBehavior": false,
    },
  },
}
```

- `presentation: "model3d"` 走 Three.js 舞台；缺省仍是 webm。
- `assetId` 对应包内 `assets/model3d/model3d-demo/`（`Fox.glb` + `meta.json`）。上面内联的 `meta` 与磁盘那份一致，启动不另读文件。
- `display: "desktop"` 只在桌面透明窗出现。`fixedEnabled: true` 只关掉 webm 随机链里的转向/移动；三维漫游看 `meta.autoBehavior`。
- `autoBehavior: false`：只循环 idle，不随机走路。改成 `true` 后，大约每 5–9 秒走向一个随机点，到达后回到 idle。
- 和女仆写在同一份配置里时，条目级 webm 动画池仍会拍到这只宠物上。三维不认识的名字会回落到 `clips.idle`，不会改去播 webm。
- 设置页保存会保留已写上的 `presentation` / `model3d`，不必为了改别的开关而手抄一遍。

素材署名见上文「素材」表。公开展示这只狐狸时保留 tomkranis（CC-BY 4.0）与 PixelMannen（CC0）的出处。

## 启动

在仓库根目录：

```bash
npm run build && npm run vendor:three-model3d && npm run start:desktop
```

`npm run build` 会准备桌面共享逻辑；`vendor:three-model3d` 生成 `runtime/electron-helper/vendor/three-gltf.iife.js`。改完用户配置后重新启动桌面模式。

## 验收清单

- [ ] **idle 循环**：狐狸出现后一直播 Survey，不冻在末帧
- [ ] **walk 位移**：把 `autoBehavior` 改为 `true` 并重启，狐狸按 `walkSpeedPx` 走到屏幕内另一处，到达后回到 idle
- [ ] **拖拽**：按住狐狸拖动窗口，松手停在新位置并回到 idle（演示模型没有 drag 片段，拖动过程中不另换一套动作）
- [ ] **关漫游**：`autoBehavior: false` 时只待机，不自己走
- [ ] **webm 回归**：默认女仆仍是 video，随机待机、移动和拖拽抛掷与改前一致
