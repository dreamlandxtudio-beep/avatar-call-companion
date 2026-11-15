export function AvatarImg({
  src,
  name,
  className = "",
}: {
  src: string | null;
  name: string;
  className?: string;
}) {
  const effectiveSrc = src || "/avatars/default.jpg";
  return <img src={effectiveSrc} alt={name} className={`rounded-full object-cover ${className}`} />;
}
