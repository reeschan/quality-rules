import { type Task, TaskStatus } from '@/domain/task';

const OTHER_STATUS: Record<TaskStatus, TaskStatus> = {
  [TaskStatus.Open]: TaskStatus.Done,
  [TaskStatus.Done]: TaskStatus.Open,
};

/** Returns the tasks with the given status, in their original order. */
export function tasksWithStatus(tasks: readonly Task[], status: TaskStatus): Task[] {
  return tasks.filter((task) => task.status === status);
}

/** Returns the share of finished tasks from 0 to 1, or 0 for an empty list. */
export function completionRatio(tasks: readonly Task[]): number {
  if (tasks.length === 0) {
    return 0;
  }
  return tasksWithStatus(tasks, TaskStatus.Done).length / tasks.length;
}

/** Returns the list with one more open task whose id follows the highest id so far. */
export function appendTask(tasks: readonly Task[], title: string): Task[] {
  const highestId = Math.max(0, ...tasks.map((task) => task.id));
  return [...tasks, { id: highestId + 1, title, status: TaskStatus.Open }];
}

/** Returns the list with the status of the task with the given id switched. */
export function switchStatus(tasks: readonly Task[], id: number): Task[] {
  return tasks.map((task) => {
    if (task.id !== id) {
      return task;
    }
    return { ...task, status: OTHER_STATUS[task.status] };
  });
}
