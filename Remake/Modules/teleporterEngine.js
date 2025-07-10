// Modules/teleporterEngine.js
export function getTeleportTarget(object, matrix) {
  if (!object.id) return null

  if (object.type === 7 || object.type === 8) {
    const targetType = object.type === 7 ? 8 : 7
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        const target = matrix[y][x]
        if (target && target.id === object.id && target !== object && target.type === targetType) {
          return { x, y }
        }
      }
    }
  }

  return null
}
