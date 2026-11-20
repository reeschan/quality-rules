export function Menu(props: { items: string[]; onSave: () => void }) {
  return (
    <nav>
      <ul>
        {props.items.map((item) => (
          <li>{item}</li>
        ))}
      </ul>
      <button onClick={props.onSave}>Save</button>
      <div role="buttn">Open</div>
    </nav>
  );
}
