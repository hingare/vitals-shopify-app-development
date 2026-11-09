import { z } from "@app/tool-sdk";

/** কয়েকটা টুলে একই রকম ফিল্ড লাগে, তাই এখানে একবার লেখা */
export const text = (max: number, value = "") => z.string().trim().max(max).default(value);

/** ফাঁকা, https:// লিংক, বা স্টোরের ভেতরের পথ (/collections/sale) */
export const link = () =>
  z
    .string()
    .trim()
    .max(500)
    .regex(/^$|^https:\/\/\S+$|^\/\S*$/)
    .default("");
