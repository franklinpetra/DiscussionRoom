import ClockRoom from "@/app/clock/clock-room";
import SiteFooter from "@/app/site-footer";

const DESCRIPTION =
  "Describe a project and seat the makers it needs: thinkers, interface designers, a painter, a composer, testers. They build it together into something you can try.";

export const metadata = {
  title: "Creative Clock",
  description: DESCRIPTION,
  openGraph: { type: "website", siteName: "Creative Clock", title: "Creative Clock", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "Creative Clock", description: DESCRIPTION },
};

/** Creative Clock: makers around a clock face build one idea together. */
export default function ClockPage() {
  return (
    <main className="shell page-shell">
      <ClockRoom />
      <SiteFooter room="Creative Clock" />
    </main>
  );
}
