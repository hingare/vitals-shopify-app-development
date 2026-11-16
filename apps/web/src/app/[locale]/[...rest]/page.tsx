import { notFound } from "next/navigation";

/** Any unknown address inside a language shows the translated 404 page. */
export default function CatchAll() {
  notFound();
}
