// In-memory stand-in for lib/data/postgres — only what the footage engine
// touches. `isConfigured` is false so health writes are skipped.
export const isConfigured = false;
export async function atQuery() {
  return [];
}
export async function withTransaction(fn) {
  return fn(async () => []);
}
export const provenanceReady = async () => true;
export const footageReady = async () => true;
