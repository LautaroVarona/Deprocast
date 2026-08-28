export async function waitWhile(
  cond: () => boolean,
  ms: number,
  stepMs = 40,
): Promise<void> {
  const t0 = Date.now()
  while (cond() && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, stepMs))
  }
}
