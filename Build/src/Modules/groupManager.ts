import type CameraManager from "./cameraManager";

interface Vector2 {
  x: number;
  y: number;
}

interface GroupObject {
  group?: string | number;
  lock?: string;
  [key: string]: unknown;
}

type GroupMatrix = Array<Array<GroupObject | null | undefined>>;

interface PlayerLike {
  x: number;
  y: number;
}

interface RenderEngineBridge {
  spriteMap: Map<string, unknown> | null;
  matrix: GroupMatrix | null;
  reRenderMatrix: (player: PlayerLike, playerPos: Vector2) => Promise<void>;
}

let renderEngine: RenderEngineBridge | null = null;

export function setRenderEngine(engine: RenderEngineBridge | null): void {
  renderEngine = engine;
}

export async function triggerGroup(
  groupId: string | number,
  matrix: GroupMatrix,
  player: PlayerLike,
  cameraManager?: any | null
): Promise<void> {
  console.log(`Attempting to trigger group ${groupId}`);
  let activated = false;

  // First pass: update all locks
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      const object = matrix[y][x];
      if (object && object.group === groupId && object.lock === "off") {
        object.lock = "0";
        activated = true;
        console.log(
          `Group ${groupId} activated: Object at [${x},${y}] unlocked`
        );
      }
    }
  }

  // Then render ONCE after all updates
  if (activated && renderEngine?.spriteMap && renderEngine.matrix) {
    const playerPos: Vector2 = { x: player.x, y: player.y };
    await renderEngine.reRenderMatrix(player, playerPos);
  }

  if (!activated) {
    console.log(`No objects found for group ${groupId} with lock: 'off'`);
  }
}

export function isObjectActive(
  object: GroupObject | null | undefined
): boolean {
  return !object || object.lock !== "off";
}

export function handleUnlockOrb(
  object: GroupObject,
  x: number,
  y: number,
  matrix: GroupMatrix,
  player: PlayerLike,
  cameraManager?: any | null
): void {
  if (object.lock === "unlock" && object.group) {
    triggerGroup(object.group, matrix, player, cameraManager);
  }
}
