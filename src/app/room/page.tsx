import GuestRoom from "@/app/room/guest-room";

export const metadata = { title: "The Discussion · The Room" };

/** The Discussion. An example question from the arrival page arrives as ?q=. */
export default async function RoomPage({ searchParams }: PageProps<"/room">) {
  const { q } = await searchParams;
  return (
    <main className="shell page-shell">
      <GuestRoom initialQuestion={typeof q === "string" ? q : ""} />
    </main>
  );
}
