import { useEffect, useRef, useState } from "react";
import site from "../../content/site.json";
import { encodeShare, shareUrl } from "../lib/share.ts";
import { useCalc } from "../lib/state.tsx";
import { t } from "../lib/text.ts";
import { originFrom, useFeedback } from "./Feedback.tsx";

export function ShareButton() {
  const { data } = useCalc();
  const { toast } = useFeedback();
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [withName, setWithName] = useState(false);
  const [link, setLink] = useState("");
  const s = site.share;

  useEffect(() => {
    if (!open) return;
    let live = true;
    encodeShare(data, withName).then((p) => { if (live) setLink(shareUrl(p)); });
    return () => { live = false; };
  }, [open, withName, data]);

  const show = () => {
    if (!data.subjects.length) { toast(s.empty); return; }
    setLink(""); setOpen(true);
    originFrom(dialog.current, document.activeElement);
    dialog.current?.showModal();
  };
  const close = () => { dialog.current?.close(); setOpen(false); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast(s.copied); }
    catch { field.current?.select(); toast(s.copyFailed); }
  };
  const canNative = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <>
      <button type="button" className="btn btn-icon sm:!w-auto sm:!px-3.5" aria-label={site.toolbar.share} onClick={show}>
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="m16 6-4-4-4 4" /><path d="M12 2v13" /></svg>
        <span className="hidden sm:inline">{site.toolbar.share}</span>
      </button>
      {/* Three ways out, always: ‹ Back at the top, Done at the bottom, or a tap outside / Escape. */}
      <dialog ref={dialog} className="confirm" aria-labelledby="share-title" onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div className="glass p-5 sm:p-6">
          <button type="button" className="paper-back mb-2" aria-label={s.backLabel} onClick={close}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>{s.back}
          </button>
          <h2 id="share-title" className="text-[1.15rem] font-semibold">{s.title}</h2>
          <p className="mt-2 text-[0.88rem] text-foreground-2">{s.body}</p>
          <label className="mt-4 flex items-start gap-2.5 text-[0.88rem]">
            <input type="checkbox" className="mt-0.5" checked={withName} onChange={(e) => setWithName(e.target.checked)} />
            <span>{s.includeName}<span className="block text-[0.76rem] text-foreground-3">{s.includeNameHelp}</span></span>
          </label>
          <label className="field mt-4" htmlFor="share-link">{s.linkLabel}
            <input id="share-link" ref={field} className="input font-mono !text-[0.78rem]" readOnly value={link || s.making} onFocus={(e) => e.currentTarget.select()} />
            {link && <span className="help">{t(s.chars, { n: link.length })}</span>}
          </label>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {canNative && <button type="button" className="btn" disabled={!link} onClick={() => navigator.share({ title: site.meta.title, url: link }).catch(() => {})}>{s.native}</button>}
            <button type="button" className="btn" disabled={!link} onClick={() => void copy()}>{s.copy}</button>
            <button type="button" className="btn btn-primary" onClick={close}>{s.close}</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
