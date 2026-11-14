export function AvatarImg({ src, name, className = "" }: { src: string | null; name: string; className?: string }) {
  return src ? (
    <img src={src} alt={name} className={`rounded-full object-cover ${className}`} />
  ) : (
    <div className={`flex items-center justify-center rounded-full bg-secondary font-display text-primary ${className}`}>{name.slice(0, 1)}</div>
  );
}
