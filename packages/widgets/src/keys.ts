/** ব্রাউজারে বানানো গোপন চাবি: ৩২ বাইট র‍্যান্ডম, URL-নিরাপদ base64 (৪৩ অক্ষর); সার্ভার শুধু এর hash রাখে */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
