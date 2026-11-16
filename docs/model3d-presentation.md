# 3D 骨骼桌宠（model3d）

设计规格见（工作区）：`docs/superpowers/specs/2026-11-16-model3d-presentation-design.md`。

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
