import ClockRoom from "@/app/clock/clock-room";
import SiteFooter from "@/app/site-footer";

export const metadata = { title: "Creative Clock" };

/** Creative Clock: makers around a clock face build one idea together. */
export default function ClockPage() {
  return (
    <main className="shell page-shell">
      <ClockRoom />
      <SiteFooter room="Creative Clock" />
    </main>
  );
}
