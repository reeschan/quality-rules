export function Profile({ name, avatar }: { name: string; avatar: string }) {
  return (
    <section>
      <img src={avatar} />
      <p>{name}</p>
    </section>
  );
}
