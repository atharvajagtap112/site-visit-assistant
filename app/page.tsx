import { redirect } from "next/navigation";

// ponytail: staff sign-in is the only screen so far. The buyer project page replaces this on Day 3.
export default function Home() {
  redirect("/sign-in");
}
