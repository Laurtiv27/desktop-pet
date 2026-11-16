/**
 * Three.js + GLTFLoader 的 vendor 入口。
 *
 * 桌面 Helper 从 file:// 载入经典 script，不能直接 import ESM。
 * 本文件只负责把命名空间和加载器标成入口导出，由 vendor-three-model3d.mjs 打成 IIFE。
 * @module dsh-pet/scripts/vendor/model3d-three-entry
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export { THREE, GLTFLoader };
