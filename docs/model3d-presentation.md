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

首版使用可演示授权的免费 glTF（来源与署名在接入具体 GLB 时写入本节）。
