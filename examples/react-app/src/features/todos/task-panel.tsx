import { useState } from 'react';
import type { Task } from '@/domain/task';
import { appendTask, completionRatio, switchStatus } from '@/domain/task-list';
import { normalizeTitle } from '@/domain/title';
import { TaskRow } from './internal/task-row';

interface TaskPanelProps {
  readonly initial: readonly Task[];
}

/** A list of tasks with a form that adds one and a button on each task that switches it. */
export function TaskPanel(props: TaskPanelProps) {
  const [tasks, setTasks] = useState<readonly Task[]>(props.initial);
  const [draft, setDraft] = useState('');

  function submit() {
    const title = normalizeTitle(draft);
    if (title === '') {
      return;
    }
    setTasks(appendTask(tasks, title));
    setDraft('');
  }

  return (
    <section>
      <p>{Math.round(completionRatio(tasks) * 100)}% done</p>
      <ul>
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onSwitch={() => setTasks(switchStatus(tasks, task.id))}
          />
        ))}
      </ul>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button type="button" onClick={submit}>
        Add
      </button>
    </section>
  );
}
