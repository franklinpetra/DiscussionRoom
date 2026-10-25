import Link from "next/link";

export type RoomId = "discussion" | "verity" | "clock";

/** The three rooms, centred in every room's header; the current one is marked. */
export default function RoomSwitch({ current }: { current: RoomId }) {
  const mark = (room: RoomId) => (room === current ? ("page" as const) : undefined);
  return (
    <nav aria-label="Rooms" className="room-switch">
      <Link aria-current={mark("discussion")} href="/">The Discussion</Link>
      {/* Verity is a separate static app served from /verity, so a plain link. */}
      <a aria-current={mark("verity")} href="/verity">Verity</a>
      <Link aria-current={mark("clock")} href="/clock">The Clock</Link>
    </nav>
  );
}
