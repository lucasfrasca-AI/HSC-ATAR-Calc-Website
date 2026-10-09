import { createContext, useContext } from "react";

export type TabKey = "calc" | "subj" | "syl" | "help";
export interface Nav { go: (tab: TabKey, focusId?: string) => void; jumpToSubject: (uid: string) => void; scrollTo: (id: string) => void }
export const NavCtx = createContext<Nav | null>(null);
export const useNav = () => useContext(NavCtx)!;
