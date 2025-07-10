let renderEngine = null
export function setRenderEngine(engine) {
  renderEngine = engine
}

// Modules/groupManager.js
export async function triggerGroup(groupId, matrix, player, cameraManager) {
  console.log(`Attempting to trigger group ${groupId}`)
  let activated = false

  // First pass: update all locks
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      const object = matrix[y][x]
      if (object && object.group === groupId && object.lock === "off") {
        object.lock = "0"
        activated = true
        console.log(`Group ${groupId} activated: Object at [${x},${y}] unlocked`)
      }
    }
  }

  // Then render ONCE after all updates
  if (activated && renderEngine && renderEngine.spriteMap && renderEngine.matrix) {
    const playerPos = { x: player.x, y: player.y }
    await renderEngine.reRenderMatrix(player, playerPos)
  }

  if (!activated) {
    console.log(`No objects found for group ${groupId} with lock: 'off'`)
  }
}

export function isObjectActive(object) {
  return !object || object.lock !== "off"
}

export function handleUnlockOrb(object, x, y, matrix, player, cameraManager) {
  if (object.lock === "unlock" && object.group) {
    triggerGroup(object.group, matrix, player, cameraManager)
  }
}
