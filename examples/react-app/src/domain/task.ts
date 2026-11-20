/** The states a task can be in. */
export const TaskStatus = {
  Open: 'open',
  Done: 'done',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/** One entry of the task list. */
export interface Task {
  readonly id: number;
  readonly title: string;
  readonly status: TaskStatus;
}
