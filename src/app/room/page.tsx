import { redirect } from "next/navigation";

// The room now lives on the home page.
export default function RoomPage() {
  redirect("/");
}
