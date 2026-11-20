import { TaskStatus } from '@/domain/task';
import { TaskPanel } from '@/features/todos';

const INITIAL_TASKS = [
  { id: 1, title: 'Write the first task', status: TaskStatus.Done },
  { id: 2, title: 'Add a second one', status: TaskStatus.Open },
];

/** The page: a heading above the task panel. */
export function App() {
  return (
    <main>
      <h1>Task list</h1>
      <TaskPanel initial={INITIAL_TASKS} />
    </main>
  );
}
