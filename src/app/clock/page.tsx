import ClockRoom from "@/app/clock/clock-room";

export const metadata = { title: "The Clock · The Room" };

/** The Clock: makers around a clock face build one idea together. */
export default function ClockPage() {
  return (
    <main className="shell page-shell">
      <ClockRoom />
    </main>
  );
}
