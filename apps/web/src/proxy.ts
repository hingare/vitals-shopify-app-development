import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Every page, but not the API, Next.js files, or files with an extension (robots.txt, llms.txt).
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
