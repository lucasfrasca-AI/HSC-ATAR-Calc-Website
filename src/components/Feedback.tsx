// Toasts (announced politely to screen readers) and an accessible confirm
// dialog built on <dialog>, replacing the reference's window.confirm().
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import site from "../../content/site.json";

export interface ToastAction { label: string; run: () => void }
interface Feedback { toast: (text: string, action?: ToastAction) => void; confirm: (text: string) => Promise<boolean> }

/** Sets a dialog's transform-origin to the element that opened it, so it grows from its source (Apple §7). */
export function originFrom(dialog: HTMLDialogElement | null, trigger: Element | null) {
  if (!dialog) return;
  const r = (trigger ?? document.activeElement)?.getBoundingClientRect();
  if (!r) return;
  const w = Math.min(420, window.innerWidth - 32), h = 260;
  dialog.style.setProperty("--from-x", `${r.left + r.width / 2 - (window.innerWidth - w) / 2}px`);
  dialog.style.setProperty("--from-y", `${r.top + r.height / 2 - (window.innerHeight - h) / 2}px`);
}
const Ctx = createContext<Feedback | null>(null);
export const useFeedback = () => useContext(Ctx)!;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState("");
  const [action, setAction] = useState<ToastAction | null>(null);
  const [on, setOn] = useState(false);
  const timer = useRef(0);
  const toast = useCallback((t: string, a?: ToastAction) => {
    setText(t); setAction(a ?? null); setOn(true);
    window.clearTimeout(timer.current);
    // Longer when there's something to act on.
    timer.current = window.setTimeout(() => setOn(false), a ? 6000 : 2600);
  }, []);

  const dialog = useRef<HTMLDialogElement>(null);
  const [question, setQuestion] = useState("");
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirm = useCallback((q: string) => {
    setQuestion(q);
    originFrom(dialog.current, document.activeElement);
    dialog.current?.showModal();
    return new Promise<boolean>((res) => { resolver.current = res; });
  }, []);
  const close = (ok: boolean) => { dialog.current?.close(); resolver.current?.(ok); resolver.current = null; };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toast glass glass-sm" role="status" aria-live="polite" data-on={on} data-action={!!action}>
        <span>{text}</span>
        {action && on && <button type="button" className="toast-action" onClick={() => { action.run(); setOn(false); }}>{action.label}</button>}
      </div>
      <dialog ref={dialog} className="confirm" aria-labelledby="confirm-q" onCancel={(e) => { e.preventDefault(); close(false); }}>
        <div className="glass p-5">
          <p id="confirm-q" className="text-[0.95rem]">{question}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => close(false)} autoFocus>{site.dialogs.cancel}</button>
            <button type="button" className="btn btn-primary" onClick={() => close(true)}>{site.dialogs.confirm}</button>
          </div>
        </div>
      </dialog>
    </Ctx.Provider>
  );
}
