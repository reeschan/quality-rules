export function Card({ title, image }: { title: string; image: string }) {
  return (
    <article>
      <img src={image} />
      <h2>{title}</h2>
    </article>
  );
}
