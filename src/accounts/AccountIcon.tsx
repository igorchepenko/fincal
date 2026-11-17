import { icons } from "./options";

export function AccountIcon({ id }: { id: string }) {
  const path = (icons.find((i) => i.id === id) ?? icons[1]).path;
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
