// Toasts (announced politely to screen readers) and an accessible confirm
// dialog built on <dialog>, replacing the reference's window.confirm().
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import site from "../../content/site.json";

interface Feedback { toast: (text: string) => void; confirm: (text: string) => Promise<boolean> }
const Ctx = createContext<Feedback | null>(null);
export const useFeedback = () => useContext(Ctx)!;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState("");
  const [on, setOn] = useState(false);
  const timer = useRef(0);
  const toast = useCallback((t: string) => {
    setText(t); setOn(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), 2600);
  }, []);

  const dialog = useRef<HTMLDialogElement>(null);
  const [question, setQuestion] = useState("");
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirm = useCallback((q: string) => {
    setQuestion(q);
    dialog.current?.showModal();
    return new Promise<boolean>((res) => { resolver.current = res; });
  }, []);
  const close = (ok: boolean) => { dialog.current?.close(); resolver.current?.(ok); resolver.current = null; };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toast glass glass-sm" role="status" aria-live="polite" data-on={on}>{text}</div>
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
