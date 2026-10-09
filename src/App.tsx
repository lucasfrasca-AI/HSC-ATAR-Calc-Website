import site from "../content/site.json";

export function App() {
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-16 sm:px-5">
      <h1 className="text-4xl font-semibold tracking-tight">{site.meta.title}</h1>
      <p className="mt-3 max-w-[60ch] text-foreground-2">{site.header.intro}</p>
      <footer className="mt-16 border-t border-border/15 pt-4 text-sm text-foreground-3">
        <p>{site.footer.disclaimer}</p>
        <p className="mt-2 text-xs">{site.footer.credit}</p>
      </footer>
    </main>
  );
}
