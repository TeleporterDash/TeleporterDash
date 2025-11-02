interface LayeredAppearance {
  depthOffset: number;
}

interface LayeredObject {
  layer: number;
  appearance: LayeredAppearance;
}

type MatrixCell = LayeredObject | null | undefined;

interface LayerEntry {
  object: LayeredObject;
  x: number;
  y: number;
}

export function getLayerOrder(matrix: MatrixCell[][]): LayerEntry[] {
  const objects: LayerEntry[] = [];
  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y];
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (cell) {
        objects.push({ object: cell, x, y });
      }
    }
  }
  return objects.sort((a, b) => {
    const layerDiff = a.object.layer - b.object.layer;
    if (layerDiff !== 0) return layerDiff;
    return a.object.appearance.depthOffset - b.object.appearance.depthOffset;
  });
}
