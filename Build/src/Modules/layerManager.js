// Modules/layerManager.js
export function getLayerOrder(matrix) {
  const objects = []
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (matrix[y][x]) objects.push({ object: matrix[y][x], x, y })
    }
  }
  return objects.sort((a, b) => {
    const layerDiff = a.object.layer - b.object.layer
    if (layerDiff !== 0) return layerDiff
    return a.object.appearance.depthOffset - b.object.appearance.depthOffset
  })
}
