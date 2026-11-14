/** Loading placeholder. It shows that content is loading without inventing a value. */
function Skeleton({ width = "100%", height = 14, className = "" }) {
  return <span className={`mw-skeleton ${className}`} style={{ width, height }} aria-hidden="true" />;
}

export default Skeleton;
