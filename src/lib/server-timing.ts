export async function measureServerOperation<T>(timings: Record<string, number>, name: string, operation: () => Promise<T>) {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    timings[name] = Math.round(performance.now() - startedAt);
  }
}

export function logServerTiming(route: string, startedAt: number, timings: Record<string, number>, metadata: Record<string, number | string | boolean>) {
  console.info("[Server Timing]", {
    route,
    durationMs: Math.round(performance.now() - startedAt),
    operationsMs: timings,
    ...metadata,
  });
}
