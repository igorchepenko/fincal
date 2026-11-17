const paths: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  calendar: "M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8.5 3v4M15.5 3v4",
  list: "M9 6.5h10M9 12h10M9 17.5h10M5 6.5h.01M5 12h.01M5 17.5h.01",
  wallet: "M4 7.5A1.5 1.5 0 0 1 5.5 6H18a2 2 0 0 1 2 2v9.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM4 8.5V7M16 13h.01",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l1.8-1.4-1.8-3.1-2.1.8a7 7 0 0 0-2-1.2L14.5 3h-3.6l-.3 2.9a7 7 0 0 0-2 1.2l-2.1-.8-1.8 3.1 1.8 1.4a7 7 0 0 0 0 2.4l-1.8 1.4 1.8 3.1 2.1-.8a7 7 0 0 0 2 1.2l.3 2.9h3.6l.3-2.9a7 7 0 0 0 2-1.2l2.1.8 1.8-3.1-1.8-1.4c.1-.4.1-.8.1-1.2z",
};

export function Icon({ name }: { name: string }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
