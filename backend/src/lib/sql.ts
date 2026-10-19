/**
 * يهيّئ نمط بحث جزئي (ILIKE) مع تهريب محارف البدل لمنع تغيير معنى النمط.
 * يُستخدم مع: column ILIKE $n ESCAPE '\'
 */
export function containsPattern(value: string): string {
  const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}
