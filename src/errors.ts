/** Error base de la aplicación. */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Ollama no responde o devolvió un error. */
export class OllamaUnavailableError extends AppError {}

/** No hay índice o está vacío. */
export class IndexEmptyError extends AppError {}

/** El índice está en formato antiguo y hay que migrar. */
export class MigrationRequiredError extends AppError {}

/** El archivo embeddings.bin está corrupto o no coincide con index.json. */
export class StoreCorruptedError extends AppError {}
