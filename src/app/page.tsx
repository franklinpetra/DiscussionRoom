import GuestRoom from "@/app/room/guest-room";

export const metadata = { title: "The Discussion · The Room" };

/** The front door is The Discussion; Verity and the Clock are a click away in the header. A question can arrive as ?q=. */
export default async function Home({ searchParams }: PageProps<"/">) {
  const { q } = await searchParams;
  return (
    <main className="shell page-shell">
      <GuestRoom initialQuestion={typeof q === "string" ? q : ""} />
    </main>
  );
}
