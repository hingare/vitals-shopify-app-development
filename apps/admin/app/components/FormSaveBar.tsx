import { useCallback, useRef, useState } from "react";
import { SaveBar } from "@shopify/app-bridge-react";

/**
 * Shopify অ্যাডমিনের নিজের সেভ বার (contextual save bar): কিছু বদলালে উপরে Save আর Discard দেখায়,
 * আর সেভ বা বাতিল না করে অন্য পাতায় যেতে দেয় না। বোতামের লেখা অ্যাডমিন নিজেই মার্চেন্টের ভাষায় বসায়।
 */
export function FormSaveBar({
  id,
  dirty,
  saving,
  onSave,
  onDiscard,
}: {
  id: string;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <SaveBar id={id} open={dirty || saving} discardConfirmation>
      <button variant="primary" onClick={onSave} {...(saving ? { loading: "" } : {})} />
      <button onClick={onDiscard} {...(saving ? { disabled: true } : {})} />
    </SaveBar>
  );
}

/**
 * শেষবার সেভ হওয়া অবস্থার সাথে এখনকারটা মেলায়। সেভ পাঠানোর সময় begin(), সার্ভার সফল বললে commit():
 * সেভ চলার মধ্যে মার্চেন্ট আরও কিছু বদলালে সেটুকু তখনো "বদলানো" থাকে।
 */
export function useSaveState<T>(current: T) {
  const snapshot = JSON.stringify(current);
  const [saved, setSaved] = useState(snapshot);
  const pending = useRef<string | null>(null);
  /** next: সেভের আগে মান ঠিক করে নিলে (যেমন সীমার মধ্যে আনা) যা আসলে পাঠানো হলো */
  const begin = useCallback(
    (next?: T) => {
      pending.current = next === undefined ? snapshot : JSON.stringify(next);
    },
    [snapshot],
  );
  const commit = useCallback(() => {
    if (pending.current !== null) setSaved(pending.current);
    pending.current = null;
  }, []);
  /** শেষবার সেভ হওয়া মান (Discard-এ ফিরিয়ে আনার জন্য) */
  const lastSaved = useCallback(() => JSON.parse(saved) as T, [saved]);
  return { dirty: snapshot !== saved, begin, commit, saved: lastSaved };
}
