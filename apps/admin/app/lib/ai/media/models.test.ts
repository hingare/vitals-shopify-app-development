import { describe, expect, it } from "vitest";
import {
  BACKGROUND_PRICE,
  EXPAND_PRICE,
  PRODUCT_SHOT_PRICE,
  UPSCALE_MAX_MICROS,
  alreadyShape,
  expandPlan,
  plainEnglish,
  productShotPayload,
  sizedImage,
  upscaleAllowed,
  upscalePlan,
  videoModel,
  videoPrice,
} from "./models";

const URL = "https://cdn.shopify.com/s/files/1/shirt.jpg?v=1";

describe("photo sizes sent to the models", () => {
  it("shrinks only the long side, keeps small photos as they are, and assumes a square when unknown", () => {
    expect(sizedImage(URL, { width: 4000, height: 2000 }, 2048)).toEqual({
      url: `${URL}&width=2048`,
      size: { width: 2048, height: 1024 },
    });
    expect(sizedImage(URL, { width: 1000, height: 3000 }, 1500)).toEqual({
      url: `${URL}&height=1500`,
      size: { width: 500, height: 1500 },
    });
    expect(sizedImage(URL, { width: 800, height: 600 }, 2048)).toEqual({
      url: URL,
      size: { width: 800, height: 600 },
    });
    expect(sizedImage(URL, null, 1024)).toEqual({
      url: `${URL}&width=1024`,
      size: { width: 1024, height: 1024 },
    });
  });
});

describe("prices (micro-dollars; 10,000 = one credit)", () => {
  it("keeps every photo tool within a few credits", () => {
    expect(BACKGROUND_PRICE).toBe(18_000);
    expect(EXPAND_PRICE).toBe(40_000);
    expect(PRODUCT_SHOT_PRICE).toBe(40_000);
    // ১০২৪-এর বর্গ ছবি ৪ গুণ = ৪০৯৬ বর্গ = ১৬.৮ MP, উপরের দিকে ১৭
    expect(UPSCALE_MAX_MICROS).toBe(17_000);
  });

  it("prices an upscale by the size of the result and never above the shown maximum", () => {
    const small = upscalePlan(URL, { width: 500, height: 400 });
    expect(small.output).toEqual({ width: 2000, height: 1600 });
    expect(small.costMicros).toBe(4_000);
    expect(small.payload).toMatchObject({ upscale_mode: "factor", upscale_factor: 4 });
    for (const size of [null, { width: 2999, height: 2999 }, { width: 1024, height: 700 }]) {
      expect(upscalePlan(URL, size).costMicros).toBeLessThanOrEqual(UPSCALE_MAX_MICROS);
    }
    expect(upscaleAllowed({ width: 2999, height: 1000 })).toBe(true);
    expect(upscaleAllowed({ width: 3000, height: 1000 })).toBe(false);
  });

  it("uses Kling by default and LTX when chosen, and nothing for an unknown model", () => {
    expect(videoPrice("short", {})).toEqual({ seconds: 5, micros: 280_000 });
    expect(videoPrice("long", {})).toEqual({ seconds: 10, micros: 560_000 });
    expect(videoPrice("short", { AI_VIDEO_MODEL: "ltx" })).toEqual({ seconds: 6, micros: 240_000 });
    expect(videoPrice("long", { AI_VIDEO_MODEL: "ltx" })).toEqual({ seconds: 10, micros: 400_000 });
    expect(videoModel({ AI_VIDEO_MODEL: "toString" })).toBeNull();
    expect(videoPrice("short", { AI_VIDEO_MODEL: "nope" })).toBeNull();
    expect(videoModel({})?.payload("https://x", "move", 10)).toMatchObject({ duration: "10" });
  });
});

describe("extending a photo to a new shape", () => {
  it("adds space only on the short side and centres the photo", () => {
    const plan = expandPlan(URL, { width: 1000, height: 800 }, "1:1");
    expect(plan?.payload).toEqual({
      image_url: URL,
      canvas_size: [1000, 1000],
      original_image_size: [1000, 800],
      original_image_location: [0, 100],
    });
    const wide = expandPlan(URL, { width: 1000, height: 1000 }, "16:9");
    expect(wide?.canvas).toEqual({ width: 1778, height: 1000 });
    expect(wide?.payload.original_image_location).toEqual([389, 0]);
  });

  it("zooms out on every side, and has nothing to do when the shape already fits", () => {
    expect(expandPlan(URL, { width: 1000, height: 500 }, "zoom-out")?.canvas).toEqual({
      width: 1400,
      height: 700,
    });
    expect(alreadyShape({ width: 1000, height: 1010 }, "1:1")).toBe(true);
    expect(expandPlan(URL, { width: 800, height: 1000 }, "4:5")).toBeNull();
    expect(alreadyShape(null, "1:1")).toBe(false);
  });
});

describe("photoshoot and prompts", () => {
  it("asks for exactly the number of photos chosen, in a fixed spot, in the chosen shape", () => {
    expect(productShotPayload(URL, "on a table", 3, "portrait")).toMatchObject({
      num_results: 3,
      placement_type: "manual_placement",
      shot_size: [1000, 1250],
    });
    expect(productShotPayload(URL, "on a table", 1, "square").shot_size).toEqual([1000, 1000]);
  });

  it("sends plain English straight to the model and anything else through translation", () => {
    expect(plainEnglish("Slow turn around the bottle, soft light.")).toBe(true);
    expect(plainEnglish("ধীরে ধীরে ঘুরবে")).toBe(false);
    expect(plainEnglish("café table")).toBe(false);
  });
});
