import { register } from "@shopify/web-pixels-extension";
import { startPixel } from "./pixel";

// পিক্সেলের সব কাজ pixel.ts-এ, যাতে Shopify-র sandbox ছাড়াই তা টেস্ট করা যায়
register(startPixel);
