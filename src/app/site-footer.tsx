/** Every room's footer: the honest caveat about AI, who made it, and where to send ideas. */
export default function SiteFooter({ room }: { room: string }) {
  return (
    <footer className="site-footer">
      <p>
        AI models can make mistakes, including about sources. Check anything important before you rely on it.
      </p>
      <p>
        Made by Petra Franklin at Tandem Works. If something isn&apos;t working, or there&apos;s a feature you&apos;d
        like, email{" "}
        <a href={`mailto:petrafranklin@gmail.com?subject=${encodeURIComponent(`${room} feedback`)}`}>
          petrafranklin@gmail.com
        </a>
        .
      </p>
    </footer>
  );
}
