export function Clean(props: { items: string[]; avatar: string }) {
  return (
    <nav>
      <img src={props.avatar} alt="Profile" />
      <ul>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <button type="button">Save</button>
      <section aria-label="Details">Open</section>
    </nav>
  );
}
