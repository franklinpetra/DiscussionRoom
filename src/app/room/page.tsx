import { redirect } from "next/navigation";

/** The Discussion moved to the front door; old links (and their ?q= questions) follow it there. */
export default async function RoomPage({ searchParams }: PageProps<"/room">) {
  const { q } = await searchParams;
  redirect(typeof q === "string" && q ? `/?q=${encodeURIComponent(q)}` : "/");
}
