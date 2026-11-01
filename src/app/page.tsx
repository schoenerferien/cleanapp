import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(user.role === "owner" ? "/dashboard" : "/ma");
}
