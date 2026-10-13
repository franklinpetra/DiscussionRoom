import Link from "next/link";
import GuestRoom from "@/app/room/guest-room";

export default function RoomPage() {
  return (
    <main className="shell page-shell">
      <header className="masthead">
        <Link className="wordmark" href="/">The Room</Link>
        <Link className="quiet-link" href="/login">Sign in</Link>
      </header>
      <GuestRoom />
    </main>
  );
}
