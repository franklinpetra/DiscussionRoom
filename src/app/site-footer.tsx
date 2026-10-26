import Image from "next/image";

/** Every room's footer, the same in each: the caveat about AI, and where to send problems and ideas, beside the maker's mark. */
export default function SiteFooter({ room }: { room: string }) {
  return (
    <footer className="room-footer">
      <Image alt="Tandem Works" height={40} src="/tandem-works.png" width={30} />
      <div>
        <p>AI models can make mistakes, please check anything important before you rely on it.</p>
        <p>
          Please{" "}
          <a href={`mailto:petrafranklin@gmail.com?subject=${encodeURIComponent(`${room} feedback`)}`}>email</a> if
          something isn&apos;t working, or you have an idea for a new feature – Petra Franklin of Tandem Works
        </p>
      </div>
    </footer>
  );
}
