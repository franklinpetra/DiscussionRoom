import GuestRoom from "@/app/room/guest-room";
import SiteFooter from "@/app/site-footer";

export const metadata = { title: "Discussion" };

/** The front door is Discussion; Verity and Creative Clock are a click away in the header. A question can arrive as ?q=. */
export default async function Home({ searchParams }: PageProps<"/">) {
  const { q } = await searchParams;
  return (
    <main className="shell page-shell">
      <GuestRoom initialQuestion={typeof q === "string" ? q : ""} />
      <SiteFooter room="Discussion" />
    </main>
  );
}
