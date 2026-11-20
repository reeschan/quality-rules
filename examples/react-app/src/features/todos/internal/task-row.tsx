import type { Task } from '@/domain/task';

interface TaskRowProps {
  readonly task: Task;
  readonly onSwitch: () => void;
}

/** One line of the list: the title and a button that switches the task between open and done. */
export function TaskRow(props: TaskRowProps) {
  return (
    <li>
      <span>{props.task.title}</span>
      <button type="button" onClick={props.onSwitch}>
        {props.task.status}
      </button>
    </li>
  );
}
