import { describe, expect, it } from 'vitest';
import { type Task, TaskStatus } from '@/domain/task';
import { appendTask, completionRatio, switchStatus, tasksWithStatus } from '@/domain/task-list';

const tasks: Task[] = [
  { id: 1, title: 'one', status: TaskStatus.Done },
  { id: 2, title: 'two', status: TaskStatus.Open },
];

describe('task list', () => {
  it('keeps only the tasks with the given status', () => {
    expect(tasksWithStatus(tasks, TaskStatus.Open).map((task) => task.id)).toEqual([2]);
  });

  it('measures how much of the list is done', () => {
    expect(completionRatio(tasks)).toBe(0.5);
    expect(completionRatio([])).toBe(0);
  });

  it('adds an open task with the next id', () => {
    expect(appendTask(tasks, 'three')).toEqual([
      ...tasks,
      { id: 3, title: 'three', status: TaskStatus.Open },
    ]);
  });

  it('switches one task between open and done', () => {
    expect(switchStatus(tasks, 2).map((task) => task.status)).toEqual([
      TaskStatus.Done,
      TaskStatus.Done,
    ]);
    expect(switchStatus(tasks, 1).map((task) => task.status)).toEqual([
      TaskStatus.Open,
      TaskStatus.Open,
    ]);
  });
});
