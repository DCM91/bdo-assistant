/**
 * Similitud coseno entre dos vectores numéricos.
 * Devuelve 0 si alguno tiene norma 0 o las dimensiones no coinciden.
 */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Similitud coseno de un vector de consulta contra una fila de una matriz
 * de embeddings almacenada en un Float32Array plano (row-major).
 * Evita copiar la fila: itera directamente sobre el buffer.
 */
export function cosineSimilarityRow(
  query: ArrayLike<number>,
  matrix: Float32Array,
  row: number,
  dims: number,
  queryNorm?: number,
): number {
  const offset = row * dims;
  if (offset + dims > matrix.length || query.length !== dims) return 0;
  let dot = 0;
  let normB = 0;
  let normA = 0;
  for (let i = 0; i < dims; i++) {
    const q = query[i];
    const v = matrix[offset + i];
    dot += q * v;
    normB += v * v;
    normA += q * q;
  }
  if (normB === 0) return 0;
  const nA = queryNorm ?? Math.sqrt(normA);
  if (nA === 0) return 0;
  return dot / (nA * Math.sqrt(normB));
}

/** Norma L2 de un vector. */
export function l2Norm(v: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}
