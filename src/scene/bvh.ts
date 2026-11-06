/**
 * 用 three-mesh-bvh 加速场景拾取：外墙窗格有四十多万个三角形，逐个求交会卡。
 */
import { BufferGeometry, Mesh } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;
