export function Toolbar(props: { labels: string[]; onClose: () => void }) {
  return (
    <header>
      <ol>
        {props.labels.map((label) => (
          <li>{label}</li>
        ))}
      </ol>
      <button onClick={props.onClose}>Close</button>
      <span role="tooltipp">Help</span>
      <a></a>
      <p>// not a comment</p>
    </header>
  );
}
