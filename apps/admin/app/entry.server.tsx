import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, isRouteErrorResponse } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext, type HandleErrorFunction } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { startJobs } from "./lib/jobs.server";
import { recordError, requestLocation, requestShop } from "./lib/errors.server";

// Speed Guard মাপের মতো ব্যাকগ্রাউন্ড কাজ
startJobs();

export const streamTimeout = 5000;

/**
 * সার্ভারের পাতা বা রাস্তায় অপ্রত্যাশিত ত্রুটি: আগের মতো লগে, আর অ্যাপের ত্রুটির খাতায় (ডেস্কের Errors পাতা)।
 * 404-এর মতো ৫০০-এর নিচের উত্তর ত্রুটি নয়, তাই খাতায় যায় না। ব্যবহারকারী পাতা ছেড়ে গেলে বা নতুন অনুরোধে
 * আগেরটা বাতিল হলেও এটা ডাকা হয়; সেগুলো বাদ।
 */
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (request.signal.aborted) return;
  // React Router নিজের তৈরি উত্তরে (যেমন কোনো রাস্তা না মেলা) আসল ত্রুটিটা ভেতরে রাখে
  const inner = isRouteErrorResponse(error) ? (error as { error?: unknown }).error : undefined;
  const cause = inner ?? error;
  console.error(cause);
  if (isRouteErrorResponse(error) && error.status < 500) return;
  void recordError({
    source: "server",
    location: requestLocation(request),
    error: cause,
    shop: requestShop(request),
  });
};

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
