import { useLayoutEffect, useRef } from "preact/hooks";
import { type NoticeSettings, buildNotice } from "./early/notice";

export type { NoticeSettings };

/** Cart Drawer-এর ভেতরে Cart Notice-এর বার্তা (কার্ট পেজের বার্তার মতোই, early/notice.ts থেকে) */
export function Notice({ s }: { s: NoticeSettings }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const note = buildNotice(s);
    box.current?.replaceChildren(...(note ? [note] : []));
  }, [s]);
  return <div ref={box} />;
}
