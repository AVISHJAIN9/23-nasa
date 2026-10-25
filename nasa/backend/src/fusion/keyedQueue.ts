/**
 * In-process per-key sequential asynchronous task queue.
 * Ensures that operations targeting the same group_key (e.g. "crew-01:respiratory")
 * are strictly serialized without blocking operations on distinct keys.
 */
export class KeyedQueue {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly counts = new Map<string, number>();

  /**
   * Enqueues a task for the specified key. Executes sequentially behind
   * any pending tasks for this key.
   */
  public enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const currentCount = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, currentCount);

    const prevPromise = this.queues.get(key) ?? Promise.resolve();

    const runTask = async (): Promise<T> => {
      try {
        await prevPromise;
      } catch {
        // Previous task failure should not abort the next queued task
      }
      return await task();
    };

    const taskPromise = runTask();

    // Store the tail promise for subsequent tasks
    this.queues.set(key, taskPromise);

    return taskPromise.finally(() => {
      const remaining = (this.counts.get(key) ?? 1) - 1;
      if (remaining <= 0) {
        this.counts.delete(key);
        // Only delete from queues if this is still the active tail
        if (this.queues.get(key) === taskPromise) {
          this.queues.delete(key);
        }
      } else {
        this.counts.set(key, remaining);
      }
    });
  }

  /**
   * Returns queue depth (pending items) for a key or the entire queue system.
   */
  public getDepth(key?: string): number {
    if (key !== undefined) {
      return this.counts.get(key) ?? 0;
    }
    let total = 0;
    for (const count of this.counts.values()) {
      total += count;
    }
    return total;
  }
}
