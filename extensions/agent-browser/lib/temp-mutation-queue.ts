let tempMutationQueue = Promise.resolve();

/** One queue owns all root cleanup, preservation, spill writes and persistent eviction. */
export function enqueueTempMutation<T>(task: () => Promise<T>): Promise<T> {
	const nextTask = tempMutationQueue.then(task, task);
	tempMutationQueue = nextTask.then(
		() => undefined,
		() => undefined,
	);
	return nextTask;
}
