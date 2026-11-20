export function Tidy(props: { labels: string[]; picture: string }) {
  return (
    <main>
      <img src={props.picture} alt="Picture" />
      <ol>
        {props.labels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ol>
      <button type="submit">Send</button>
      <a href="/help">Help</a>
    </main>
  );
}
